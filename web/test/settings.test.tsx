import { deleteMeta, getMeta, setMeta } from '@kotoba/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/App'
import { defaultDeviceName } from '../src/lib/device'
import { jsonResponse, makeClient, routes } from './helpers'

const AI = { enrich_mode: 'auto', llm_base_url: 'http://host.docker.internal:11434/v1', llm_model: 'qwen3-coder:30b', has_api_key: false }

const online = (extra: Record<string, (init: RequestInit) => Response> = {}) =>
  routes({
    'GET /api/sync': () => jsonResponse(200, { changes: [], next_seq: 0, has_more: false }),
    'GET /api/devices': () => jsonResponse(200, [
      { id: 'd1', name: 'iPhone PWA', created_at: 1, last_seen_at: 1, revoked_at: null, current: true },
    ]),
    'GET /api/settings/ai': () => jsonResponse(200, AI),
    'GET /api/settings/ai/models': () => jsonResponse(200, { models: ['qwen3-coder:30b', 'qwen38-unc-nothink:latest'] }),
    ...extra,
  })

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: '设置' }))
}

describe('settings', () => {
  it('logs in, stores the device token and shows devices', async () => {
    const client = makeClient(online({ 'POST /api/auth/login': () => jsonResponse(200, { token: 'tok', device_id: 'd1' }) }))
    render(<App client={client} />)
    openSettings()
    fireEvent.change(await screen.findByLabelText('口令'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('iPhone PWA')).toBeTruthy()
    expect(await getMeta<string>(client.db, 'token')).toBe('tok')
    expect(await getMeta<string>(client.db, 'deviceId')).toBe('d1')
  })

  it('explains a wrong passphrase and a lockout', async () => {
    let status = 401
    const client = makeClient(online({ 'POST /api/auth/login': () => jsonResponse(status, { detail: 'x' }) }))
    render(<App client={client} />)
    openSettings()
    fireEvent.change(await screen.findByLabelText('口令'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('口令错误')).toBeTruthy()
    status = 429
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText(/15 分钟/)).toBeTruthy()
  })

  it('returns to the login form after the token is cleared', async () => {
    const client = makeClient(online())
    await setMeta(client.db, 'token', 'tok')
    render(<App client={client} />)
    openSettings()
    expect(await screen.findByRole('button', { name: '退出登录' })).toBeTruthy()
    await deleteMeta(client.db, 'token')
    expect(await screen.findByLabelText('口令')).toBeTruthy()
  })

  it('offers an Access re-login link when logging in hits an expired Access session', async () => {
    const expired = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response
    const client = makeClient(online({ 'POST /api/auth/login': () => expired }))
    render(<App client={client} />)
    openSettings()
    fireEvent.change(await screen.findByLabelText('口令'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect((await screen.findByRole('link', { name: '重新登录 Access' })).getAttribute('href')).toBe('/api/relogin')
  })

  it('returns to the login form when the server revokes the token', async () => {
    const client = makeClient(online({ 'GET /api/sync': () => jsonResponse(401, { detail: 'invalid or revoked token' }) }))
    await setMeta(client.db, 'token', 'tok')
    render(<App client={client} />)
    openSettings()
    expect(await screen.findByLabelText('口令')).toBeTruthy()
    expect(await getMeta<string>(client.db, 'token')).toBeUndefined()
  })

  it('loads and saves AI settings without echoing the API key', async () => {
    let saved: Record<string, unknown> | null = null
    const client = makeClient(
      online({
        'PUT /api/settings/ai': (init) => {
          saved = JSON.parse(String(init.body))
          return jsonResponse(200, { ...AI, llm_model: 'qwen38-unc-nothink:latest', has_api_key: true })
        },
      }),
    )
    await setMeta(client.db, 'token', 'tok')
    render(<App client={client} />)
    openSettings()
    const model = (await screen.findByLabelText('模型')) as HTMLInputElement
    expect(model.value).toBe('qwen3-coder:30b')
    fireEvent.change(model, { target: { value: 'qwen38-unc-nothink:latest' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 AI 设置' }))
    expect(await screen.findByText('已保存')).toBeTruthy()
    expect(saved).toMatchObject({ llm_model: 'qwen38-unc-nothink:latest', llm_api_key: 'sk-secret' })
    await waitFor(() => expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe(''))
  })

  it('shows sync status and lets the user sync now', async () => {
    const client = makeClient(online())
    await setMeta(client.db, 'token', 'tok')
    render(<App client={client} />)
    openSettings()
    fireEvent.click(await screen.findByRole('button', { name: '立即同步' }))
    expect(await screen.findByText('已同步')).toBeTruthy()
  })
})

describe('sync panel copy', () => {
  it('does not repeat raw English errors for states it already names', async () => {
    render(<App client={makeClient()} />)
    openSettings()
    expect(await screen.findByText('未登录', { selector: 'span' })).toBeTruthy()
    expect(screen.queryByText('not logged in')).toBeNull()
  })
})

describe('defaultDeviceName', () => {
  it('names common devices', () => {
    expect(defaultDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone PWA')
    expect(defaultDeviceName('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('iPad PWA')
    expect(defaultDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows PWA')
    expect(defaultDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Mac PWA')
    expect(defaultDeviceName('curl/8')).toBe('浏览器 PWA')
  })
})
