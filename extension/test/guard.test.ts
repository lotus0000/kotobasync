import { installKeyGuard } from '../src/guard'
import { ensureSyncAlarm } from '../src/alarm'

describe('installKeyGuard', () => {
  it('hides card keystrokes from page listeners, even capture-phase ones on window', () => {
    let escaped = 0
    const remove = installKeyGuard(window, () => {
      escaped += 1
    })
    const host = document.createElement('kotoba-sync')
    document.body.appendChild(host)
    const input = document.createElement('input')
    host.attachShadow({ mode: 'closed' }).appendChild(input)
    const outside = document.createElement('textarea')
    document.body.appendChild(outside)

    const seen: string[] = []
    const spy = (e: Event) => seen.push(`${e.type}:${(e.target as Element).localName}`)
    window.addEventListener('keydown', spy, true)
    document.addEventListener('keyup', spy, true)
    try {
      for (const t of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(new KeyboardEvent(t, { key: 'a', bubbles: true, composed: true }))
      }
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
      outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, composed: true }))
    } finally {
      window.removeEventListener('keydown', spy, true)
      document.removeEventListener('keyup', spy, true)
      remove()
    }
    expect(seen).toEqual(['keydown:textarea'])
    expect(escaped).toBe(1)
  })
})

describe('ensureSyncAlarm', () => {
  it('recreates the alarm when the browser dropped it, and leaves an existing one alone', async () => {
    const created: string[] = []
    const alarms = {
      existing: undefined as unknown,
      get: async () => alarms.existing,
      create: async (name: string, info: { periodInMinutes: number }) => {
        created.push(`${name}:${info.periodInMinutes}`)
        alarms.existing = { name }
      },
    }
    await ensureSyncAlarm(alarms)
    await ensureSyncAlarm(alarms)
    expect(created).toEqual(['sync:1'])
  })
})
