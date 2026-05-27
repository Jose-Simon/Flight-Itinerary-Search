import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { REGION_IDS_IN_UI_ORDER, REGION_LABELS, type RegionId } from '../data/regions'
import { enrichAirlineFromMeta } from '../lib/airlineMetaLookup'
import type { AirlinesMeta } from '../lib/airlineMetaLookup'
import { airlineRegionForAirline } from '../lib/airlineRegionGroup'

export type { AirlinesMeta }

type Row = {
  code: string
  name: string
  /** IATA for display, or the raw result token if unknown. */
  codeLabel: string
  region: RegionId
}

type Props = {
  hasSearched: boolean
  /** IATA codes present in current raw search results (outbound ∪ return). */
  airlinesInResults: string[]
  excludedCodes: Set<string>
  /** Called with allowed = checkbox checked (airline not excluded). */
  onToggleAirline: (code: string, allowed: boolean) => void
  /** Every airline in the current result set (outbound ∪ return), regardless of the list filter. */
  onSetAllInResults: (allowed: boolean) => void
  onRegionSetAll: (region: RegionId, codesInRegion: string[], allowed: boolean) => void
  meta: AirlinesMeta
  nameFallback: Record<string, string>
  /** Itineraries in current filtered outbound list that include this airline (any segment). */
  itineraryCountsOut?: Map<string, number>
  /** Same for return when round trip. */
  itineraryCountsRet?: Map<string, number>
  tripType?: 'oneway' | 'round'
  /** From Settings / SQLite; wins over built-in IATA hints. */
  persistedAirlineUiRegions?: Record<string, RegionId>
}

function formatAirlineCountLabel(
  code: string,
  tripType: 'oneway' | 'round',
  out?: Map<string, number>,
  ret?: Map<string, number>,
): string | null {
  if (!out && !ret) return null
  const o = out?.get(code) ?? 0
  if (tripType === 'oneway') return `(${o})`
  const r = ret?.get(code) ?? 0
  if (r === 0 && o === 0) return '(0)'
  return `(${o} · ${r})`
}

function AirlineRegionMasterCheck({
  region,
  label,
  codes,
  excludedCodes,
  onRegionSetAll,
}: {
  region: RegionId
  label: string
  codes: string[]
  excludedCodes: Set<string>
  onRegionSetAll: (region: RegionId, codesInRegion: string[], allowed: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const allOn = codes.length > 0 && codes.every((c) => !excludedCodes.has(c))
  const noneOn = codes.length > 0 && codes.every((c) => excludedCodes.has(c))
  const someOn = !allOn && !noneOn

  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = someOn
  }, [someOn])

  return (
    <label className="check layover-region-check">
      <input
        ref={ref}
        type="checkbox"
        checked={allOn}
        onChange={(e) => onRegionSetAll(region, codes, e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export function AirlineFilterPanel({
  hasSearched,
  airlinesInResults,
  excludedCodes,
  onToggleAirline,
  onSetAllInResults,
  onRegionSetAll,
  meta,
  nameFallback,
  itineraryCountsOut,
  itineraryCountsRet,
  tripType = 'oneway',
  persistedAirlineUiRegions,
}: Props) {
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<RegionId>>(() => new Set())

  const rows = useMemo((): Row[] => {
    return airlinesInResults.map((code) => {
      const e = enrichAirlineFromMeta(code, meta, nameFallback)
      const codeLabel = e.iata ?? e.filterKey
      return {
        code: e.filterKey,
        name: e.displayName,
        codeLabel,
        region: airlineRegionForAirline(e.iata ?? e.filterKey, e.country, persistedAirlineUiRegions),
      }
    })
  }, [airlinesInResults, meta, nameFallback, persistedAirlineUiRegions])

  const grouped = useMemo(() => {
    const buckets = new Map<RegionId, Row[]>()
    for (const r of REGION_IDS_IN_UI_ORDER) buckets.set(r, [])
    for (const row of rows) {
      buckets.get(row.region)!.push(row)
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
    }
    return REGION_IDS_IN_UI_ORDER.map((region) => ({
      region,
      airlines: buckets.get(region)!,
    })).filter((g) => g.airlines.length > 0)
  }, [rows])

  const filteredGrouped = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return grouped
    return grouped
      .map(({ region, airlines }) => ({
        region,
        airlines: airlines.filter(
          (a) =>
            a.code.toLowerCase().includes(t) ||
            a.name.toLowerCase().includes(t) ||
            a.codeLabel.toLowerCase().includes(t),
        ),
      }))
      .filter((g) => g.airlines.length > 0)
  }, [grouped, q])

  const toggleExpand = (id: RegionId) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  if (!hasSearched) {
    return (
      <div className="filter-section sidebar-filter-sep">
        <div className="filter-section-title">Airlines</div>
        <p className="muted small airline-filter-idle">Run a search to filter by airlines that appear in your results.</p>
      </div>
    )
  }

  if (airlinesInResults.length === 0) {
    return (
      <div className="filter-section sidebar-filter-sep">
        <div className="filter-section-title">Airlines</div>
        <p className="muted small airline-filter-idle">No airlines in the current result set.</p>
      </div>
    )
  }

  return (
    <div className="filter-section sidebar-filter-sep">
      <div className="filter-section-title">Airlines</div>
      <div className="airline-filter-toolbar">
        <div className="airline-filter-bulk-actions">
          <button type="button" className="btn btn-ghost btn-tiny" onClick={() => onSetAllInResults(true)}>
            All
          </button>
          <button type="button" className="btn btn-ghost btn-tiny" onClick={() => onSetAllInResults(false)}>
            None
          </button>
        </div>
        <input
          className="input input-tiny airline-filter-filter-input"
          placeholder="Filter list…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter airlines"
        />
      </div>
      <ul className="layover-regions-list airline-bucket-hierarchy">
        {filteredGrouped.map(({ region, airlines }) => {
          const codesFull = grouped.find((g) => g.region === region)?.airlines.map((a) => a.code) ?? []
          const isOpen = expanded.has(region)
          const cnt = airlines.length
          return (
            <li key={region} className="layover-region-item">
              <div className="layover-region-row">
                <button
                  type="button"
                  className={`layover-region-chevron${isOpen ? ' layover-region-chevron--open' : ''}`}
                  aria-expanded={isOpen}
                  onClick={() => toggleExpand(region)}
                  disabled={airlines.length === 0}
                >
                  ▸
                </button>
                <AirlineRegionMasterCheck
                  region={region}
                  label={REGION_LABELS[region]}
                  codes={codesFull}
                  excludedCodes={excludedCodes}
                  onRegionSetAll={onRegionSetAll}
                />
                <span
                  className="muted small layover-region-count airline-bucket-count"
                  title="Airlines in this region (current list filter)"
                >
                  {cnt}
                </span>
              </div>
              {isOpen && airlines.length > 0 ? (
                <ul className="layover-airport-list">
                  {airlines.map((a) => {
                    const c = formatAirlineCountLabel(a.code, tripType, itineraryCountsOut, itineraryCountsRet)
                    return (
                      <li key={a.code} className="layover-airport-item">
                        <label className="check check-inline layover-airport-check">
                          <input
                            type="checkbox"
                            checked={!excludedCodes.has(a.code)}
                            onChange={(e) => onToggleAirline(a.code, e.target.checked)}
                          />
                          <span className="airline-filter-item-text">
                            {a.name} <span className="mono muted small">({a.codeLabel})</span>
                            {c ? <span className="mono muted small"> {c}</span> : null}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
