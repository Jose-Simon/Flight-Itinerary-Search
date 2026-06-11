import { DateTime } from 'luxon'
import type { SearchHistoryRow } from '../db/searchHistoryTypes'
import type { ItineraryInsightStats } from '../lib/resultStats'
import { formatDurationHoursMinutes } from '../lib/resultStats'
import type { RoundTripPairDeepenState } from '../lib/roundTripPairMeta'
import {
  formatReturnFetchTokenNote,
  formatSearchProgress,
  type SearchProgressState,
} from '../lib/searchProgress'

type Props = {
  origins: string[]
  destinations: string[]
  tripType: 'oneway' | 'round'
  outboundDate: string
  returnDate: string
  /** Shown when no passenger model exists yet */
  passengerSummary: string
  hasSearched: boolean
  outboundStats: ItineraryInsightStats
  currency: string
  history: SearchHistoryRow[]
  onApplyHistory: (row: SearchHistoryRow) => void
  /** Show indeterminate progress bar while a search is in flight. */
  loading?: boolean
  searchProgress?: SearchProgressState | null
  /** Rolling one-liner: last combo added/updated (shown while loading). */
  activityMessage?: string | null
  /** Live deepen states — used to show the outbound route on the current token fetch. */
  roundTripDeepenStates?: RoundTripPairDeepenState[]
  /** Shown after search finishes (price window / cache messages). */
  completionHint?: string | null
  /** Stop the in-flight SerpApi run (no new calls after the current one). */
  onStop?: () => void
}

function formatShortDate(iso: string): string {
  const d = DateTime.fromISO(iso)
  return d.isValid ? d.toFormat('EEE LLL d') : iso
}

function fmtMoney(n: number | null, currency: string): string {
  if (n == null || !Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${currency} ${Math.round(n)}`
  }
}

function StatChip({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="search-summary-stat">
      <span className={`search-summary-stat-value ${valueClass ?? ''}`.trim()}>{value}</span>
      <span className="search-summary-stat-label">{label}</span>
    </div>
  )
}

export function SearchSummaryBar({
  origins,
  destinations,
  tripType,
  outboundDate,
  returnDate,
  passengerSummary,
  hasSearched,
  outboundStats,
  currency,
  history,
  onApplyHistory,
  loading = false,
  searchProgress = null,
  activityMessage = null,
  roundTripDeepenStates = [],
  completionHint = null,
  onStop,
}: Props) {
  const routeLeft = origins.length ? origins.map((c) => c.trim().toUpperCase()).join('/') : '—'
  const routeRight = destinations.length ? destinations.map((c) => c.trim().toUpperCase()).join('/') : '—'
  const dateLine =
    tripType === 'round'
      ? `${formatShortDate(outboundDate)} — ${formatShortDate(returnDate)}`
      : formatShortDate(outboundDate)

  const returnFetchTokenNote =
    searchProgress && roundTripDeepenStates.length > 0
      ? formatReturnFetchTokenNote(searchProgress, roundTripDeepenStates)
      : null

  return (
    <div className="search-summary-bar">
      <div className={`search-progress-bar${loading ? ' search-progress-bar--active' : ''}`} aria-hidden />
      {loading && searchProgress?.includeAirlines?.length ? (
        <p className="search-summary-include-airlines" role="status" aria-live="polite">
          <span className="search-summary-include-airlines-label">include_airlines (every call):</span>{' '}
          <span className="mono">{searchProgress.includeAirlines.join(', ')}</span>
        </p>
      ) : null}
      {loading && searchProgress && (
        <>
          <div className="search-summary-progress-row">
            <p className="search-summary-progress-text" role="status" aria-live="polite">
              {formatSearchProgress(searchProgress)}
              {(searchProgress.phase === 'pairScan' || searchProgress.phase === 'roundTrip') && (
                <span className="search-summary-progress-hint"> · Heatmap updates live</span>
              )}
              {searchProgress.phase === 'returnFetch' && (
                <span className="search-summary-progress-hint"> · Return options populating</span>
              )}
              {returnFetchTokenNote && (
                <span className="search-summary-progress-route"> · {returnFetchTokenNote}</span>
              )}
            </p>
            {onStop && (
              <button
                type="button"
                className="btn btn-xs btn-danger search-summary-stop-btn"
                onClick={onStop}
                title="Stop after the current API call — partial results are kept"
              >
                Stop
              </button>
            )}
          </div>
          {activityMessage && (
            <p className="search-summary-activity" role="status" aria-live="polite">
              {activityMessage}
            </p>
          )}
          {searchProgress.hourUsed != null && searchProgress.hourLimit != null && (
            <div
              className="search-summary-budget"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={searchProgress.hourLimit}
              aria-valuenow={searchProgress.hourUsed}
              aria-label={`SerpApi ${searchProgress.hourUsed} of ${searchProgress.hourLimit} calls this hour`}
            >
              <div
                className="search-summary-budget-fill"
                style={{
                  width: `${Math.min(100, (100 * searchProgress.hourUsed) / searchProgress.hourLimit)}%`,
                }}
              />
              {(searchProgress.clickReserve ?? 0) > 0 && (
                <div
                  className="search-summary-budget-reserve"
                  style={{
                    width: `${Math.min(
                      100,
                      (100 * (searchProgress.clickReserveRemaining ?? searchProgress.clickReserve ?? 0)) /
                        searchProgress.hourLimit,
                    )}%`,
                  }}
                  title={`${searchProgress.clickReserveRemaining ?? searchProgress.clickReserve} calls reserved for cell clicks`}
                />
              )}
              <span className="search-summary-budget-label muted tiny">
                {searchProgress.hourUsed}/{searchProgress.hourLimit}
                {(searchProgress.clickReserve ?? 0) > 0 && (
                  <>
                    {' '}
                    · {searchProgress.clickReserveRemaining ?? searchProgress.clickReserve} clicks ·{' '}
                    {searchProgress.remainingForAutoDeepen ?? 0} auto-deepen
                  </>
                )}
              </span>
            </div>
          )}
        </>
      )}
      {!loading && completionHint && (
        <p className="search-summary-completion-hint" role="status" aria-live="polite">
          {completionHint}
        </p>
      )}
      <div className="search-summary-main">
        <div className="search-summary-route-pill" title="Origins → Destinations">
          <span className="search-summary-route-part">{routeLeft}</span>
          <span className="search-summary-route-arrow" aria-hidden>
            →
          </span>
          <span className="search-summary-route-part">{routeRight}</span>
        </div>
        <span className="search-summary-meta">
          <span className="search-summary-meta-item">{dateLine}</span>
          <span className="search-summary-meta-sep" aria-hidden>
            ·
          </span>
          <span className="search-summary-meta-item">{passengerSummary}</span>
          <span className="search-summary-meta-sep" aria-hidden>
            ·
          </span>
          <span className="search-summary-meta-item">{tripType === 'round' ? 'Round trip' : 'One way'}</span>
        </span>
      </div>

      <div className="search-summary-stats">
        <div className="search-summary-results-pill">
          <span className="search-summary-results-dot" aria-hidden />
          {hasSearched ? `${outboundStats.count} results` : 'Not searched'}
        </div>
        <StatChip
          label="Cheapest"
          value={hasSearched ? fmtMoney(outboundStats.cheapest, currency) : '—'}
          valueClass="search-summary-stat--accent"
        />
        <StatChip label="Median" value={hasSearched ? fmtMoney(outboundStats.medianPrice, currency) : '—'} />
        <StatChip label="Highest" value={hasSearched ? fmtMoney(outboundStats.highest, currency) : '—'} />
        <StatChip
          label="Fastest"
          value={hasSearched && outboundStats.fastestMins != null ? formatDurationHoursMinutes(outboundStats.fastestMins) : '—'}
          valueClass="search-summary-stat--ok"
        />
        <StatChip
          label="Median"
          value={hasSearched && outboundStats.medianMins != null ? formatDurationHoursMinutes(outboundStats.medianMins) : '—'}
        />
        <StatChip
          label="Slowest"
          value={hasSearched && outboundStats.slowestMins != null ? formatDurationHoursMinutes(outboundStats.slowestMins) : '—'}
        />
      </div>

      <div className="search-summary-actions">
        {history.length > 0 && (
          <label className="search-summary-history-label">
            <span className="muted tiny">History</span>
            <select
              className="input input-tiny search-summary-history-select"
              value=""
              onChange={(e) => {
                const id = Number(e.target.value)
                if (!id) return
                const row = history.find((h) => h.id === id)
                if (row) onApplyHistory(row)
                e.target.value = ''
              }}
            >
              <option value="">Open recent…</option>
              {history.map((h) => {
                const s = h.snapshot
                const isPw = s.searchGoal === 'priceWindow'
                // Old entries may have stored pw* fields separately; new entries use outboundDate/outboundEnd for both modes
                const dateFrom = (isPw && s.pwOutStart) ? s.pwOutStart : s.outboundDate
                const dateTo = (isPw && s.pwOutEnd) ? s.pwOutEnd : (s.outboundEnd ?? s.outboundDate)
                const dateStr = dateTo && dateTo !== dateFrom
                  ? `${formatShortDate(dateFrom)}–${formatShortDate(dateTo)}`
                  : formatShortDate(dateFrom)
                const goalTag = isPw ? '[PW] ' : ''
                const label = `${goalTag}${s.origins.join('/')} → ${s.destinations.join('/')} · ${dateStr}`
                return (
                  <option key={h.id} value={h.id}>
                    {label}
                  </option>
                )
              })}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}
