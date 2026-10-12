import { expandToWord, hasJapanese, pickWord, sentenceAround } from '../src/segment'

const TEXT = '毎日日本語を勉強する。週末は友達と映画を見た。'
const at = (s: string) => ({ start: TEXT.indexOf(s), end: TEXT.indexOf(s) + s.length })
const slice = (r: { start: number; end: number }) => TEXT.slice(r.start, r.end)

describe('hasJapanese', () => {
  it('detects kana and kanji', () => {
    expect(hasJapanese('勉強')).toBe(true)
    expect(hasJapanese('ラーメン')).toBe(true)
    expect(hasJapanese('ｶﾀｶﾅ')).toBe(true)
    expect(hasJapanese('hello 123')).toBe(false)
  })
})

describe('expandToWord', () => {
  it('expands a partial selection to the whole word', () => {
    const r = at('強')
    expect(slice(expandToWord(TEXT, r.start, r.end))).toBe('勉強')
  })

  it('keeps a selection that already sits on word boundaries', () => {
    const r = at('勉強する')
    expect(slice(expandToWord(TEXT, r.start, r.end))).toBe('勉強する')
  })
})

describe('trimming overshoot', () => {
  it('drops punctuation dragged into the selection', () => {
    const a = at('する。')
    expect(pickWord({ text: TEXT, ...a })).toEqual({ surface: 'する', sentence: '毎日日本語を勉強する。' })
    const b = at('。週')
    expect(pickWord({ text: TEXT, ...b })).toEqual({ surface: '週末', sentence: '週末は友達と映画を見た。' })
  })
})

describe('sentenceAround', () => {
  it('returns the sentence containing the selection, with its terminator', () => {
    const r = at('映画')
    expect(sentenceAround(TEXT, r.start, r.end)).toBe('週末は友達と映画を見た。')
  })

  it('caps long sentences at 300 characters around the selection', () => {
    const long = 'あ'.repeat(400) + '勉強' + 'い'.repeat(400)
    const start = 400
    const s = sentenceAround(long, start, start + 2)
    expect(s.length).toBe(300)
    expect(s).toContain('勉強')
  })
})

describe('pickWord', () => {
  it('combines expansion and sentence', () => {
    const r = at('強')
    expect(pickWord({ text: TEXT, ...r })).toEqual({ surface: '勉強', sentence: '毎日日本語を勉強する。' })
  })
})
