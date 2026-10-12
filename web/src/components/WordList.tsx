import { liveWords, type EnrichStatus } from '@kotoba/shared'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import { useClient } from '../lib/client'
import { filterWords } from '../lib/filter'
import { FamiliarityDots } from './Familiarity'
import { WordEditor } from './WordEditor'

const STATUS_BADGE: Partial<Record<EnrichStatus, string>> = { pending: '补全中', failed: '补全失败' }

export function WordList() {
  const { db } = useClient()
  const words = useLiveQuery(() => liveWords(db), [db])
  const [q, setQ] = useState('')
  const [familiarity, setFamiliarity] = useState<number | null>(null)
  const [status, setStatus] = useState<EnrichStatus | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (words === undefined) return null
  const shown = filterWords(words, { q, familiarity, status })

  return (
    <section>
      <input
        type="search"
        aria-label="搜索"
        placeholder="搜索表记、读音或中文"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-base outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
      />
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Chip active={familiarity === null && status === null} onClick={() => { setFamiliarity(null); setStatus(null) }}>
          全部
        </Chip>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <Chip key={n} active={familiarity === n} onClick={() => setFamiliarity(familiarity === n ? null : n)}>
            熟悉度 {n}
          </Chip>
        ))}
        {(['pending', 'failed'] as const).map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(status === s ? null : s)}>
            {STATUS_BADGE[s]}
          </Chip>
        ))}
      </div>

      {words.length === 0 ? (
        <p className="mt-16 text-center text-sm text-stone-500">还没有词。在 ChatGPT 页面划词收藏，或在「添加」里手动添加。</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-stone-500">
            {shown.length} / {words.length} 个词
          </p>
          <ul className="mt-1 divide-y divide-stone-200 dark:divide-stone-800">
            {shown.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => setEditingId(w.id)} className="flex w-full items-start gap-3 py-3 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-lg font-semibold">{w.surface}</span>
                      <span className="text-sm text-stone-500">{w.reading}</span>
                      {STATUS_BADGE[w.enrich_status] && (
                        <span className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          {STATUS_BADGE[w.enrich_status]}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-stone-600 dark:text-stone-400">{w.meaning_zh || '—'}</p>
                  </div>
                  <FamiliarityDots value={w.familiarity} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {editingId && <WordEditor wordId={editingId} onClose={() => setEditingId(null)} />}
    </section>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1 ${
        active ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
      }`}
    >
      {children}
    </button>
  )
}
