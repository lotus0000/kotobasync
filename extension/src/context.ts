const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, dt'

export interface SelectionContext {
  text: string
  start: number
  end: number
}

/** The selection's offsets inside its nearest block's text, so a sentence spanning <strong> etc. stays whole. */
export function selectionContext(range: Range): SelectionContext {
  const node = range.startContainer
  const startEl = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const block: Element = startEl?.closest(BLOCK) ?? startEl ?? document.body
  const text = block.textContent ?? ''
  const before = document.createRange()
  before.selectNodeContents(block)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  return { text, start, end: Math.min(start + range.toString().length, text.length) }
}
