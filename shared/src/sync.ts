import { ApiError, type KotobaApi } from './api'
import { backoffMs } from './backoff'
import { getMeta, setMeta, type KotobaDB } from './db'
import { normalizeSurface, rebaseOnto } from './local'
import type { Word, WordPayload } from './types'

export type SyncApi = Pick<KotobaApi, 'putWord' | 'deleteWord' | 'sync'>
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'auth_required' | 'access_expired'

export interface SyncStatus {
  state: SyncState
  lastSyncAt: number | null
  pending: number
  lastError: string | null
}

export interface SyncEngineOptions {
  db: KotobaDB
  api: SyncApi
  now?: () => number
  random?: () => number
  /** Called when the server rejects the stored token (revoked device), so the app can forget it. */
  onAuthRevoked?: () => void | Promise<void>
}

const PAGE_SIZE = 500

export class SyncEngine {
  status: SyncStatus = { state: 'idle', lastSyncAt: null, pending: 0, lastError: null }
  private running: Promise<SyncStatus> | null = null
  private readonly listeners = new Set<(s: SyncStatus) => void>()
  private readonly db: KotobaDB
  private readonly api: SyncApi
  private readonly now: () => number
  private readonly random: () => number
  private readonly onAuthRevoked: SyncEngineOptions['onAuthRevoked']

  constructor(opts: SyncEngineOptions) {
    this.db = opts.db
    this.api = opts.api
    this.now = opts.now ?? Date.now
    this.random = opts.random ?? Math.random
    this.onAuthRevoked = opts.onAuthRevoked
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Push the outbox, then pull. Concurrent callers share the in-flight run. */
  sync(): Promise<SyncStatus> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async run(): Promise<SyncStatus> {
    this.update({ state: 'syncing' })
    let outcome: Partial<SyncStatus>
    try {
      const pushed = await this.push()
      await this.pull()
      // The server answered, so writes held back by network backoff can go now.
      if (pushed === 'blocked' && (await this.liftNetworkBackoff())) await this.push()
      outcome = { state: 'idle', lastSyncAt: this.now(), lastError: null }
    } catch (e) {
      outcome = failure(e)
      if (e instanceof ApiError && e.kind === 'auth' && e.status === 401) await this.onAuthRevoked?.()
    }
    this.update({ ...outcome, pending: await this.db.outbox.count() })
    return this.status
  }

  private update(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn(this.status)
  }

  private async liftNetworkBackoff(): Promise<boolean> {
    const lifted = await this.db.outbox
      .filter((e) => e.last_error_kind === 'network' && e.next_try_at > this.now())
      .modify({ next_try_at: 0 })
    return lifted > 0
  }

  private async push(): Promise<'done' | 'blocked'> {
    const { db, api } = this
    const entries = await db.outbox.orderBy('seq').toArray()
    for (const entry of entries) {
      // Keep this device's write order: a backed-off head blocks the rest (pull still runs).
      if (entry.next_try_at > this.now()) return 'blocked'
      const seq = entry.seq as number
      let payload = entry.payload
      if (entry.needs_rebase) {
        const canonical = await db.words.get(entry.word_id)
        if (!canonical) continue // the survivor arrives with a later pull
        payload = rebaseOnto(canonical, payload as WordPayload)
        await db.outbox.update(seq, { payload, needs_rebase: false })
      }
      try {
        const out =
          entry.op === 'put'
            ? await api.putWord(entry.word_id, payload as WordPayload)
            : await api.deleteWord(entry.word_id, (payload as { deleted_at: number }).deleted_at)
        await db.transaction('rw', db.words, db.outbox, async () => {
          await db.outbox.delete(seq)
          if (out) await applyServerWord(db, out.word, entry.word_id)
        })
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'http' && !isTransient(e.status)) {
          await db.transaction('rw', db.outbox, db.syncErrors, async () => {
            await db.outbox.delete(seq)
            await db.syncErrors.add({ at: this.now(), word_id: entry.word_id, op: entry.op, status: e.status, message: e.message })
          })
          continue
        }
        if (e instanceof ApiError && (e.kind === 'network' || e.kind === 'http')) {
          const attempts = entry.attempts + 1
          await db.outbox.update(seq, {
            attempts,
            next_try_at: this.now() + backoffMs(attempts, this.random()),
            last_error_kind: e.kind,
          })
        }
        throw e
      }
    }
    return 'done'
  }

  private async pull(): Promise<void> {
    const { db, api } = this
    let since = (await getMeta<number>(db, 'lastServerSeq')) ?? 0
    for (;;) {
      const page = await api.sync(since, PAGE_SIZE)
      await db.transaction('rw', db.words, db.outbox, db.meta, async () => {
        for (const word of page.changes) await applyServerWord(db, word, word.id)
        await setMeta(db, 'lastServerSeq', page.next_seq)
      })
      since = page.next_seq
      if (!page.has_more) return
    }
  }
}

/** Merge one server record into the local store. Must run inside a words+outbox transaction. */
async function applyServerWord(db: KotobaDB, word: Word, requestedId: string): Promise<void> {
  if (word.id !== requestedId) await adoptCanonical(db, requestedId, word.id)
  if (word.merged_into !== null) {
    // Merged away (e.g. on another device): hand its queued edits to the survivor.
    await adoptCanonical(db, word.id, word.merged_into)
    return
  }
  const pending = await db.outbox.where('word_id').equals(word.id).toArray()
  if (pending.some((e) => e.op === 'delete')) {
    await db.words.delete(word.id)
    return
  }
  const lastPut = pending.filter((e) => e.op === 'put').at(-1)
  if (lastPut) {
    // Unpushed local edits stay visible; they reach the server on the next push (LWW).
    let p = lastPut.payload as WordPayload
    if (lastPut.needs_rebase) {
      p = rebaseOnto(word, p)
      await db.outbox.update(lastPut.seq as number, { payload: p, needs_rebase: false })
    }
    await db.words.put({ ...word, ...p, surface_norm: normalizeSurface(p.surface), deleted_at: null, merged_into: null })
    return
  }
  if (word.deleted_at !== null) {
    await db.words.delete(word.id)
    return
  }
  const local = await db.words.get(word.id)
  if (local && local.updated_at > word.updated_at) return
  await db.words.put(word)
}

async function adoptCanonical(db: KotobaDB, fromId: string, toId: string): Promise<void> {
  await db.words.delete(fromId)
  await db.outbox
    .where('word_id')
    .equals(fromId)
    .modify((e) => {
      e.word_id = toId
      if (e.op === 'put') e.needs_rebase = true
    })
}

function isTransient(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

function failure(e: unknown): Partial<SyncStatus> {
  if (e instanceof ApiError) {
    if (e.kind === 'auth') return { state: 'auth_required', lastError: e.message }
    if (e.kind === 'access') return { state: 'access_expired', lastError: e.message }
    if (e.kind === 'network') return { state: 'offline', lastError: e.message }
    return { state: 'error', lastError: e.message }
  }
  return { state: 'error', lastError: e instanceof Error ? e.message : String(e) }
}
