import { useEffect, useMemo, useRef, useState } from 'react'
import type { PriceWindowResult, DateTopRoute } from '../lib/routeGrouping'
import { reverseRouteKey } from '../lib/routeGrouping'
import { formatPriceAmount } from '../lib/formatPrice'
import type { NormalizedItinerary, NormalizedSegment } from '../lib/types'
import {
  buildGoogleFlightsDeepLink,
  buildGoogleFlightsSearchUrl,
  itineraryDetailsText,
} from '../lib/googleFlightsLink'
import { ItineraryCard } from './ItineraryCard'
import type { AirlinesMeta } from '../lib/airlineMetaLookup'
import type { PriceVerificationRow } from '../db/priceVerificationRepo'
import { vKey } from '../db/priceVerificationRepo'

/** Internal state for uncontrolled mode only. */
type CellSelection =
  | { kind: 'global'; date: string }
  | { kind: 'route'; routeKey: string; date: string; pickedIdx: number }

/** Effective selection used for both cell highlighting and detail panel rendering. */
type EffSelection = { routeKey: string; date: string; pickedIdx: number } | null

function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function shortDateWithDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Format a date as "09/01 (Tue)" — used in cell tooltips for return date options. */
function shortRetDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const dow = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  return `${mm}/${dd} (${dow})`
}

/** Compute median from a pre-sorted numeric array (returns integer-rounded value). */
function priceMedian(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

function heatColor(price: number, minP: number, maxP: number): string {
  if (maxP <= minP) return 'hsl(145,62%,46%)'
  const t = Math.max(0, Math.min(1, (price - minP) / (maxP - minP)))
  const hue = Math.round(145 - t * 145)   // 145 green → 0 red
  const light = Math.round(26 + (1 - t) * 22) // 26% (expensive/dark) → 48% (cheap/vivid)
  return `hsl(${hue},62%,${light}%)`
}

function formatMins(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function timeHM(raw: string | undefined): string {
  if (!raw) return '—'
  return raw.length >= 5 ? raw.slice(-5) : raw
}

function SegmentLine({ seg }: { seg: NormalizedSegment }) {
  return (
    <span className="pw-itin-seg-line">
      <span className="pw-itin-airline">{seg.airline ?? ''}</span>
      {seg.flightNumber ? <span className="pw-itin-fn">{seg.flightNumber}</span> : null}
      <span className="pw-itin-route">
        {seg.dep} {timeHM(seg.depTime)} → {seg.arr} {timeHM(seg.arrTime)}
      </span>
      <span className="pw-itin-dur">{formatMins(seg.durationMinutes)}</span>
    </span>
  )
}

function ItineraryCompact({ it, currency }: { it: NormalizedItinerary; currency: string }) {
  return (
    <div className="pw-itin-compact">
      {it.segments.map((seg, i) => (
        <div key={i}>
          <SegmentLine seg={seg} />
          {it.layovers[i] && !it.layovers[i].isTechnical && (
            <div className="pw-itin-layover">
              ↳ {it.layovers[i].airport} · {formatMins(it.layovers[i].durationMinutes)} layover
            </div>
          )}
        </div>
      ))}
      <div className="pw-itin-total">
        {formatMins(it.totalDurationMinutes)}
        {it.price != null ? ` · ${formatPriceAmount(it.price, currency)}` : ''}
      </div>
    </div>
  )
}

function GlobalDrilldown({ routes, currency }: { routes: DateTopRoute[]; currency: string }) {
  if (routes.length === 0) return <p className="muted small">No priced results for this date.</p>
  const lo = routes[0].minPrice
  const hi = routes[routes.length - 1].minPrice
  return (
    <div className="pw-drilldown">
      <div className="pw-drilldown-range">
        {formatPriceAmount(lo, currency)}
        {hi > lo ? ` – ${formatPriceAmount(hi, currency)}` : ''}
        <span className="pw-drilldown-range-label"> (cheapest – #{routes.length})</span>
      </div>
      <ol className="pw-drilldown-list">
        {routes.map((r, i) => {
          const [waypoint, carriers = ''] = r.routeKey.split('|')
          const path = waypoint.replace(/-/g, ' › ')
          return (
            <li key={r.routeKey} className="pw-drilldown-item">
              <span className="pw-drilldown-rank">{i + 1}.</span>
              <span className="pw-drilldown-route">{path}</span>
              {carriers && <span className="pw-drilldown-carrier">{carriers}</span>}
              <span className="pw-drilldown-price">{formatPriceAmount(r.minPrice, currency)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export type PriceWindowPanelProps = {
  result: PriceWindowResult
  currency: string
  title: string
  namesByIata: Map<string, string>
  /** Outbound panel: when provided, cells show outbound + cheapest matching return (combined total). */
  returnResult?: PriceWindowResult | null
  /** Return panel: when set, show only this route key (hides all other rows and global row). */
  filterToRouteKey?: string | null
  /** Called when a route+date cell is selected/deselected or the picked itinerary changes. */
  onRouteSelect?: (sel: { routeKey: string; date: string; pickedIdx?: number; selectedItinerary?: NormalizedItinerary } | null) => void
  /**
   * Controlled selection — when this prop is defined (even as null), the panel's
   * active cell and detail view are driven by the parent instead of internal state.
   * Pass null to clear the selection.
   */
  controlledSelection?: { routeKey: string; date: string; pickedIdx?: number } | null
  /**
   * When true, clicking cells fires onRouteSelect but the panel shows a compact
   * "selected combination" summary instead of an inline itinerary detail panel.
   * Use for the Total Round Trip panel where the detail is handled by sibling panels.
   */
  selectionOnly?: boolean
  /**
   * Explicitly user-selected return itinerary (from the Return panel).
   * Used to build the Google Flights link and shown in the selectionOnly summary.
   */
  selectedReturnIt?: NormalizedItinerary | null
  selectedReturnDate?: string
  /** Called when the user clicks Save on a selected itinerary. */
  onSave?: (
    outIt: NormalizedItinerary,
    outDate: string,
    retIt: NormalizedItinerary | null,
    retDate: string | null,
  ) => void
  /** Show a collapse/expand toggle in the panel title bar. Default: true. */
  collapsible?: boolean
  // ── Rich-card props (used by selectionOnly summary) ──────────────────────
  /** Required to render full ItineraryCard in the selection summary. */
  tzByIata?: Map<string, string>
  displayTimezone?: string
  airlineDirectory?: Record<string, string>
  airlinesMeta?: AirlinesMeta
  layoverLongMinHours?: number
  layoverShortMaxHours?: number
  /**
   * Hide cells whose displayed price exceeds this value.
   * For the combined panel this caps outbound+return totals; for single-leg
   * panels it caps the individual leg price.
   */
  maxPrice?: number | null
  /** Price verifications keyed by vKey(routeKey, outDepTime, retDepTime). */
  verifications?: Map<string, PriceVerificationRow>
  onUpsertVerification?: (row: Omit<PriceVerificationRow, 'id' | 'updatedAt'>) => void | Promise<void>
  onRemoveVerification?: (routeKey: string, outDepTime: string, retDepTime: string) => void | Promise<void>
}

const MAX_ROUTES_SHOWN = 30

export function PriceWindowPanel({
  result,
  currency,
  title,
  namesByIata,
  returnResult,
  filterToRouteKey,
  onRouteSelect,
  controlledSelection,
  selectionOnly = false,
  collapsible = true,
  maxPrice,
  selectedReturnIt,
  selectedReturnDate,
  onSave,
  tzByIata,
  displayTimezone = '',
  airlineDirectory,
  airlinesMeta,
  layoverLongMinHours = 4,
  layoverShortMaxHours = 1,
  verifications,
  onUpsertVerification,
  onRemoveVerification,
}: PriceWindowPanelProps) {
  // Internal selection state — only used in uncontrolled mode (controlledSelection === undefined)
  const [selection, setSelection] = useState<CellSelection | null>(null)
  const [isOpen, setIsOpen] = useState(true)
  const [saveConfirm, setSaveConfirm] = useState(false)
  const saveConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [verifyPrice, setVerifyPrice] = useState('')
  const [verifyPaxDesc, setVerifyPaxDesc] = useState('')
  const [verifyNote, setVerifyNote] = useState('')
  type StatSort = 'default' | 'min-asc' | 'min-desc' | 'med-asc' | 'med-desc'
  const [statSort, setStatSort] = useState<StatSort>('default')

  function cycleStatSort(col: 'min' | 'med') {
    setStatSort((prev) => {
      if (prev === `${col}-asc`) return `${col}-desc` as StatSort
      if (prev === `${col}-desc`) return 'default'
      return `${col}-asc` as StatSort
    })
  }

  // Auto-expand when a route filter is applied from a sibling panel
  const prevFilterRef = useRef(filterToRouteKey)
  useEffect(() => {
    if (filterToRouteKey && filterToRouteKey !== prevFilterRef.current) {
      setIsOpen(true)
    }
    prevFilterRef.current = filterToRouteKey
  }, [filterToRouteKey])

  // Auto-expand when an external selection arrives (e.g. Total Round Trip drives Outbound panel)
  const prevControlledRef = useRef(controlledSelection)
  useEffect(() => {
    if (
      controlledSelection !== undefined &&
      controlledSelection !== null &&
      controlledSelection !== prevControlledRef.current
    ) {
      setIsOpen(true)
    }
    prevControlledRef.current = controlledSelection
  }, [controlledSelection])

  const { dates, globalMinByDate, globalTopRoutesByDate, perRouteByDate, routeKeyOrder } = result

  // ─── Controlled vs uncontrolled selection ────────────────────────────────
  const isControlled = controlledSelection !== undefined

  const effSelection: EffSelection = useMemo(() => {
    if (isControlled) {
      return controlledSelection
        ? { routeKey: controlledSelection.routeKey, date: controlledSelection.date, pickedIdx: controlledSelection.pickedIdx ?? 0 }
        : null
    }
    if (selection?.kind === 'route') {
      return { routeKey: selection.routeKey, date: selection.date, pickedIdx: selection.pickedIdx }
    }
    return null
  }, [isControlled, controlledSelection, selection])

  // Reset save confirmation whenever the selected itinerary changes
  useEffect(() => {
    setSaveConfirm(false)
    if (saveConfirmTimerRef.current) clearTimeout(saveConfirmTimerRef.current)
  }, [effSelection?.routeKey, effSelection?.date])

  // Clear verify inputs whenever the selected itinerary changes
  useEffect(() => {
    setVerifyPrice(''); setVerifyPaxDesc(''); setVerifyNote('')
  }, [effSelection?.routeKey, effSelection?.date, selectedReturnDate])

  // ─── Return price maps ────────────────────────────────────────────────────
  const minReturnByRouteKey = new Map<string, number>()
  if (returnResult) {
    for (const [rk, dateMap] of returnResult.perRouteByDate) {
      let min = Infinity
      for (const { minPrice } of dateMap.values()) {
        if (minPrice < min) min = minPrice
      }
      if (min < Infinity) minReturnByRouteKey.set(rk, min)
    }
  }

  function combinedPrice(routeKey: string, outPrice: number): number | null {
    let price: number
    if (!returnResult) {
      price = outPrice
    } else {
      const lowestReturn = minReturnByRouteKey.get(reverseRouteKey(routeKey))
      if (lowestReturn == null) return null
      price = outPrice + lowestReturn
    }
    if (maxPrice != null && price > maxPrice) return null
    return price
  }

  const combinedGlobalMinByDate: Map<string, number> | null = returnResult
    ? (() => {
        const m = new Map<string, number>()
        for (const date of dates) {
          let min = Infinity
          for (const [rk, dateMap] of perRouteByDate) {
            const bucket = dateMap.get(date)
            if (!bucket) continue
            const lowestRet = minReturnByRouteKey.get(reverseRouteKey(rk))
            if (lowestRet == null) continue
            const combined = bucket.minPrice + lowestRet
            if (maxPrice != null && combined > maxPrice) continue
            if (combined < min) min = combined
          }
          if (min < Infinity) m.set(date, min)
        }
        return m
      })()
    : null

  const cappedGlobalMinByDate: Map<string, number> = useMemo(() => {
    if (maxPrice == null || combinedGlobalMinByDate != null) return globalMinByDate
    const m = new Map<string, number>()
    for (const [date, p] of globalMinByDate) {
      if (p <= maxPrice) m.set(date, p)
    }
    return m
  }, [globalMinByDate, maxPrice, combinedGlobalMinByDate])

  const displayGlobalMinByDate = combinedGlobalMinByDate ?? cappedGlobalMinByDate

  const allPrices: number[] = []
  if (!returnResult) {
    for (const p of globalMinByDate.values()) allPrices.push(p)
    for (const dateMap of perRouteByDate.values()) {
      for (const { minPrice } of dateMap.values()) allPrices.push(minPrice)
    }
  } else {
    for (const [rk, dateMap] of perRouteByDate) {
      const lowestReturn = minReturnByRouteKey.get(reverseRouteKey(rk))
      if (lowestReturn == null) continue
      for (const { minPrice } of dateMap.values()) allPrices.push(minPrice + lowestReturn)
    }
  }
  const minP = allPrices.length ? Math.min(...allPrices) : 0
  const maxP = allPrices.length ? Math.max(...allPrices) : 0

  // Hide the "All routes" row in selectionOnly mode (it's not actionable there)
  const showGlobalRow = !filterToRouteKey && !selectionOnly
  const visibleRoutes = filterToRouteKey
    ? perRouteByDate.has(filterToRouteKey) ? [filterToRouteKey] : []
    : routeKeyOrder.slice(0, MAX_ROUTES_SHOWN)

  // ─── Precompute min/median per route (for stat columns + sorting) ─────────
  type RouteStats = { min: number | null; med: number | null }
  const routeStatsMap = new Map<string, RouteStats>()
  for (const routeKey of visibleRoutes) {
    const dateMap = perRouteByDate.get(routeKey)
    if (!dateMap) { routeStatsMap.set(routeKey, { min: null, med: null }); continue }
    const prices: number[] = []
    for (const d of dates) {
      const bucket = dateMap.get(d)
      if (!bucket) continue
      const p = combinedPrice(routeKey, bucket.minPrice)
      if (p != null) prices.push(p)
    }
    const sp = [...prices].sort((a, b) => a - b)
    routeStatsMap.set(routeKey, { min: sp[0] ?? null, med: priceMedian(sp) })
  }

  // Apply stat sort (3-way toggle: asc → desc → default)
  const sortedRoutes = statSort === 'default' ? visibleRoutes : [...visibleRoutes].sort((a, b) => {
    const col: keyof RouteStats = statSort.startsWith('min') ? 'min' : 'med'
    const va = routeStatsMap.get(a)?.[col] ?? Infinity
    const vb = routeStatsMap.get(b)?.[col] ?? Infinity
    return statSort.endsWith('desc') ? vb - va : va - vb
  })

  // ─── Interaction handlers ─────────────────────────────────────────────────
  function toggleGlobal(date: string) {
    if (selection?.kind === 'global' && selection.date === date) {
      setSelection(null)
    } else {
      setSelection({ kind: 'global', date })
      onRouteSelect?.(null)
    }
  }

  function toggleRoute(routeKey: string, date: string) {
    const isActive = effSelection?.routeKey === routeKey && effSelection?.date === date
    const bucket = perRouteByDate.get(routeKey)?.get(date)
    const pickedIt = bucket?.allItineraries[0] ?? bucket?.bestItinerary
    if (isActive) {
      if (!isControlled) setSelection(null)
      onRouteSelect?.(null)
    } else {
      if (!isControlled) setSelection({ kind: 'route', routeKey, date, pickedIdx: 0 })
      onRouteSelect?.({ routeKey, date, pickedIdx: 0, selectedItinerary: pickedIt })
    }
  }

  function pickItinerary(routeKey: string, date: string, idx: number) {
    const bucket = perRouteByDate.get(routeKey)?.get(date)
    const pickedIt = bucket?.allItineraries[idx] ?? bucket?.bestItinerary
    if (!isControlled) setSelection({ kind: 'route', routeKey, date, pickedIdx: idx })
    onRouteSelect?.({ routeKey, date, pickedIdx: idx, selectedItinerary: pickedIt })
  }

  function routeLabel(routeKey: string): { path: string; fullTitle: string; carriers: string } {
    const [waypoint, carriers = ''] = routeKey.split('|')
    const airports = waypoint.split('-')
    const path = airports.join(' › ')
    const fullTitle = airports
      .map((iata) => {
        const name = namesByIata.get(iata)
        return name ? `${name} (${iata})` : iata
      })
      .join(' › ')
    return { path, fullTitle, carriers }
  }

  // ─── Verification badge set: "routeKey|outDate" pairs that have any verification ───
  const verifiedCellSet = useMemo(() => {
    const s = new Set<string>()
    if (!verifications) return s
    for (const key of verifications.keys()) {
      // key format: routeKey::outDepTime::retDepTime
      // outDepTime is "YYYY-MM-DD HH:mm" — extract just the date for cell-level badge
      const parts = key.split('::')
      if (parts.length >= 2) s.add(`${parts[0]}|${parts[1].slice(0, 10)}`)
    }
    return s
  }, [verifications])

  // ─── Detail panel data ────────────────────────────────────────────────────
  const selectedGlobalRoutes =
    selection?.kind === 'global'
      ? (globalTopRoutesByDate.get(selection.date) ?? [])
      : null

  const selectedRouteBucket = effSelection
    ? perRouteByDate.get(effSelection.routeKey)?.get(effSelection.date) ?? null
    : null

  const pickedOutboundIt: NormalizedItinerary | null =
    effSelection && selectedRouteBucket
      ? (selectedRouteBucket.allItineraries[effSelection.pickedIdx] ?? selectedRouteBucket.bestItinerary)
      : null

  // ─── Helpers used in both summary and detail panel ────────────────────────
  function buildDetailContext(outIt: NormalizedItinerary, outDate: string) {
    let bestRetDate = selectedReturnDate ?? ''
    let bestRetIt: NormalizedItinerary | null = selectedReturnIt ?? null

    // If no explicit return is selected but returnResult is available, auto-pick cheapest
    if (!bestRetIt && returnResult && effSelection) {
      const revKey = reverseRouteKey(effSelection.routeKey)
      const retDateMap = returnResult.perRouteByDate.get(revKey)
      if (retDateMap) {
        let bestRetPrice = Infinity
        for (const [d, bucket] of retDateMap) {
          if (bucket.minPrice < bestRetPrice) {
            bestRetPrice = bucket.minPrice
            bestRetDate = d
            bestRetIt = bucket.bestItinerary
          }
        }
      }
    }

    const airports = (effSelection?.routeKey ?? '').split('|')[0].split('-')
    const deepUrl = buildGoogleFlightsDeepLink(outIt, outDate, bestRetIt, bestRetIt ? bestRetDate : null)
    const { url: searchUrl, reliable } = buildGoogleFlightsSearchUrl(
      [airports[0]],
      [airports[airports.length - 1]],
      outDate,
      bestRetIt ? bestRetDate : null,
    )

    const outPrice = outIt.price
    const retPrice = bestRetIt?.price
    const totalPrice = outPrice != null && retPrice != null ? outPrice + retPrice : null

    const copyDetails = async () => {
      const lines = [itineraryDetailsText(outIt, 'Outbound', outDate)]
      if (bestRetIt) lines.push('', itineraryDetailsText(bestRetIt, 'Return', bestRetDate))
      await navigator.clipboard.writeText(lines.join('\n'))
    }

    return { bestRetIt, bestRetDate, deepUrl, url: deepUrl ?? searchUrl, reliable, outPrice, retPrice, totalPrice, copyDetails }
  }

  const displayTitle = filterToRouteKey
    ? `${title} · ${filterToRouteKey.split('|')[0].replace(/-/g, ' › ')}`
    : title

  return (
    <div className="pw-panel">
      <div className="pw-panel-titlebar">
        <h3 className="pw-panel-title">{displayTitle}</h3>
        {collapsible && (
          <button
            type="button"
            className="pw-panel-collapse-btn"
            onClick={() => setIsOpen((v) => !v)}
            aria-expanded={isOpen}
            title={isOpen ? 'Collapse' : 'Expand'}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        )}
      </div>

      {(!collapsible || isOpen) && <>

        {/* ── selectionOnly summary (Total Round Trip panel) ─────────────── */}
        {selectionOnly && (
          <div className="pw-sel-summary">
            {effSelection && pickedOutboundIt ? (() => {
              const { bestRetIt, bestRetDate, url, deepUrl, reliable, outPrice, retPrice, totalPrice, copyDetails } =
                buildDetailContext(pickedOutboundIt, effSelection.date)

              // Derive airports from routeKey for per-leg GF links
              const routeAirports = effSelection.routeKey.split('|')[0].split('-')
              const outOrigins = [routeAirports[0]]
              const outDests = [routeAirports[routeAirports.length - 1]]

              // Use rich ItineraryCard when display props are available, else fall back to compact
              const canShowRichCard = !!(tzByIata && airlinesMeta && airlineDirectory)

              const sharedCardProps = canShowRichCard ? {
                tzByIata: tzByIata!,
                displayTimezone,
                airlineDirectory: airlineDirectory!,
                airlinesMeta: airlinesMeta!,
                namesByIata,
                layoverLongMinHours,
                layoverShortMaxHours,
                priceCurrency: currency,
              } : null

              return (
                <>
                  {canShowRichCard && sharedCardProps ? (
                    <div className="srt-legs">
                      <div className="srt-leg">
                        <div className="srt-leg-header">
                          <span className="srt-leg-label">Outbound · {shortDateWithDay(effSelection.date)}</span>
                          {deepUrl && (
                            <a href={deepUrl} target="_blank" rel="noopener noreferrer" className="srt-leg-gf-icon" title="Open round-trip in Google Flights">↗</a>
                          )}
                        </div>
                        <ItineraryCard
                          {...sharedCardProps}
                          it={pickedOutboundIt}
                          gfOrigins={outOrigins}
                          gfDestinations={outDests}
                          linkDate={effSelection.date}
                          returnDate={bestRetIt ? bestRetDate : null}
                        />
                      </div>
                      {bestRetIt ? (
                        <div className="srt-leg srt-leg--return">
                          <div className="srt-leg-header">
                            <span className="srt-leg-label">Return · {shortDateWithDay(bestRetDate)}</span>
                            {deepUrl && (
                              <a href={deepUrl} target="_blank" rel="noopener noreferrer" className="srt-leg-gf-icon" title="Open round-trip in Google Flights">↗</a>
                            )}
                          </div>
                          <ItineraryCard
                            {...sharedCardProps}
                            it={bestRetIt}
                            gfOrigins={outDests}
                            gfDestinations={outOrigins}
                            linkDate={bestRetDate}
                            returnDate={null}
                          />
                        </div>
                      ) : (
                        <div className="srt-leg srt-leg--return">
                          <p className="pw-sel-hint muted small">
                            ↓ Pick a return date in the Return panel below
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="pw-sel-row">
                        <span className="pw-sel-label">Outbound · {shortDateWithDay(effSelection.date)}</span>
                        <ItineraryCompact it={pickedOutboundIt} currency={currency} />
                      </div>
                      {bestRetIt ? (
                        <div className="pw-sel-row">
                          <span className="pw-sel-label">Return · {shortDateWithDay(bestRetDate)}</span>
                          <ItineraryCompact it={bestRetIt} currency={currency} />
                        </div>
                      ) : (
                        <p className="pw-sel-hint muted small">
                          ↓ Pick a return date in the Return panel below
                        </p>
                      )}
                    </>
                  )}
                  {totalPrice != null && (
                    <div className="pw-sel-total">
                      Round-trip total:{' '}
                      <strong className="pw-sel-total-value">{formatPriceAmount(totalPrice, currency)}</strong>
                      <span className="pw-sel-total-breakdown muted">
                        {' '}({formatPriceAmount(outPrice!, currency)} + {formatPriceAmount(retPrice!, currency)})
                      </span>
                    </div>
                  )}

                  {/* ── Verified price section ── */}
                  {onUpsertVerification && (() => {
                    // Dep times uniquely identify the specific itinerary (not just the date)
                    const outDepTime = pickedOutboundIt.segments[0]?.depTime ?? ''
                    const retDepTime = bestRetIt?.segments[0]?.depTime ?? ''
                    const vk = vKey(effSelection.routeKey, outDepTime, retDepTime)
                    const existing = verifications?.get(vk)
                    return (
                      <div className="pw-sel-verify" onClick={e => e.stopPropagation()}>
                        {existing && (
                          <div className="pw-sel-verify-existing">
                            <span className="pw-sel-verify-badge">✓ Verified</span>
                            <strong className="pw-sel-verify-price">{formatPriceAmount(existing.verifiedPrice, existing.currency)}</strong>
                            {existing.paxDesc && <span className="muted small">{existing.paxDesc}</span>}
                            {existing.note && <span className="muted small">· {existing.note}</span>}
                          </div>
                        )}
                        <div className="pw-sel-verify-label muted small">
                          {outDepTime ? `Out dep: ${outDepTime.slice(11)}` : 'Out dep: unknown'}
                          {retDepTime ? ` · Ret dep: ${retDepTime.slice(11)}` : ''}
                        </div>
                        <div className="pw-sel-verify-inputs">
                          <input
                            type="number"
                            className="input pw-sel-verify-input"
                            placeholder={existing ? 'Update verified price' : 'Verified price (e.g. 3777)'}
                            value={verifyPrice}
                            onChange={e => setVerifyPrice(e.target.value)}
                          />
                          <input
                            type="text"
                            className="input pw-sel-verify-input"
                            placeholder="Pax (e.g. 1A+2C)"
                            value={verifyPaxDesc}
                            onChange={e => setVerifyPaxDesc(e.target.value)}
                          />
                          <input
                            type="text"
                            className="input pw-sel-verify-input"
                            placeholder="Note (optional)"
                            value={verifyNote}
                            onChange={e => setVerifyNote(e.target.value)}
                          />
                          <div className="pw-sel-verify-btns">
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              onClick={() => {
                                const p = Number(verifyPrice)
                                if (!Number.isFinite(p) || p <= 0) return
                                void onUpsertVerification({
                                  routeKey: effSelection.routeKey,
                                  outDate: effSelection.date,
                                  retDate: bestRetDate,
                                  outDepTime,
                                  retDepTime,
                                  verifiedPrice: p,
                                  currency,
                                  paxDesc: verifyPaxDesc.trim(),
                                  note: verifyNote.trim(),
                                })
                              }}
                            >
                              {existing ? 'Update verified' : 'Save verified price'}
                            </button>
                            {existing && onRemoveVerification && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-small"
                                onClick={() => void onRemoveVerification(effSelection.routeKey, outDepTime, retDepTime)}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="pw-detail-actions">
                    <a
                      className="itin-action"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      title={deepUrl ? 'Pre-selected exact flights (round trip)' : reliable ? undefined : 'Approximate — multi-origin/destination'}
                    >
                      Google Flights{deepUrl ? ' ✓' : (!reliable ? ' (~)' : '')} (round trip)
                    </a>
                    <button type="button" className="itin-action" onClick={() => void copyDetails()}>
                      Copy both legs
                    </button>
                    {onSave && (
                      saveConfirm ? (
                        <span className="itin-save-confirm">✓ Saved</span>
                      ) : (
                        <button
                          type="button"
                          className="itin-action itin-action--save"
                          onClick={() => {
                            onSave(pickedOutboundIt, effSelection.date, bestRetIt, bestRetIt ? bestRetDate : null)
                            setSaveConfirm(true)
                            if (saveConfirmTimerRef.current) clearTimeout(saveConfirmTimerRef.current)
                            saveConfirmTimerRef.current = setTimeout(() => setSaveConfirm(false), 2500)
                          }}
                          title={bestRetIt ? 'Save outbound + return to Saved Results' : 'Save outbound to Saved Results'}
                        >
                          Save{bestRetIt ? ' both' : ''}
                        </button>
                      )
                    )}
                  </div>
                </>
              )
            })() : (
              <p className="pw-sel-hint muted small">
                ↓ Click a cell in the grid below to select an outbound date and route
              </p>
            )}
          </div>
        )}

        {displayGlobalMinByDate.size === 0 && routeKeyOrder.length === 0 && (
          <div className="pw-no-results">
            No priced results found.
            <span className="pw-no-results-hint">
              {' '}Check that the search ran successfully, your API quota has not been exhausted, and that active filters aren't hiding all results.
            </span>
          </div>
        )}

        {(displayGlobalMinByDate.size > 0 || routeKeyOrder.length > 0) && <div className="pw-grid-wrap">
          <div className="pw-grid-scroll">

            {/* Header row */}
            <div className="pw-grid-row pw-grid-header-row">
              <div className="pw-label-col pw-label-sticky pw-label-header">Route</div>
              <button
                type="button"
                className={`pw-stat-col pw-stat-col--min pw-stat-sticky pw-label-header pw-stat-sortable${statSort.startsWith('min') ? ' pw-stat-sorted' : ''}`}
                onClick={() => cycleStatSort('min')}
                title="Sort by minimum price (click to cycle: ↑ asc → ↓ desc → default)"
              >
                Min{statSort === 'min-asc' ? ' ↑' : statSort === 'min-desc' ? ' ↓' : ''}
              </button>
              <button
                type="button"
                className={`pw-stat-col pw-stat-col--med pw-stat-sticky pw-label-header pw-stat-sortable${statSort.startsWith('med') ? ' pw-stat-sorted' : ''}`}
                onClick={() => cycleStatSort('med')}
                title="Sort by median price (click to cycle: ↑ asc → ↓ desc → default)"
              >
                Med{statSort === 'med-asc' ? ' ↑' : statSort === 'med-desc' ? ' ↓' : ''}
              </button>
              {dates.map((d) => (
                <div key={d} className="pw-date-col pw-date-header">
                  <span className="pw-date-dow">{new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                  <span>{shortDate(d)}</span>
                </div>
              ))}
            </div>

            {/* Global min row */}
            {showGlobalRow && (() => {
              const globalPrices = [...displayGlobalMinByDate.values()].sort((a, b) => a - b)
              const gMin = globalPrices[0] ?? null
              const gMed = priceMedian(globalPrices)
              return (
                <div className="pw-grid-row pw-grid-global-row">
                  <div className="pw-label-col pw-label-sticky pw-label-global">
                    All routes
                    <span className="pw-label-hint">{returnResult ? 'best combined' : 'cheapest any'}</span>
                  </div>
                  <div
                    className={`pw-stat-col pw-stat-col--min pw-stat-sticky pw-stat-global${gMin != null ? ' pw-stat-heat' : ''}`}
                    style={gMin != null ? { '--pw-heat-bg': heatColor(gMin, minP, maxP) } as React.CSSProperties : undefined}
                  >
                    {gMin != null ? formatPriceAmount(gMin, currency) : '—'}
                  </div>
                  <div
                    className={`pw-stat-col pw-stat-col--med pw-stat-sticky pw-stat-global${gMed != null ? ' pw-stat-heat' : ''}`}
                    style={gMed != null ? { '--pw-heat-bg': heatColor(gMed, minP, maxP) } as React.CSSProperties : undefined}
                  >
                    {gMed != null ? formatPriceAmount(gMed, currency) : '—'}
                  </div>
                  {dates.map((d) => {
                    const p = displayGlobalMinByDate.get(d)
                    const isActive = selection?.kind === 'global' && selection.date === d
                    return p != null ? (
                      <button
                        key={d}
                        type="button"
                        className={`pw-date-col pw-price-cell${isActive ? ' pw-cell-active' : ''}`}
                        style={{ background: heatColor(p, minP, maxP) }}
                        onClick={() => toggleGlobal(d)}
                        title={`${shortDateWithDay(d)}: ${formatPriceAmount(p, currency)}`}
                      >
                        {formatPriceAmount(p, currency)}
                      </button>
                    ) : (
                      <div key={d} className="pw-date-col pw-empty-cell">—</div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Route rows */}
            {sortedRoutes.map((routeKey) => {
              const dateMap = perRouteByDate.get(routeKey)
              if (!dateMap) return null
              const { path, fullTitle, carriers } = routeLabel(routeKey)
              const { min: routeMin, med: routeMed } = routeStatsMap.get(routeKey) ?? { min: null, med: null }

              return (
                <div key={routeKey} className="pw-grid-row pw-grid-route-row">
                  <div className="pw-label-col pw-label-sticky pw-label-route" title={fullTitle}>
                    <span className="pw-route-path">{path}</span>
                    {carriers && <span className="pw-route-carriers">{carriers}</span>}
                  </div>
                  <div
                    className={`pw-stat-col pw-stat-col--min pw-stat-sticky${routeMin != null ? ' pw-stat-heat' : ''}${statSort.startsWith('min') ? ' pw-stat-sorted' : ''}`}
                    style={routeMin != null ? { '--pw-heat-bg': heatColor(routeMin, minP, maxP) } as React.CSSProperties : undefined}
                  >
                    {routeMin != null ? formatPriceAmount(routeMin, currency) : '—'}
                  </div>
                  <div
                    className={`pw-stat-col pw-stat-col--med pw-stat-sticky${routeMed != null ? ' pw-stat-heat' : ''}${statSort.startsWith('med') ? ' pw-stat-sorted' : ''}`}
                    style={routeMed != null ? { '--pw-heat-bg': heatColor(routeMed, minP, maxP) } as React.CSSProperties : undefined}
                  >
                    {routeMed != null ? formatPriceAmount(routeMed, currency) : '—'}
                  </div>
                  {dates.map((d) => {
                    const bucket = dateMap.get(d)
                    const isActive =
                      effSelection?.routeKey === routeKey && effSelection?.date === d

                    if (!bucket) {
                      return <div key={d} className="pw-date-col pw-empty-cell">—</div>
                    }

                    const combined = combinedPrice(routeKey, bucket.minPrice)
                    if (combined == null) {
                      return <div key={d} className="pw-date-col pw-empty-cell">—</div>
                    }

                    // Tooltip: for round-trip panels show top-3 return date options with combined price
                    const retDateMap = returnResult?.perRouteByDate.get(reverseRouteKey(routeKey))
                    let tooltipText: string
                    if (retDateMap && retDateMap.size > 0) {
                      const top3 = [...retDateMap.entries()]
                        .map(([retDate, retBucket]) => ({
                          date: retDate,
                          retPrice: retBucket.minPrice,
                          combined: bucket.minPrice + retBucket.minPrice,
                        }))
                        .filter((o) => maxPrice == null || o.combined <= maxPrice)
                        .sort((a, b) => a.combined - b.combined)
                        .slice(0, 3)
                      tooltipText = top3.length > 0
                        ? top3.map((o) =>
                            `${formatPriceAmount(o.combined, currency)} (ret: ${shortRetDate(o.date)} ${formatPriceAmount(o.retPrice, currency)})`
                          ).join('\n')
                        : `${shortDateWithDay(d)}: ${formatPriceAmount(combined, currency)}`
                    } else {
                      tooltipText = `${shortDateWithDay(d)}: ${formatPriceAmount(combined, currency)}`
                    }

                    const hasVerification = verifiedCellSet.has(`${routeKey}|${d}`)
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`pw-date-col pw-price-cell${isActive ? ' pw-cell-active' : ''}`}
                        style={{ background: heatColor(combined, minP, maxP) }}
                        onClick={() => toggleRoute(routeKey, d)}
                        title={tooltipText}
                      >
                        {hasVerification && <span className="pw-cell-verified-badge">✓</span>}
                        {formatPriceAmount(combined, currency)}
                      </button>
                    )
                  })}
                </div>
              )
            })}

          </div>
        </div>}

        {/* ── Drilldown / detail panel (shown when NOT in selectionOnly mode) ── */}
        {!selectionOnly && <>
          {selection?.kind === 'global' && selectedGlobalRoutes != null && (
            <div className="pw-detail-panel">
              <div className="pw-detail-heading">
                Top routes · {shortDateWithDay(selection.date)}
              </div>
              <GlobalDrilldown routes={selectedGlobalRoutes} currency={currency} />
            </div>
          )}

          {effSelection && selectedRouteBucket && pickedOutboundIt && (() => {
            const outIt = pickedOutboundIt
            const outDate = effSelection.date
            const allOut = selectedRouteBucket.allItineraries
            const pickedIdx = effSelection.pickedIdx
            const routeAirports = effSelection.routeKey.split('|')[0].split('-')

            const { bestRetIt, bestRetDate, url, deepUrl, reliable, copyDetails } =
              buildDetailContext(outIt, outDate)

            return (
              <div className="pw-detail-panel">
                <div className="pw-detail-actions">
                  <a className="itin-action" href={url} target="_blank" rel="noreferrer"
                    title={deepUrl ? 'Pre-selected exact flights' : reliable ? undefined : 'Approximate search — multi-origin/destination'}>
                    Google Flights{deepUrl ? ' ✓' : (!reliable ? ' (~)' : '')}
                  </a>
                  <button type="button" className="itin-action" onClick={() => void copyDetails()}>
                    Copy details
                  </button>
                  {onSave && (
                    saveConfirm ? (
                      <span className="itin-save-confirm">✓ Saved</span>
                    ) : (
                      <button
                        type="button"
                        className="itin-action itin-action--save"
                        onClick={() => {
                          onSave(outIt, outDate, bestRetIt, bestRetIt ? bestRetDate : null)
                          setSaveConfirm(true)
                          if (saveConfirmTimerRef.current) clearTimeout(saveConfirmTimerRef.current)
                          saveConfirmTimerRef.current = setTimeout(() => setSaveConfirm(false), 2500)
                        }}
                        title={bestRetIt ? 'Save outbound + return to Saved Results' : 'Save outbound to Saved Results'}
                      >
                        Save{bestRetIt ? ' both' : ''}
                      </button>
                    )
                  )}
                </div>

                <div className="pw-detail-heading">
                  Options · {shortDateWithDay(outDate)}
                  {allOut.length > 1 && <span className="pw-detail-count"> ({allOut.length})</span>}
                </div>
                <div className="pw-itin-list">
                  {allOut.map((it, i) => {
                    const optDeepUrl = buildGoogleFlightsDeepLink(it, outDate, bestRetIt, bestRetIt ? bestRetDate : null)
                    const { url: optSearchUrl } = buildGoogleFlightsSearchUrl(
                      [routeAirports[0]],
                      [routeAirports[routeAirports.length - 1]],
                      outDate,
                      bestRetIt ? bestRetDate : null,
                    )
                    const optGfUrl = optDeepUrl ?? optSearchUrl
                    return (
                      <div key={i} className={`pw-itin-option-wrap${i === pickedIdx ? ' pw-itin-option--active' : ''}`}>
                        <button
                          type="button"
                          className="pw-itin-option-body"
                          onClick={() => pickItinerary(effSelection.routeKey, effSelection.date, i)}
                          title="Select this itinerary"
                        >
                          <ItineraryCompact it={it} currency={currency} />
                        </button>
                        <a
                          href={optGfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pw-itin-option-gf"
                          title={optDeepUrl ? 'Open this flight in Google Flights (pre-selected)' : 'Search in Google Flights'}
                          onClick={e => e.stopPropagation()}
                        >↗</a>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </>}

        {!filterToRouteKey && routeKeyOrder.length > MAX_ROUTES_SHOWN && (
          <p className="pw-truncated-note muted small">
            Showing top {MAX_ROUTES_SHOWN} of {routeKeyOrder.length} routes by cheapest price.
          </p>
        )}
      </>}
    </div>
  )
}
