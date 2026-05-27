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
}

function formatShortDate(iso: string): string {
  const d = DateTime.fromISO(iso)
  return d.isValid ? d.toFormat('LLL d') : iso
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
}: Props) {
  const routeLeft = origins.length ? origins.map((c) => c.trim().toUpperCase()).join('/') : '—'
  const routeRight = destinations.length ? destinations.map((c) => c.trim().toUpperCase()).join('/') : '—'
  const dateLine =
    tripType === 'round'
      ? `${formatShortDate(outboundDate)} — ${formatShortDate(returnDate)}`
      : formatShortDate(outboundDate)

  return (
    <div className="search-summary-bar">
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
        <button type="button" className="btn btn-secondary btn-tiny" onClick={onToggleSearchPanel}>
          {searchPanelOpen ? 'Hide search options' : 'Show search options'}
        </button>
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
                const label = `${s.origins.join('/')} → ${s.destinations.join('/')} · ${formatShortDate(s.outboundDate)}`
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
