import { throwIfSerpSearchStopRequested } from './serpHourBudget'

/** Minimum ms between consecutive SerpApi HTTP calls (reduces hourly throttle). 0 = no delay. */
let minIntervalMs = 1800
let lastFinishedAt = 0
let chain: Promise<void> = Promise.resolve()

export function setSerpApiMinIntervalMs(ms: number): void {
  minIntervalMs = Math.max(0, Math.min(60_000, Math.floor(ms)))
}

export function getSerpApiMinIntervalMs(): number {
  return minIntervalMs
}

/** Run SerpApi fetches one at a time with optional spacing (shared across the app). */
export function scheduleSerpApiCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    throwIfSerpSearchStopRequested()
    const wait = Math.max(0, minIntervalMs - (Date.now() - lastFinishedAt))
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    throwIfSerpSearchStopRequested()
    try {
      return await fn()
    } finally {
      lastFinishedAt = Date.now()
    }
  }
  const p = chain.then(run, run)
  chain = p.then(
    () => undefined,
    () => undefined,
  )
  return p
}
