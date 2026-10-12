export const EDITABLE_FIELDS = ['surface', 'reading', 'meaning_zh', 'example_ja', 'example_zh'] as const
export type EditableField = (typeof EDITABLE_FIELDS)[number]
export type EnrichStatus = 'pending' | 'done' | 'failed' | 'manual'
export type WordSource = 'chatgpt' | 'manual'

export interface Word {
  id: string
  surface: string
  surface_norm: string
  reading: string
  meaning_zh: string
  example_ja: string
  example_zh: string
  sentence: string
  source: WordSource
  familiarity: number
  enrich_status: EnrichStatus
  user_edited: EditableField[]
  created_at: number
  updated_at: number
  deleted_at: number | null
  merged_into: string | null
  server_seq: number
}

export type WordPayload = Pick<
  Word,
  | 'surface' | 'reading' | 'meaning_zh' | 'example_ja' | 'example_zh' | 'sentence'
  | 'source' | 'familiarity' | 'user_edited' | 'created_at' | 'updated_at'
>

export interface UpsertOut {
  canonical_id: string
  word: Word
}

export interface SyncOut {
  changes: Word[]
  next_seq: number
  has_more: boolean
}

export interface LoginOut {
  token: string
  device_id: string
}

export interface EnrichPreview {
  surface: string
  reading: string
  meaning_zh: string
  example_ja: string
  example_zh: string
}

export interface DeviceOut {
  id: string
  name: string
  created_at: number
  last_seen_at: number | null
  revoked_at: number | null
  current: boolean
}

export type EnrichMode = 'auto' | 'external' | 'off'

export interface AiSettings {
  enrich_mode: EnrichMode
  llm_base_url: string
  llm_model: string
  has_api_key: boolean
}

export interface AiSettingsUpdate {
  enrich_mode?: EnrichMode
  llm_base_url?: string
  llm_model?: string
  llm_api_key?: string
}

export interface OutboxEntry {
  seq?: number
  word_id: string
  op: 'put' | 'delete'
  payload: WordPayload | { deleted_at: number }
  attempts: number
  next_try_at: number
  /** Re-pointed onto a canonical word after a server merge; must be rebased on it before sending. */
  needs_rebase?: boolean
  /** Why the last attempt failed; network backoff is lifted as soon as the server answers again. */
  last_error_kind?: 'network' | 'http'
}

export interface MetaRow {
  key: string
  value: unknown
}

export interface SyncErrorRow {
  id?: number
  at: number
  word_id: string
  op: string
  status: number
  message: string
}
