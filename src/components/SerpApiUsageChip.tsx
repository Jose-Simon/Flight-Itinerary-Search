import type { SerpApiAccountInfo } from '../hooks/useSerpApiUsage'

type Props = {
  apiKey: string
  status: 'idle' | 'loading' | 'ok' | 'error'
  data?: SerpApiAccountInfo
  fetchedAt?: Date
  /** e.g. "12m ago" — last price-window API search. */
  lastSearchAgo?: string | null
  errorMessage?: string
  onRefresh: () => void
}

function fmt(n: number | undefined): string {
  return n != null ? n.toLocaleString() : '—'
}

export function SerpApiUsageChip({
  apiKey,
  status,
  data,
  fetchedAt,
  lastSearchAgo,
  errorMessage,
  onRefresh,
}: Props) {
  if (!apiKey.trim()) return null

  const used = data?.this_month_usage
  const total = data?.searches_per_month
  const remaining = data?.total_searches_left
  const pct = used != null && total != null && total > 0 ? Math.min(1, used / total) : null

  const hourUsed = data?.this_hour_searches
  const hourLimit = data?.account_rate_limit_per_hour
  const hourPct = hourUsed != null && hourLimit != null && hourLimit > 0
    ? Math.min(1, hourUsed / hourLimit) : null

  // Colour the bar: green → yellow → red
  function barColor(p: number): string {
    if (p < 0.6) return 'var(--accent)'
    if (p < 0.85) return '#f5c542'
    return '#f87171'
  }

  const timeStr = fetchedAt
    ? fetchedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null

  const tooltipParts = [`SerpApi · ${data?.plan_name ?? 'unknown plan'}`]
  if (timeStr) tooltipParts.push(`refreshed ${timeStr}`)
  if (hourUsed != null && hourLimit != null) tooltipParts.push(`${fmt(hourUsed)} / ${fmt(hourLimit)} this hour`)

  return (
    <div className="serp-usage-chip" title={tooltipParts.join(' · ')}>
      {status === 'loading' && (
        <span className="serp-usage-loading muted tiny">Loading…</span>
      )}
      {status === 'error' && (
        <span className="serp-usage-error tiny" title={errorMessage}>
          API ⚠{errorMessage ? <span className="serp-usage-error-detail"> — {errorMessage}</span> : null}
        </span>
      )}
      {status === 'ok' && (
        <>
          <div className="serp-usage-numbers">
            <span className="serp-usage-label muted tiny">SerpApi</span>
            <span className="serp-usage-count">
              <strong>{fmt(used)}</strong>
              {total != null && <span className="muted"> / {fmt(total)}</span>}
            </span>
            {remaining != null && (
              <span className="serp-usage-remaining muted tiny">{fmt(remaining)} left</span>
            )}
            {lastSearchAgo && (
              <span className="serp-usage-last-search muted tiny" title="Last price window API search">
                · {lastSearchAgo}
              </span>
            )}
          </div>
          {/* Monthly usage bar */}
          {pct != null && (
            <div className="serp-usage-bar-track" title="Monthly usage">
              <div
                className="serp-usage-bar-fill"
                style={{ width: `${Math.round(pct * 100)}%`, background: barColor(pct) }}
              />
            </div>
          )}
          {/* Hourly rate bar */}
          {hourPct != null && (
            <div className="serp-usage-bar-track serp-usage-bar-hour" title={`This hour: ${fmt(hourUsed)} / ${fmt(hourLimit)}`}>
              <div
                className="serp-usage-bar-fill"
                style={{ width: `${Math.round(hourPct * 100)}%`, background: barColor(hourPct) }}
              />
            </div>
          )}
        </>
      )}
      <button
        type="button"
        className="btn-icon serp-usage-refresh-btn"
        onClick={onRefresh}
        title="Refresh usage"
        disabled={status === 'loading'}
      >
        ↻
      </button>
    </div>
  )
}
