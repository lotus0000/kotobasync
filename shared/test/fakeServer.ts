import { ApiError } from '../src/api'
import type { SyncApi } from '../src/sync'
import type { SyncOut, UpsertOut, Word, WordPayload } from '../src/types'

/** Minimal in-memory stand-in for the server's word/sync semantics, with scriptable failures. */
export class FakeServer implements SyncApi {
  words = new Map<string, Word>()
  seq = 0
  calls: string[] = []
  /** Errors thrown by the next calls, consumed in order. */
  failures: ApiError[] = []
  /** Request id → existing id the server should merge it into. */
  mergeInto = new Map<string, string>()
  /** Runs once inside the next putWord, i.e. while that request is "in flight". */
  duringPut: (() => Promise<void>) | undefined

  private next(): number {
    this.seq += 1
    return this.seq
  }

  private fail(call: string): void {
    this.calls.push(call)
    const err = this.failures.shift()
    if (err) throw err
  }

  async putWord(id: string, payload: WordPayload): Promise<UpsertOut> {
    this.fail(`put:${id}`)
    const target = this.mergeInto.get(id)
    const hook = this.duringPut
    this.duringPut = undefined
    if (hook) await hook()
    if (target) {
      const keep = this.words.get(target)!
      const merged: Word = { ...keep, meaning_zh: keep.meaning_zh || payload.meaning_zh, server_seq: this.next() }
      this.words.set(target, merged)
      this.words.set(id, { ...this.toWord(id, payload), deleted_at: payload.updated_at, merged_into: target, server_seq: this.next() })
      return { canonical_id: target, word: merged }
    }
    const existing = this.words.get(id)
    if (existing && existing.updated_at >= payload.updated_at) return { canonical_id: id, word: existing }
    const word = { ...this.toWord(id, payload), server_seq: this.next() }
    this.words.set(id, word)
    return { canonical_id: id, word }
  }

  async deleteWord(id: string, deletedAt: number): Promise<UpsertOut | undefined> {
    this.fail(`delete:${id}`)
    const existing = this.words.get(id)
    if (!existing) return undefined
    const word = { ...existing, deleted_at: deletedAt, updated_at: deletedAt, server_seq: this.next() }
    this.words.set(id, word)
    return { canonical_id: id, word }
  }

  async sync(since: number, limit = 500): Promise<SyncOut> {
    this.fail(`sync:${since}`)
    const changes = [...this.words.values()].filter((w) => w.server_seq > since).sort((a, b) => a.server_seq - b.server_seq)
    const page = changes.slice(0, limit)
    return { changes: page, next_seq: page.at(-1)?.server_seq ?? since, has_more: changes.length > limit }
  }

  /** Simulate a change made by another device. */
  remoteWrite(word: Partial<Word> & { id: string }): Word {
    const full: Word = { ...this.toWord(word.id, { surface: '語' } as WordPayload), ...word, server_seq: this.next() }
    this.words.set(full.id, full)
    return full
  }

  private toWord(id: string, p: WordPayload): Word {
    return {
      id, surface: p.surface, surface_norm: p.surface, reading: p.reading ?? '', meaning_zh: p.meaning_zh ?? '',
      example_ja: p.example_ja ?? '', example_zh: p.example_zh ?? '', sentence: p.sentence ?? '',
      source: p.source ?? 'manual', familiarity: p.familiarity ?? 0, enrich_status: 'pending',
      user_edited: p.user_edited ?? [], created_at: p.created_at ?? 0, updated_at: p.updated_at ?? 0,
      deleted_at: null, merged_into: null, server_seq: 0,
    }
  }
}
