import type { EnrichPreview } from '@kotoba/shared'
import { adoptStyles, mountCard } from './card'
import { selectionContext } from './context'
import { saveStatusFrom, type Message } from './messages'
import { buttonPosition, BUTTON_HEIGHT } from './position'
import { hasJapanese, pickWord } from './segment'

const SURFACE_MAX = 64

const host = document.createElement('kotoba-sync')
host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647'
const root = host.attachShadow({ mode: 'closed' })
adoptStyles(root)
document.body.appendChild(host)

let button: HTMLButtonElement | null = null
let card: { close(): void } | null = null

// The document_start key guard (guard-entry.ts) swallows Escape before the card sees it; let it close the card.
;(globalThis as typeof globalThis & { __kotobaEscape?: () => void }).__kotobaEscape = () => card?.close()

const fromUs = (e: Event) => e.composedPath().includes(host)

function hideButton(): void {
  button?.remove()
  button = null
}

async function send(msg: Message): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(msg)
  } catch {
    throw new Error('扩展已更新，请刷新页面')
  }
}

function openCard(picked: { surface: string; sentence: string }, anchor: { x: number; y: number }): void {
  hideButton()
  card = mountCard(root, {
    ...picked,
    anchor,
    requestPreview: async () =>
      ((await send({ type: 'preview', surface: picked.surface, sentence: picked.sentence }).catch(() => null)) as EnrichPreview | null),
    save: async (input) => saveStatusFrom(await send({ type: 'save', input })),
    onClose: () => {
      card = null
    },
  })
}

function onSelectionDone(): void {
  if (card) return
  const sel = window.getSelection()
  const raw = sel?.toString() ?? ''
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !hasJapanese(raw) || raw.trim().length > SURFACE_MAX) {
    hideButton()
    return
  }
  const range = sel.getRangeAt(0)
  const picked = pickWord(selectionContext(range))
  if (!picked.surface || picked.surface.length > SURFACE_MAX) {
    hideButton()
    return
  }
  const { x, y } = buttonPosition(range.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
  hideButton()
  button = document.createElement('button')
  button.type = 'button'
  button.className = 'kotoba-save'
  button.textContent = '＋ 收藏'
  button.title = `收藏「${picked.surface}」`
  button.style.left = `${x}px`
  button.style.top = `${y}px`
  button.addEventListener('click', () => openCard(picked, { x, y: y + BUTTON_HEIGHT + 4 }))
  root.appendChild(button)
}

// Passive listeners only: ChatGPT's own handlers run untouched.
document.addEventListener('mouseup', (e) => {
  if (!fromUs(e)) setTimeout(onSelectionDone, 0)
}, { passive: true })
document.addEventListener('keyup', (e) => {
  if (e.shiftKey && !fromUs(e)) setTimeout(onSelectionDone, 0)
}, { passive: true })
document.addEventListener('mousedown', (e) => {
  if (fromUs(e)) return
  hideButton()
  card?.close()
}, { passive: true })
