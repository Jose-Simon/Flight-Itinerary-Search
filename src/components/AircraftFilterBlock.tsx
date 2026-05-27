import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AircraftMatchMode } from '../lib/filters'
import { compareManufacturerNames, inferAircraftManufacturer } from '../lib/aircraftManufacturer'
import { FilterChip } from './FilterChip'

export type AircraftOptionRow = { aircraft: string; routeCount: number }

function AircraftManufacturerMasterCheck({
  label,
  codes,
  selectedSet,
  onSetAll,
}: {
  label: string
  codes: string[]
  selectedSet: Set<string>
  onSetAll: (allowed: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const allOn = codes.length > 0 && codes.every((c) => selectedSet.has(c))
  const noneOn = codes.length > 0 && codes.every((c) => !selectedSet.has(c))
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
        onChange={(e) => onSetAll(e.target.checked)}
      />
      <span className="aircraft-mfr-title">{label}</span>
    </label>
  )
}

type Props = {
  options: AircraftOptionRow[]
  selected: string[]
  onToggle: (code: string, on: boolean) => void
  /** Select or clear many types in one state update (e.g. manufacturer master checkbox). */
  onBulkToggle: (codes: string[], on: boolean) => void
  matchMode: AircraftMatchMode
  onMatchMode: (m: AircraftMatchMode) => void
  /** Pool itineraries (out + return) that use ≥1 aircraft of this manufacturer on any leg. */
  manufacturerPoolCounts: Record<string, number>
  onSelectAllInPool: () => void
  onClearAircraftSelection: () => void
}

export function AircraftFilterBlock({
  options,
  selected,
  onToggle,
  onBulkToggle,
  matchMode,
  onMatchMode,
  manufacturerPoolCounts,
  onSelectAllInPool,
  onClearAircraftSelection,
}: Props) {
  const sel = new Set(selected)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [q, setQ] = useState('')

  const grouped = useMemo(() => {
    const byMfr = new Map<string, AircraftOptionRow[]>()
    for (const row of options) {
      const m = inferAircraftManufacturer(row.aircraft)
      const list = byMfr.get(m) ?? []
      list.push(row)
      byMfr.set(m, list)
    }
    for (const list of byMfr.values()) {
      list.sort((a, b) => b.routeCount - a.routeCount || a.aircraft.localeCompare(b.aircraft))
    }
    return [...byMfr.entries()].sort(([a], [b]) => compareManufacturerNames(a, b))
  }, [options])

  const filteredGrouped = useMemo(() => {
    const t = q.trim().toLowerCase()
    const asObjects = grouped.map(([mfr, rows]) => ({ mfr, rows }))
    if (!t) return asObjects
    return asObjects
      .map(({ mfr, rows }) => ({
        mfr,
        rows: rows.filter(
          (r) => r.aircraft.toLowerCase().includes(t) || mfr.toLowerCase().includes(t),
        ),
      }))
      .filter((g) => g.rows.length > 0)
  }, [grouped, q])

  const toggleExpand = (mfr: string) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(mfr)) n.delete(mfr)
      else n.add(mfr)
      return n
    })
  }

  if (options.length === 0) {
    return (
      <div className="filter-section sidebar-filter-sep">
        <div className="filter-section-title">Aircraft</div>
        <p className="muted tiny">Run a search to see aircraft types from results.</p>
      </div>
    )
  }

  return (
    <div className="filter-section sidebar-filter-sep">
      <div className="filter-section-title">Aircraft</div>
      <div className="airline-filter-toolbar">
        <div className="airline-filter-bulk-actions">
          <button type="button" className="btn btn-ghost btn-tiny" onClick={onSelectAllInPool}>
            All
          </button>
          <button type="button" className="btn btn-ghost btn-tiny" onClick={onClearAircraftSelection}>
            None
          </button>
        </div>
        <input
          className="input input-tiny airline-filter-filter-input"
          placeholder="Filter list…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter aircraft"
        />
      </div>
      <div className="field-tight filter-chip-field">
        <span className="label">Match</span>
        <div className="filter-chip-row" role="radiogroup" aria-label="Aircraft match mode">
          <FilterChip
            radio
            selected={matchMode === 'any'}
            onClick={() => onMatchMode('any')}
            aria-label="Match if any segment uses selected aircraft"
          >
            Any
          </FilterChip>
          <FilterChip
            radio
            selected={matchMode === 'every'}
            onClick={() => onMatchMode('every')}
            aria-label="Match only if every segment uses selected aircraft"
          >
            Every
          </FilterChip>
        </div>
      </div>
      <ul className="aircraft-hierarchy-list">
        {filteredGrouped.map(({ mfr, rows }) => {
          const isOpen = expanded.has(mfr)
          const pool = manufacturerPoolCounts[mfr] ?? 0
          const codesFull = grouped.find(([name]) => name === mfr)?.[1].map((r) => r.aircraft) ?? []
          return (
            <li key={mfr} className="aircraft-hierarchy-item">
              <div className="layover-region-row">
                <button
                  type="button"
                  className={`layover-region-chevron${isOpen ? ' layover-region-chevron--open' : ''}`}
                  aria-expanded={isOpen}
                  onClick={() => toggleExpand(mfr)}
                  disabled={rows.length === 0}
                >
                  ▸
                </button>
                <AircraftManufacturerMasterCheck
                  label={mfr}
                  codes={codesFull}
                  selectedSet={sel}
                  onSetAll={(allowed) => onBulkToggle(codesFull, allowed)}
                />
                <span
                  className="muted small aircraft-hierarchy-count"
                  title="Itineraries in the current pool (outbound + return) with this manufacturer on at least one leg"
                >
                  {pool}
                </span>
              </div>
              {isOpen && rows.length > 0 ? (
                <ul className="aircraft-model-list">
                  {rows.map(({ aircraft, routeCount }) => (
                    <li key={aircraft} className="layover-airport-item">
                      <label className="check check-inline layover-airport-check aircraft-model-check">
                        <input
                          type="checkbox"
                          checked={sel.has(aircraft)}
                          onChange={(e) => onToggle(aircraft, e.target.checked)}
                        />
                        <span>{aircraft}</span>
                      </label>
                      <span
                        className="muted small aircraft-hierarchy-count"
                        title="Itineraries in the current pool (outbound + return) with this type on at least one leg"
                      >
                        {routeCount}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
