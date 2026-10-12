const JAPANESE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ々〆ヵヶ]/
const SENTENCE_END = /[。！？!?\n]/
const SENTENCE_MAX = 300

export function hasJapanese(s: string): boolean {
  return JAPANESE.test(s)
}

const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })

/** Grow [start, end) to whole-word boundaries when it starts or ends inside a word. */
export function expandToWord(text: string, start: number, end: number): { start: number; end: number } {
  let s = start
  let e = end
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) continue
    const ps = part.index
    const pe = part.index + part.segment.length
    if (ps < start && pe > start) s = Math.min(s, ps)
    if (ps < end && pe > end) e = Math.max(e, pe)
  }
  return { start: s, end: e }
}

export function sentenceAround(text: string, start: number, end: number): string {
  let s = start
  while (s > 0 && !SENTENCE_END.test(text[s - 1])) s -= 1
  let e = end
  while (e < text.length && !SENTENCE_END.test(text[e])) e += 1
  if (e < text.length && text[e] !== '\n') e += 1 // keep the terminator
  if (e - s <= SENTENCE_MAX) return text.slice(s, e).trim()
  const spare = Math.max(0, SENTENCE_MAX - (end - start))
  const from = Math.max(s, Math.min(start - Math.floor(spare / 2), e - SENTENCE_MAX))
  return text.slice(from, from + SENTENCE_MAX)
}

/** Drop punctuation/whitespace segments at the edges of [start, end) (a drag that overshoots onto 「。」). */
export function trimToWords(text: string, start: number, end: number): { start: number; end: number } {
  let first = -1
  let last = -1
  for (const part of segmenter.segment(text)) {
    const ps = part.index
    const pe = part.index + part.segment.length
    if (!part.isWordLike || pe <= start || ps >= end) continue
    if (first === -1) first = Math.max(ps, start)
    last = Math.min(pe, end)
  }
  return first === -1 ? { start, end } : { start: first, end: last }
}

export function pickWord(ctx: { text: string; start: number; end: number }): { surface: string; sentence: string } {
  const expanded = expandToWord(ctx.text, ctx.start, ctx.end)
  const { start, end } = trimToWords(ctx.text, expanded.start, expanded.end)
  return { surface: ctx.text.slice(start, end).trim(), sentence: sentenceAround(ctx.text, start, end) }
}
