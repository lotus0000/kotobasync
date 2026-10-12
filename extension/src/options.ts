import type { SyncStatus } from '@kotoba/shared'
import type { LoginResult, Message } from './messages'
import { DEFAULT_SERVER, loadSettings, type KeyValueStore } from './settings'

const kv: KeyValueStore = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const STATE_LABEL: Record<SyncStatus['state'], string> = {
  idle: '已同步', syncing: '同步中…', offline: '离线', error: '出错', auth_required: '未登录', access_expired: 'Access 拒绝访问',
}

async function send<T>(msg: Message): Promise<T> {
  return (await chrome.runtime.sendMessage(msg)) as T
}

async function render(): Promise<void> {
  const s = await loadSettings(kv)
  $<HTMLInputElement>('serverUrl').value = s.serverUrl
  $<HTMLInputElement>('cfClientId').value = s.cfClientId ?? ''
  $<HTMLInputElement>('cfClientSecret').placeholder = s.cfClientSecret ? '已设置（留空保持不变）' : '可选'
  $('login').hidden = Boolean(s.token)
  $('account').hidden = !s.token
  const status = await send<SyncStatus & { pending: number }>({ type: 'status' })
  $('status').textContent = `${STATE_LABEL[status.state]} · 待同步 ${status.pending} 条`
}

$('serverForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const serverUrl = $<HTMLInputElement>('serverUrl').value.trim().replace(/\/+$/, '') || DEFAULT_SERVER
  let origin: string
  try {
    origin = new URL(serverUrl).origin
  } catch {
    $('serverMsg').textContent = '地址无效'
    return
  }
  if (serverUrl !== DEFAULT_SERVER) {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
    if (!granted) {
      $('serverMsg').textContent = '需要授权访问该服务器'
      return
    }
  }
  const result = await send<LoginResult>({
    type: 'setServer',
    serverUrl,
    cfClientId: $<HTMLInputElement>('cfClientId').value.trim(),
    cfClientSecret: $<HTMLInputElement>('cfClientSecret').value.trim() || undefined,
  })
  $<HTMLInputElement>('cfClientSecret').value = ''
  $('serverMsg').textContent = result.ok ? '已保存' : result.error
  await render()
})

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const result = await send<LoginResult>({
    type: 'login',
    passphrase: $<HTMLInputElement>('passphrase').value,
    deviceName: $<HTMLInputElement>('deviceName').value.trim() || 'Chrome 扩展',
  })
  $('loginMsg').textContent = result.ok ? '' : result.error
  $<HTMLInputElement>('passphrase').value = ''
  await render()
})

$('logout').addEventListener('click', async () => {
  await send({ type: 'logout' })
  await render()
})

$('syncNow').addEventListener('click', async () => {
  $('status').textContent = '同步中…'
  await send({ type: 'sync' })
  await render()
})

void render()
