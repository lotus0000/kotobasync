import {
  ApiError, createWord, deleteMeta, liveWords, normalizeSurface, type EnrichPreview, type KotobaApi, type KotobaDB,
  type NewWordInput, type SyncEngine,
} from '@kotoba/shared'
import { DEFAULT_SERVER, loadSettings, type KeyValueStore } from './settings'

export type Message =
  | { type: 'preview'; surface: string; sentence: string }
  | { type: 'save'; input: NewWordInput }
  | { type: 'login'; passphrase: string; deviceName: string }
  | { type: 'logout' }
  | { type: 'sync' }
  | { type: 'status' }
  | { type: 'setServer'; serverUrl: string; cfClientId: string; cfClientSecret?: string }

export interface SaveResult {
  status: 'saved' | 'exists'
  id: string
}

export type LoginResult = { ok: true } | { ok: false; error: string }

export interface Deps {
  db: KotobaDB
  api: Pick<KotobaApi, 'preview' | 'login'>
  engine: Pick<SyncEngine, 'sync' | 'status'>
  kv: KeyValueStore
  now: () => number
  previewTimeoutMs?: number
}

export async function handleMessage(msg: Message, deps: Deps): Promise<unknown> {
  switch (msg.type) {
    case 'preview':
      return preview(msg.surface, msg.sentence, deps)
    case 'save':
      return save(msg.input, deps)
    case 'login':
      return login(msg.passphrase, msg.deviceName, deps)
    case 'logout':
      await deps.kv.remove(['token', 'deviceId'])
      return { ok: true }
    case 'sync':
      return deps.engine.sync()
    case 'status':
      return { ...deps.engine.status, pending: await deps.db.outbox.count() }
    case 'setServer':
      return setServer(msg, deps)
    default:
      return undefined
  }
}

async function preview(surface: string, sentence: string, deps: Deps): Promise<EnrichPreview | null> {
  // Not logged in, offline or slow: the card simply stays as typed.
  const call = deps.api.preview(surface, sentence).then(
    (p) => p ?? null,
    () => null,
  )
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), deps.previewTimeoutMs ?? 4_000))
  return Promise.race([call, timeout])
}

async function save(input: NewWordInput, deps: Deps): Promise<SaveResult> {
  const norm = normalizeSurface(input.surface)
  const reading = (input.reading ?? '').trim()
  const existing = (await liveWords(deps.db)).find(
    (w) => w.surface_norm === norm && (!reading || !w.reading || w.reading === reading),
  )
  if (existing) return { status: 'exists', id: existing.id }
  const word = await createWord(deps.db, input, { now: deps.now() })
  void deps.engine.sync()
  return { status: 'saved', id: word.id }
}

async function login(passphrase: string, deviceName: string, deps: Deps): Promise<LoginResult> {
  try {
    const out = await deps.api.login(passphrase, deviceName)
    await deps.kv.set({ token: out.token, deviceId: out.device_id })
    void deps.engine.sync()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: loginError(e) }
  }
}

function loginError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === 'auth') return '口令错误'
    if (e.kind === 'access') return 'Cloudflare Access 拒绝：请检查 Service Token'
    if (e.kind === 'network') return '无法连接服务器'
    if (e.status === 429) return '尝试次数过多，请 15 分钟后再试'
    if (e.status === 503) return '服务器尚未设置口令'
    return e.message
  }
  return '登录失败'
}

/** The background answers `{ error }` when a handler throws; never let that read as 「已存在」. */
export function saveStatusFrom(res: unknown): SaveResult['status'] {
  const status = (res as Partial<SaveResult> | undefined)?.status
  if (status === 'saved' || status === 'exists') return status
  const error = (res as { error?: unknown } | undefined)?.error
  throw new Error(typeof error === 'string' && error ? `保存失败：${error}` : '保存失败')
}

async function setServer(
  msg: { serverUrl: string; cfClientId: string; cfClientSecret?: string },
  deps: Deps,
): Promise<LoginResult> {
  const serverUrl = msg.serverUrl.trim().replace(/\/+$/, '') || DEFAULT_SERVER
  const current = await loadSettings(deps.kv)
  const items: Record<string, unknown> = { serverUrl, cfClientId: msg.cfClientId.trim() }
  if (msg.cfClientSecret) items.cfClientSecret = msg.cfClientSecret
  if (serverUrl !== current.serverUrl) {
    const pending = await deps.db.outbox.count()
    if (pending > 0) return { ok: false, error: `还有 ${pending} 条未同步，请先同步后再切换服务器` }
    // Credentials and the local library belong to the old server.
    await deps.kv.remove(['token', 'deviceId', 'cfClientSecret'])
    await deps.db.words.clear()
    await deleteMeta(deps.db, 'lastServerSeq')
  }
  await deps.kv.set(items)
  return { ok: true }
}
