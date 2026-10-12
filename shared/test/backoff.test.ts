import { describe, expect, it } from 'vitest'
import { BACKOFF_MAX_MS, backoffMs } from '../src/backoff'

describe('backoffMs', () => {
  it('doubles from one second', () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, 0.5))).toEqual([1000, 2000, 4000, 8000])
  })

  it('caps at five minutes', () => {
    expect(backoffMs(30, 0.5)).toBe(BACKOFF_MAX_MS)
  })

  it('applies ±20% jitter', () => {
    expect(backoffMs(1, 0)).toBe(800)
    expect(backoffMs(1, 1)).toBe(1200)
  })
})
