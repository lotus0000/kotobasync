import { beforeEach, describe, expect, it } from 'vitest'
import { getMeta, openDb, setMeta, type KotobaDB } from '../src/db'
import { createWord, liveWords, normalizeSurface, removeWord, updateWord } from '../src/local'
import type { WordPayload } from '../src/types'

let db: KotobaDB

beforeEach(() => {
  db = openDb(`test-${crypto.randomUUID()}`)
})

describe('normalizeSurface', () => {
  it('folds width and trims', () => {
    expect(normalizeSurface(' ＡＩ ')).toBe('AI')
    expect(normalizeSurface('ｶﾀｶﾅ')).toBe('カタカナ')
    expect(normalizeSurface('　猫\n')).toBe('猫')
  })
})

describe('createWord', () => {
  it('stores a pending word and queues a put with the full record', async () => {
    const w = await createWord(db, { surface: ' 勉強 ', sentence: '毎日勉強する。', source: 'chatgpt' }, { now: 1000, id: 'w1' })
    expect(w).toMatchObject({
      id: 'w1', surface: '勉強', surface_norm: '勉強', enrich_status: 'pending',
      user_edited: ['surface'], created_at: 1000, updated_at: 1000, deleted_at: null, server_seq: 0,
    })
    const queued = await db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ word_id: 'w1', op: 'put', attempts: 0, next_try_at: 1000 })
    expect((queued[0].payload as WordPayload).sentence).toBe('毎日勉強する。')
  })

  it('marks words with reading and meaning as manual and respects explicit user_edited', async () => {
    const w = await createWord(
      db,
      { surface: '食べる', reading: 'たべる', meaning_zh: '吃', source: 'chatgpt', user_edited: ['meaning_zh'] },
      { now: 1, id: 'w2' },
    )
    expect(w.enrich_status).toBe('manual')
    expect(w.user_edited).toEqual(['meaning_zh'])
  })

  it('rejects a blank surface and truncates long sentences', async () => {
    await expect(createWord(db, { surface: '　', source: 'manual' }, { now: 1 })).rejects.toThrow()
    const w = await createWord(db, { surface: '猫', sentence: 'あ'.repeat(400), source: 'manual' }, { now: 1 })
    expect(w.sentence).toHaveLength(300)
  })
})

describe('updateWord', () => {
  it('records changed editable fields as user-edited and bumps updated_at', async () => {
    await createWord(db, { surface: '猫', source: 'chatgpt', user_edited: [] }, { now: 1000, id: 'w1' })
    const w = await updateWord(db, 'w1', { surface: '猫', meaning_zh: ' 猫咪 ', familiarity: 9 }, 900)
    expect(w).toMatchObject({ meaning_zh: '猫咪', user_edited: ['meaning_zh'], familiarity: 5, updated_at: 1001 })
  })

  it('coalesces repeated edits into one queued put carrying the latest content', async () => {
    await createWord(db, { surface: '猫', source: 'chatgpt' }, { now: 1000, id: 'w1' })
    await updateWord(db, 'w1', { meaning_zh: 'A' }, 2000)
    await updateWord(db, 'w1', { meaning_zh: 'B' }, 3000)
    const queued = await db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect((queued[0].payload as WordPayload).meaning_zh).toBe('B')
    expect((queued[0].payload as WordPayload).updated_at).toBe(3000)
  })

  it('turns a pending word manual once reading and meaning are both filled', async () => {
    await createWord(db, { surface: '猫', source: 'chatgpt' }, { now: 1, id: 'w1' })
    const w = await updateWord(db, 'w1', { reading: 'ねこ', meaning_zh: '猫' }, 2)
    expect(w?.enrich_status).toBe('manual')
  })

  it('returns undefined for unknown words', async () => {
    expect(await updateWord(db, 'nope', { meaning_zh: 'x' }, 1)).toBeUndefined()
  })
})

describe('removeWord', () => {
  it('drops the local copy and replaces queued puts with one delete newer than the record', async () => {
    await createWord(db, { surface: '猫', source: 'chatgpt' }, { now: 5000, id: 'w1' })
    await removeWord(db, 'w1', 4000)
    expect(await db.words.get('w1')).toBeUndefined()
    const queued = await db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ word_id: 'w1', op: 'delete', payload: { deleted_at: 5001 } })
  })
})

describe('liveWords and meta', () => {
  it('hides tombstones and merged words', async () => {
    await createWord(db, { surface: '猫', source: 'manual' }, { now: 1, id: 'a' })
    await db.words.put({ ...(await db.words.get('a'))!, id: 'b', deleted_at: 5 })
    await db.words.put({ ...(await db.words.get('a'))!, id: 'c', merged_into: 'a' })
    expect((await liveWords(db)).map((w) => w.id)).toEqual(['a'])
  })

  it('round-trips meta values', async () => {
    expect(await getMeta<number>(db, 'lastServerSeq')).toBeUndefined()
    await setMeta(db, 'lastServerSeq', 42)
    expect(await getMeta<number>(db, 'lastServerSeq')).toBe(42)
  })
})
