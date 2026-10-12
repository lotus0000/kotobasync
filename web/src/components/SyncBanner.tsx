import type { ReactNode } from 'react'
import { useSyncStatus } from '../lib/client'

export function SyncBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const s = useSyncStatus()
  if (s.state === 'access_expired') {
    return (
      <Banner tone="warn">
        Access 登录已过期。
        {/* Not location.reload(): the service worker would answer from its cached shell. /api/* bypasses it. */}
        <a className="ml-1 underline" href="/api/relogin">
          点此重新登录
        </a>
      </Banner>
    )
  }
  if (s.state === 'auth_required') {
    return (
      <Banner tone="info">
        未登录，词汇只保存在本机。
        <button type="button" className="ml-1 underline" onClick={onOpenSettings}>
          去登录
        </button>
      </Banner>
    )
  }
  if (s.state === 'offline') return <Banner tone="info">离线中{s.pending ? `，${s.pending} 条待同步` : ''}</Banner>
  if (s.state === 'error') return <Banner tone="warn">同步出错：{s.lastError}</Banner>
  return null
}

function Banner({ tone, children }: { tone: 'info' | 'warn'; children: ReactNode }) {
  const color =
    tone === 'warn'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
      : 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
  return <div className={`px-4 py-2 text-center text-sm ${color}`}>{children}</div>
}
