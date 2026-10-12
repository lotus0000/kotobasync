export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_MAX_MS = 5 * 60_000

/** Delay before retry number `attempt` (1-based): 1s, 2s, 4s… capped at 5 min, ±20% jitter. */
export function backoffMs(attempt: number, random: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS)
  return Math.round(base * (0.8 + 0.4 * random))
}
