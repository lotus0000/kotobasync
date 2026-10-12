import type { EnrichPreview, NewWordInput } from '@kotoba/shared'
import { buildInput, mergePreview, mountCard, type CardField } from '../src/card'

const PREVIEW: EnrichPreview = {
  surface: '勉強', reading: 'べんきょう', meaning_zh: '学习', example_ja: '毎日勉強します。', example_zh: '每天学习。',
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function setup(overrides: Partial<Parameters<typeof mountCard>[1]> = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const preview = deferred<EnrichPreview | null>()
  const saved: NewWordInput[] = []
  let closed = 0
  const card = mountCard(root, {
    surface: '勉強',
    sentence: '毎日勉強する。',
    anchor: { x: 10, y: 10 },
    requestPreview: () => preview.promise,
    save: async (input) => {
      saved.push(input)
      return 'saved'
    },
    onClose: () => {
      closed += 1
    },
    ...overrides,
  })
  const input = (name: string) => root.querySelector(`[name="${name}"]`) as HTMLInputElement
  const type = (name: string, value: string) => {
    input(name).value = value
    input(name).dispatchEvent(new Event('input', { bubbles: true }))
  }
  const submit = () => (root.querySelector('form') as HTMLFormElement).requestSubmit()
  const status = () => root.querySelector('[role="status"]')?.textContent ?? ''
  return { host, root, card, preview, saved, closed: () => closed, input, type, submit, status }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('mergePreview / buildInput', () => {
  it('fills only untouched fields', () => {
    const touched = new Set<CardField>(['meaning_zh'])
    expect(mergePreview({ surface: '勉', reading: '', meaning_zh: '我的' }, touched, PREVIEW)).toEqual({
      surface: '勉強', reading: 'べんきょう', meaning_zh: '我的',
    })
  })

  it('marks touched, non-empty fields as user-edited', () => {
    const input = buildInput(
      { surface: '勉強', reading: '', meaning_zh: '我的' },
      new Set<CardField>(['meaning_zh', 'reading']),
      { sentence: 's', example_ja: 'e', example_zh: 'z' },
    )
    expect(input).toMatchObject({ source: 'chatgpt', user_edited: ['meaning_zh'], sentence: 's', example_ja: 'e' })
  })
})

describe('mountCard', () => {
  it('opens editable at once, prefilled with the selection and sentence', () => {
    const { input, root } = setup()
    expect(input('surface').value).toBe('勉強')
    expect(root.textContent).toContain('毎日勉強する。')
    expect(root.textContent).toContain('AI 补全中')
  })

  it('prefill never overwrites what the user typed', async () => {
    const { input, type, preview, submit, saved } = setup()
    type('meaning_zh', '用功')
    preview.resolve(PREVIEW)
    await flush()
    expect(input('reading').value).toBe('べんきょう')
    expect(input('meaning_zh').value).toBe('用功')
    submit()
    await flush()
    expect(saved[0]).toMatchObject({
      surface: '勉強', reading: 'べんきょう', meaning_zh: '用功', sentence: '毎日勉強する。',
      example_ja: '毎日勉強します。', user_edited: ['meaning_zh'],
    })
  })

  it('drops AI examples once the user changes the word itself', async () => {
    const { type, preview, submit, saved } = setup()
    preview.resolve(PREVIEW)
    await flush()
    type('surface', '勉強会')
    submit()
    await flush()
    expect(saved[0]).toMatchObject({ surface: '勉強会', example_ja: '', example_zh: '', user_edited: ['surface'] })
  })

  it('can leave the sentence out', async () => {
    const { root, submit, saved } = setup()
    ;(root.querySelector('[name="withSentence"]') as HTMLInputElement).click()
    submit()
    await flush()
    expect(saved[0].sentence).toBe('')
  })

  it('reports saved / exists and closes itself', async () => {
    vi.useFakeTimers()
    try {
      const a = setup()
      a.submit()
      await vi.advanceTimersByTimeAsync(0)
      expect(a.status()).toBe('已保存')
      await vi.advanceTimersByTimeAsync(1500)
      expect(a.closed()).toBe(1)

      const b = setup({ save: async () => 'exists' })
      b.submit()
      await vi.advanceTimersByTimeAsync(0)
      expect(b.status()).toBe('已存在')
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a blank word and shows save errors', async () => {
    const a = setup()
    a.type('surface', '  ')
    a.submit()
    await flush()
    expect(a.status()).toBe('请输入表记')
    expect(a.saved).toHaveLength(0)

    const b = setup({ save: async () => { throw new Error('扩展已更新，请刷新页面') } })
    b.submit()
    await flush()
    expect(b.status()).toBe('扩展已更新，请刷新页面')
  })

  it('closes on Escape and on the cancel button', () => {
    const a = setup()
    a.input('reading').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    expect(a.closed()).toBe(1)
    expect(a.root.querySelector('form')).toBeNull()

    const b = setup()
    ;(b.root.querySelector('button.cancel') as HTMLButtonElement).click()
    expect(b.closed()).toBe(1)
  })

  it('keeps keystrokes inside the card', () => {
    const { input } = setup()
    const seen: string[] = []
    const listener = (e: Event) => seen.push(e.type)
    document.addEventListener('keydown', listener)
    document.addEventListener('keypress', listener)
    document.addEventListener('keyup', listener)
    try {
      for (const t of ['keydown', 'keypress', 'keyup']) {
        input('reading').dispatchEvent(new KeyboardEvent(t, { key: 'a', bubbles: true, composed: true }))
      }
    } finally {
      document.removeEventListener('keydown', listener)
      document.removeEventListener('keypress', listener)
      document.removeEventListener('keyup', listener)
    }
    expect(seen).toEqual([])
  })
})
