import { removeWord, updateWord, type Word } from '@kotoba/shared'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { useClient } from '../lib/client'
import { FamiliarityPicker } from './Familiarity'

type Form = Pick<Word, 'surface' | 'reading' | 'meaning_zh' | 'example_ja' | 'example_zh' | 'sentence' | 'familiarity'>

function toForm(w: Word): Form {
  return {
    surface: w.surface, reading: w.reading, meaning_zh: w.meaning_zh, example_ja: w.example_ja,
    example_zh: w.example_zh, sentence: w.sentence, familiarity: w.familiarity,
  }
}

export function WordEditor({ wordId, onClose }: { wordId: string; onClose: () => void }) {
  const { db, api, engine, now } = useClient()
  const word = useLiveQuery(() => db.words.get(wordId), [db, wordId])
  const [initial, setInitial] = useState<Form | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (word && !form) {
      setInitial(toForm(word))
      setForm(toForm(word))
    }
  }, [word, form])

  if (!word || !form) return null
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value })

  async function save() {
    if (!form || !form.surface.trim()) {
      setMessage('表记不能为空')
      return
    }
    // Only what the user touched: fields filled by a sync while the editor was open must survive.
    const changes: Partial<Form> = {}
    for (const key of Object.keys(form) as (keyof Form)[]) {
      if (initial && form[key] !== initial[key]) Object.assign(changes, { [key]: form[key] })
    }
    await updateWord(db, wordId, changes, now())
    void engine.sync()
    onClose()
  }

  async function remove() {
    await removeWord(db, wordId, now())
    void engine.sync()
    onClose()
  }

  async function retry() {
    try {
      await api.retryEnrichment(wordId)
      await engine.sync()
      setMessage('已重新加入补全队列')
    } catch {
      setMessage('需要联网并登录后才能重新补全')
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`编辑 ${word.surface}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-2xl dark:bg-stone-900"
      >
        <div className="space-y-3">
          <Field label="表记" value={form.surface} onChange={(v) => set('surface', v)} />
          <Field label="读音" value={form.reading} onChange={(v) => set('reading', v)} />
          <Field label="中文" value={form.meaning_zh} onChange={(v) => set('meaning_zh', v)} multiline />
          <Field label="日语例句" value={form.example_ja} onChange={(v) => set('example_ja', v)} multiline />
          <Field label="例句翻译" value={form.example_zh} onChange={(v) => set('example_zh', v)} multiline />
          <Field label="原句" value={form.sentence} onChange={(v) => set('sentence', v)} multiline />
          <div>
            <span className="mb-1 block text-xs text-stone-500">熟悉度</span>
            <FamiliarityPicker value={form.familiarity} onChange={(v) => set('familiarity', v)} />
          </div>
        </div>

        {message && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{message}</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button primary onClick={save}>保存</Button>
          {word.enrich_status === 'failed' && <Button onClick={retry}>重新补全</Button>}
          <span className="flex-1" />
          {confirming ? (
            <Button danger onClick={remove}>确认删除</Button>
          ) : (
            <Button onClick={() => setConfirming(true)}>删除</Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function Field({
  label, value, onChange, multiline = false, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; type?: string }) {
  const cls =
    'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-950'
  return (
    <label className="block text-xs text-stone-500">
      {label}
      {multiline ? (
        <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </label>
  )
}

export function Button({
  children, onClick, primary = false, danger = false, type = 'button', disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  danger?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
}) {
  const tone = danger
    ? 'bg-red-600 text-white'
    : primary
      ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900'
      : 'bg-stone-100 dark:bg-stone-800'
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${tone}`}>
      {children}
    </button>
  )
}
