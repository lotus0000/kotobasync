export const BUTTON_HEIGHT = 30
const BUTTON_WIDTH = 90
const GAP = 6
const MARGIN = 8

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Where the 「＋ 收藏」 button goes. ChatGPT shows its own 「向 ChatGPT 提问」 popup just above a selection,
 * so ours sits below it (left-aligned), or at the right end of the line when there is no room below.
 */
export function buttonPosition(rect: Box, view: { width: number; height: number }): { x: number; y: number } {
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, view.width - BUTTON_WIDTH))
  const below = rect.bottom + GAP
  if (below + BUTTON_HEIGHT <= view.height - MARGIN) return { x: clampX(rect.left), y: below }
  return { x: clampX(rect.right + GAP), y: Math.max(MARGIN, Math.min(rect.top, view.height - BUTTON_HEIGHT - MARGIN)) }
}
