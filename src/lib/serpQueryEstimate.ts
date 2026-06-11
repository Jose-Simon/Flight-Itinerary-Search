import {
  buildFilteredRoundTripDatePairs,
  formatPairFilterStatsLine,
  type PriceWindowPairFilters,
} from './priceWindowPairFilters'
import type { PriceWindowSearchMode } from './priceWindowSearchMode'
import {
  PW_BALANCED_AUTO_DEEPEN_MAX,
  PW_BALANCED_CLICK_RESERVE,
} from './priceWindowSearchMode'
import type { RoundTripSortMode } from './roundTripSortMode'
import {
  PW_HOURLY_SERP_CALLS_DEFAULT,
  resolvePwSearchTranche,
  returnBudgetAfterInitialScan,
  returnBudgetForContinue,
} from './pwSearchTranche'

function dateRangeCount(start: string, end: string): number {
  let n = 0
  let cur = start
  while (cur <= end) {
    n++
    cur = addDays(cur, 1)
  }
  return Math.max(1, n)
}

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export type SerpQueryEstimate = {
  min: number
  max: number
  datePairs: number
  outboundDays: number
  returnDays: number
  summary: string
}

/** Rough SerpApi call count before a price-window search (API mode). */
export function estimatePriceWindowSerpQueries(opts: {
  tripType: 'oneway' | 'round'
  outboundDate: string
  outboundEnd: string
  returnDate: string
  returnEnd: string
  alsoSearchOneWay: boolean
  /** Round-trip initial queries per date pair (1 for price/duration, 2 for both). */
  roundTripSortMode?: RoundTripSortMode
  /** @deprecated use roundTripSortMode */
  roundTripPriceSortOnly?: boolean
  /** @deprecated use searchMode */
  adaptiveDeepen?: boolean
  searchMode?: PriceWindowSearchMode
  maxOutboundFollow?: number
  pairFilters?: PriceWindowPairFilters | null
}): SerpQueryEstimate {
  const outDays = dateRangeCount(opts.outboundDate, opts.outboundEnd)
  const retDays =
    opts.tripType === 'round' ? dateRangeCount(opts.returnDate, opts.returnEnd) : 0
  let pairs = 0
  let pairFilterNote: string | null = null
  if (opts.tripType === 'round') {
    const built = buildFilteredRoundTripDatePairs(
      opts.outboundDate,
      opts.outboundEnd,
      opts.returnDate,
      opts.returnEnd,
      opts.pairFilters,
    )
    pairs = built.pairs.length
    pairFilterNote = formatPairFilterStatsLine(built.stats, opts.pairFilters)
  }
  const sortMode =
    opts.roundTripSortMode ??
    (opts.roundTripPriceSortOnly === false ? 'both' : 'price')
  const initialPerPair = sortMode === 'both' ? 2 : 1
  const mode: PriceWindowSearchMode =
    opts.searchMode ?? (opts.adaptiveDeepen === true ? 'exhaustive' : 'balanced')
  let min = 0
  let max = 0

  if (opts.tripType === 'round') {
    const initial = pairs * initialPerPair
    min += initial
    if (mode === 'fast') {
      max += initial
    } else if (mode === 'balanced') {
      max += initial + Math.min(PW_BALANCED_AUTO_DEEPEN_MAX, pairs * 2)
    } else {
      max += initial + 200
    }
  } else {
    min += outDays * 2
    max += outDays * 2
  }

  if (opts.alsoSearchOneWay && opts.tripType === 'round') {
    const oneWay = (outDays + retDays) * 2
    min += oneWay
    max += oneWay
  }

  const summary =
    opts.tripType === 'round'
      ? `~${min}–${max} SerpApi calls (${pairs} date pair${pairs === 1 ? '' : 's'}`
          + (sortMode !== 'both' ? `, ${sortMode} sort` : '')
          + (mode === 'fast'
            ? ', initial scan only (deepen on cell click)'
            : mode === 'balanced'
              ? `, then top-priority auto-deepen (~${PW_BALANCED_AUTO_DEEPEN_MAX} calls, ${PW_BALANCED_CLICK_RESERVE} reserved for clicks)`
              : ', return fetches while budget allows')
          + `${opts.alsoSearchOneWay ? ', + one-way compare' : ''}`
          + `${pairFilterNote ? `, ${pairFilterNote}` : ''})`
      : `~${min} SerpApi calls (${outDays} outbound day${outDays === 1 ? '' : 's'})`

  return {
    min,
    max,
    datePairs: pairs,
    outboundDays: outDays,
    returnDays: retDays,
    summary,
  }
}

/** Scheduled tranche: 130+50 initial or 180 continue (replace outbound → initial). */
export function estimatePwTrancheSerpQueries(opts: {
  outboundDate: string
  outboundEnd: string
  returnDate: string
  returnEnd: string
  roundTripSortMode?: RoundTripSortMode
  pairFilters?: PriceWindowPairFilters | null
  replaceOutbound: boolean
  hasExistingGrid: boolean
  alsoSearchOneWay?: boolean
  plannedHourlySerpCalls?: number
  hourUsedBeforeSearch?: number
}): SerpQueryEstimate {
  const built = buildFilteredRoundTripDatePairs(
    opts.outboundDate,
    opts.outboundEnd,
    opts.returnDate,
    opts.returnEnd,
    opts.pairFilters,
  )
  const pairs = built.pairs.length
  const sortMode = opts.roundTripSortMode ?? 'price'
  const initialPerPair = sortMode === 'both' ? 2 : 1
  const planned =
    opts.plannedHourlySerpCalls != null && opts.plannedHourlySerpCalls > 0
      ? opts.plannedHourlySerpCalls
      : PW_HOURLY_SERP_CALLS_DEFAULT
  const tranche = resolvePwSearchTranche(opts.replaceOutbound, opts.hasExistingGrid)
  const scanCalls = tranche === 'initial' ? pairs * initialPerPair : 0
  const hourBefore = opts.hourUsedBeforeSearch ?? 0
  const returnBudget =
    tranche === 'initial'
      ? returnBudgetAfterInitialScan(planned, hourBefore + scanCalls)
      : returnBudgetForContinue(planned)
  const total = scanCalls + returnBudget
  const pairFilterNote = formatPairFilterStatsLine(built.stats, opts.pairFilters)
  let oneWay = 0
  if (opts.alsoSearchOneWay) {
    const outDays = dateRangeCount(opts.outboundDate, opts.outboundEnd)
    const retDays = dateRangeCount(opts.returnDate, opts.returnEnd)
    oneWay = (outDays + retDays) * 2
  }
  const summary =
    tranche === 'initial'
      ? `~${total + oneWay} SerpApi calls (${pairs} date pair${pairs === 1 ? '' : 's'} × ${initialPerPair} scan + ~${returnBudget} return fetches from ${planned}/hr budget, 50-25-25)${opts.alsoSearchOneWay ? ', + one-way compare' : ''}${pairFilterNote ? `, ${pairFilterNote}` : ''})`
      : `~${total + oneWay} SerpApi calls (~${returnBudget} return fetches from ${planned}/hr, 50-25-25)${opts.alsoSearchOneWay ? ', + one-way compare' : ''}${pairFilterNote ? `, ${pairFilterNote}` : ''})`
  return {
    min: total + oneWay,
    max: total + oneWay,
    datePairs: pairs,
    outboundDays: dateRangeCount(opts.outboundDate, opts.outboundEnd),
    returnDays: dateRangeCount(opts.returnDate, opts.returnEnd),
    summary,
  }
}

/** Rough SerpApi calls for return deepen (filtered cells, batched per route). */
export function estimateReturnDeepenQueries(opts: {
  eligiblePairs: number
  pendingRoutes: number
}): SerpQueryEstimate {
  const pairs = Math.max(0, opts.eligiblePairs)
  const routes = Math.max(0, opts.pendingRoutes)
  const min = pairs > 0 ? Math.min(pairs, routes) : 0
  const max = routes
  const summary =
    pairs === 0
      ? 'No filtered cells need return fetches'
      : `~${min}–${max} SerpApi calls (${pairs} date pair${pairs === 1 ? '' : 's'}, ${routes} outbound route${routes === 1 ? '' : 's'} pending)`
  return {
    min,
    max,
    datePairs: pairs,
    outboundDays: 0,
    returnDays: 0,
    summary,
  }
}

export function isSerpThrottleMessage(msg: string): boolean {
  return /throttl|exceeding.*searches per hour|rate.?limit|too many requests/i.test(msg)
}

/** Max days per outbound/return window when using price + duration (≈10×10×2 = 200 calls). */
export const MAX_PW_DAYS_BOTH_SORT_MODES = 10
/** Max days per window with price sort only (≈14×14 = 196 calls). */
export const MAX_PW_DAYS_PRICE_SORT_ONLY = 14

/** Block oversized round-trip date grids before search (SerpApi ~200/hour). */
export function validatePriceWindowDateGrid(opts: {
  tripType: 'oneway' | 'round'
  outboundDays: number
  returnDays: number
  roundTripSortMode?: RoundTripSortMode
  /** @deprecated use roundTripSortMode */
  roundTripPriceSortOnly?: boolean
  outboundDate?: string
  outboundEnd?: string
  returnDate?: string
  returnEnd?: string
  pairFilters?: PriceWindowPairFilters | null
}): string | null {
  if (opts.tripType !== 'round') return null

  const sortMode =
    opts.roundTripSortMode ??
    (opts.roundTripPriceSortOnly === false ? 'both' : 'price')
  const singleSort = sortMode === 'price' || sortMode === 'duration'
  const maxDays = singleSort ? MAX_PW_DAYS_PRICE_SORT_ONLY : MAX_PW_DAYS_BOTH_SORT_MODES
  const gridMax = maxDays * maxDays
  const modeHint = singleSort
    ? `${sortMode} sort only (up to ${MAX_PW_DAYS_PRICE_SORT_ONLY}×${MAX_PW_DAYS_PRICE_SORT_ONLY} ≈ ${gridMax} date-pair calls)`
    : `price + duration (up to ${MAX_PW_DAYS_BOTH_SORT_MODES}×${MAX_PW_DAYS_BOTH_SORT_MODES}×2 ≈ ${gridMax * 2} calls)`

  if (opts.outboundDays > maxDays || opts.returnDays > maxDays) {
    const fix =
      sortMode === 'both'
        ? ` Choose Price or Duration only for up to ${MAX_PW_DAYS_PRICE_SORT_ONLY}×${MAX_PW_DAYS_PRICE_SORT_ONLY} days.`
        : ''
    return (
      `Round-trip price window is too large for SerpApi’s ~200 searches/hour. With ${modeHint}, keep each date window to ${maxDays} days. You have ${opts.outboundDays} outbound × ${opts.returnDays} return days.${fix}`
    )
  }

  if (
    opts.outboundDate &&
    opts.outboundEnd &&
    opts.returnDate &&
    opts.returnEnd
  ) {
    const { stats } = buildFilteredRoundTripDatePairs(
      opts.outboundDate,
      opts.outboundEnd,
      opts.returnDate,
      opts.returnEnd,
      opts.pairFilters,
    )
    if (stats.finalPairs === 0) {
      return 'No date pairs match your filters. Widen trip length, increase sparse stride, or raise the pair cap.'
    }
  }

  return null
}

export function formatSerpThrottleHelp(baseMessage: string): string {
  if (!isSerpThrottleMessage(baseMessage)) return baseMessage
  return [
    baseMessage,
    '',
    'SerpApi allows about 200 searches per hour on many plans. This app can use many calls per search (round-trip date pairs × return-flight lookups).',
    '• Narrow outbound/return date windows',
    '• Turn off “Also search one-way legs”',
    '• Choose Price or Duration only (not both) to halve round-trip calls',
    '• Use date pair filters (trip length, sparse grid, cap) before searching',
    '• After one API run, switch Source to Database to reuse cache',
    '• Wait for the hourly counter to reset (see SerpApi chip in header)',
  ].join('\n')
}
