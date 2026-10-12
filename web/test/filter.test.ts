import type { Word } from '@kotoba/shared'
import { filterWords } from '../src/lib/filter'

const base: Word = {
  id: 'x', surface: '', surface_norm: '', reading: '', meaning_zh: '', example_ja: '', example_zh: '',
  sentence: '', source: 'manual', familiarity: 0, enrich_status: 'done', user_edited: [],
  created_at: 0, updated_at: 0, deleted_at: null, merged_into: null, server_seq: 0,
}
const w = (o: Partial<Word>): Word => ({ ...base, ...o })

const words = [
  w({ id: 'cat', surface: '猫', surface_norm: '猫', reading: 'ねこ', meaning_zh: '猫咪', familiarity: 2, created_at: 1 }),
  w({ id: 'ai', surface: 'ＡＩ', surface_norm: 'AI', reading: 'えーあい', meaning_zh: '人工智能', created_at: 3 }),
  w({ id: 'dog', surface: '犬', surface_norm: '犬', reading: 'いぬ', meaning_zh: '狗', enrich_status: 'pending', created_at: 2 }),
]
const none = { q: '', familiarity: null, status: null }

describe('filterWords', () => {
  it('sorts newest first', () => {
    expect(filterWords(words, none).map((x) => x.id)).toEqual(['ai', 'dog', 'cat'])
  })

  it('matches surface, reading and meaning, ignoring width and case', () => {
    expect(filterWords(words, { ...none, q: 'ねこ' }).map((x) => x.id)).toEqual(['cat'])
    expect(filterWords(words, { ...none, q: '狗' }).map((x) => x.id)).toEqual(['dog'])
    expect(filterWords(words, { ...none, q: ' ai ' }).map((x) => x.id)).toEqual(['ai'])
  })

  it('filters by familiarity and status', () => {
    expect(filterWords(words, { ...none, familiarity: 2 }).map((x) => x.id)).toEqual(['cat'])
    expect(filterWords(words, { ...none, status: 'pending' }).map((x) => x.id)).toEqual(['dog'])
  })
})
