import {
  ApiError, deleteMeta, getMeta, setMeta, type AiSettings, type AiSettingsUpdate, type DeviceOut, type EnrichMode,
  type SyncState,
} from '@kotoba/shared'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useClient, useSyncStatus } from '../lib/client'
import { defaultDeviceName } from '../lib/device'
import { Button, Field } from './WordEditor'

export function Settings() {
  const { db } = useClient()
  const token = useLiveQuery(async () => (await getMeta<string>(db, 'token')) ?? null, [db])
  if (token === undefined) return null
  return (
    <div className="space-y-8">
      {token ? <Account /> : <Login />}
      <SyncPanel />
      {token && <AiSettingsPanel />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-stone-500">{title}</h2>
      {children}
    </section>
  )
}

function loginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'auth') return '口令错误'
    if (err.kind === 'network') return '无法连接服务器'
    if (err.status === 429) return '尝试次数过多，请 15 分钟后再试'
    if (err.status === 503) return '服务器尚未设置口令'
    return err.message
  }
  return '登录失败'
}

function Login() {
  const { db, api, engine } = useClient()
  const [passphrase, setPassphrase] = useState('')
  const [deviceName, setDeviceName] = useState(() => defaultDeviceName(navigator.userAgent))
  const [error, setError] = useState<string | null>(null)
  const [accessExpired, setAccessExpired] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setAccessExpired(false)
    try {
      const out = await api.login(passphrase, deviceName.trim() || defaultDeviceName(navigator.userAgent))
      await setMeta(db, 'token', out.token)
      await setMeta(db, 'deviceId', out.device_id)
      setPassphrase('')
      void engine.sync()
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'access') setAccessExpired(true)
      else setError(loginError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="登录">
      <form onSubmit={submit} className="space-y-3">
        <Field label="口令" type="password" value={passphrase} onChange={setPassphrase} />
        <Field label="设备名" value={deviceName} onChange={setDeviceName} />
        {error && <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>}
        {accessExpired && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Cloudflare Access 登录已过期，请先
            <a className="ml-1 underline" href="/api/relogin">
              重新登录 Access
            </a>
          </p>
        )}
        <Button primary type="submit" disabled={busy}>登录</Button>
      </form>
    </Section>
  )
}

function Account() {
  const { db, api } = useClient()
  const [devices, setDevices] = useState<DeviceOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setDevices(await api.listDevices())
      setError(null)
    } catch {
      setError('设备列表需要联网')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  async function logout() {
    await deleteMeta(db, 'token')
    await deleteMeta(db, 'deviceId')
  }

  async function revoke(device: DeviceOut) {
    try {
      await api.revokeDevice(device.id)
      if (device.current) await logout()
      else await load()
    } catch {
      setError('吊销失败，请联网后重试')
    }
  }

  return (
    <Section title="设备">
      {error && <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">{error}</p>}
      <ul className="divide-y divide-stone-200 rounded-xl bg-white dark:divide-stone-800 dark:bg-stone-900">
        {(devices ?? []).map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {d.name}
                {d.current && <span className="ml-2 text-xs text-stone-500">本机</span>}
              </p>
              <p className="text-xs text-stone-500">
                {d.revoked_at ? '已吊销' : `最近使用 ${d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}`}
              </p>
            </div>
            {!d.revoked_at && <Button onClick={() => void revoke(d)}>吊销</Button>}
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Button onClick={() => void logout()}>退出登录</Button>
      </div>
    </Section>
  )
}

const STATE_LABEL: Record<SyncState, string> = {
  idle: '已同步',
  syncing: '同步中…',
  offline: '离线',
  error: '出错',
  auth_required: '未登录',
  access_expired: 'Access 已过期',
}

function SyncPanel() {
  const { db, engine } = useClient()
  const status = useSyncStatus()
  const errors = useLiveQuery(() => db.syncErrors.orderBy('id').reverse().limit(5).toArray(), [db]) ?? []
  return (
    <Section title="同步">
      <div className="rounded-xl bg-white p-4 text-sm dark:bg-stone-900">
        <p>
          状态：<span className="font-medium">{STATE_LABEL[status.state]}</span>
        </p>
        <p className="text-stone-500">待同步：{status.pending} 条</p>
        <p className="text-stone-500">上次同步：{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : '—'}</p>
        {status.lastError && (status.state === 'error' || status.state === 'offline') && (
          <p className="mt-1 text-amber-700 dark:text-amber-300">{status.lastError}</p>
        )}
        <div className="mt-3">
          <Button onClick={() => void engine.sync()}>立即同步</Button>
        </div>
        {errors.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-stone-500">
            {errors.map((e) => (
              <li key={e.id}>
                {new Date(e.at).toLocaleString()} {e.op} 被拒绝（{e.status}）：{e.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

const MODE_LABEL: Record<EnrichMode, string> = {
  auto: '本地模型自动补全',
  external: '交给外部 agent（Codex / Claude）',
  off: '关闭',
}

function AiSettingsPanel() {
  const { api } = useClient()
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await api.getAiSettings()
        if (!cancelled) setSettings(loaded)
      } catch {
        if (!cancelled) setMessage('AI 设置需要联网')
      }
      try {
        const listed = await api.listModels()
        if (!cancelled) setModels(listed)
      } catch {
        // The model list is a convenience; the field still accepts free text.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api])

  if (!settings) return message ? <Section title="AI 补全"><p className="text-sm text-stone-500">{message}</p></Section> : null

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!settings) return
    const update: AiSettingsUpdate = {
      enrich_mode: settings.enrich_mode,
      llm_base_url: settings.llm_base_url,
      llm_model: settings.llm_model,
    }
    if (apiKey) update.llm_api_key = apiKey
    try {
      setSettings(await api.putAiSettings(update))
      setApiKey('')
      setMessage('已保存')
    } catch (err) {
      setMessage(err instanceof ApiError ? `保存失败：${err.message}` : '保存失败')
    }
  }

  return (
    <Section title="AI 补全">
      <form onSubmit={save} className="space-y-3 rounded-xl bg-white p-4 dark:bg-stone-900">
        <label className="block text-xs text-stone-500">
          补全方式
          <select
            value={settings.enrich_mode}
            onChange={(e) => setSettings({ ...settings, enrich_mode: e.target.value as EnrichMode })}
            className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-950"
          >
            {(Object.keys(MODE_LABEL) as EnrichMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <Field label="接口地址" value={settings.llm_base_url} onChange={(v) => setSettings({ ...settings, llm_base_url: v })} />
        <label className="block text-xs text-stone-500">
          模型
          <input
            list="kotoba-models"
            value={settings.llm_model}
            onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })}
            className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-950"
          />
          <datalist id="kotoba-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="block text-xs text-stone-500">
          API Key
          <input
            type="password"
            value={apiKey}
            placeholder={settings.has_api_key ? '已设置（留空保持不变）' : '可选'}
            onChange={(e) => setApiKey(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-950"
          />
        </label>
        {message && <p className="text-sm text-stone-600 dark:text-stone-300">{message}</p>}
        <Button primary type="submit">保存 AI 设置</Button>
      </form>
    </Section>
  )
}
