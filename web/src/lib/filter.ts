import type { EnrichStatus, Word } from '@kotoba/shared'

export interface WordFilter {
  q: string
  familiarity: number | null
  status: EnrichStatus | null
}

export function filterWords(words: Word[], f: WordFilter): Word[] {
  const q = f.q.normalize('NFKC').trim().toLowerCase()
  return words
    .filter(
      (w) =>
        (f.familiarity === null || w.familiarity === f.familiarity) &&
        (f.status === null || w.enrich_status === f.status) &&
        (!q || [w.surface_norm, w.reading, w.meaning_zh].some((t) => t.normalize('NFKC').toLowerCase().includes(q))),
    )
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
}
