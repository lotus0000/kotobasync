import { openDb } from '@kotoba/shared'
import { buildClient, type AppClient } from '../src/lib/client'

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Handler = (init: RequestInit) => Response | Promise<Response>

/** Fake fetch keyed by "METHOD /path" (query string ignored); unknown routes fail like a dead network. */
export function routes(handlers: Record<string, Handler>): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const handler = handlers[`${init.method ?? 'GET'} ${url.pathname}`]
    if (!handler) throw new TypeError('Failed to fetch')
    return handler(init)
  }) as typeof fetch
}

export function makeClient(fetchImpl: typeof fetch = routes({})): AppClient {
  return buildClient({ db: openDb(`test-${crypto.randomUUID()}`), baseUrl: 'http://kotoba.test', fetch: fetchImpl, now: () => 1_000 })
}
