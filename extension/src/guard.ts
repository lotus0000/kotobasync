const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const
const HOST_TAG = 'kotoba-sync'

/**
 * Registered at document_start, before ChatGPT's own scripts, so our capture listener on `window` runs first:
 * keystrokes typed into the KotobaSync card never reach the page's (capture or bubble) shortcut handlers.
 */
export function installKeyGuard(win: Window, onEscape: () => void): () => void {
  const guard = (e: Event) => {
    const fromCard = e.composedPath().some((n) => n instanceof Element && n.localName === HOST_TAG)
    if (!fromCard) return
    if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') onEscape()
    e.stopImmediatePropagation()
  }
  for (const t of KEY_EVENTS) win.addEventListener(t, guard, true)
  return () => {
    for (const t of KEY_EVENTS) win.removeEventListener(t, guard, true)
  }
}
