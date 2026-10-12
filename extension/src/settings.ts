declare const __KOTOBA_SERVER__: string | undefined

// Set at build time from KOTOBA_SERVER (see build.mjs); tests fall back to localhost.
export const DEFAULT_SERVER = typeof __KOTOBA_SERVER__ === 'string' ? __KOTOBA_SERVER__ : 'http://localhost:8900'

export interface KeyValueStore {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

export interface ExtSettings {
  serverUrl: string
  token?: string
  deviceId?: string
  cfClientId?: string
  cfClientSecret?: string
}

const KEYS = ['serverUrl', 'token', 'deviceId', 'cfClientId', 'cfClientSecret']

export async function loadSettings(kv: KeyValueStore): Promise<ExtSettings> {
  const raw = await kv.get(KEYS)
  const str = (k: string): string | undefined => (typeof raw[k] === 'string' && raw[k] !== '' ? (raw[k] as string) : undefined)
  return {
    serverUrl: (str('serverUrl') ?? DEFAULT_SERVER).replace(/\/+$/, ''),
    token: str('token'),
    deviceId: str('deviceId'),
    cfClientId: str('cfClientId'),
    cfClientSecret: str('cfClientSecret'),
  }
}

export function accessHeaders(s: ExtSettings): Record<string, string> {
  return s.cfClientId && s.cfClientSecret
    ? { 'CF-Access-Client-Id': s.cfClientId, 'CF-Access-Client-Secret': s.cfClientSecret }
    : {}
}

const PRESET_KEYS = ['serverUrl', 'cfClientId', 'cfClientSecret']

/**
 * A personal build may ship `preset.json` (server + Access service token) so a new PC only needs the
 * passphrase. Only fills keys the user hasn't set; device tokens are never preset.
 */
export async function applyPreset(kv: KeyValueStore, preset: Record<string, unknown> | null): Promise<void> {
  if (!preset) return
  const current = await kv.get(PRESET_KEYS)
  const items: Record<string, unknown> = {}
  for (const key of PRESET_KEYS) {
    const value = preset[key]
    if (typeof value === 'string' && value !== '' && current[key] === undefined) items[key] = value
  }
  if (Object.keys(items).length > 0) await kv.set(items)
}
