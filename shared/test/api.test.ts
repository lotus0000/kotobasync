import { describe, expect, it, vi } from 'vitest'
import { ApiError, KotobaApi } from '../src/api'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function html(status: number): Response {
  return new Response('<html>Cloudflare Access</html>', { status, headers: { 'content-type': 'text/html' } })
}

const opaqueRedirect = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response

function api(fetchImpl: typeof fetch, token: string | null = 'tok') {
  return new KotobaApi({
    baseUrl: 'https://kotoba.test',
    getToken: async () => token,
    extraHeaders: () => ({ 'CF-Access-Client-Id': 'cid' }),
    fetch: fetchImpl,
  })
}

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof ApiError ? `${e.kind}:${e.status}` : `other:${String(e)}`
  }
}

describe('KotobaApi', () => {
  it('sends bearer token, extra headers and JSON body', async () => {
    const fetchImpl = vi.fn(async () => json(200, { canonical_id: 'w1', word: { id: 'w1' } }))
    const out = await api(fetchImpl as unknown as typeof fetch).putWord('w1', {
      surface: '猫', reading: '', meaning_zh: '', example_ja: '', example_zh: '', sentence: '',
      source: 'manual', familiarity: 0, user_edited: [], created_at: 1, updated_at: 1,
    })
    expect(out.canonical_id).toBe('w1')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://kotoba.test/api/words/w1')
    expect(init.method).toBe('PUT')
    expect(init.redirect).toBe('manual')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['CF-Access-Client-Id']).toBe('cid')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string).surface).toBe('猫')
  })

  it('refuses protected calls without a token and never hits the network', async () => {
    const fetchImpl = vi.fn()
    expect(await kindOf(api(fetchImpl as unknown as typeof fetch, null).sync(0))).toBe('auth:0')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('logs in without a token', async () => {
    const fetchImpl = vi.fn(async () => json(200, { token: 't', device_id: 'd' }))
    const out = await api(fetchImpl as unknown as typeof fetch, null).login('pass phrase', 'iPhone')
    expect(out).toEqual({ token: 't', device_id: 'd' })
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('classifies Access login responses', async () => {
    for (const res of [opaqueRedirect, html(200), html(403)]) {
      expect(await kindOf(api(async () => res).sync(0))).toMatch(/^access:/)
    }
  })

  it('classifies 401, other HTTP errors, gateway pages and network failures', async () => {
    expect(await kindOf(api(async () => json(401, { detail: 'x' })).sync(0))).toBe('auth:401')
    expect(await kindOf(api(async () => json(422, { detail: [{ msg: 'bad' }] })).sync(0))).toBe('http:422')
    expect(await kindOf(api(async () => html(502)).sync(0))).toBe('http:502')
    expect(await kindOf(api(async () => { throw new TypeError('Failed to fetch') }).sync(0))).toBe('network:0')
  })

  it('returns undefined for 204 and unwraps the model list', async () => {
    expect(await api(async () => new Response(null, { status: 204 })).preview('猫', '')).toBeUndefined()
    expect(await api(async () => json(200, { models: ['a', 'b'] })).listModels()).toEqual(['a', 'b'])
  })

  it('resolves a dynamic base URL per request', async () => {
    let base = 'https://one.test'
    const fetchImpl = vi.fn(async () => json(200, { changes: [], next_seq: 0, has_more: false }))
    const client = new KotobaApi({ baseUrl: () => base, getToken: () => 't', fetch: fetchImpl as unknown as typeof fetch })
    await client.sync(0)
    base = 'https://two.test'
    await client.sync(0)
    const urls = fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0])
    expect(urls).toEqual(['https://one.test/api/sync?since=0&limit=500', 'https://two.test/api/sync?since=0&limit=500'])
  })

  it('carries the server detail message on HTTP errors', async () => {
    const err = await api(async () => json(429, { detail: 'too many failed attempts' })).login('x', 'y').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('too many failed attempts')
  })
})
