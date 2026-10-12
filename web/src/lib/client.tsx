import { KotobaApi, SyncEngine, deleteMeta, getMeta, openDb, type KotobaDB, type SyncStatus } from '@kotoba/shared'
import { createContext, useContext, useEffect, useState } from 'react'

export interface AppClient {
  db: KotobaDB
  api: KotobaApi
  engine: SyncEngine
  now: () => number
}

export interface ClientOptions {
  db: KotobaDB
  baseUrl?: string
  fetch?: typeof fetch
  now?: () => number
}

export function buildClient({ db, baseUrl = '', fetch, now = Date.now }: ClientOptions): AppClient {
  const api = new KotobaApi({ baseUrl, getToken: () => getMeta<string>(db, 'token'), fetch })
  const forgetToken = async () => {
    await deleteMeta(db, 'token')
    await deleteMeta(db, 'deviceId')
  }
  return { db, api, engine: new SyncEngine({ db, api, now, onAuthRevoked: forgetToken }), now }
}

export function createAppClient(): AppClient {
  return buildClient({ db: openDb() })
}

export const ClientContext = createContext<AppClient | null>(null)

export function useClient(): AppClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('ClientContext is missing')
  return client
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useClient()
  const [status, setStatus] = useState(engine.status)
  useEffect(() => engine.subscribe(setStatus), [engine])
  return status
}
