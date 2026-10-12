import { startAutoSync } from '@kotoba/shared'
import { useEffect, useState } from 'react'
import { AddWord } from './components/AddWord'
import { Settings } from './components/Settings'
import { SyncBanner } from './components/SyncBanner'
import { WordList } from './components/WordList'
import { ClientContext, type AppClient } from './lib/client'

type Tab = 'words' | 'add' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'words', label: '词库' },
  { id: 'add', label: '添加' },
  { id: 'settings', label: '设置' },
]

export function App({ client }: { client: AppClient }) {
  const [tab, setTab] = useState<Tab>('words')
  useEffect(() => startAutoSync(client.engine), [client])

  return (
    <ClientContext.Provider value={client}>
      <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <SyncBanner onOpenSettings={() => setTab('settings')} />
        <main className="mx-auto max-w-2xl px-4 pt-4 pb-28">
          {tab === 'words' && <WordList />}
          {tab === 'add' && <AddWord onDone={() => setTab('words')} />}
          {tab === 'settings' && <Settings />}
        </main>
        <nav className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-stone-800 dark:bg-stone-900/90">
          <div className="mx-auto flex max-w-2xl">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`flex-1 py-3 text-sm font-medium ${tab === t.id ? 'text-stone-900 dark:text-white' : 'text-stone-400'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </ClientContext.Provider>
  )
}
