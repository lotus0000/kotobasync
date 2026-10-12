import type {
  AiSettings, AiSettingsUpdate, DeviceOut, EnrichPreview, LoginOut, SyncOut, UpsertOut, WordPayload,
} from './types'

export type ApiErrorKind = 'auth' | 'access' | 'http' | 'network'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number

  constructor(kind: ApiErrorKind, status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

type MaybePromise<T> = T | Promise<T>

export interface ApiOptions {
  /** A fixed origin, or a function evaluated per request (the extension's server is configurable). */
  baseUrl: string | (() => MaybePromise<string>)
  getToken: () => MaybePromise<string | null | undefined>
  extraHeaders?: () => MaybePromise<Record<string, string>>
  fetch?: typeof fetch
}

export class KotobaApi {
  private readonly opts: ApiOptions

  constructor(opts: ApiOptions) {
    this.opts = opts
  }

  login(passphrase: string, deviceName: string): Promise<LoginOut> {
    return this.request('POST', '/api/auth/login', { passphrase, device_name: deviceName }, false)
  }

  putWord(id: string, payload: WordPayload): Promise<UpsertOut> {
    return this.request('PUT', `/api/words/${encodeURIComponent(id)}`, payload)
  }

  deleteWord(id: string, deletedAt: number): Promise<UpsertOut | undefined> {
    return this.request('DELETE', `/api/words/${encodeURIComponent(id)}`, { deleted_at: deletedAt })
  }

  sync(since: number, limit = 500): Promise<SyncOut> {
    return this.request('GET', `/api/sync?since=${since}&limit=${limit}`)
  }

  preview(surface: string, sentence: string): Promise<EnrichPreview | undefined> {
    return this.request('POST', '/api/enrich/preview', { surface, sentence })
  }

  retryEnrichment(id: string): Promise<UpsertOut> {
    return this.request('POST', `/api/words/${encodeURIComponent(id)}/enrich`)
  }

  listDevices(): Promise<DeviceOut[]> {
    return this.request('GET', '/api/devices')
  }

  async revokeDevice(id: string): Promise<void> {
    await this.request('DELETE', `/api/devices/${encodeURIComponent(id)}`)
  }

  getAiSettings(): Promise<AiSettings> {
    return this.request('GET', '/api/settings/ai')
  }

  putAiSettings(update: AiSettingsUpdate): Promise<AiSettings> {
    return this.request('PUT', '/api/settings/ai', update)
  }

  async listModels(): Promise<string[]> {
    return (await this.request<{ models: string[] }>('GET', '/api/settings/ai/models')).models
  }

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { ...(await this.opts.extraHeaders?.()) }
    if (auth) {
      const token = await this.opts.getToken()
      if (!token) throw new ApiError('auth', 0, 'not logged in')
      headers.Authorization = `Bearer ${token}`
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const doFetch = this.opts.fetch ?? fetch
    const base = typeof this.opts.baseUrl === 'function' ? await this.opts.baseUrl() : this.opts.baseUrl
    let res: Response
    try {
      res = await doFetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        credentials: 'same-origin',
      })
    } catch (e) {
      throw new ApiError('network', 0, e instanceof Error ? e.message : String(e))
    }

    // Cloudflare Access answers an expired session with a redirect (opaque under redirect:'manual')
    // or with its own HTML page; our API itself only ever answers JSON.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      throw new ApiError('access', res.status, 'Cloudflare Access session expired')
    }
    if (res.status === 401) throw new ApiError('auth', 401, 'token invalid or revoked')
    if (res.status === 204) return undefined as T

    const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
    if (!isJson) {
      if (res.ok || res.status === 403) throw new ApiError('access', res.status, 'Cloudflare Access session expired')
      throw new ApiError('http', res.status, res.statusText || `HTTP ${res.status}`)
    }
    const data: unknown = await res.json()
    if (!res.ok) throw new ApiError('http', res.status, detailOf(data) ?? `HTTP ${res.status}`)
    return data as T
  }
}

function detailOf(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    return typeof detail === 'string' ? detail : JSON.stringify(detail)
  }
  return undefined
}
