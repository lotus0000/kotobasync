import { BUTTON_HEIGHT, buttonPosition } from '../src/position'

const VIEW = { width: 1280, height: 800 }
const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

describe('buttonPosition', () => {
  it('sits below the selection, clear of ChatGPT\'s own popup above it', () => {
    const r = rect(100, 200, 160, 220)
    const p = buttonPosition(r, VIEW)
    expect(p.y).toBeGreaterThanOrEqual(r.bottom)
    expect(p.x).toBe(100)
  })

  it('moves to the right of the line when there is no room below', () => {
    const r = rect(100, 770, 160, 790)
    const p = buttonPosition(r, VIEW)
    expect(p.y + BUTTON_HEIGHT).toBeLessThanOrEqual(VIEW.height)
    expect(p.y).toBeLessThan(r.bottom)
    expect(p.x).toBeGreaterThanOrEqual(r.right)
  })

  it('stays inside the viewport horizontally', () => {
    expect(buttonPosition(rect(1250, 200, 1270, 220), VIEW).x).toBeLessThanOrEqual(VIEW.width - 90)
    expect(buttonPosition(rect(-30, 200, 10, 220), VIEW).x).toBeGreaterThanOrEqual(8)
  })
})
