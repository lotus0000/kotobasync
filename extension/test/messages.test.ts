import { ApiError, openDb, type EnrichPreview, type KotobaDB, type SyncStatus } from '@kotoba/shared'
import { getMeta, setMeta } from '@kotoba/shared'
import { handleMessage, saveStatusFrom, type Deps } from '../src/messages'
import { accessHeaders, DEFAULT_SERVER, loadSettings } from '../src/settings'
import { MemoryStore } from './memoryStore'

const IDLE: SyncStatus = { state: 'idle', lastSyncAt: null, pending: 0, lastError: null }

function deps(over: Partial<Deps> = {}): Deps & { db: KotobaDB; kv: MemoryStore; syncs: { n: number } } {
  const syncs = { n: 0 }
  return {
    db: openDb(`test-${crypto.randomUUID()}`),
    kv: new MemoryStore(),
    now: () => 1_000,
    api: {
      preview: async () => undefined,
      login: async () => ({ token: 'tok', device_id: 'dev' }),
    },
    engine: {
      status: IDLE,
      sync: async () => {
        syncs.n += 1
        return IDLE
      },
    },
    syncs,
    ...over,
  } as Deps & { db: KotobaDB; kv: MemoryStore; syncs: { n: number } }
}

describe('settings', () => {
  it('defaults the server and trims trailing slashes', async () => {
    const kv = new MemoryStore()
    expect((await loadSettings(kv)).serverUrl).toBe(DEFAULT_SERVER)
    await kv.set({ serverUrl: 'https://x.test//', token: '' })
    const s = await loadSettings(kv)
    expect(s.serverUrl).toBe('https://x.test')
    expect(s.token).toBeUndefined()
  })

  it('sends Access headers only when both parts are set', () => {
    expect(accessHeaders({ serverUrl: 'x', cfClientId: 'id' })).toEqual({})
    expect(accessHeaders({ serverUrl: 'x', cfClientId: 'id', cfClientSecret: 's' })).toEqual({
      'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 's',
    })
  })
})

describe('handleMessage', () => {
  it('saves a new word locally, queues it and kicks a sync', async () => {
    const d = deps()
    const out = await handleMessage({ type: 'save', input: { surface: '勉強', sentence: '毎日勉強する。', source: 'chatgpt', user_edited: [] } }, d)
    expect(out).toMatchObject({ status: 'saved' })
    expect(await d.db.outbox.count()).toBe(1)
    expect(d.syncs.n).toBe(1)
  })

  it('reports an existing word instead of saving twice', async () => {
    const d = deps()
    await handleMessage({ type: 'save', input: { surface: '勉強', source: 'chatgpt' } }, d)
    const again = await handleMessage({ type: 'save', input: { surface: ' 勉強 ', reading: 'べんきょう', source: 'chatgpt' } }, d)
    expect(again).toMatchObject({ status: 'exists' })
    expect(await d.db.words.count()).toBe(1)
    expect(await d.db.outbox.count()).toBe(1)
  })

  it('still saves a homograph with a different reading', async () => {
    const d = deps()
    await handleMessage({ type: 'save', input: { surface: '上手', reading: 'じょうず', source: 'chatgpt' } }, d)
    const other = await handleMessage({ type: 'save', input: { surface: '上手', reading: 'うわて', source: 'chatgpt' } }, d)
    expect(other).toMatchObject({ status: 'saved' })
  })

  it('saves locally even when preview fails', async () => {
    const d = deps({
      api: {
        preview: async () => {
          throw new ApiError('auth', 0, 'not logged in')
        },
        login: async () => ({ token: 't', device_id: 'd' }),
      },
    })
    expect(await handleMessage({ type: 'preview', surface: '勉強', sentence: '' }, d)).toBeNull()
    expect(await handleMessage({ type: 'save', input: { surface: '勉強', source: 'chatgpt' } }, d)).toMatchObject({ status: 'saved' })
  })

  it('returns the preview, or null after the timeout', async () => {
    const p: EnrichPreview = { surface: '勉強', reading: 'べんきょう', meaning_zh: '学习', example_ja: '', example_zh: '' }
    const fast = deps({ api: { preview: async () => p, login: async () => ({ token: 't', device_id: 'd' }) } })
    expect(await handleMessage({ type: 'preview', surface: '勉強', sentence: '' }, fast)).toEqual(p)
    const slow = deps({
      previewTimeoutMs: 20,
      api: { preview: () => new Promise(() => undefined), login: async () => ({ token: 't', device_id: 'd' }) },
    })
    expect(await handleMessage({ type: 'preview', surface: '勉強', sentence: '' }, slow)).toBeNull()
  })

  it('logs in, stores the token and syncs; logs out', async () => {
    const d = deps()
    expect(await handleMessage({ type: 'login', passphrase: 'correct horse battery', deviceName: 'Chrome 扩展' }, d)).toEqual({ ok: true })
    expect(d.kv.data).toMatchObject({ token: 'tok', deviceId: 'dev' })
    expect(d.syncs.n).toBe(1)
    await handleMessage({ type: 'logout' }, d)
    expect(d.kv.data.token).toBeUndefined()
  })

  it('explains login failures', async () => {
    const d = deps({
      api: {
        preview: async () => undefined,
        login: async () => {
          throw new ApiError('auth', 401, 'invalid passphrase')
        },
      },
    })
    expect(await handleMessage({ type: 'login', passphrase: 'x', deviceName: 'y' }, d)).toEqual({ ok: false, error: '口令错误' })
  })

  it('reports status with the pending count', async () => {
    const d = deps()
    await handleMessage({ type: 'save', input: { surface: '猫', source: 'chatgpt' } }, d)
    expect(await handleMessage({ type: 'status' }, d)).toMatchObject({ state: 'idle', pending: 1 })
  })
})

describe('saveStatusFrom', () => {
  it('accepts only real save results and surfaces background errors', () => {
    expect(saveStatusFrom({ status: 'saved', id: 'x' })).toBe('saved')
    expect(saveStatusFrom({ status: 'exists', id: 'x' })).toBe('exists')
    expect(() => saveStatusFrom({ error: 'QuotaExceededError' })).toThrow('保存失败：QuotaExceededError')
    expect(() => saveStatusFrom(undefined)).toThrow('保存失败')
  })
})

describe('setServer', () => {
  it('keeps credentials when the server does not change', async () => {
    const d = deps()
    await d.kv.set({ token: 'tok', cfClientId: 'id', cfClientSecret: 's' })
    const out = await handleMessage({ type: 'setServer', serverUrl: `${DEFAULT_SERVER}/`, cfClientId: 'id2' }, d)
    expect(out).toEqual({ ok: true })
    expect(d.kv.data).toMatchObject({ token: 'tok', cfClientId: 'id2', cfClientSecret: 's' })
  })

  it('forgets token, Access secret and the local library when switching servers', async () => {
    const d = deps()
    await d.kv.set({ token: 'tok', deviceId: 'dev', cfClientId: 'id', cfClientSecret: 's' })
    await handleMessage({ type: 'save', input: { surface: '猫', source: 'chatgpt' } }, d)
    await d.db.outbox.clear() // synced
    await setMeta(d.db, 'lastServerSeq', 42)
    const out = await handleMessage({ type: 'setServer', serverUrl: 'https://other.test', cfClientId: '' }, d)
    expect(out).toEqual({ ok: true })
    expect(d.kv.data).toEqual({ serverUrl: 'https://other.test', cfClientId: '' })
    expect(await d.db.words.count()).toBe(0)
    expect(await getMeta(d.db, 'lastServerSeq')).toBeUndefined()
  })

  it('refuses to switch while words are still unsynced', async () => {
    const d = deps()
    await handleMessage({ type: 'save', input: { surface: '猫', source: 'chatgpt' } }, d)
    const out = await handleMessage({ type: 'setServer', serverUrl: 'https://other.test', cfClientId: '' }, d)
    expect(out).toEqual({ ok: false, error: '还有 1 条未同步，请先同步后再切换服务器' })
    expect(await d.db.words.count()).toBe(1)
  })
})

describe('applyPreset', () => {
  it('fills only settings the user has not set, and never a token', async () => {
    const { applyPreset } = await import('../src/settings')
    const kv = new MemoryStore()
    await kv.set({ cfClientId: 'mine' })
    await applyPreset(kv, { serverUrl: 'https://kotoba.example.com', cfClientId: 'preset-id', cfClientSecret: 'preset-secret', token: 'nope' })
    expect(kv.data).toEqual({ serverUrl: 'https://kotoba.example.com', cfClientId: 'mine', cfClientSecret: 'preset-secret' })
    await applyPreset(kv, null)
    expect(kv.data.serverUrl).toBe('https://kotoba.example.com')
  })
})
