import { DateTime } from 'luxon'
import type { SearchHistoryRow } from '../db/searchHistoryTypes'
import type { ItineraryInsightStats } from '../lib/resultStats'
import { formatDurationHoursMinutes } from '../lib/resultStats'

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
  searchPanelOpen: boolean
  onToggleSearchPanel: () => void
  history: SearchHistoryRow[]
  onApplyHistory: (row: SearchHistoryRow) => void
  /** Show indeterminate progress bar while a search is in flight. */
  loading?: boolean
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
  searchPanelOpen,
  onToggleSearchPanel,
  history,
  onApplyHistory,
  loading = false,
}: Props) {
  const routeLeft = origins.length ? origins.map((c) => c.trim().toUpperCase()).join('/') : '—'
  const routeRight = destinations.length ? destinations.map((c) => c.trim().toUpperCase()).join('/') : '—'
  const dateLine =
    tripType === 'round'
      ? `${formatShortDate(outboundDate)} — ${formatShortDate(returnDate)}`
      : formatShortDate(outboundDate)

  return (
    <div className="search-summary-bar">
      <div className={`search-progress-bar${loading ? ' search-progress-bar--active' : ''}`} aria-hidden />
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
