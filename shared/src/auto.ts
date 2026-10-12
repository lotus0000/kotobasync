import type { SyncEngine } from './sync'

export interface AutoSyncOptions {
  intervalMs?: number
  target?: Window
}

/** Browser triggers from the spec: now, coming online, returning to the foreground, every minute. */
export function startAutoSync(engine: SyncEngine, opts: AutoSyncOptions = {}): () => void {
  const win = opts.target ?? window
  const run = () => {
    void engine.sync()
  }
  const onVisible = () => {
    if (win.document.visibilityState === 'visible') run()
  }
  win.addEventListener('online', run)
  win.document.addEventListener('visibilitychange', onVisible)
  const timer = win.setInterval(run, opts.intervalMs ?? 60_000)
  run()
  return () => {
    win.removeEventListener('online', run)
    win.document.removeEventListener('visibilitychange', onVisible)
    win.clearInterval(timer)
  }
}
