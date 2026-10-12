import type { KotobaDB } from './db'
import {
  EDITABLE_FIELDS, type EditableField, type OutboxEntry, type Word, type WordPayload, type WordSource,
} from './types'

const SENTENCE_MAX = 300

export function normalizeSurface(s: string): string {
  return s.normalize('NFKC').trim()
}

export function toPayload(w: Word): WordPayload {
  return {
    surface: w.surface, reading: w.reading, meaning_zh: w.meaning_zh, example_ja: w.example_ja,
    example_zh: w.example_zh, sentence: w.sentence, source: w.source, familiarity: w.familiarity,
    user_edited: w.user_edited, created_at: w.created_at, updated_at: w.updated_at,
  }
}

const MERGEABLE = [...EDITABLE_FIELDS, 'sentence'] as const

/**
 * A queued write for a word the server merged into `canonical`, re-expressed against it the way the
 * server merges (words/service.py `_absorb`): fill the survivor's blanks, keep the higher familiarity,
 * union user-edited fields — never blank what the survivor already has.
 */
export function rebaseOnto(canonical: Word, p: WordPayload): WordPayload {
  const base = toPayload(canonical)
  for (const field of MERGEABLE) {
    if (!base[field] && p[field]) base[field] = p[field]
  }
  base.familiarity = Math.max(base.familiarity, p.familiarity)
  base.user_edited = [...new Set([...base.user_edited, ...p.user_edited])].sort()
  base.updated_at = Math.max(p.updated_at, canonical.updated_at + 1)
  return base
}

export interface NewWordInput {
  surface: string
  reading?: string
  meaning_zh?: string
  example_ja?: string
  example_zh?: string
  sentence?: string
  source: WordSource
  /** Fields the user typed or corrected; defaults to every non-empty editable field. */
  user_edited?: EditableField[]
}

export async function createWord(db: KotobaDB, input: NewWordInput, opts: { now: number; id?: string }): Promise<Word> {
  const fields: Record<EditableField, string> = {
    surface: input.surface.trim(),
    reading: (input.reading ?? '').trim(),
    meaning_zh: (input.meaning_zh ?? '').trim(),
    example_ja: (input.example_ja ?? '').trim(),
    example_zh: (input.example_zh ?? '').trim(),
  }
  if (!normalizeSurface(fields.surface)) throw new Error('surface is blank')
  const userEdited = input.user_edited ?? EDITABLE_FIELDS.filter((f) => fields[f] !== '')
  const word: Word = {
    id: opts.id ?? crypto.randomUUID(),
    ...fields,
    surface_norm: normalizeSurface(fields.surface),
    sentence: (input.sentence ?? '').trim().slice(0, SENTENCE_MAX),
    source: input.source,
    familiarity: 0,
    enrich_status: fields.reading && fields.meaning_zh ? 'manual' : 'pending',
    user_edited: [...userEdited].sort(),
    created_at: opts.now,
    updated_at: opts.now,
    deleted_at: null,
    merged_into: null,
    server_seq: 0,
  }
  await db.transaction('rw', db.words, db.outbox, async () => {
    await db.words.put(word)
    await enqueue(db, word.id, 'put', toPayload(word), opts.now)
  })
  return word
}

export type WordChanges = Partial<Pick<Word, EditableField | 'sentence' | 'familiarity'>>

export async function updateWord(db: KotobaDB, id: string, changes: WordChanges, now: number): Promise<Word | undefined> {
  return db.transaction('rw', db.words, db.outbox, async () => {
    const current = await db.words.get(id)
    if (!current) return undefined
    const next: Word = { ...current }
    const edited = new Set<EditableField>(current.user_edited)
    for (const field of EDITABLE_FIELDS) {
      const value = changes[field]
      if (value === undefined) continue
      const trimmed = value.trim()
      if (trimmed !== current[field]) {
        next[field] = trimmed
        edited.add(field)
      }
    }
    if (changes.sentence !== undefined) next.sentence = changes.sentence.trim().slice(0, SENTENCE_MAX)
    if (changes.familiarity !== undefined) next.familiarity = Math.min(5, Math.max(0, Math.round(changes.familiarity)))
    next.surface_norm = normalizeSurface(next.surface)
    next.user_edited = [...edited].sort()
    next.updated_at = Math.max(now, current.updated_at + 1)
    if ((next.enrich_status === 'pending' || next.enrich_status === 'failed') && next.reading && next.meaning_zh) {
      next.enrich_status = 'manual'
    }
    await db.words.put(next)
    await enqueue(db, id, 'put', toPayload(next), now)
    return next
  })
}

export async function removeWord(db: KotobaDB, id: string, now: number): Promise<void> {
  await db.transaction('rw', db.words, db.outbox, async () => {
    const current = await db.words.get(id)
    const deletedAt = Math.max(now, (current?.updated_at ?? 0) + 1)
    await db.words.delete(id)
    await enqueue(db, id, 'delete', { deleted_at: deletedAt }, now)
  })
}

export async function liveWords(db: KotobaDB): Promise<Word[]> {
  return (await db.words.toArray()).filter((w) => w.deleted_at === null && w.merged_into === null)
}

async function enqueue(
  db: KotobaDB, wordId: string, op: OutboxEntry['op'], payload: OutboxEntry['payload'], now: number,
): Promise<void> {
  // Payloads are whole records (or a tombstone), so only the newest pending op per word matters.
  await db.outbox.where('word_id').equals(wordId).delete()
  await db.outbox.add({ word_id: wordId, op, payload, attempts: 0, next_try_at: now })
}
