import Dexie, { type Table } from 'dexie'
import type { MetaRow, OutboxEntry, SyncErrorRow, Word } from './types'

export type KotobaDB = Dexie & {
  words: Table<Word, string>
  outbox: Table<OutboxEntry, number>
  meta: Table<MetaRow, string>
  syncErrors: Table<SyncErrorRow, number>
}

export function openDb(name = 'kotobasync'): KotobaDB {
  const db = new Dexie(name) as KotobaDB
  db.version(1).stores({
    words: 'id, created_at',
    outbox: '++seq, word_id',
    meta: 'key',
    syncErrors: '++id',
  })
  return db
}

export async function getMeta<T>(db: KotobaDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(db: KotobaDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export async function deleteMeta(db: KotobaDB, key: string): Promise<void> {
  await db.meta.delete(key)
}
