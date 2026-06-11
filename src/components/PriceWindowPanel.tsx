import { useEffect, useMemo, useRef, useState } from 'react'
import type { PriceWindowResult, DateTopRoute, RouteDateBucket } from '../lib/routeGrouping'
import { formatPriceAmount } from '../lib/formatPrice'
import type { NormalizedItinerary, NormalizedSegment } from '../lib/types'
import {
  buildGoogleFlightsDeepLink,
  buildGoogleFlightsSearchUrl,
  itineraryDetailsText,
} from '../lib/googleFlightsLink'
import { dedupeByScheduleKey, itineraryScheduleKey } from '../lib/filters'
import { ItineraryCard } from './ItineraryCard'
import { RouteLabelCell } from './RouteLabelCell'
import type { AirlinesMeta } from '../lib/airlineMetaLookup'
import type { PriceVerificationRow } from '../db/priceVerificationRepo'
import {
  legKeyDepTime,
  legVerificationKey,
  lookupVerificationRow,
  parseVKey,
  verificationPriceLabel,
} from '../db/priceVerificationRepo'
import {
  minCombinedForDatePair,
  minTokenPriceForScheduleOnPair,
  minPriceForOutboundScheduleOnPair,
  resolveRoundTripSelection,
  type PriceOverrideMap,
  type PriceWindowDateBounds,
} from '../lib/priceOverrides'
import { computePwPanelCellPrice } from '../lib/pwPanelCellPrice'
import {
  outboundItinerariesForCell,
  returnItinerariesForCell,
  returnRouteKeysForOutbound,
} from '../lib/roundTripPricing'
import {
  expansionBadgeLabel,
  roundTripPairCellKey,
  type RoundTripPairDeepenState,
  type RoundTripPairMeta,
} from '../lib/roundTripPairMeta'
import type { RoundTripCombo } from '../lib/roundTripTypes'
import type { RtTokenPriceIndex } from '../lib/rtTokenRoutePrice'
import {
  HEATMAP_QUALITY_DEFS,
  resolveOneWayRouteDateQuality,
  resolveOutboundRouteDateQuality,
  resolveReturnRouteDateQuality,
  type HeatmapCellQuality,
} from '../lib/heatmapCellQuality'
import { HeatmapQualityBadge, heatmapQualityCellClass } from './HeatmapQualityFilter'

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

function ItineraryCompact({
  it,
  currency,
  hidePrice = false,
  displayPrice,
}: {
  it: NormalizedItinerary
  currency: string
  hidePrice?: boolean
  /** When set, shown instead of it.price (e.g. bundled RT for active return date). */
  displayPrice?: number | null
}) {
  const price = displayPrice ?? it.price
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
        {!hidePrice && price != null ? ` · ${formatPriceAmount(price, currency)}` : ''}
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
  /** Passenger counts passed to Google Flights deep links. */
  adults?: number
  children?: number
  /** Cabin class passed to Google Flights deep links: 1=Economy (default), 2=Premium Economy, 3=Business, 4=First */
  cabinClass?: number
  /** When set, combined cells use SerpApi round-trip bundled fares (not leg sums). */
  roundTripCombos?: RoundTripCombo[] | null
  /** Initial-scan prices per date pair (heatmap / shell grids). */
  roundTripPairMeta?: Map<string, RoundTripPairMeta> | null
  /** Ranked outbound options from RT scan (for cells without grid buckets). */
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null
  /** Precomputed token prices (heatmap quality badges). */
  rtTokenIndex?: RtTokenPriceIndex | null
  /** Outbound-date index for ranked option lookup. */
  deepenByOutDate?: Map<string, RoundTripPairDeepenState[]> | null
  /** Return-date panel: outbound date axis for combined RT lookup. */
  pairedOutboundResult?: PriceWindowResult | null
  /** Return panel: selected outbound route (shows matching return paths + combo options). */
  pairedOutboundRouteKey?: string | null
  pairedOutboundDate?: string | null
  pairedOutboundSelection?: {
    routeKey: string
    date: string
    pickedIdx?: number
    selectedItinerary?: NormalizedItinerary
  } | null
  /** Applied to outbound itineraries shown in OPTIONS (filters deepenState ranked candidates). */
  outboundLegFilter?: ((it: NormalizedItinerary) => boolean) | null
  /** Applied to return itineraries shown in OPTIONS. */
  returnLegFilter?: ((it: NormalizedItinerary) => boolean) | null
  /** Search calendar limits (return dates outside this range are excluded from cell + tooltip). */
  dateBounds?: PriceWindowDateBounds | null
  /** When non-empty, only matching quality cells stay vivid; others dim. */
  qualityFilter?: ReadonlySet<HeatmapCellQuality>
  /** selectionOnly: heading above itinerary summary (default "Selected itinerary"). */
  summaryTitle?: string
  /** selectionOnly: heading above the price grid (defaults to `title`). */
  gridTitle?: string
  /** Root `data-testid` for automated validation (e.g. pw-panel-total). */
  panelTestId?: string
  /**
   * When true, the selectionOnly summary omits the return leg section entirely.
   * Use for one-way price window panels where no return exists.
   */
  hideReturn?: boolean
  /**
   * Hide route rows whose implied stop count (derived from waypoint segments)
   * is below this threshold. Mirrors the UI "STOPS MIN" filter at the row level
   * so rows aren't shown as "—" placeholders when they can never pass the filter.
   */
  routeStopsMin?: number | null
  /**
   * Hide route rows whose implied stop count (derived from waypoint segments)
   * exceeds this threshold. Mirrors the UI "STOPS MAX" filter at the row level
   * so routes with too many stops are omitted entirely rather than shown with
   * "—" or red placeholder cells.
   */
  routeStopsMax?: number | null
}

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
  adults = 1,
  children = 0,
  cabinClass = 1,
  roundTripCombos = null,
  roundTripPairMeta = null,
  roundTripDeepenStates = null,
  rtTokenIndex = null,
  deepenByOutDate = null,
  pairedOutboundResult = null,
  pairedOutboundRouteKey = null,
  pairedOutboundDate = null,
  pairedOutboundSelection = null,
  outboundLegFilter = null,
  returnLegFilter = null,
  dateBounds = null,
  qualityFilter,
  summaryTitle = 'Selected itinerary',
  gridTitle,
  panelTestId,
  routeStopsMin = null,
  routeStopsMax = null,
  hideReturn = false,
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

  const { dates, globalTopRoutesByDate, perRouteByDate, routeKeyOrder } = result
  const overrideMap: PriceOverrideMap = verifications ?? new Map()

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

  function computeCellPrice(
    routeKey: string,
    axisDate: string,
    bucket: RouteDateBucket | undefined,
  ): number | null {
    const mode =
      returnResult
        ? 'total_or_outbound'
        : pairedOutboundResult && pairedOutboundRouteKey
          ? 'return_paired'
          : pairedOutboundResult
            ? 'return_unpaired'
            : 'total_or_outbound'
    return computePwPanelCellPrice({
      mode,
      routeKey,
      axisDate,
      bucket,
      outResult: result,
      retResult: returnResult,
      pairedOutboundResult,
      pairedOutboundRouteKey,
      pairedOutboundDate,
      selectedReturnDate,
      verifications: overrideMap,
      roundTripCombos,
      roundTripPairMeta,
      roundTripDeepenStates,
      rtTokenIndex,
      dateBounds,
      outboundLegFilter: outboundLegFilter ?? undefined,
      returnLegFilter: returnLegFilter ?? undefined,
      maxPrice,
    })
  }

  const showGlobalRow = !filterToRouteKey && !pairedOutboundRouteKey && !selectionOnly
  const visibleRoutes = useMemo(() => {
    let routes: string[]
    if (pairedOutboundRouteKey) {
      routes = returnRouteKeysForOutbound(
        pairedOutboundRouteKey,
        roundTripCombos,
        routeKeyOrder,
        pairedOutboundDate,
      )
    } else if (filterToRouteKey) {
      routes = perRouteByDate.has(filterToRouteKey) ? [filterToRouteKey] : []
    } else {
      routes = routeKeyOrder
    }
    // Filter route rows by stop count so routes that can never pass the UI stops
    // filter don't appear as empty "—" placeholder rows in the grid.
    if (routeStopsMin != null || routeStopsMax != null) {
      routes = routes.filter((rk) => {
        // Route key is the waypoint key, e.g. "JFK-DOH-MAA" → 1 stop (3 segments - 2 = 1 connection)
        const connections = Math.max(0, rk.split('-').length - 2)
        if (routeStopsMin != null && connections < routeStopsMin) return false
        if (routeStopsMax != null && connections > routeStopsMax) return false
        return true
      })
    }
    return routes
  }, [
    pairedOutboundRouteKey,
    roundTripCombos,
    routeKeyOrder,
    pairedOutboundDate,
    filterToRouteKey,
    perRouteByDate,
    routeStopsMin,
    routeStopsMax,
  ])

  /** One pass over routes × dates — avoids recomputing prices on every cell during render. */
  const gridMetrics = useMemo(() => {
    type RouteStats = { min: number | null; med: number | null }
    const cellPrices = new Map<string, number>()
    const cellQualities = new Map<string, HeatmapCellQuality>()
    const routeStatsMap = new Map<string, RouteStats>()
    const displayGlobalMinByDate = new Map<string, number>()

    for (const routeKey of visibleRoutes) {
      const dateMap = perRouteByDate.get(routeKey)
      const prices: number[] = []
      for (const d of dates) {
        const bucket = dateMap?.get(d)
        const combined = computeCellPrice(routeKey, d, bucket)
        const cellKey = `${routeKey}\u001e${d}`
        if (combined != null) {
          cellPrices.set(cellKey, combined)
          prices.push(combined)
          const prevGlobal = displayGlobalMinByDate.get(d)
          if (prevGlobal == null || combined < prevGlobal) {
            displayGlobalMinByDate.set(d, combined)
          }
        }
        // Always compute cell quality for badge icon accuracy (●/○/˜/—).
        // Previously gated on qualityFilter.size>0, which caused all cells to show
        // ● (Complete) even when returns were not loaded.
        if (combined != null) {
          cellQualities.set(
            cellKey,
            returnResult
              ? resolveOutboundRouteDateQuality(
                  routeKey,
                  d,
                  result,
                  returnResult,
                  overrideMap,
                  roundTripCombos,
                  roundTripPairMeta,
                  dateBounds,
                  roundTripDeepenStates,
                  rtTokenIndex,
                )
              : pairedOutboundResult && pairedOutboundRouteKey
                ? resolveReturnRouteDateQuality(
                    pairedOutboundRouteKey,
                    routeKey,
                    d,
                    pairedOutboundResult,
                    result,
                    overrideMap,
                    roundTripCombos,
                    roundTripPairMeta,
                    dateBounds,
                    roundTripDeepenStates,
                    rtTokenIndex,
                  )
                : resolveOneWayRouteDateQuality(routeKey, d, result),
          )
        }
      }
      const sp = [...prices].sort((a, b) => a - b)
      routeStatsMap.set(routeKey, { min: sp[0] ?? null, med: priceMedian(sp) })
    }

    const allPrices = [...cellPrices.values()]
    const minP = allPrices.length ? Math.min(...allPrices) : 0
    const maxP = allPrices.length ? Math.max(...allPrices) : 0

    return { cellPrices, cellQualities, routeStatsMap, displayGlobalMinByDate, minP, maxP }
  }, [
    visibleRoutes,
    dates,
    perRouteByDate,
    result,
    returnResult,
    overrideMap,
    roundTripCombos,
    roundTripPairMeta,
    dateBounds,
    roundTripDeepenStates,
    rtTokenIndex,
    outboundLegFilter,
    maxPrice,
    pairedOutboundResult,
    pairedOutboundRouteKey,
    pairedOutboundDate,
    selectedReturnDate,
    selectedReturnIt,
    qualityFilter,
  ])

  const { cellPrices, cellQualities, routeStatsMap, displayGlobalMinByDate, minP, maxP } = gridMetrics

  const sortedRoutes = useMemo(() => {
    if (statSort === 'default') return visibleRoutes
    return [...visibleRoutes].sort((a, b) => {
      const col: 'min' | 'med' = statSort.startsWith('min') ? 'min' : 'med'
      const va = routeStatsMap.get(a)?.[col] ?? Infinity
      const vb = routeStatsMap.get(b)?.[col] ?? Infinity
      return statSort.endsWith('desc') ? vb - va : va - vb
    })
  }, [visibleRoutes, routeStatsMap, statSort])

  function routeDateQuality(routeKey: string, axisDate: string): HeatmapCellQuality {
    // Always return the computed quality for badge display — never short-circuit to 'perfect'.
    // The old shortcut caused all cells to show ● (Complete) even when return itineraries
    // were not loaded, misleading the user into thinking the cell had full data.
    return cellQualities.get(`${routeKey}\u001e${axisDate}`) ?? 'empty'
  }

  // ─── Interaction handlers ─────────────────────────────────────────────────
  function toggleGlobal(date: string) {
    if (selection?.kind === 'global' && selection.date === date) {
      setSelection(null)
    } else {
      setSelection({ kind: 'global', date })
      onRouteSelect?.(null)
    }
  }

  const isReturnLegPanel = !!(pairedOutboundResult && pairedOutboundRouteKey)

  function cellItineraryOptions(routeKey: string, date: string) {
    if (isReturnLegPanel) {
      const raw = returnItinerariesForCell(
        pairedOutboundRouteKey!,
        pairedOutboundDate ?? undefined,
        routeKey,
        date,
        perRouteByDate.get(routeKey)?.get(date),
        roundTripCombos,
      )
      return returnLegFilter ? raw.filter(returnLegFilter) : raw
    }
    // In round-trip context (Return panel present), prefer itinerary-backed RT candidates
    // (combos or ranked) over bucket contents, so the selected itinerary matches the shown cell price.
    if (returnResult) {
      const rtCandidates = outboundItinerariesForCell(
        routeKey,
        date,
        undefined,
        roundTripCombos,
        roundTripDeepenStates,
        outboundLegFilter,
        deepenByOutDate,
      )
      if (rtCandidates.length) return rtCandidates
    }
    return outboundItinerariesForCell(
      routeKey,
      date,
      perRouteByDate.get(routeKey)?.get(date),
      roundTripCombos,
      roundTripDeepenStates,
      outboundLegFilter,
      deepenByOutDate,
    )
  }

  function bundledPriceForOutboundOption(
    it: NormalizedItinerary,
    routeKey: string,
    outDate: string,
  ): number | null {
    if (!returnResult || !selectedReturnDate || selectedReturnDate <= outDate) {
      return it.price ?? null
    }
    if (roundTripCombos?.length) {
      const price = minPriceForOutboundScheduleOnPair(
        it,
        routeKey,
        outDate,
        selectedReturnDate,
        overrideMap,
        roundTripCombos,
        returnLegFilter ?? undefined,
      )
      if (price != null) return price
    }
    const schedulePrice = minTokenPriceForScheduleOnPair(
      it,
      routeKey,
      outDate,
      selectedReturnDate,
      roundTripDeepenStates,
      roundTripCombos,
      overrideMap,
    )
    if (schedulePrice != null) return schedulePrice
    const resolved = resolveRoundTripSelection({
      routeKey,
      outDate,
      outIt: it,
      outResult: result,
      retResult: returnResult,
      verifications: overrideMap,
      roundTripCombos,
      roundTripPairMeta,
      roundTripDeepenStates,
      selectedReturnDate,
      selectedReturnIt: selectedReturnIt ?? null,
    })
    return resolved.bundledPrice
  }

  function pickOutboundForCell(routeKey: string, date: string, options: NormalizedItinerary[]) {
    if (!options.length) return { pickedIdx: 0, pickedIt: undefined as NormalizedItinerary | undefined }
    if (!returnResult || !selectedReturnDate || selectedReturnDate <= date) {
      return { pickedIdx: 0, pickedIt: options[0] }
    }
    let bestIdx = 0
    let bestPrice = Infinity
    for (let i = 0; i < options.length; i++) {
      const resolved = resolveRoundTripSelection({
        routeKey,
        outDate: date,
        outIt: options[i]!,
        outResult: result,
        retResult: returnResult,
        verifications: overrideMap,
        roundTripCombos,
        roundTripPairMeta,
        roundTripDeepenStates,
        selectedReturnDate,
        selectedReturnIt: selectedReturnIt ?? null,
      })
      const p = resolved.bundledPrice
      if (p != null && p < bestPrice) {
        bestPrice = p
        bestIdx = i
      }
    }
    return { pickedIdx: bestIdx, pickedIt: options[bestIdx] }
  }

  function toggleRoute(routeKey: string, date: string) {
    const isActive = effSelection?.routeKey === routeKey && effSelection?.date === date
    const options = cellItineraryOptions(routeKey, date)
    const { pickedIdx, pickedIt } = pickOutboundForCell(routeKey, date, options)
    if (isActive) {
      if (!isControlled) setSelection(null)
      onRouteSelect?.(null)
    } else {
      if (!isControlled) setSelection({ kind: 'route', routeKey, date, pickedIdx })
      onRouteSelect?.({ routeKey, date, pickedIdx, selectedItinerary: pickedIt })
    }
  }

  function pickItinerary(routeKey: string, date: string, idx: number) {
    const options = cellItineraryOptions(routeKey, date)
    const pickedIdx = options[idx] != null ? idx : 0
    const pickedIt = options[pickedIdx]
    if (!isControlled) setSelection({ kind: 'route', routeKey, date, pickedIdx })
    onRouteSelect?.({ routeKey, date, pickedIdx, selectedItinerary: pickedIt })
  }

  // ─── Verification badge set: "routeKey|outDate" pairs that have any verification ───
  const verifiedCellSet = useMemo(() => {
    const s = new Set<string>()
    if (!verifications) return s
    for (const key of verifications.keys()) {
      const parsed = parseVKey(key)
      if (!parsed) continue
      const outDate = legKeyDepTime(parsed.outLegKey).slice(0, 10)
      if (outDate) s.add(`${parsed.routeKey}|${outDate}`)
    }
    return s
  }, [verifications])

  // ─── Detail panel data ────────────────────────────────────────────────────
  const selectedGlobalRoutes =
    selection?.kind === 'global'
      ? (globalTopRoutesByDate.get(selection.date) ?? [])
      : null

  const cellOutboundOptionsList = useMemo(() => {
    if (!effSelection) return []
    return cellItineraryOptions(effSelection.routeKey, effSelection.date)
  }, [effSelection, perRouteByDate, roundTripCombos, roundTripDeepenStates, isReturnLegPanel, pairedOutboundRouteKey, pairedOutboundDate, outboundLegFilter, returnLegFilter])

  /** schedule key → departure_token for the selected outbound date — all ranked pairs. */
  const outboundTokenByScheduleKey = useMemo((): Map<string, string> => {
    const map = new Map<string, string>()
    if (!effSelection || !roundTripDeepenStates) return map
    for (const s of roundTripDeepenStates) {
      if (s.outDate !== effSelection.date) continue
      for (const { it, token } of s.ranked) {
        const k = itineraryScheduleKey(it)
        if (!map.has(k)) map.set(k, token)
      }
    }
    return map
  }, [effSelection, roundTripDeepenStates])

  const pickedOutboundIt: NormalizedItinerary | null =
    effSelection && cellOutboundOptionsList.length
      ? (cellOutboundOptionsList[effSelection.pickedIdx] ?? cellOutboundOptionsList[0])
      : null

  const deepenDatePair = useMemo((): { outDate: string; retDate: string } | null => {
    if (!effSelection) return null
    if (isReturnLegPanel && pairedOutboundDate) {
      if (effSelection.date <= pairedOutboundDate) return null
      return { outDate: pairedOutboundDate, retDate: effSelection.date }
    }
    if (returnResult && selectedReturnDate && selectedReturnDate > effSelection.date) {
      return { outDate: effSelection.date, retDate: selectedReturnDate }
    }
    return null
  }, [effSelection, isReturnLegPanel, pairedOutboundDate, returnResult, selectedReturnDate])

  const selectedPairMeta = useMemo(() => {
    if (!roundTripPairMeta || !deepenDatePair) return null
    return roundTripPairMeta.get(roundTripPairCellKey(deepenDatePair.outDate, deepenDatePair.retDate)) ?? null
  }, [roundTripPairMeta, deepenDatePair])

  const combosForSelectedDatePair = useMemo(() => {
    if (!effSelection || !deepenDatePair || !roundTripCombos?.length) return []
    return roundTripCombos.filter(
      (c) =>
        c.routeKey === effSelection.routeKey &&
        c.outDate === deepenDatePair.outDate &&
        c.retDate === deepenDatePair.retDate,
    )
  }, [effSelection, deepenDatePair, roundTripCombos])

  const filteredReturnOptionsForSelectedPair = useMemo(() => {
    if (!combosForSelectedDatePair.length) return []
    const raw = combosForSelectedDatePair.map((c) => ({ ...c.retIt, price: c.roundTripPrice }))
    const filtered = returnLegFilter ? raw.filter(returnLegFilter) : raw
    return dedupeByScheduleKey(filtered)
  }, [combosForSelectedDatePair, returnLegFilter])


  // ─── Helpers used in both summary and detail panel ────────────────────────
  function buildDetailContext(outIt: NormalizedItinerary, outDate: string) {
    const routeKey = effSelection?.routeKey ?? ''
    const airports = routeKey.split('|')[0].split('-')

    let bestRetDate = selectedReturnDate ?? ''
    let bestRetIt: NormalizedItinerary | null = selectedReturnIt ?? null
    let totalPrice: number | null = null
    let rtBundled = false

    if (returnResult && effSelection) {
      const resolved = resolveRoundTripSelection({
        routeKey,
        outDate,
        outIt,
        outResult: result,
        retResult: returnResult,
        verifications: overrideMap,
        roundTripCombos,
        roundTripPairMeta,
        roundTripDeepenStates,
        selectedReturnDate: selectedReturnDate ?? null,
        selectedReturnIt: selectedReturnIt ?? null,
      })
      bestRetDate = resolved.bestRetDate
      bestRetIt = resolved.bestRetIt
      rtBundled = true
      if (selectedReturnDate && selectedReturnDate > outDate) {
        totalPrice = minCombinedForDatePair(
          routeKey,
          outDate,
          selectedReturnDate,
          result,
          returnResult,
          overrideMap,
          roundTripCombos,
          roundTripPairMeta,
          dateBounds,
          roundTripDeepenStates,
          outboundLegFilter ?? undefined,
          returnLegFilter ?? undefined,
        )
      } else {
        totalPrice = resolved.bundledPrice
      }
      if (bestRetIt) {
        const verified = lookupVerificationRow(overrideMap, routeKey, outIt, bestRetIt)
        if (verified?.verifiedPrice != null && verified.verifiedPrice > 0) {
          totalPrice = verified.verifiedPrice
        }
      }
    } else if (pairedOutboundResult && pairedOutboundSelection && effSelection && isReturnLegPanel) {
      const outOpts = outboundItinerariesForCell(
        pairedOutboundSelection.routeKey,
        pairedOutboundSelection.date,
        pairedOutboundResult.perRouteByDate.get(pairedOutboundSelection.routeKey)?.get(pairedOutboundSelection.date),
        roundTripCombos,
        roundTripDeepenStates,
        null,
        deepenByOutDate,
      )
      const outLeg = pairedOutboundSelection.selectedItinerary
        ?? outOpts[pairedOutboundSelection.pickedIdx ?? 0]
        ?? outOpts[0]
      if (outLeg) {
        const resolved = resolveRoundTripSelection({
          routeKey: pairedOutboundSelection.routeKey,
          outDate: pairedOutboundSelection.date,
          outIt: outLeg,
          outResult: pairedOutboundResult,
          retResult: result,
          verifications: overrideMap,
          roundTripCombos,
          roundTripPairMeta,
          roundTripDeepenStates,
          selectedReturnDate: effSelection.date,
          selectedReturnIt: outIt,
        })
        bestRetDate = resolved.bestRetDate
        bestRetIt = resolved.bestRetIt
        totalPrice = resolved.bundledPrice
        rtBundled = true
      }
    }

    const deepUrl = buildGoogleFlightsDeepLink(outIt, outDate, bestRetIt, bestRetIt ? bestRetDate : null, adults, children, bestRetIt != null, cabinClass)
    const { url: searchUrl, reliable } = buildGoogleFlightsSearchUrl(
      [airports[0]],
      [airports[airports.length - 1]],
      outDate,
      bestRetIt ? bestRetDate : null,
    )

    const copyDetails = async () => {
      const lines = [itineraryDetailsText(outIt, 'Outbound', outDate)]
      if (bestRetIt) lines.push('', itineraryDetailsText(bestRetIt, 'Return', bestRetDate))
      if (rtBundled && totalPrice != null) {
        lines.push('', `Round-trip fare (bundled): ${formatPriceAmount(totalPrice, currency)}`)
      }
      await navigator.clipboard.writeText(lines.join('\n'))
    }

    return {
      bestRetIt,
      bestRetDate,
      deepUrl,
      url: deepUrl ?? searchUrl,
      reliable,
      totalPrice,
      rtBundled,
      copyDetails,
    }
  }

  const routeSuffix = (rk: string) => rk.split('|')[0].replace(/-/g, ' › ')
  const displayTitle = selectionOnly
    ? summaryTitle
    : pairedOutboundRouteKey
      ? `${title} · ${routeSuffix(pairedOutboundRouteKey)}`
      : filterToRouteKey
        ? `${title} · ${routeSuffix(filterToRouteKey)}`
        : title
  const displayGridTitle = gridTitle ?? title
  const panelBodyOpen = !collapsible || isOpen

  const selectedItinerarySummary = selectionOnly ? (
    <div className="pw-sel-summary">
            {effSelection && pickedOutboundIt ? (() => {
              const { bestRetIt, bestRetDate, url, deepUrl, reliable, totalPrice, rtBundled, copyDetails } =
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
                hideFare: rtBundled,
              } : null

              return (
                <>
                  {totalPrice != null && rtBundled && (
                    <div className="pw-sel-rt-hero" data-testid="pw-round-trip-fare" data-pw-price={totalPrice}>
                      <div className="pw-sel-rt-hero-label">Round-trip fare</div>
                      <div className="pw-sel-rt-hero-price">{formatPriceAmount(totalPrice, currency)}</div>
                      {bestRetIt && bestRetDate ? (
                        <div className="pw-sel-rt-hero-dates muted small">
                          Outbound {shortDateWithDay(effSelection.date)} · Return {shortDateWithDay(bestRetDate)}
                        </div>
                      ) : (
                        <div className="pw-sel-rt-hero-dates muted small">
                          Outbound {shortDateWithDay(effSelection.date)}
                          {bestRetDate ? ` · best return ${shortDateWithDay(bestRetDate)}` : ''}
                          {' '}· SerpApi bundled price (not outbound + return)
                        </div>
                      )}
                    </div>
                  )}
                  {canShowRichCard && sharedCardProps ? (
                    <div className="srt-legs">
                      <div className="srt-leg">
                        <div className="srt-leg-header">
                          <span className="srt-leg-label">
                            {hideReturn ? shortDateWithDay(effSelection.date) : `Outbound · ${shortDateWithDay(effSelection.date)}`}
                          </span>
                          {deepUrl && (
                            <a href={deepUrl} target="_blank" rel="noopener noreferrer" className="srt-leg-gf-icon" title="Open in Google Flights">↗</a>
                          )}
                        </div>
                        <ItineraryCard
                          {...sharedCardProps}
                          it={pickedOutboundIt}
                          gfOrigins={outOrigins}
                          gfDestinations={outDests}
                          linkDate={effSelection.date}
                          returnDate={bestRetIt ? bestRetDate : null}
                          travelClass={cabinClass}
                        />
                      </div>
                      {!hideReturn && (
                        <div className="srt-leg srt-leg--return">
                          <div className="srt-leg-header">
                            <span className="srt-leg-label">
                              Return{bestRetDate ? ` · ${shortDateWithDay(bestRetDate)}` : ''}
                            </span>
                            {deepUrl && (
                              <a href={deepUrl} target="_blank" rel="noopener noreferrer" className="srt-leg-gf-icon" title="Open round-trip in Google Flights">↗</a>
                            )}
                          </div>
                          {bestRetIt ? (
                            <ItineraryCard
                              {...sharedCardProps}
                              it={bestRetIt}
                              gfOrigins={outDests}
                              gfDestinations={outOrigins}
                              linkDate={bestRetDate}
                              returnDate={null}
                              travelClass={cabinClass}
                            />
                          ) : (
                            <p className="muted small" style={{ margin: 0 }}>
                              {bestRetDate
                                ? 'Price is known for this date pair, but return itineraries are not loaded yet. Deepen this date pair to fetch them.'
                                : 'Pick a return date to see the return itinerary here.'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="pw-sel-row">
                        <span className="pw-sel-label">Outbound · {shortDateWithDay(effSelection.date)}</span>
                        <ItineraryCompact it={pickedOutboundIt} currency={currency} hidePrice={rtBundled} />
                      </div>
                      {!hideReturn && (bestRetIt || bestRetDate) ? (
                        <div className="pw-sel-row">
                          <span className="pw-sel-label">Return · {bestRetDate ? shortDateWithDay(bestRetDate) : '—'}</span>
                          {bestRetIt ? (
                            <ItineraryCompact it={bestRetIt} currency={currency} hidePrice={rtBundled} />
                          ) : (
                            <span className="muted small">Deepen to load itineraries</span>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                  {totalPrice != null && !rtBundled && (
                    <div className="pw-sel-total">
                      Total:{' '}
                      <strong className="pw-sel-total-value">{formatPriceAmount(totalPrice, currency)}</strong>
                    </div>
                  )}

                  {/* ── Verified price section ── */}
                  {onUpsertVerification && (() => {
                    const outLegKey = legVerificationKey(pickedOutboundIt)
                    const retLegKey = bestRetIt ? legVerificationKey(bestRetIt) : ''
                    const existing = bestRetIt
                      ? lookupVerificationRow(
                          verifications ?? new Map(),
                          effSelection.routeKey,
                          pickedOutboundIt,
                          bestRetIt,
                        )
                      : undefined
                    return (
                      <div className="pw-sel-verify" onClick={e => e.stopPropagation()}>
                        {existing && (
                          <div className="pw-sel-verify-existing">
                            <span className="pw-sel-verify-badge">✓ Verified</span>
                            <strong className="pw-sel-verify-price">{verificationPriceLabel(existing, formatPriceAmount)}</strong>
                            {existing.paxDesc && <span className="muted small">{existing.paxDesc}</span>}
                            {existing.note && <span className="muted small">· {existing.note}</span>}
                          </div>
                        )}
                        <div className="pw-sel-verify-label muted small">
                          {outLegKey ? `Out: ${legKeyDepTime(outLegKey).slice(11)}` : 'Out: unknown'}
                          {outLegKey.includes('::') ? ` ${outLegKey.split('::')[1]}` : ''}
                          {retLegKey ? ` · Ret: ${legKeyDepTime(retLegKey).slice(11)}` : ''}
                          {retLegKey.includes('::') ? ` ${retLegKey.split('::')[1]}` : ''}
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
                                  outDepTime: outLegKey,
                                  retDepTime: retLegKey,
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
                                onClick={() => void onRemoveVerification(effSelection.routeKey, outLegKey, retLegKey)}
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
            })() : effSelection && deepenDatePair ? (
              <>
                {filteredReturnOptionsForSelectedPair.length > 0 && (
                  <div className="pw-detail-panel">
                    <div className="pw-detail-heading">Return options fetched</div>
                    <p className="muted small" style={{ marginTop: 0 }}>
                      These are the return flights found for this date pair (bundled round-trip price is shown on the right).
                      Select a return date/cell in the Return panel to use one of these in the round-trip summary.
                    </p>
                    <div className="pw-itin-list">
                      {filteredReturnOptionsForSelectedPair.map((it, i) => (
                        <div key={i} className="pw-itin-option-wrap">
                          <div className="pw-itin-option-body" style={{ cursor: 'default' }}>
                            <ItineraryCompact it={it} currency={currency} hidePrice={false} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {combosForSelectedDatePair.length > 0 && filteredReturnOptionsForSelectedPair.length === 0 && (
                  <div className="pw-detail-panel">
                    <div className="pw-detail-heading">Return options fetched</div>
                    <p className="muted small" style={{ marginTop: 0 }}>
                      Return itineraries were fetched for this date pair, but **none match your current filters** (including layover bounds).
                      Try relaxing filters or keep fetching more routes.
                    </p>
                  </div>
                )}
              </>
            ) : effSelection ? (
              <p className="pw-sel-hint muted small">
                Select a return date in the Return panel to fetch options for this outbound date.
              </p>
            ) : (
              <p className="pw-sel-hint muted small">
                Click a cell in the Total round-trip by date grid below to select an outbound date and route
              </p>
            )}
    </div>
  ) : null

  const priceGridSection = (
    <>
        {displayGlobalMinByDate.size === 0 && routeKeyOrder.length === 0 && (
          <div className="pw-no-results">
            No priced results found.
            <span className="pw-no-results-hint">
              {' '}Check that the search ran successfully, your API quota has not been exhausted, and that active filters aren't hiding all results.
            </span>
          </div>
        )}

        {(displayGlobalMinByDate.size > 0 || routeKeyOrder.length > 0) && (
        <div className="pw-grid-wrap">
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
                        data-testid="pw-price-cell"
                        data-pw-panel={panelTestId ?? title}
                        data-pw-route="__global__"
                        data-pw-date={d}
                        data-pw-price={p}
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
              const { min: routeMin, med: routeMed } = routeStatsMap.get(routeKey) ?? { min: null, med: null }

              return (
                <div key={routeKey} className="pw-grid-row pw-grid-route-row">
                  <div className="pw-label-col pw-label-sticky pw-label-route">
                    <RouteLabelCell
                      routeKey={routeKey}
                      namesByIata={namesByIata}
                      airlinesMeta={airlinesMeta}
                      airlineDirectory={airlineDirectory}
                    />
                  </div>
                  <div
                    className={`pw-stat-col pw-stat-col--min pw-stat-sticky${routeMin != null ? ' pw-stat-heat' : ''}`}
                    style={routeMin != null ? { '--pw-heat-bg': heatColor(routeMin, minP, maxP) } as React.CSSProperties : undefined}
                  >
                    {routeMin != null ? formatPriceAmount(routeMin, currency) : '—'}
                  </div>
                  <div
                    className={`pw-stat-col pw-stat-col--med pw-stat-sticky${routeMed != null ? ' pw-stat-heat' : ''}`}
                    style={routeMed != null ? { '--pw-heat-bg': heatColor(routeMed, minP, maxP) } as React.CSSProperties : undefined}
                  >
                    {routeMed != null ? formatPriceAmount(routeMed, currency) : '—'}
                  </div>
                  {dates.map((d) => {
                    const isActive =
                      effSelection?.routeKey === routeKey && effSelection?.date === d

                    const combined = cellPrices.get(`${routeKey}\u001e${d}`) ?? null
                    const cellQ = routeDateQuality(routeKey, d)
                    if (combined == null) {
                      return (
                        <div
                          key={d}
                          className={[
                            'pw-date-col',
                            'pw-empty-cell',
                            heatmapQualityCellClass('empty', qualityFilter),
                          ].filter(Boolean).join(' ')}
                        >
                          <HeatmapQualityBadge quality="empty" />
                          <span>—</span>
                        </div>
                      )
                    }

                    // Tooltip: price only (full return breakdown is expensive — computed on demand elsewhere)
                    const tooltipText = `${shortDateWithDay(d)}: ${formatPriceAmount(combined, currency)}`

                    const hasVerification = verifiedCellSet.has(`${routeKey}|${d}`)
                    const qualityTitle = HEATMAP_QUALITY_DEFS[cellQ].title
                    return (
                      <button
                        key={d}
                        type="button"
                        className={[
                          'pw-date-col',
                          'pw-price-cell',
                          isActive ? 'pw-cell-active' : '',
                          heatmapQualityCellClass(cellQ, qualityFilter),
                        ].filter(Boolean).join(' ')}
                        style={{ background: heatColor(combined, minP, maxP) }}
                        onClick={() => toggleRoute(routeKey, d)}
                        title={[tooltipText, qualityTitle].join('\n')}
                        data-testid="pw-price-cell"
                        data-pw-panel={panelTestId ?? title}
                        data-pw-route={routeKey}
                        data-pw-date={d}
                        data-pw-price={combined}
                      >
                        <HeatmapQualityBadge quality={cellQ} className="pw-hq-badge--cell" />
                        {hasVerification && <span className="pw-cell-verified-badge">✓</span>}
                        {formatPriceAmount(combined, currency)}
                      </button>
                    )
                  })}
                </div>
              )
            })}

          </div>
        </div>
        )}
    </>
  )

  const panelTitlebar = (titleText: string) => (
    <div className="pw-panel-titlebar">
      <h3 className="pw-panel-title">{titleText}</h3>
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
  )

  if (selectionOnly) {
    return (
      <div className="pw-panel-duo">
        <div
          className="pw-panel pw-panel--selected-itinerary"
          data-testid={panelTestId ? `${panelTestId}-itinerary` : undefined}
        >
          {panelTitlebar(summaryTitle)}
          {panelBodyOpen && selectedItinerarySummary}
        </div>
        <div className="pw-panel pw-panel--date-grid" data-testid={panelTestId}>
          {panelTitlebar(displayGridTitle)}
          {panelBodyOpen && priceGridSection}
        </div>
      </div>
    )
  }

  return (
    <div className="pw-panel" data-testid={panelTestId}>
      {panelTitlebar(displayTitle)}
      {panelBodyOpen && <>
        {priceGridSection}

        {/* ── Drilldown / detail panel (shown when NOT in selectionOnly mode) ── */}
          {selection?.kind === 'global' && selectedGlobalRoutes != null && selectedGlobalRoutes.length > 0 && (
            <div className="pw-detail-panel">
              <div className="pw-detail-heading">
                Top routes · {shortDateWithDay(selection.date)}
              </div>
              <GlobalDrilldown routes={selectedGlobalRoutes} currency={currency} />
            </div>
          )}

          {effSelection && pickedOutboundIt && (() => {
            const outIt = pickedOutboundIt
            const outDate = effSelection.date
            const allOut = cellOutboundOptionsList
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
                  {isReturnLegPanel ? 'Return options' : 'Options'} · {shortDateWithDay(outDate)}
                  {allOut.length > 1 && <span className="pw-detail-count"> ({allOut.length})</span>}
                </div>
                <div className="pw-itin-list">
                  {allOut.map((it, i) => {
                    const optDeepUrl = buildGoogleFlightsDeepLink(it, outDate, bestRetIt, bestRetIt ? bestRetDate : null, adults, children, bestRetIt != null, cabinClass)
                    const { url: optSearchUrl } = buildGoogleFlightsSearchUrl(
                      [routeAirports[0]],
                      [routeAirports[routeAirports.length - 1]],
                      outDate,
                      bestRetIt ? bestRetDate : null,
                    )
                    const optGfUrl = optDeepUrl ?? optSearchUrl
                    const departureToken = outboundTokenByScheduleKey.get(itineraryScheduleKey(it))
                    return (
                      <div key={i} className={`pw-itin-option-wrap${i === pickedIdx ? ' pw-itin-option--active' : ''}`}>
                        <button
                          type="button"
                          className="pw-itin-option-body"
                          onClick={() => pickItinerary(effSelection.routeKey, effSelection.date, i)}
                          title="Select this itinerary"
                        >
                          <ItineraryCompact
                            it={it}
                            currency={currency}
                            hidePrice={isReturnLegPanel && !!roundTripCombos?.length}
                            displayPrice={
                              isReturnLegPanel
                                ? undefined
                                : bundledPriceForOutboundOption(it, effSelection.routeKey, effSelection.date)
                            }
                          />
                          {departureToken && (
                            <span
                              className="pw-departure-token"
                              title={`departure_token — click to copy:\n${departureToken}`}
                              onClick={async (e) => {
                                e.stopPropagation()
                                await navigator.clipboard.writeText(departureToken)
                              }}
                            >
                              {departureToken.slice(0, 28)}…
                            </span>
                          )}
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

          {effSelection && !pickedOutboundIt && deepenDatePair && (
            <>
              {filteredReturnOptionsForSelectedPair.length > 0 && (
                <div className="pw-detail-panel">
                  <div className="pw-detail-heading">Return options fetched</div>
                  <p className="muted small" style={{ marginTop: 0 }}>
                    These return flights are now available for this date pair. Use the Return panel to pick one (or keep deepening to fetch more routes).
                  </p>
                  <div className="pw-itin-list">
                    {filteredReturnOptionsForSelectedPair.map((it, i) => (
                      <div key={i} className="pw-itin-option-wrap">
                        <div className="pw-itin-option-body" style={{ cursor: 'default' }}>
                          <ItineraryCompact it={it} currency={currency} hidePrice={false} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {combosForSelectedDatePair.length > 0 && filteredReturnOptionsForSelectedPair.length === 0 && (
                <div className="pw-detail-panel">
                  <div className="pw-detail-heading">Return options fetched</div>
                  <p className="muted small" style={{ marginTop: 0 }}>
                    Return itineraries were fetched for this date pair, but **none match your current filters**.
                  </p>
                </div>
              )}
            </>
          )}
          {effSelection && !pickedOutboundIt && !deepenDatePair && (
            <p className="pw-sel-hint muted small pw-detail-panel">
              Pick an outbound in Total or Outbound above before fetching return options here.
            </p>
          )}
      </>}
    </div>
  )
}
