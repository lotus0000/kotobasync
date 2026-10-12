import type { KeyValueStore } from '../src/settings'

export class MemoryStore implements KeyValueStore {
  data: Record<string, unknown> = {}

  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((k) => k in this.data).map((k) => [k, this.data[k]]))
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items)
  }

  async remove(keys: string[]): Promise<void> {
    for (const k of keys) delete this.data[k]
  }
}
