import type { EnrichPreview, NewWordInput } from '@kotoba/shared'

export const CARD_FIELDS = ['surface', 'reading', 'meaning_zh'] as const
export type CardField = (typeof CARD_FIELDS)[number]
export type CardValues = Record<CardField, string>

const LABELS: Record<CardField, string> = { surface: '表记', reading: '读音', meaning_zh: '中文' }
const CLOSE_AFTER_MS = 1200

/** AI prefill: only fields the user has not typed into. */
export function mergePreview(values: CardValues, touched: ReadonlySet<CardField>, preview: EnrichPreview): CardValues {
  const next = { ...values }
  for (const f of CARD_FIELDS) {
    if (!touched.has(f) && preview[f]) next[f] = preview[f]
  }
  return next
}

export function buildInput(
  values: CardValues,
  touched: ReadonlySet<CardField>,
  extras: { sentence: string; example_ja: string; example_zh: string },
): NewWordInput {
  return {
    surface: values.surface,
    reading: values.reading,
    meaning_zh: values.meaning_zh,
    example_ja: extras.example_ja,
    example_zh: extras.example_zh,
    sentence: extras.sentence,
    source: 'chatgpt',
    user_edited: CARD_FIELDS.filter((f) => touched.has(f) && values[f].trim() !== ''),
  }
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Hiragino Sans", "PingFang SC", sans-serif; }
.kotoba-save { position: fixed; padding: 4px 10px; border: 0; border-radius: 999px; background: #d97706; color: #fff;
  font-size: 13px; line-height: 20px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
.card { position: fixed; width: 300px; padding: 14px; border-radius: 14px; background: #fff; color: #1c1917;
  box-shadow: 0 8px 30px rgba(0,0,0,.25); font-size: 13px; }
.card label { display: block; margin-bottom: 8px; color: #78716c; font-size: 12px; }
.card input[type="text"] { display: block; width: 100%; margin-top: 3px; padding: 6px 8px; border: 1px solid #d6d3d1;
  border-radius: 8px; font-size: 14px; color: #1c1917; background: #fff; }
.card .row { display: flex; gap: 6px; align-items: center; }
.card .sentence { margin: 0 0 10px; color: #57534e; font-size: 12px; line-height: 1.5; max-height: 4.5em; overflow: auto; }
.card .actions { display: flex; gap: 8px; align-items: center; }
.card .status { flex: 1; color: #b45309; font-size: 12px; }
.card button { padding: 6px 12px; border: 0; border-radius: 8px; font-size: 13px; cursor: pointer; background: #f5f5f4; color: #1c1917; }
.card button[type="submit"] { background: #1c1917; color: #fafaf9; }
@media (prefers-color-scheme: dark) {
  .card { background: #1c1917; color: #fafaf9; }
  .card input[type="text"] { background: #0c0a09; color: #fafaf9; border-color: #44403c; }
  .card button { background: #292524; color: #fafaf9; }
  .card button[type="submit"] { background: #fafaf9; color: #1c1917; }
  .card .sentence { color: #a8a29e; }
}
`

/** Constructable stylesheets are not subject to the page's style-src CSP; fall back to <style> (tests). */
export function adoptStyles(root: ShadowRoot): void {
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(STYLE)
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
    return
  }
  const style = document.createElement('style')
  style.textContent = STYLE
  root.appendChild(style)
}

export interface CardOptions {
  surface: string
  sentence: string
  anchor: { x: number; y: number }
  requestPreview(): Promise<EnrichPreview | null>
  save(input: NewWordInput): Promise<'saved' | 'exists'>
  onClose(): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v)
  for (const c of children) node.append(c)
  return node
}

export function mountCard(root: ShadowRoot, opts: CardOptions): { close(): void } {
  let values: CardValues = { surface: opts.surface, reading: '', meaning_zh: '' }
  const touched = new Set<CardField>()
  let examples = { example_ja: '', example_zh: '' }
  let closed = false

  const inputs = {} as Record<CardField, HTMLInputElement>
  const fields = CARD_FIELDS.map((f) => {
    inputs[f] = el('input', { type: 'text', name: f, autocomplete: 'off' })
    inputs[f].value = values[f]
    inputs[f].addEventListener('input', () => {
      touched.add(f)
      values = { ...values, [f]: inputs[f].value }
    })
    return el('label', {}, [LABELS[f], inputs[f]])
  })
  const withSentence = el('input', { type: 'checkbox', name: 'withSentence' })
  withSentence.checked = opts.sentence !== ''
  const status = el('span', { class: 'status', role: 'status' }, ['AI 补全中…'])
  const cancel = el('button', { type: 'button', class: 'cancel' }, ['取消'])
  const submit = el('button', { type: 'submit' }, ['保存'])
  const form = el('form', { class: 'card', 'aria-label': 'KotobaSync 收藏' }, [
    ...fields,
    el('label', { class: 'row' }, [withSentence, '保存原句']),
    el('p', { class: 'sentence' }, [opts.sentence]),
    el('div', { class: 'actions' }, [status, cancel, submit]),
  ])

  const left = Math.max(8, Math.min(opts.anchor.x, window.innerWidth - 308))
  const top = Math.max(8, Math.min(opts.anchor.y, window.innerHeight - 320))
  form.style.left = `${left}px`
  form.style.top = `${top}px`

  // ChatGPT has global shortcuts; typing in the card must not reach the page.
  for (const t of ['keydown', 'keypress', 'keyup']) {
    form.addEventListener(t, (e) => {
      if (t === 'keydown' && (e as KeyboardEvent).key === 'Escape') close()
      e.stopPropagation()
    })
  }

  function close() {
    if (closed) return
    closed = true
    form.remove()
    opts.onClose()
  }

  cancel.addEventListener('click', close)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!values.surface.trim()) {
      status.textContent = '请输入表记'
      return
    }
    submit.disabled = true
    try {
      const extras = touched.has('surface') ? { example_ja: '', example_zh: '' } : examples
      const result = await opts.save(buildInput(values, touched, { sentence: withSentence.checked ? opts.sentence : '', ...extras }))
      status.textContent = result === 'saved' ? '已保存' : '已存在'
      setTimeout(close, CLOSE_AFTER_MS)
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : '保存失败'
      submit.disabled = false
    }
  })

  root.appendChild(form)
  inputs.surface.focus()

  void opts.requestPreview().then(
    (preview) => {
      if (closed) return
      if (status.textContent === 'AI 补全中…') status.textContent = ''
      if (!preview) return
      values = mergePreview(values, touched, preview)
      examples = { example_ja: preview.example_ja, example_zh: preview.example_zh }
      for (const f of CARD_FIELDS) if (!touched.has(f)) inputs[f].value = values[f]
    },
    () => {
      if (!closed && status.textContent === 'AI 补全中…') status.textContent = ''
    },
  )

  return { close }
}
