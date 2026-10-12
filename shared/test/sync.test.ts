import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../src/api'
import { getMeta, openDb, type KotobaDB } from '../src/db'
import { createWord, removeWord, updateWord } from '../src/local'
import { SyncEngine, type SyncStatus } from '../src/sync'
import { FakeServer } from './fakeServer'

let db: KotobaDB
let server: FakeServer
let clock: number
let engine: SyncEngine

beforeEach(() => {
  db = openDb(`test-${crypto.randomUUID()}`)
  server = new FakeServer()
  clock = 10_000
  engine = new SyncEngine({ db, api: server, now: () => clock, random: () => 0.5 })
})

const network = () => new ApiError('network', 0, 'Failed to fetch')

describe('SyncEngine', () => {
  it('pushes queued writes, then pulls, and records the cursor', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'w1' })
    const status = await engine.sync()
    expect(status).toMatchObject({ state: 'idle', pending: 0, lastSyncAt: 10_000, lastError: null })
    expect(server.words.get('w1')?.surface).toBe('猫')
    expect((await db.words.get('w1'))?.server_seq).toBe(1)
    expect(await getMeta<number>(db, 'lastServerSeq')).toBe(1)
    expect(server.calls).toEqual(['put:w1', 'sync:0'])
  })

  it('backs off on network failure, keeps the queue, and retries once due', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'w1' })
    server.failures.push(network())
    expect(await engine.sync()).toMatchObject({ state: 'offline', pending: 1 })
    expect((await db.outbox.toArray())[0]).toMatchObject({ attempts: 1, next_try_at: 11_000 })

    server.calls = []
    server.failures.push(network())
    await engine.sync() // still offline: the backed-off write is not retried, the pull fails
    expect(server.calls).toEqual(['sync:0'])
    expect((await db.outbox.toArray())[0].attempts).toBe(1)

    server.calls = []
    expect(await engine.sync()).toMatchObject({ state: 'idle', pending: 0 }) // server answers again
    expect(server.calls).toEqual(['sync:0', 'put:w1'])
    expect(server.words.has('w1')).toBe(true)
  })

  it('treats 5xx and 429 as transient', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'w1' })
    server.failures.push(new ApiError('http', 503, 'down'))
    expect(await engine.sync()).toMatchObject({ state: 'error', pending: 1 })
    clock = 20_000
    server.failures.push(new ApiError('http', 429, 'slow down'))
    expect(await engine.sync()).toMatchObject({ state: 'error', pending: 1 })
  })

  it('stops on 401 without backoff and keeps the queue', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'w1' })
    server.failures.push(new ApiError('auth', 401, 'token invalid or revoked'))
    expect(await engine.sync()).toMatchObject({ state: 'auth_required', pending: 1 })
    expect((await db.outbox.toArray())[0]).toMatchObject({ attempts: 0, next_try_at: 1000 })
  })

  it('stops on expired Access session and keeps the queue', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'w1' })
    server.failures.push(new ApiError('access', 0, 'Cloudflare Access session expired'))
    expect(await engine.sync()).toMatchObject({ state: 'access_expired', pending: 1 })
    expect((await db.outbox.toArray())[0].attempts).toBe(0)
  })

  it('drops a rejected write, logs it, and keeps pushing the rest', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'bad' })
    await createWord(db, { surface: '犬', source: 'manual' }, { now: 1000, id: 'good' })
    server.failures.push(new ApiError('http', 422, 'surface is blank'))
    expect(await engine.sync()).toMatchObject({ state: 'idle', pending: 0 })
    expect(server.words.has('good')).toBe(true)
    expect(await db.syncErrors.toArray()).toEqual([
      expect.objectContaining({ word_id: 'bad', op: 'put', status: 422, message: 'surface is blank' }),
    ])
  })

  it('adopts the canonical id and re-points queued edits', async () => {
    server.remoteWrite({ id: 'old', surface: '上手', reading: 'じょうず', meaning_zh: '擅长', updated_at: 500 })
    await createWord(db, { surface: '上手', reading: 'じょうず', source: 'chatgpt' }, { now: 1000, id: 'new' })
    server.mergeInto.set('new', 'old')
    // The user edits the word while the create is in flight; the server answers with the canonical id.
    server.duringPut = async () => {
      await updateWord(db, 'new', { familiarity: 4 }, 2000)
    }
    await engine.sync()
    server.mergeInto.clear()

    expect(await db.words.get('new')).toBeUndefined()
    const queued = await db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect(queued[0].word_id).toBe('old')
    expect((await db.words.get('old'))?.familiarity).toBe(4)
    expect((await db.words.get('old'))?.meaning_zh).toBe('擅长')

    await engine.sync()
    expect(server.words.get('old')).toMatchObject({ familiarity: 4, meaning_zh: '擅长' })
    const live = (await db.words.toArray()).filter((w) => w.deleted_at === null && w.merged_into === null)
    expect(live.map((w) => w.id)).toEqual(['old'])
  })

  it('applies remote changes and tombstones on pull', async () => {
    for (let i = 0; i < 3; i++) server.remoteWrite({ id: `r${i}`, surface: `語${i}`, updated_at: 100 })
    await engine.sync()
    expect((await db.words.toArray()).map((w) => w.id).sort()).toEqual(['r0', 'r1', 'r2'])

    server.remoteWrite({ ...server.words.get('r1')!, deleted_at: 900, updated_at: 900 })
    await engine.sync()
    expect(await db.words.get('r1')).toBeUndefined()
  })

  it('pages through more than one sync batch', async () => {
    const paging = new SyncEngine({
      db,
      api: {
        sync: (since: number) => server.sync(since, 2),
        putWord: (id, payload) => server.putWord(id, payload),
        deleteWord: (id, deletedAt) => server.deleteWord(id, deletedAt),
      },
      now: () => clock,
    })
    for (let i = 0; i < 5; i++) server.remoteWrite({ id: `p${i}`, surface: `頁${i}`, updated_at: 1 })
    await paging.sync()
    expect(await db.words.count()).toBe(5)
    expect(await getMeta<number>(db, 'lastServerSeq')).toBe(5)
  })

  it('keeps unpushed local edits visible when pulling', async () => {
    server.remoteWrite({ id: 'w1', surface: '猫', meaning_zh: '服务端', updated_at: 100 })
    await engine.sync()
    await updateWord(db, 'w1', { meaning_zh: '本机' }, 5000)
    server.failures.push(network()) // push fails and backs off until 11_000
    await engine.sync()
    server.remoteWrite({ ...server.words.get('w1')!, meaning_zh: '另一台设备', updated_at: 200 })
    server.calls = []
    await engine.sync() // pull brings the remote version first, then the held-back write goes out
    expect(server.calls.slice(0, 2)).toEqual(['sync:1', 'put:w1'])
    expect((await db.words.get('w1'))?.meaning_zh).toBe('本机')
    expect(server.words.get('w1')?.meaning_zh).toBe('本机')
  })

  it('re-points queued edits of a word merged away on another device without blanking the survivor', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'x' })
    await engine.sync()
    await updateWord(db, 'x', { familiarity: 5 }, 2000)
    server.failures.push(network())
    await engine.sync() // edit stays queued
    server.remoteWrite({ id: 'c', surface: '猫', reading: 'ねこ', meaning_zh: '猫咪', updated_at: 3000 })
    server.remoteWrite({ ...server.words.get('x')!, deleted_at: 3000, merged_into: 'c', updated_at: 3000 })
    await engine.sync()
    const live = (await db.words.toArray()).filter((w) => w.deleted_at === null && w.merged_into === null)
    expect(live.map((w) => w.id)).toEqual(['c'])
    expect(server.words.get('c')).toMatchObject({ familiarity: 5, meaning_zh: '猫咪', reading: 'ねこ' })
  })

  it('pushes immediately once the network is back, even after a long backoff', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'w1' })
    for (let i = 0; i < 12; i++) {
      server.failures.push(network())
      await engine.sync()
      clock += 60_000
    }
    expect((await db.outbox.toArray())[0].next_try_at).toBeGreaterThan(clock)
    server.calls = []
    expect(await engine.sync()).toMatchObject({ state: 'idle', pending: 0 })
    expect(server.calls.some((c) => c.startsWith('put:'))).toBe(true)
  })

  it('reports a revoked token but not a missing one', async () => {
    let revoked = 0
    const watched = new SyncEngine({ db, api: server, now: () => clock, onAuthRevoked: () => { revoked += 1 } })
    server.failures.push(new ApiError('auth', 401, 'token invalid or revoked'))
    await watched.sync()
    server.failures.push(new ApiError('auth', 0, 'not logged in'))
    await watched.sync()
    expect(revoked).toBe(1)
  })

  it('pushes deletes', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'w1' })
    await engine.sync()
    await removeWord(db, 'w1', 3000)
    await engine.sync()
    expect(server.words.get('w1')?.deleted_at).toBe(3000)
  })

  it('shares one run between concurrent callers', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1000, id: 'w1' })
    const [a, b] = await Promise.all([engine.sync(), engine.sync()])
    expect(a).toBe(b)
    expect(server.calls.filter((c) => c.startsWith('put:'))).toHaveLength(1)
  })

  it('notifies subscribers', async () => {
    const seen: SyncStatus['state'][] = []
    const unsubscribe = engine.subscribe((s) => seen.push(s.state))
    await engine.sync()
    unsubscribe()
    await engine.sync()
    expect(seen).toEqual(['idle', 'syncing', 'idle'])
  })
})
