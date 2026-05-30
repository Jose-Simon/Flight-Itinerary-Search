import { useCallback, useEffect, useRef, useState } from 'react'

/** Field names as returned by https://serpapi.com/account.json (starter_v4 plan) */
export type SerpApiAccountInfo = {
  account_email?: string
  account_status?: string
  plan_name?: string
  plan_monthly_price?: number
  /** Monthly search quota. */
  searches_per_month?: number
  /** Searches used so far this month. */
  this_month_usage?: number
  /** Remaining searches this month (plan + extra credits). */
  total_searches_left?: number
  /** Plan searches remaining (before extra credits). */
  plan_searches_left?: number
  /** Additional credits purchased on top of the plan. */
  extra_credits?: number
  /** Searches in the current hour window. */
  this_hour_searches?: number
  last_hour_searches?: number
  account_rate_limit_per_hour?: number
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: SerpApiAccountInfo; fetchedAt: Date }
  | { status: 'error'; message: string }

/** Auto-refreshes every `refreshIntervalMs` (default 5 min). Pass `refreshKey` to
 *  trigger an immediate re-fetch (e.g. increment it after each search run). */
export function useSerpApiUsage(
  apiKey: string,
  refreshKey = 0,
  refreshIntervalMs = 5 * 60 * 1000,
) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const fetch_ = useCallback(async () => {
    if (!apiKey.trim()) {
      setState({ status: 'idle' })
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setState({ status: 'loading' })
    try {
      const r = await fetch(
        `/api/serpapi-account?apiKey=${encodeURIComponent(apiKey.trim())}`,
        { signal: ctrl.signal },
      )
      // Read as text first — if the server or proxy returns HTML (e.g. wrong URL,
      // proxy unreachable), r.json() would throw a raw SyntaxError with a useless
      // "Unexpected token '<'" message. We want to surface the actual error instead.
      const text = await r.text()
      let json: Record<string, unknown>
      try {
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        const preview = text.trimStart().slice(0, 80)
        throw new Error(`Server returned non-JSON: ${preview}`)
      }
      if (!r.ok) throw new Error((json.error as string | undefined) || `HTTP ${r.status}`)
      setState({ status: 'ok', data: json as SerpApiAccountInfo, fetchedAt: new Date() })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error' })
    }
  }, [apiKey])

  // Fetch on mount + whenever apiKey or refreshKey changes
  useEffect(() => {
    void fetch_()
  }, [fetch_, refreshKey])

  // Periodic refresh
  useEffect(() => {
    if (!apiKey.trim()) return
    const id = setInterval(() => void fetch_(), refreshIntervalMs)
    return () => clearInterval(id)
  }, [fetch_, apiKey, refreshIntervalMs])

  return { state, refresh: fetch_ }
}
