import { KotobaApi, SyncEngine, openDb } from '@kotoba/shared'
import { ensureSyncAlarm } from './alarm'
import { handleMessage, type Message } from './messages'
import { accessHeaders, applyPreset, loadSettings, type KeyValueStore } from './settings'

const kv: KeyValueStore = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
}

const db = openDb('kotobasync-extension')
const api = new KotobaApi({
  baseUrl: async () => (await loadSettings(kv)).serverUrl,
  getToken: async () => (await loadSettings(kv)).token,
  extraHeaders: async () => accessHeaders(await loadSettings(kv)),
})
const engine = new SyncEngine({
  db,
  api,
  onAuthRevoked: () => kv.remove(['token', 'deviceId']),
})
engine.subscribe((status) => {
  void chrome.storage.local.set({ syncStatus: status })
})

void ensureSyncAlarm(chrome.alarms)

async function loadPreset(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(chrome.runtime.getURL('preset.json'))
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null
  } catch {
    return null // a normal build has no preset
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void loadPreset()
    .then((preset) => applyPreset(kv, preset))
    .then(() => engine.sync())
})
chrome.runtime.onStartup.addListener(() => {
  void engine.sync()
})
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') void engine.sync()
})
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage()
})

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false
  handleMessage(msg, { db, api, engine, kv, now: Date.now }).then(sendResponse, (e) =>
    sendResponse({ error: e instanceof Error ? e.message : String(e) }),
  )
  return true // async response
})
