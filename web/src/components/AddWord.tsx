import { createWord } from '@kotoba/shared'
import { useState, type FormEvent } from 'react'
import { useClient } from '../lib/client'
import { Button, Field } from './WordEditor'

const EMPTY = { surface: '', reading: '', meaning_zh: '', sentence: '' }

export function AddWord({ onDone }: { onDone: () => void }) {
  const { db, engine, now } = useClient()
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.surface.trim()) {
      setError('请输入表记')
      return
    }
    await createWord(db, { ...form, source: 'manual' }, { now: now() })
    void engine.sync()
    setForm(EMPTY)
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-lg font-semibold">添加生词</h1>
      <Field label="表记" value={form.surface} onChange={(v) => setForm({ ...form, surface: v })} />
      <Field label="读音" value={form.reading} onChange={(v) => setForm({ ...form, reading: v })} />
      <Field label="中文" value={form.meaning_zh} onChange={(v) => setForm({ ...form, meaning_zh: v })} />
      <Field label="原句" value={form.sentence} onChange={(v) => setForm({ ...form, sentence: v })} multiline />
      <p className="text-xs text-stone-500">读音和中文可以留空，联网后会自动补全。</p>
      {error && <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>}
      <Button primary type="submit">保存</Button>
    </form>
  )
}
