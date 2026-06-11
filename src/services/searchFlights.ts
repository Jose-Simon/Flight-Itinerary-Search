import type { SerpGoogleFlightsResponse } from '../lib/serpapiTypes'
import {
  assertIncludeAirlinesParam,
  buildSerpDepartureTokenParams,
  buildSerpFlightParams,
  buildSerpRoundTripParams,
  sanitizeIncludeAirlinesIata,
  type SerpSearchParams,
} from '../lib/serpParams'
import { makeRouteGroupKey } from '../lib/routeGrouping'
import { buildInitialMinByRoute, pairMetaFromInternal, type RoundTripPairDeepenState, type RoundTripPairMeta } from '../lib/roundTripPairMeta'
import type { RoundTripCombo } from '../lib/roundTripTypes'
import type { RoundTripSortMode } from '../lib/roundTripSortMode'
import type { SearchProgressState } from '../lib/searchProgress'
import { scheduleSerpApiCall } from '../lib/serpApiQueue'
import {
  getActiveSerpHourBudget,
  isSerpSearchPausedError,
  isSerpSearchStopRequested,
  type SerpBudgetCallKind,
  throwSerpResponseError,
} from '../lib/serpHourBudget'
import type { PriceWindowSearchMode } from '../lib/priceWindowSearchMode'
import {
  PW_BALANCED_TOKENS_PER_CELL,
  PW_BALANCED_TOP_CELLS,
} from '../lib/priceWindowSearchMode'
import { sortPairMetaByPriority } from '../lib/roundTripPriorityQueue'
import { formatSerpThrottleHelp, isSerpThrottleMessage } from '../lib/serpQueryEstimate'
import { mergePerDateUnique, processSerpResponse } from '../lib/pipeline'
import type { NormalizedItinerary } from '../lib/types'
import { dedupeByScheduleKey, itineraryScheduleKey, sortItineraries, type SortMode } from '../lib/filters'
import { collectAllSerpOptions } from '../lib/normalizeFlight'
import type { SerpSearchDebugBundle, SerpSearchDebugQuery } from '../lib/serpDebugExport'
import sampleOutbound from '../mocks/sampleSearch.json'
import sampleReturn from '../mocks/sampleReturn.json'

export type { SerpSearchDebugBundle, SerpSearchDebugQuery } from '../lib/serpDebugExport'

const USER_STOP_REASON = 'Stopped by user — partial results shown.'

function pauseIfUserStopRequested(): { paused: true; pauseReason: string } | null {
  return isSerpSearchStopRequested() ? { paused: true, pauseReason: USER_STOP_REASON } : null
}

/** Pass `Infinity` to merge every distinct itinerary from each date’s response (no per-day cap). */
export type SearchFlightInput = {
  origins: string[]
  destinations: string[]
  /** YYYY-MM-DD center */
  centerDate: string
  flexDays: number
  maxSegments: number
  perDateLimit: number
  mockMode: boolean
  apiKey: string
  maxTotalHours: number | null
  showHidden: boolean
  deepSearch: boolean
  gl: string
  hl: string
  currency: string
  adults: number
  children: number
  /** Cabin class: 1=Economy (default), 2=Premium Economy, 3=Business, 4=First */
  cabinClass?: number
}

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export function dateWindow(center: string, flex: number): string[] {
  const dates: string[] = []
  for (let d = -flex; d <= flex; d++) dates.push(addDays(center, d))
  return dates
}

/** Parallel one-way date fetches per chunk (discovery / optional one-way compare). */
const FETCH_CHUNK_SIZE = 3
/** Round-trip date pairs: 1 at a time to avoid bursting past hourly limits. */
const RT_PAIR_CHUNK_SIZE = 1
const TOKEN_FETCH_CHUNK_SIZE = 2
import { ROUND_TRIP_DEEPEN_BATCH, ROUND_TRIP_INITIAL_OUTBOUND_FOLLOW, ROUND_TRIP_RANK_STORE_MAX } from '../lib/roundTripSearchLimits'
import { buildReturnFetchJobs, type ReturnFetchJob } from '../lib/pwReturnAllocator'
import {
  passesRtOutboundLegFilter,
  passesRtReturnLegFilter,
  reorderDeepenStateForLegFilters,
  type RtLegFilterOpts,
} from '../lib/rtFilterPool'
import {
  PW_HOURLY_SERP_CALLS_DEFAULT,
  returnBudgetAfterInitialScan,
  returnBudgetForContinue,
  type PwSearchTranche,
} from '../lib/pwSearchTranche'

export type { RoundTripDatePair } from '../lib/priceWindowPairFilters'
export {
  roundTripDatePairs,
  buildFilteredRoundTripDatePairs,
  type PairFilterStats,
} from '../lib/priceWindowPairFilters'
import type { PairFilterStats, PriceWindowPairFilters } from '../lib/priceWindowPairFilters'
import { buildFilteredRoundTripDatePairs } from '../lib/priceWindowPairFilters'

export type PriceWindowRoundTripResult = {
  combos: RoundTripCombo[]
  /** Per date-pair scan metadata (initial prices + deepen progress). */
  pairMeta: RoundTripPairMeta[]
  /** Full state for click-to-deepen (includes ranked tokens). */
  pairDeepenStates: RoundTripPairDeepenState[]
  serpDebug: SerpSearchDebugBundle
  /** True when search stopped early due to hourly SerpApi limit. */
  pausedEarly?: boolean
  pauseReason?: string
  pairsCompleted?: number
  pairsTotal?: number
  /** Adaptive deepen rounds completed after the initial pass. */
  deepenRounds?: number
  /** Balanced-mode cells auto-deepened after priority queue. */
  autoDeepenedCells?: number
  /** Outbound options not yet fetched (sum across pairs). */
  routesRemaining?: number
  pairFilterStats?: PairFilterStats
}

/** Incremental RT snapshot while a price-window search is still running. */
export type PriceWindowRoundTripPartial = Pick<
  PriceWindowRoundTripResult,
  'combos' | 'pairMeta' | 'pairDeepenStates'
>

function emitRoundTripPartial(
  pairStates: PairSearchState[],
  onPartial?: (snap: PriceWindowRoundTripPartial) => void,
): void {
  if (!onPartial || pairStates.length === 0) return
  onPartial({
    pairMeta: pairStates.map((s) => pairMetaFromInternal(s)),
    pairDeepenStates: pairStates.map((s) => pairStateToDeepenState(s)),
    combos: dedupeRoundTripCombos(pairStates.flatMap((s) => s.combos)),
  })
}

/** SerpApi calls in parallel chunks; preserves date order for debug export. */
async function fetchGoogleFlightsByDates(
  dates: string[],
  dep: string,
  arr: string,
  input: SearchFlightInput,
  sort: SortMode,
  onChunk?: (completedDates: number, totalDates: number) => void,
  onQueryDone?: (query: SerpSearchDebugQuery) => void,
): Promise<SerpSearchDebugQuery[]> {
  const queries: SerpSearchDebugQuery[] = []
  for (let i = 0; i < dates.length; i += FETCH_CHUNK_SIZE) {
    const chunk = dates.slice(i, i + FETCH_CHUNK_SIZE)
    const part = await Promise.all(
      chunk.map(async (outboundDate) => {
        const requestParams = buildSerpFlightParams({
          departureId: dep,
          arrivalId: arr,
          outboundDate,
          maxSegments: input.maxSegments,
          maxTotalHours: input.maxTotalHours,
          showHidden: input.showHidden,
          deepSearch: input.deepSearch,
          gl: input.gl,
          hl: input.hl,
          currency: input.currency,
          sort,
          adults: input.adults,
          children: input.children,
          cabinClass: input.cabinClass,
        })
        const response = await fetchSerpGoogleFlights(input.apiKey, requestParams)
        const q: SerpSearchDebugQuery = { outboundDate, requestParams, response }
        onQueryDone?.(q)
        return q
      }),
    )
    queries.push(...part)
    onChunk?.(Math.min(i + FETCH_CHUNK_SIZE, dates.length), dates.length)
  }
  return queries
}

export async function fetchSerpGoogleFlights(
  apiKey: string,
  params: Record<string, string | number | boolean>,
  budgetKind: import('../lib/serpHourBudget').SerpBudgetCallKind = 'scan',
): Promise<SerpGoogleFlightsResponse> {
  return scheduleSerpApiCall(() => fetchSerpGoogleFlightsImmediate(apiKey, params, budgetKind))
}

async function fetchSerpGoogleFlightsImmediate(
  apiKey: string,
  params: Record<string, string | number | boolean>,
  budgetKind: import('../lib/serpHourBudget').SerpBudgetCallKind = 'scan',
): Promise<SerpGoogleFlightsResponse> {
  getActiveSerpHourBudget()?.assertCanCall(budgetKind)

  let r: Response
  try {
    r = await fetch('/api/google-flights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, params }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const looksNetwork =
      e instanceof TypeError ||
      (e instanceof Error && e.name === 'NetworkError') ||
      /network|failed to fetch/i.test(msg)
    if (looksNetwork) {
      throw new Error(
        'Could not reach the local API (/api/google-flights). In development run `npm run dev` so both Vite and the Express server (port 8787) are up. If you only run `vite`, or open the app without the proxy, Search will fail with a network error.',
      )
    }
    throw e
  }
  let body: unknown
  try {
    body = await r.json()
  } catch {
    throw new Error('Invalid response from server')
  }
  const obj = body as { error?: string }
  const resp = body as SerpGoogleFlightsResponse
  const errMsg = obj.error || resp.error
  getActiveSerpHourBudget()?.recordCall(budgetKind)
  if (!r.ok) {
    throwSerpResponseError(errMsg || `Request failed (${r.status})`, r.status)
  }
  if (errMsg && (resp.search_metadata?.status === 'Error' || isSerpThrottleMessage(errMsg))) {
    throwSerpResponseError(errMsg)
  }
  return resp
}

export type SearchDirectionMeta = {
  /** Sum of `best_flights.length + other_flights.length` across every date response (raw option cards). */
  serpOptionRows: number
  /** Rows after merging flex-window dates with per-day cap (schedule-level dedupe). */
  mergedItineraries: number
}

export type SearchDirectionResult = {
  itineraries: NormalizedItinerary[]
  /** Per-date breakdown — same underlying data as itineraries, keyed by date.
   *  Persist these with flexDays=0 so the Price Window DB-load can read them. */
  perDate: PriceWindowPerDateEntry[]
  meta: SearchDirectionMeta
  /** Full per-date SerpApi bodies. Present for API + mock runs (not when loading from SQLite only). */
  serpDebug: SerpSearchDebugBundle
}

export type PriceWindowSearchInput = {
  origins: string[]
  destinations: string[]
  startDate: string
  endDate: string
  maxSegments: number
  mockMode: boolean
  apiKey: string
  maxTotalHours: number | null
  showHidden: boolean
  deepSearch: boolean
  gl: string
  hl: string
  currency: string
  adults: number
  children: number
  /** Cabin class: 1=Economy (default), 2=Premium Economy, 3=Business, 4=First */
  cabinClass?: number
  /** Which SerpApi sort(s) to run per round-trip date pair. Default price. */
  roundTripSortMode?: RoundTripSortMode
  /** fast | balanced | exhaustive (legacy). Round-trip API search uses pwTranche instead. */
  searchMode?: PriceWindowSearchMode
  /** Scheduled price-window run: full grid + remaining hour, or N return calls only. */
  pwTranche?: PwSearchTranche
  /** Planned calls/hour from Settings (hour 2+ tranche size; caps hour-1 budget). */
  plannedHourlySerpCalls?: number
  existingPairDeepenStates?: RoundTripPairDeepenState[]
  rtLegFilterOpts?: RtLegFilterOpts
  /** @deprecated use searchMode exhaustive */
  adaptiveDeepen?: boolean
  /** @deprecated use adaptiveDeepen; when false, caps at initial follow count only */
  maxOutboundFollow?: number
  /** Pre-search date-pair filters (trip length, sparse grid, cap). */
  pairFilters?: PriceWindowPairFilters | null
  /** When enabled, retain any ranked outbound option priced within X% of the global initial min for the date pair. */
  expandWithinPctOfGlobalMin?: number | null
  /**
   * IATA airline codes for SerpApi `include_airlines` on every call in this run
   * (pair scan and departure_token return fetches). Used by targeted-airline scan.
   */
  includeAirlines?: string[]
}

export type PriceWindowPerDateEntry = {
  date: string
  itineraries: NormalizedItinerary[]
}

export type PriceWindowSearchResult = {
  perDate: PriceWindowPerDateEntry[]
  serpDebug: SerpSearchDebugBundle
}

export function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  let cur = start
  while (cur <= end) {
    dates.push(cur)
    cur = addDays(cur, 1)
  }
  if (dates.length === 0) dates.push(start)
  return dates
}

export async function searchPriceWindow(
  input: PriceWindowSearchInput,
  direction: 'outbound' | 'return',
  ctx: {
    destinations?: string[]
    roundTrip: boolean
    excludedAirports: Set<string>
    /** @deprecated */
    primaryDestination?: string
    /** @deprecated */
    multipleDestinations?: boolean
  },
  onProgress?: (state: SearchProgressState) => void,
): Promise<PriceWindowSearchResult> {
  const dep = input.origins.join(',')
  const arr = input.destinations.join(',')
  const dates = dateRange(input.startDate, input.endDate)

  const fetchInput: SearchFlightInput = {
    origins: input.origins,
    destinations: input.destinations,
    centerDate: input.startDate,
    flexDays: 0,
    perDateLimit: Infinity,
    mockMode: input.mockMode,
    apiKey: input.apiKey,
    maxTotalHours: input.maxTotalHours,
    showHidden: input.showHidden,
    deepSearch: input.deepSearch,
    gl: input.gl,
    hl: input.hl,
    currency: input.currency,
    maxSegments: input.maxSegments,
    adults: input.adults,
    children: input.children,
    cabinClass: input.cabinClass,
  }

  if (input.mockMode) {
    const resp = (direction === 'return' ? sampleReturn : sampleOutbound) as SerpGoogleFlightsResponse
    const itins = processSerpResponse(resp, { ...ctx, direction }, ctx.excludedAirports, 'price')
    const perDate: PriceWindowPerDateEntry[] = dates.map((date) => ({ date, itineraries: itins }))
    const serpDebug: SerpSearchDebugBundle = {
      direction,
      queries: [
        {
          outboundDate: input.startDate,
          requestParams: { note: 'mock-sample-json' } as SerpSearchParams,
          response: resp,
        },
      ],
    }
    return { perDate, serpDebug }
  }

  // Run price-sorted and duration-sorted queries in parallel.
  // Google returns different airline rankings for each sort mode, so the
  // union captures carriers that appear in one but not the other.
  // Price-sorted results come first in the dedup array so that when the same
  // flight appears in both, the priced version is always kept.
  // A final filter drops any itinerary that still lacks a price (rare SerpApi
  // edge-case when quota is low or the response is partial).
  let progressMax = 0
  const phase: SearchProgressState['phase'] =
    direction === 'return' ? 'oneWayReturn' : 'oneWayOutbound'
  const onChunk = (completed: number, total: number) => {
    if (completed > progressMax) {
      progressMax = completed
      onProgress?.({ phase, current: completed, total })
    }
  }
  const [priceQueries, durationQueries] = await Promise.all([
    fetchGoogleFlightsByDates(dates, dep, arr, fetchInput, 'price', onChunk),
    fetchGoogleFlightsByDates(dates, dep, arr, fetchInput, 'duration', onChunk),
  ])

  for (const q of [...priceQueries, ...durationQueries]) {
    if (q.response.error || q.response.search_metadata?.status === 'Error') {
      throw new Error(q.response.error || 'SerpApi search error')
    }
  }

  const perDate: PriceWindowPerDateEntry[] = dates.map((date, i) => {
    const fromPrice = processSerpResponse(
      priceQueries[i].response,
      { ...ctx, direction },
      ctx.excludedAirports,
      'price',
    )
    const fromDuration = processSerpResponse(
      durationQueries[i].response,
      { ...ctx, direction },
      ctx.excludedAirports,
      'price',
    )
    // Merge: price-sorted first → dedup keeps the priced version for shared flights.
    // Filter afterward to ensure no price-less entry reaches the price window.
    const merged = sortItineraries(
      dedupeByScheduleKey([...fromPrice, ...fromDuration])
        .filter((it) => it.price != null && Number.isFinite(it.price)),
      'price',
    )
    return { date, itineraries: merged }
  })

  return {
    perDate,
    serpDebug: { direction, queries: [...priceQueries, ...durationQueries] },
  }
}

type RoundTripFetchCtx = {
  destinations?: string[]
  excludedAirports: Set<string>
  /** @deprecated */
  primaryDestination?: string
  /** @deprecated */
  multipleDestinations?: boolean
}

type RoundTripPairProgress = Pick<
  SearchProgressState,
  'datePair' | 'subCurrent' | 'subTotal' | 'fetchedRankedIndex' | 'targetFetchStartIndex'
>

type RankedOutbound = { it: NormalizedItinerary; token: string }

type PairSearchState = {
  outDate: string
  retDate: string
  /**
   * Ranked outbound options. After filter-first reorder, filter-passing tokens occupy
   * positions 0..filteredRankedCount-1, followed by non-passing tokens.
   */
  ranked: RankedOutbound[]
  fetchedCount: number
  combos: RoundTripCombo[]
  queries: SerpSearchDebugQuery[]
  initialMinByRoute: Record<string, number>
  globalInitialMin: number | null
  /**
   * Count of ranked entries that pass the active outbound leg filter.
   * Undefined when no filter is active or for legacy states without filter-first reorder.
   */
  filteredRankedCount?: number
  targetFetchStartIndex?: number
}

function pairStateToDeepenState(state: PairSearchState): RoundTripPairDeepenState {
  return {
    outDate: state.outDate,
    retDate: state.retDate,
    ranked: state.ranked,
    fetchedCount: state.fetchedCount,
    combos: state.combos,
    queries: state.queries,
    initialMinByRoute: state.initialMinByRoute,
    globalInitialMin: state.globalInitialMin,
    filteredRankedCount: state.filteredRankedCount,
    targetFetchStartIndex: state.targetFetchStartIndex,
  }
}

type RoundTripPairFetchResult = {
  combos: RoundTripCombo[]
  queries: SerpSearchDebugQuery[]
  paused?: boolean
  pauseReason?: string
  state?: PairSearchState
}

function pairPaused(
  combos: RoundTripCombo[],
  queries: SerpSearchDebugQuery[],
  reason: string,
): RoundTripPairFetchResult {
  return { combos, queries, paused: true, pauseReason: reason }
}

function buildOutboundOptionsFromInitial(
  initialResponses: SerpGoogleFlightsResponse[],
  normCtx: { direction: 'outbound'; roundTrip: boolean; destinations?: string[]; primaryDestination?: string; multipleDestinations?: boolean },
  excludedAirports: Set<string>,
  expandWithinPctOfGlobalMin: number | null,
  rtLegFilterOpts?: RtLegFilterOpts,
): {
  ranked: RankedOutbound[]
  initialMinByRoute: Record<string, number>
  globalInitialMin: number | null
  filteredRankedCount: number | undefined
} {
  const optionByKey = new Map<string, { it: NormalizedItinerary; token?: string }>()
  for (const resp of initialResponses) {
    for (const opt of collectAllSerpOptions(resp)) {
      const it = processSerpResponse(
        { best_flights: [opt], other_flights: [] },
        normCtx,
        excludedAirports,
        'price',
      )[0]
      if (!it) continue
      const key = itineraryScheduleKey(it)
      const token = opt.departure_token
      const prev = optionByKey.get(key)
      if (!prev || (it.price != null && (prev.it.price == null || it.price < prev.it.price))) {
        optionByKey.set(key, { it, token })
      } else if (prev && !prev.token && token) {
        optionByKey.set(key, { ...prev, token })
      }
    }
  }
  const all = [...optionByKey.values()]
  const { initialMinByRoute, globalInitialMin } = buildInitialMinByRoute(all)
  const tokened = all
    .filter((o): o is { it: NormalizedItinerary; token: string } => Boolean(o.token))
    .sort((a, b) => (a.it.price ?? Infinity) - (b.it.price ?? Infinity))
  // Keep a small default ranked list, but when the "expand within %" feature is enabled,
  // retain a larger pool so the UI can prioritize which ones to deepen based on the *overall*
  // global minimum (not per date pair).
  const HARD_MAX = 250
  const allRanked = tokened.slice(0, expandWithinPctOfGlobalMin != null ? HARD_MAX : ROUND_TRIP_RANK_STORE_MAX)

  // Filter-first reorder: when outbound leg filters are active, partition ranked list so
  // filter-passing tokens come first (price-sorted within each group). This ensures the
  // return allocator finds filter-passing outbounds at small ranked indices (0, 1, 2…)
  // instead of walking past 100+ non-passing tokens — eliminating the rank-walk budget blowout.
  if (rtLegFilterOpts) {
    const passing = allRanked.filter((r) => passesRtOutboundLegFilter(r.it, rtLegFilterOpts))
    const rest = allRanked.filter((r) => !passesRtOutboundLegFilter(r.it, rtLegFilterOpts))
    // passing is already price-sorted; rest keeps its original order.
    const ranked = [...passing, ...rest]
    return { ranked, initialMinByRoute, globalInitialMin, filteredRankedCount: passing.length }
  }

  return { ranked: allRanked, initialMinByRoute, globalInitialMin, filteredRankedCount: undefined }
}

async function fetchRoundTripPairInitial(
  dep: string,
  arr: string,
  outDate: string,
  retDate: string,
  input: PriceWindowSearchInput,
  ctx: RoundTripFetchCtx,
): Promise<RoundTripPairFetchResult> {
  const baseOpts = {
    departureId: dep,
    arrivalId: arr,
    outboundDate: outDate,
    returnDate: retDate,
    maxSegments: input.maxSegments,
    maxTotalHours: input.maxTotalHours,
    showHidden: input.showHidden,
    deepSearch: input.deepSearch,
    gl: input.gl,
    hl: input.hl,
    currency: input.currency,
    adults: input.adults,
    children: input.children,
    cabinClass: input.cabinClass,
    includeAirlines: input.includeAirlines,
  }
  const normCtx = { ...ctx, direction: 'outbound' as const, roundTrip: true }
  const sortMode: RoundTripSortMode = input.roundTripSortMode ?? 'price'
  const queries: SerpSearchDebugQuery[] = []
  let priceResp: SerpGoogleFlightsResponse | null = null
  let durationResp: SerpGoogleFlightsResponse | null = null

  if (sortMode === 'price' || sortMode === 'both') {
    const priceParams = buildSerpRoundTripParams({ ...baseOpts, sort: 'price' })
    assertIncludeAirlinesParam(priceParams, input.includeAirlines)
    try {
      priceResp = await fetchSerpGoogleFlights(input.apiKey, priceParams)
    } catch (e) {
      if (isSerpSearchPausedError(e)) return pairPaused([], queries, e.message)
      throw e
    }
    queries.push({
      outboundDate: outDate,
      returnDate: retDate,
      requestParams: priceParams,
      response: priceResp,
    })
  }

  if (sortMode === 'duration' || sortMode === 'both') {
    const durationParams = buildSerpRoundTripParams({ ...baseOpts, sort: 'duration' })
    assertIncludeAirlinesParam(durationParams, input.includeAirlines)
    try {
      durationResp = await fetchSerpGoogleFlights(input.apiKey, durationParams)
    } catch (e) {
      if (isSerpSearchPausedError(e)) return pairPaused([], queries, e.message)
      throw e
    }
    queries.push({
      outboundDate: outDate,
      returnDate: retDate,
      requestParams: durationParams,
      response: durationResp,
    })
  }

  const initialResponses = [priceResp, durationResp].filter(
    (r): r is SerpGoogleFlightsResponse => r != null,
  )

  for (const resp of initialResponses) {
    if (resp.error || resp.search_metadata?.status === 'Error') {
      const errMsg = resp.error || 'SerpApi round-trip search error'
      if (isSerpThrottleMessage(errMsg)) {
        return pairPaused([], queries, formatSerpThrottleHelp(errMsg))
      }
      throw new Error(formatSerpThrottleHelp(errMsg))
    }
  }

  const { ranked, initialMinByRoute, globalInitialMin, filteredRankedCount } = buildOutboundOptionsFromInitial(
    initialResponses,
    normCtx,
    ctx.excludedAirports,
    input.expandWithinPctOfGlobalMin ?? null,
    input.rtLegFilterOpts,
  )

  const state: PairSearchState = {
    outDate,
    retDate,
    ranked,
    fetchedCount: 0,
    combos: [],
    queries: [...queries],
    initialMinByRoute,
    globalInitialMin,
    filteredRankedCount,
  }

  const adaptive = input.adaptiveDeepen === true
  if (!adaptive) {
    return { combos: [], queries: state.queries, state }
  }

  const initialFollow = Math.min(
    ROUND_TRIP_INITIAL_OUTBOUND_FOLLOW,
    ranked.length,
  )

  const tokenResult = await fetchOutboundTokensForPair(
    state,
    dep,
    arr,
    input,
    ctx,
    initialFollow,
    ranked.length,
  )
  if (tokenResult.paused) {
    return {
      combos: state.combos,
      queries: state.queries,
      paused: true,
      pauseReason: tokenResult.pauseReason,
      state,
    }
  }

  return { combos: state.combos, queries: state.queries, state }
}

/** Fetch return options for one date pair (click-to-deepen). */
export async function deepenRoundTripPair(
  pairState: RoundTripPairDeepenState,
  dep: string,
  arr: string,
  input: PriceWindowSearchInput,
  ctx: RoundTripFetchCtx,
  count: number = ROUND_TRIP_DEEPEN_BATCH,
  onPairProgress?: (update: RoundTripPairProgress) => void,
): Promise<{ state: RoundTripPairDeepenState; paused?: boolean; pauseReason?: string }> {
  const internal: PairSearchState = {
    outDate: pairState.outDate,
    retDate: pairState.retDate,
    ranked: pairState.ranked,
    fetchedCount: pairState.fetchedCount,
    combos: [...pairState.combos],
    queries: [...pairState.queries],
    initialMinByRoute: pairState.initialMinByRoute,
    globalInitialMin: pairState.globalInitialMin,
    filteredRankedCount: pairState.filteredRankedCount,
  }
  // Use filteredRankedCount as subTotal so click-deepen progress shows "1/3 options"
  // rather than the misleading "1/250 ranked outbounds".
  const subTotal = pairState.filteredRankedCount ?? internal.ranked.length
  const tokenResult = await fetchOutboundTokensForPair(
    internal,
    dep,
    arr,
    input,
    ctx,
    count,
    subTotal,
    onPairProgress,
    'clickDeepen',
  )
  return {
    state: pairStateToDeepenState(internal),
    paused: tokenResult.paused,
    pauseReason: tokenResult.pauseReason,
  }
}

async function fetchOutboundTokensForPair(
  state: PairSearchState,
  dep: string,
  arr: string,
  input: PriceWindowSearchInput,
  ctx: RoundTripFetchCtx,
  count: number,
  subTotal: number,
  onPairProgress?: (update: RoundTripPairProgress) => void,
  budgetKind: SerpBudgetCallKind = 'scan',
): Promise<{ paused?: boolean; pauseReason?: string }> {
  const { outDate, retDate, ranked, fetchedCount } = state
  let slice = ranked.slice(fetchedCount, fetchedCount + count)
  if (input.includeAirlines?.length) {
    slice = slice.filter(({ it }) => matchesTargetAirlines(it, input.includeAirlines!))
  }
  if (!slice.length) return {}

  const airlineScan = Boolean(input.includeAirlines?.length)
  const fetchStart = state.targetFetchStartIndex ?? fetchedCount
  const progressSubTotal =
    airlineScan ? subTotal : Math.max(subTotal, ranked.length)

  const emitTokenProgress = (absoluteFetched: number) => {
    const tokensDone = airlineScan ? Math.max(0, absoluteFetched - fetchStart) : absoluteFetched
    onPairProgress?.({
      datePair: `${outDate} → ${retDate}`,
      subCurrent: tokensDone,
      subTotal: progressSubTotal,
      ...(airlineScan
        ? {
            targetFetchStartIndex: fetchStart,
            fetchedRankedIndex: absoluteFetched > fetchStart ? absoluteFetched - 1 : undefined,
          }
        : {}),
    })
  }

  emitTokenProgress(fetchedCount)

  for (let i = 0; i < slice.length; i += TOKEN_FETCH_CHUNK_SIZE) {
    const chunk = slice.slice(i, i + TOKEN_FETCH_CHUNK_SIZE)
    try {
      const retResults = await Promise.all(
        chunk.map(async ({ it: outIt, token }) => {
          if (airlineScan && !matchesTargetAirlines(outIt, input.includeAirlines!)) {
            return []
          }
          const tokenParams = buildSerpDepartureTokenParams({
            departureToken: token,
            departureId: dep,
            arrivalId: arr,
            outboundDate: outDate,
            returnDate: retDate,
            gl: input.gl,
            hl: input.hl,
            currency: input.currency,
            adults: input.adults,
            children: input.children,
            cabinClass: input.cabinClass,
            includeAirlines: input.includeAirlines,
          })
          assertIncludeAirlinesParam(tokenParams, input.includeAirlines)
          const retResp = await fetchSerpGoogleFlights(input.apiKey, tokenParams, budgetKind)
          state.queries.push({
            outboundDate: outDate,
            returnDate: retDate,
            requestParams: tokenParams,
            response: retResp,
          })
          if (retResp.error || retResp.search_metadata?.status === 'Error') {
            return []
          }
          const retCtx = { ...ctx, direction: 'return' as const, roundTrip: true }
          return processSerpResponse(retResp, retCtx, ctx.excludedAirports, 'price')
            .filter((retIt) => retIt.price != null && Number.isFinite(retIt.price))
            .map((retIt) => ({
              outIt,
              retIt,
              roundTripPrice: retIt.price!,
            }))
        }),
      )
      for (const pairs of retResults) {
        for (const { outIt, retIt, roundTripPrice } of pairs) {
          state.combos.push({
            outDate,
            retDate,
            routeKey: makeRouteGroupKey(outIt),
            outIt,
            retIt,
            roundTripPrice,
          })
        }
      }
      state.fetchedCount += chunk.length
      emitTokenProgress(state.fetchedCount)
    } catch (e) {
      if (isSerpSearchPausedError(e)) {
        return { paused: true, pauseReason: e.message }
      }
      throw e
    }
  }
  return {}
}

function deepenStateToPairState(s: RoundTripPairDeepenState): PairSearchState {
  return {
    outDate: s.outDate,
    retDate: s.retDate,
    ranked: s.ranked,
    fetchedCount: s.fetchedCount,
    combos: [...s.combos],
    queries: [...s.queries],
    initialMinByRoute: s.initialMinByRoute,
    globalInitialMin: s.globalInitialMin,
    filteredRankedCount: s.filteredRankedCount,
    targetFetchStartIndex: s.targetFetchStartIndex,
  }
}

async function executeReturnFetchJob(
  pairStates: PairSearchState[],
  job: ReturnFetchJob,
  dep: string,
  arr: string,
  input: PriceWindowSearchInput,
  ctx: RoundTripFetchCtx,
  onPairProgress?: (update: RoundTripPairProgress) => void,
): Promise<{ paused?: boolean; pauseReason?: string }> {
  const state = pairStates.find((s) => s.outDate === job.outDate && s.retDate === job.retDate)
  if (!state) return {}
  const idx = job.rankedIndex
  if (idx < state.fetchedCount) return {}
  // After filter-first reorder, filter-passing tokens are at positions 0..filteredRankedCount-1.
  // The allocator plans jobs with idx values within that prefix, so idx - fetchedCount is
  // typically 0 (meaning count = 1 — exactly one SerpApi call per job).
  // The walk formula is kept for correctness when two routes share the same pair and jobs
  // arrive in order: job(idx=0) sets fetchedCount=1, then job(idx=1) gets count=1. ✓
  const count = idx - state.fetchedCount + 1
  // subTotal uses filteredRankedCount so the progress bar shows "1/3 Qatar options"
  // rather than the misleading "1/250 ranked outbounds".
  const subTotal = state.filteredRankedCount ?? state.ranked.length
  return fetchOutboundTokensForPair(
    state,
    dep,
    arr,
    input,
    ctx,
    count,
    subTotal,
    onPairProgress,
    'autoDeepen',
  )
}

/** 50-25-25 (or 90-45-45) scheduled return-token allocation. */
async function runPwReturnAllocator(
  pairStates: PairSearchState[],
  dep: string,
  arr: string,
  input: PriceWindowSearchInput,
  ctx: RoundTripFetchCtx,
  budget: number,
  legOpts: RtLegFilterOpts | undefined,
  onProgress?: (state: SearchProgressState) => void,
  mergeHour?: (s: SearchProgressState) => SearchProgressState,
  onPartial?: (snap: PriceWindowRoundTripPartial) => void,
): Promise<{ paused?: boolean; pauseReason?: string; jobsRun: number }> {
  if (budget <= 0 || !legOpts) return { jobsRun: 0 }

  const jobs = buildReturnFetchJobs(
    pairStates.map(pairStateToDeepenState),
    pairStates.map((s) => pairMetaFromInternal(s)),
    dedupeRoundTripCombos(pairStates.flatMap((s) => s.combos)),
    legOpts,
    budget,
  )

  let jobsRun = 0
  const total = jobs.length

  for (let i = 0; i < jobs.length; i++) {
    const stopped = pauseIfUserStopRequested()
    if (stopped) return { ...stopped, jobsRun }

    const job = jobs[i]!
    const budgetSnap = getActiveSerpHourBudget()
    if (budgetSnap && budgetSnap.remaining <= 0) {
      return {
        paused: true,
        pauseReason: `Hourly SerpApi limit reached (${budgetSnap.usedThisHour}/${budgetSnap.hourLimit} this hour). Return allocation paused after ${jobsRun} fetch${jobsRun === 1 ? '' : 'es'}.`,
        jobsRun,
      }
    }

    const progressBase: SearchProgressState = {
      phase: 'returnFetch',
      current: i + 1,
      total,
      datePair: `${job.outDate} → ${job.retDate}`,
      subCurrent: jobsRun,
      subTotal: total,
    }
    onProgress?.(mergeHour ? mergeHour(progressBase) : progressBase)

    const result = await executeReturnFetchJob(
      pairStates,
      job,
      dep,
      arr,
      input,
      ctx,
      (sub) => {
        onProgress?.(
          mergeHour
            ? mergeHour({ ...progressBase, ...sub, datePair: `${job.outDate} → ${job.retDate}` })
            : { ...progressBase, ...sub },
        )
      },
    )
    jobsRun++
    emitRoundTripPartial(pairStates, onPartial)

    if (result.paused) {
      return { paused: true, pauseReason: result.pauseReason, jobsRun }
    }
  }

  return { jobsRun }
}

/** Balanced mode: deepen top-priority cells until budget or cap. */
async function runPriorityAutoDeepen(
  pairStates: PairSearchState[],
  dep: string,
  arr: string,
  input: PriceWindowSearchInput,
  ctx: RoundTripFetchCtx,
  onProgress?: (state: SearchProgressState) => void,
  mergeHour?: (s: SearchProgressState) => SearchProgressState,
  onPartial?: (snap: PriceWindowRoundTripPartial) => void,
): Promise<{ paused?: boolean; pauseReason?: string; cellsDeepened: number }> {
  const metaList = pairStates.map((s) => pairMetaFromInternal(s))
  const ordered = sortPairMetaByPriority(metaList).slice(0, PW_BALANCED_TOP_CELLS)
  let cellsDeepened = 0
  const total = pairStates.length

  for (const meta of ordered) {
    const stopped = pauseIfUserStopRequested()
    if (stopped) return { ...stopped, cellsDeepened }

    const state = pairStates.find((s) => s.outDate === meta.outDate && s.retDate === meta.retDate)
    if (!state || state.fetchedCount >= state.ranked.length) continue

    const budget = getActiveSerpHourBudget()
    if (!budget || budget.remainingForAutoDeepen <= 0) {
      return {
        paused: true,
        pauseReason: `Auto-deepen stopped — ${budget?.clickReserveRemaining ?? 0} SerpApi call(s) reserved for cell clicks.`,
        cellsDeepened,
      }
    }

    const batch = Math.min(
      PW_BALANCED_TOKENS_PER_CELL,
      state.ranked.length - state.fetchedCount,
      budget.remainingForAutoDeepen,
    )
    if (batch <= 0) continue

    const progressBase: SearchProgressState = {
      phase: 'roundTrip',
      current: total,
      total,
      datePair: `${state.outDate} → ${state.retDate} · auto-deepen`,
      subCurrent: state.fetchedCount,
      subTotal: state.ranked.length,
    }
    onProgress?.(mergeHour ? mergeHour(progressBase) : progressBase)

    const tokenResult = await fetchOutboundTokensForPair(
      state,
      dep,
      arr,
      input,
      ctx,
      batch,
      state.ranked.length,
      (sub) => {
        onProgress?.(
          mergeHour
            ? mergeHour({ ...progressBase, ...sub, datePair: `${state.outDate} → ${state.retDate} · auto-deepen` })
            : { ...progressBase, ...sub },
        )
      },
      'autoDeepen',
    )
    cellsDeepened++
    emitRoundTripPartial(pairStates, onPartial)

    if (tokenResult.paused) {
      return { paused: true, pauseReason: tokenResult.pauseReason, cellsDeepened }
    }
  }

  return { cellsDeepened }
}

export function dedupeRoundTripCombos(combos: RoundTripCombo[]): RoundTripCombo[] {
  const seen = new Set<string>()
  const out: RoundTripCombo[] = []
  for (const c of combos) {
    const k = `${c.outDate}|${c.retDate}|${c.routeKey}|${itineraryScheduleKey(c.outIt)}|${itineraryScheduleKey(c.retIt)}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

/** SerpApi round-trip searches for each valid (outbound date × return date) pair. */
export async function searchPriceWindowRoundTrip(
  input: PriceWindowSearchInput & {
    returnStartDate: string
    returnEndDate: string
  },
  ctx: RoundTripFetchCtx,
  onProgress?: (state: SearchProgressState) => void,
  onPartialResult?: (snap: PriceWindowRoundTripPartial) => void,
): Promise<PriceWindowRoundTripResult> {
  const dep = input.origins.join(',')
  const arr = input.destinations.join(',')
  if (!dep.trim() || !arr.trim()) {
    throw new Error('Select at least one origin and one destination airport.')
  }
  const { pairs, stats: pairFilterStats } = buildFilteredRoundTripDatePairs(
    input.startDate,
    input.endDate,
    input.returnStartDate,
    input.returnEndDate,
    input.pairFilters,
  )
  if (pairs.length === 0) {
    throw new Error(
      'No date pairs match your filters. Widen trip length, increase sparse stride, or raise the pair cap.',
    )
  }

  if (input.mockMode) {
    const pairStates: PairSearchState[] = []
    const allQueries: SerpSearchDebugQuery[] = []
    for (const { outDate, retDate } of pairs) {
      const result = await fetchRoundTripPairInitial(dep, arr, outDate, retDate, input, ctx)
      if (result.queries.length) allQueries.push(...result.queries)
      if (result.state) pairStates.push(result.state)
    }
    return {
      combos: dedupeRoundTripCombos(pairStates.flatMap((s) => s.combos)),
      pairMeta: pairStates.map((s) => pairMetaFromInternal(s)),
      pairDeepenStates: pairStates.map((s) => pairStateToDeepenState(s)),
      serpDebug: { direction: 'roundTrip', queries: allQueries },
    }
  }

  const pwTranche = input.pwTranche
  const pairStates: PairSearchState[] = []
  let pausedEarly = false
  let pauseReason: string | undefined
  let pairsCompleted = 0
  let deepenRounds = 0
  let autoDeepenedCells = 0
  const searchMode: PriceWindowSearchMode =
    input.searchMode ?? (input.adaptiveDeepen === true ? 'exhaustive' : 'balanced')
  const exhaustiveDeepen = !pwTranche && searchMode === 'exhaustive'
  const legacyBalanced = !pwTranche && searchMode === 'balanced'

  const mergeHourIntoProgress = (state: SearchProgressState): SearchProgressState => {
    const budget = getActiveSerpHourBudget()
    if (!budget) return state
    const snap = budget.snapshot()
    return {
      ...state,
      hourUsed: snap.usedThisHour,
      hourLimit: snap.hourLimit,
      sessionCalls: snap.sessionCalls,
      clickReserve: snap.clickReserve,
      clickReserveRemaining: snap.clickReserveRemaining,
      remainingForAutoDeepen: snap.remainingForAutoDeepen,
    }
  }

  const pairKeySet = new Set(pairs.map((p) => `${p.outDate}|${p.retDate}`))

  if (pwTranche === 'continue' && input.existingPairDeepenStates?.length) {
    for (const s of input.existingPairDeepenStates) {
      if (!pairKeySet.has(`${s.outDate}|${s.retDate}`)) continue
      // Re-apply filter-first reorder to cached states on continue runs.
      // Cached states may have been stored without the reorder (no filteredRankedCount),
      // or with a different filter that has since changed. Re-applying ensures the allocator
      // finds filter-passing tokens at the front of ranked[] so rank-walk count stays small.
      const reordered =
        input.rtLegFilterOpts && s.filteredRankedCount == null
          ? reorderDeepenStateForLegFilters(s, input.rtLegFilterOpts)
          : s
      // Compute filteredRankedCount for the re-ordered state if not already set.
      let withCount = reordered
      if (input.rtLegFilterOpts && withCount.filteredRankedCount == null) {
        let count = 0
        for (const { it } of withCount.ranked) {
          if (passesRtOutboundLegFilter(it, input.rtLegFilterOpts)) count++
          else break // filter-passing block is now at the front
        }
        withCount = { ...withCount, filteredRankedCount: count }
      }
      pairStates.push(deepenStateToPairState(withCount))
    }
    pairsCompleted = pairs.length
    emitRoundTripPartial(pairStates, onPartialResult)
  }

  if (pwTranche !== 'continue') {
    for (let i = 0; i < pairs.length; i += RT_PAIR_CHUNK_SIZE) {
      const chunk = pairs.slice(i, i + RT_PAIR_CHUNK_SIZE)
      for (let j = 0; j < chunk.length; j++) {
        const stopped = pauseIfUserStopRequested()
        if (stopped) {
          pausedEarly = true
          pauseReason = stopped.pauseReason
          break
        }
        const { outDate, retDate } = chunk[j]!
        const pairIndex = i + j
        onProgress?.(
          mergeHourIntoProgress({
            phase: 'pairScan',
            current: pairIndex + 1,
            total: pairs.length,
            datePair: `${outDate} → ${retDate}`,
          }),
        )
        const result = await fetchRoundTripPairInitial(dep, arr, outDate, retDate, input, ctx)
        if (result.state) pairStates.push(result.state)
        emitRoundTripPartial(pairStates, onPartialResult)
        pairsCompleted = pairIndex + 1
        if (result.paused) {
          pausedEarly = true
          pauseReason = result.pauseReason
          break
        }
      }
      if (pausedEarly) break
    }
  }

  if (pwTranche && !pausedEarly && pairStates.length > 0) {
    const planned =
      input.plannedHourlySerpCalls != null && input.plannedHourlySerpCalls > 0
        ? input.plannedHourlySerpCalls
        : PW_HOURLY_SERP_CALLS_DEFAULT
    const budgetSnap = getActiveSerpHourBudget()
    const returnBudget =
      pwTranche === 'continue'
        ? returnBudgetForContinue(planned)
        : budgetSnap
          ? budgetSnap.remaining
          : returnBudgetAfterInitialScan(planned, 0)

    const allocResult = await runPwReturnAllocator(
      pairStates,
      dep,
      arr,
      input,
      ctx,
      returnBudget,
      input.rtLegFilterOpts,
      onProgress,
      mergeHourIntoProgress,
      onPartialResult,
    )
    autoDeepenedCells = allocResult.jobsRun
    if (allocResult.paused) {
      pausedEarly = true
      pauseReason = allocResult.pauseReason
    }
  }

  if (legacyBalanced && !pausedEarly) {
    const autoResult = await runPriorityAutoDeepen(
      pairStates,
      dep,
      arr,
      input,
      ctx,
      onProgress,
      mergeHourIntoProgress,
      onPartialResult,
    )
    autoDeepenedCells = autoResult.cellsDeepened
    if (autoResult.paused) {
      pausedEarly = true
      pauseReason = autoResult.pauseReason
    }
  }

  if (exhaustiveDeepen && !pausedEarly) {
    while (true) {
      const stopped = pauseIfUserStopRequested()
      if (stopped) {
        pausedEarly = true
        pauseReason = stopped.pauseReason
        break
      }
      const needMore = pairStates.filter((s) => s.fetchedCount < s.ranked.length)
      if (!needMore.length) break

      const budget = getActiveSerpHourBudget()
      if (!budget || budget.remaining <= 0) {
        pausedEarly = true
        pauseReason =
          pauseReason ??
          `Hourly SerpApi limit reached (${budget?.usedThisHour ?? '?'}/${budget?.hourLimit ?? 200} this hour). Showing partial results — ${needMore.length} date pair(s) still have more routes available.`
        break
      }

      deepenRounds++
      let fetchedThisRound = 0

      for (const state of needMore) {
        const stopped = pauseIfUserStopRequested()
        if (stopped) {
          pausedEarly = true
          pauseReason = stopped.pauseReason
          break
        }
        if (budget.remaining <= 0) {
          pausedEarly = true
          pauseReason =
            pauseReason ??
            `Hourly SerpApi limit reached (${budget.usedThisHour}/${budget.hourLimit} this hour). Partial results include deepen round ${deepenRounds}.`
          break
        }

        const remaining = state.ranked.length - state.fetchedCount
        const batch = Math.min(ROUND_TRIP_DEEPEN_BATCH, remaining, budget.remaining)
        if (batch <= 0) continue

        onProgress?.(
          mergeHourIntoProgress({
            phase: 'roundTrip',
            current: pairsCompleted,
            total: pairs.length,
            datePair: `${state.outDate} → ${state.retDate}`,
            subCurrent: state.fetchedCount,
            subTotal: state.ranked.length,
          }),
        )

        const deepenResult = await fetchOutboundTokensForPair(
          state,
          dep,
          arr,
          input,
          ctx,
          batch,
          state.ranked.length,
          (sub) => {
            onProgress?.(
              mergeHourIntoProgress({
                phase: 'roundTrip',
                current: pairsCompleted,
                total: pairs.length,
                datePair: `${state.outDate} → ${state.retDate} · deepen ${deepenRounds}`,
                ...sub,
              }),
            )
          },
          'autoDeepen',
        )
        fetchedThisRound += batch

        if (deepenResult.paused) {
          pausedEarly = true
          pauseReason = deepenResult.pauseReason
          break
        }
      }

      if (fetchedThisRound > 0) emitRoundTripPartial(pairStates, onPartialResult)
      if (!fetchedThisRound || pausedEarly) break
    }
  }

  const allQueries = pairStates.flatMap((s) => s.queries)
  const routesRemaining = pairStates.reduce(
    (sum, s) => sum + Math.max(0, s.ranked.length - s.fetchedCount),
    0,
  )

  const pairMeta = pairStates.map((s) => pairMetaFromInternal(s))
  const pairDeepenStates = pairStates.map((s) => pairStateToDeepenState(s))

  return {
    combos: dedupeRoundTripCombos(pairStates.flatMap((s) => s.combos)),
    pairMeta,
    pairDeepenStates,
    serpDebug: { direction: 'roundTrip', queries: allQueries },
    pausedEarly: pausedEarly || undefined,
    pauseReason,
    pairsCompleted,
    pairsTotal: pairs.length,
    deepenRounds: deepenRounds || undefined,
    routesRemaining: routesRemaining || undefined,
    autoDeepenedCells: autoDeepenedCells || undefined,
    pairFilterStats,
  }
}

export type RefreshFilteredReturnsResult = PriceWindowRoundTripResult & {
  /** Number of date pairs that required a fresh pair scan (had no prior deepen state). */
  pairsScanned: number
}

/**
 * Refresh return itineraries for date pairs in the current price-window view.
 *
 * Strategy:
 *  - Pairs supplied in `existingClearedStates` (combos=[], fetchedCount=0) skip the
 *    pair scan and go straight to the return-fetch allocator.
 *  - Pairs with no existing state run a full outbound pair scan first (type=1 RT call)
 *    to obtain departure tokens, then the return allocator.
 *
 * The hour budget system is active: the run can pause and show partial results.
 */
export async function refreshFilteredReturns(
  input: PriceWindowSearchInput & { returnStartDate: string; returnEndDate: string },
  existingClearedStates: RoundTripPairDeepenState[],
  ctx: RoundTripFetchCtx,
  onProgress?: (state: SearchProgressState) => void,
  onPartialResult?: (snap: PriceWindowRoundTripPartial) => void,
): Promise<RefreshFilteredReturnsResult> {
  const dep = input.origins.join(',')
  const arr = input.destinations.join(',')

  if (!dep.trim() || !arr.trim()) {
    throw new Error('Select at least one origin and one destination airport.')
  }

  const { pairs } = buildFilteredRoundTripDatePairs(
    input.startDate,
    input.endDate,
    input.returnStartDate,
    input.returnEndDate,
    input.pairFilters,
  )

  if (pairs.length === 0) {
    throw new Error('No date pairs in the current window.')
  }

  // Build pair key set for fast lookup
  const pairKeySet = new Set(pairs.map((p) => `${p.outDate}|${p.retDate}`))

  // Partition: cleared existing states vs pairs needing a fresh scan
  const existingKeySet = new Set(existingClearedStates.map((s) => `${s.outDate}|${s.retDate}`))
  const needScanPairs = pairs.filter((p) => !existingKeySet.has(`${p.outDate}|${p.retDate}`))

  const pairStates: PairSearchState[] = existingClearedStates
    .filter((s) => pairKeySet.has(`${s.outDate}|${s.retDate}`))
    .map((s) => deepenStateToPairState(s))

  let pausedEarly = false
  let pauseReason: string | undefined

  const mergeHourIntoProgress = (state: SearchProgressState): SearchProgressState => {
    const budget = getActiveSerpHourBudget()
    if (!budget) return state
    const snap = budget.snapshot()
    return {
      ...state,
      hourUsed: snap.usedThisHour,
      hourLimit: snap.hourLimit,
      sessionCalls: snap.sessionCalls,
      clickReserve: snap.clickReserve,
      clickReserveRemaining: snap.clickReserveRemaining,
      remainingForAutoDeepen: snap.remainingForAutoDeepen,
    }
  }

  // Phase 1: Pair scan for date pairs with no existing deepen state
  for (let i = 0; i < needScanPairs.length; i++) {
    const stopped = pauseIfUserStopRequested()
    if (stopped) {
      pausedEarly = true
      pauseReason = stopped.pauseReason
      break
    }
    const { outDate, retDate } = needScanPairs[i]!
    onProgress?.(
      mergeHourIntoProgress({
        phase: 'pairScan',
        current: i + 1,
        total: needScanPairs.length,
        datePair: `${outDate} → ${retDate}`,
      }),
    )
    const result = await fetchRoundTripPairInitial(dep, arr, outDate, retDate, input, ctx)
    if (result.state) pairStates.push(result.state)
    emitRoundTripPartial(pairStates, onPartialResult)
    if (result.paused) {
      pausedEarly = true
      pauseReason = result.pauseReason
      break
    }
  }

  // Phase 2: Return fetch via allocator (same 50-25-25 budget logic as regular run)
  if (!pausedEarly && pairStates.length > 0 && input.rtLegFilterOpts) {
    const budgetSnap = getActiveSerpHourBudget()
    const returnBudget = budgetSnap
      ? budgetSnap.remaining
      : returnBudgetForContinue(input.plannedHourlySerpCalls ?? PW_HOURLY_SERP_CALLS_DEFAULT)

    const allocResult = await runPwReturnAllocator(
      pairStates,
      dep,
      arr,
      input,
      ctx,
      returnBudget,
      input.rtLegFilterOpts,
      onProgress,
      mergeHourIntoProgress,
      onPartialResult,
    )

    if (allocResult.paused) {
      pausedEarly = true
      pauseReason = allocResult.pauseReason
    }
  }

  const allQueries = pairStates.flatMap((s) => s.queries)
  const pairMeta = pairStates.map((s) => pairMetaFromInternal(s))
  const pairDeepenStates = pairStates.map((s) => pairStateToDeepenState(s))

  return {
    combos: dedupeRoundTripCombos(pairStates.flatMap((s) => s.combos)),
    pairMeta,
    pairDeepenStates,
    serpDebug: { direction: 'roundTrip', queries: allQueries },
    pausedEarly: pausedEarly || undefined,
    pauseReason,
    pairsScanned: needScanPairs.length,
  }
}

// ── Targeted airline scan ────────────────────────────────────────────────────

export type AirlineTargetedScanMode = 'outboundAndReturn' | 'returnOnly'

export type AirlineTargetedScanResult = {
  pairDeepenStates: RoundTripPairDeepenState[]
  /** Target-airline outbound options found across all pairs (unfiltered). */
  rawOutboundFound: number
  /** Target-airline outbound options that pass the outbound leg filter (tokens fetched). */
  filteredOutboundFound: number
  /** Return itineraries received from filter-passing outbound tokens (any return leg). */
  rawReturnItineraries: number
  /** Return itineraries that pass the return leg filter. */
  filteredReturnItineraries: number
  /** @deprecated use rawReturnItineraries — kept for callers */
  rawCombosFound: number
  /** @deprecated use filteredReturnItineraries — kept for callers */
  filteredCombosFound: number
  serpDebug: { direction: 'roundTrip'; queries: SerpSearchDebugQuery[] }
  pausedEarly?: boolean
  pauseReason?: string
}

/**
 * Clean-slate airline-targeted scan for a price-window grid.
 *
 * For every (outDate, retDate) pair in the current window:
 *
 * **outboundAndReturn** (default):
 *  1. Fresh outbound scan with `include_airlines` for `targetAirlines`.
 *  2. Merge into ranked[], replacing prior target-airline entries.
 *  3. Fetch returns for filter-passing target outbounds, ascending by price.
 *
 * **returnOnly**:
 *  1. Skip outbound scan; keep saved target-airline departure tokens.
 *  2. Clear target-airline combos and re-fetch returns (same filter + price order).
 *
 * `include_airlines` is set on every SerpApi call (pair scan + departure_token fetches).
 */
export async function runAirlineTargetedScan(
  input: PriceWindowSearchInput & {
    returnStartDate: string
    returnEndDate: string
    targetAirlines: string[]   // e.g. ['QR']
    /** `returnOnly` skips the outbound scan and re-fetches returns from saved tokens. */
    scanMode?: AirlineTargetedScanMode
  },
  existingDeepenStates: RoundTripPairDeepenState[],
  ctx: RoundTripFetchCtx,
  onProgress?: (state: SearchProgressState) => void,
  onPartialResult?: (snap: PriceWindowRoundTripPartial) => void,
): Promise<AirlineTargetedScanResult> {
  const dep = input.origins.join(',')
  const arr = input.destinations.join(',')

  const { pairs } = buildFilteredRoundTripDatePairs(
    input.startDate,
    input.endDate,
    input.returnStartDate,
    input.returnEndDate,
    input.pairFilters,
  )
  if (pairs.length === 0) throw new Error('No date pairs in the current window.')

  const includedIata = sanitizeIncludeAirlinesIata(input.targetAirlines)
  if (!includedIata.length) {
    throw new Error(
      'No valid IATA airline codes for include_airlines (need 2-letter codes like QR).',
    )
  }

  const returnOnly = input.scanMode === 'returnOnly'

  const existingByKey = new Map(
    existingDeepenStates.map((s) => [`${s.outDate}|${s.retDate}`, s]),
  )

  // Build working pair states seeded from existing deepen data.
  const pairStates: PairSearchState[] = pairs.map(({ outDate, retDate }) => {
    const existing = existingByKey.get(`${outDate}|${retDate}`)
    if (existing) {
      const keptCombos = existing.combos.filter((c) => !matchesTargetAirlines(c.outIt, includedIata))
      if (returnOnly) {
        const nonTarget = existing.ranked.filter((r) => !matchesTargetAirlines(r.it, includedIata))
        const target = existing.ranked.filter((r) => matchesTargetAirlines(r.it, includedIata))
        return deepenStateToPairState({
          ...existing,
          ranked: [...nonTarget, ...target],
          combos: keptCombos,
          fetchedCount: nonTarget.length,
        })
      }
      const keptRanked = existing.ranked.filter((r) => !matchesTargetAirlines(r.it, includedIata))
      return deepenStateToPairState({
        ...existing,
        ranked: keptRanked,
        combos: keptCombos,
        fetchedCount: keptRanked.length,
      })
    }
    return {
      outDate,
      retDate,
      ranked: [],
      fetchedCount: 0,
      combos: [],
      queries: [],
      initialMinByRoute: {},
      globalInitialMin: null,
    }
  })

  let pausedEarly = false
  let pauseReason: string | undefined
  const allQueries: SerpSearchDebugQuery[] = []

  const mergeHourIntoProgress = (state: SearchProgressState): SearchProgressState => {
    const budget = getActiveSerpHourBudget()
    const withAirlines: SearchProgressState = { ...state, includeAirlines: includedIata }
    if (!budget) return withAirlines
    const snap = budget.snapshot()
    return {
      ...withAirlines,
      hourUsed: snap.usedThisHour,
      hourLimit: snap.hourLimit,
      sessionCalls: snap.sessionCalls,
      clickReserve: snap.clickReserve,
      clickReserveRemaining: snap.clickReserveRemaining,
      remainingForAutoDeepen: snap.remainingForAutoDeepen,
    }
  }

  const scanInput: PriceWindowSearchInput = {
    ...input,
    targetAirlines: includedIata,
    includeAirlines: includedIata,
  }

  // Phase 1: fresh outbound scan with include_airlines (skipped in return-only mode).
  if (!returnOnly) {
    for (let i = 0; i < pairStates.length; i++) {
      const stopped = pauseIfUserStopRequested()
      if (stopped) {
        pausedEarly = true
        pauseReason = stopped.pauseReason
        break
      }
      const state = pairStates[i]!
      const { outDate, retDate } = state

      onProgress?.(
        mergeHourIntoProgress({
          phase: 'pairScan',
          current: i + 1,
          total: pairStates.length,
          datePair: `${outDate} → ${retDate}`,
        }),
      )

      const budgetSnap = getActiveSerpHourBudget()
      if (budgetSnap && budgetSnap.remaining <= 0) {
        pausedEarly = true
        pauseReason = `Hourly SerpApi limit reached (${budgetSnap.usedThisHour}/${budgetSnap.hourLimit} this hour). Airline scan paused after ${i} pairs.`
        break
      }

      const result = await fetchRoundTripPairInitial(dep, arr, outDate, retDate, scanInput, ctx)
      allQueries.push(...(result.queries ?? []))

      if (result.state) {
        const newRanked = result.state.ranked
        state.ranked = [...state.ranked, ...newRanked]
        state.initialMinByRoute = { ...state.initialMinByRoute, ...result.state.initialMinByRoute }
        if (state.globalInitialMin == null || (result.state.globalInitialMin != null && result.state.globalInitialMin < state.globalInitialMin)) {
          state.globalInitialMin = result.state.globalInitialMin
        }
      }

      if (result.paused) {
        pausedEarly = true
        pauseReason = result.pauseReason
        break
      }

      emitRoundTripPartial(pairStates, onPartialResult)
    }
  } else {
    const tokenTotal = pairStates.reduce(
      (n, s) => n + countAirlineScanFetchTokens(s, includedIata, input.rtLegFilterOpts),
      0,
    )
    if (tokenTotal === 0) {
      throw new Error(
        'Return-only mode needs saved outbound departure tokens for the selected airlines. Run outbound + return first, or use the full refresh.',
      )
    }
  }

  // Phase 2: fetch return tokens for filter-passing target-airline outbounds only,
  // ascending by price.  fetchedCount points past the preserved non-target prefix.
  if (!pausedEarly) {
    const total = pairStates.reduce(
      (n, s) => n + countAirlineScanFetchTokens(s, includedIata, input.rtLegFilterOpts),
      0,
    )
    let done = 0

    for (const state of pairStates) {
      const stopped = pauseIfUserStopRequested()
      if (stopped) {
        pausedEarly = true
        pauseReason = stopped.pauseReason
        break
      }
      const { outDate, retDate } = state
      const count = prepareAirlineScanFetchRanked(
        state,
        includedIata,
        input.rtLegFilterOpts,
      )
      if (count <= 0) continue

      const budgetSnap = getActiveSerpHourBudget()
      if (budgetSnap && budgetSnap.remaining <= 0) {
        pausedEarly = true
        pauseReason = `Hourly SerpApi limit reached — airline scan paused at ${done}/${total} tokens.`
        break
      }

      emitRoundTripPartial(pairStates, onPartialResult)

      onProgress?.(
        mergeHourIntoProgress({
          phase: 'returnFetch',
          current: done + 1,
          total,
          datePair: `${outDate} → ${retDate}`,
          subCurrent: 0,
          subTotal: count,
          targetFetchStartIndex: state.targetFetchStartIndex,
        }),
      )

      const subTotal = count
      const fetchResult = await fetchOutboundTokensForPair(
        state,
        dep,
        arr,
        scanInput,
        ctx,
        count,
        subTotal,
        (sub) => {
          onProgress?.(
            mergeHourIntoProgress({
              phase: 'returnFetch',
              current: done + 1,
              total,
              datePair: `${outDate} → ${retDate}`,
              ...sub,
            }),
          )
        },
        'autoDeepen',
      )
      done += count
      allQueries.push(...(state.queries ?? []))

      emitRoundTripPartial(pairStates, onPartialResult)

      if (fetchResult.paused) {
        pausedEarly = true
        pauseReason = fetchResult.pauseReason
        break
      }
    }
  }

  const pairDeepenStates = pairStates.map((s) => pairStateToDeepenState(s))
  const allCombos = dedupeRoundTripCombos(pairStates.flatMap((s) => s.combos))

  let rawOutboundFound = 0
  let filteredOutboundFound = 0
  for (const s of pairStates) {
    const targets = s.ranked.filter((r) => matchesTargetAirlines(r.it, includedIata))
    rawOutboundFound += targets.length
    filteredOutboundFound += input.rtLegFilterOpts
      ? targets.filter((r) => passesRtOutboundLegFilter(r.it, input.rtLegFilterOpts!)).length
      : targets.length
  }

  const targetCombos = allCombos.filter((c) => matchesTargetAirlines(c.outIt, includedIata))
  const outboundPassingCombos = input.rtLegFilterOpts
    ? targetCombos.filter((c) => passesRtOutboundLegFilter(c.outIt, input.rtLegFilterOpts!))
    : targetCombos
  const rawReturnItineraries = outboundPassingCombos.length
  const filteredReturnItineraries = input.rtLegFilterOpts
    ? outboundPassingCombos.filter((c) =>
        passesRtReturnLegFilter(c.retIt, input.rtLegFilterOpts!),
      ).length
    : rawReturnItineraries

  return {
    pairDeepenStates,
    rawOutboundFound,
    filteredOutboundFound,
    rawReturnItineraries,
    filteredReturnItineraries,
    rawCombosFound: rawReturnItineraries,
    filteredCombosFound: filteredReturnItineraries,
    serpDebug: { direction: 'roundTrip', queries: allQueries },
    pausedEarly: pausedEarly || undefined,
    pauseReason,
  }
}

/** Count target-airline ranked rows after the preserved prefix that pass outbound filters. */
function countAirlineScanFetchTokens(
  state: PairSearchState,
  targetAirlines: string[],
  legOpts: RtLegFilterOpts | undefined,
): number {
  const tail = state.ranked.slice(state.fetchedCount).filter((r) => matchesTargetAirlines(r.it, targetAirlines))
  if (!legOpts) return tail.length
  return tail.filter((r) => passesRtOutboundLegFilter(r.it, legOpts)).length
}

/**
 * Reorder the newly scanned target-airline ranked tail: filter-passing rows first,
 * sorted ascending by price; non-passing rows kept after (never fetched).
 * Returns how many tokens will be fetched.
 */
function prepareAirlineScanFetchRanked(
  state: PairSearchState,
  targetAirlines: string[],
  legOpts: RtLegFilterOpts | undefined,
): number {
  const prefixLen = state.fetchedCount
  const prefix = state.ranked.slice(0, prefixLen)
  const newTarget = state.ranked.slice(prefixLen).filter((r) => matchesTargetAirlines(r.it, targetAirlines))

  let passing = newTarget
  if (legOpts) {
    passing = newTarget.filter((r) => passesRtOutboundLegFilter(r.it, legOpts))
  }
  passing.sort((a, b) => (a.it.price ?? Infinity) - (b.it.price ?? Infinity))

  const passingKeys = new Set(passing.map((r) => itineraryScheduleKey(r.it)))
  const nonPassing = newTarget.filter((r) => !passingKeys.has(itineraryScheduleKey(r.it)))

  state.ranked = [...prefix, ...passing, ...nonPassing]
  state.filteredRankedCount = prefixLen + passing.length
  state.targetFetchStartIndex = prefixLen
  return passing.length
}

/** True when at least one flight segment is operated by a target IATA (not codeshare mention in summary). */
function matchesTargetAirlines(it: NormalizedItinerary, codes: string[]): boolean {
  const targets = new Set(codes.map((c) => c.trim().toUpperCase()))
  for (const s of it.segments) {
    const raw = s.airline?.trim()
    if (!raw) continue
    const upper = raw.toUpperCase()
    if (targets.has(upper)) return true
    for (const code of codes) {
      if (upper === airlineNameForCode(code).toUpperCase()) return true
    }
  }
  return false
}

/** Map common IATA codes to the full airline name as stored in ranked[].airlines. */
function airlineNameForCode(code: string): string {
  const map: Record<string, string> = {
    QR: 'Qatar Airways',
    EK: 'Emirates',
    EY: 'Etihad',
    AI: 'Air India',
    '9W': 'Jet Airways',
    BA: 'British Airways',
    LH: 'Lufthansa',
    AF: 'Air France',
    KL: 'KLM',
    TK: 'Turkish Airlines',
    SQ: 'Singapore Airlines',
    CX: 'Cathay Pacific',
    MH: 'Malaysia Airlines',
    UL: 'SriLankan Airlines',
  }
  return map[code] ?? code
}

export async function searchDirection(
  input: SearchFlightInput,
  direction: 'outbound' | 'return',
  ctx: {
    destinations?: string[]
    roundTrip: boolean
    excludedAirports: Set<string>
    sort: SortMode
    /** @deprecated */
    primaryDestination?: string
    /** @deprecated */
    multipleDestinations?: boolean
  },
  onProgress?: (state: SearchProgressState) => void,
): Promise<SearchDirectionResult> {
  const dep = input.origins.join(',')
  const arr = input.destinations.join(',')
  const dates = dateWindow(input.centerDate, input.flexDays)

  if (input.mockMode) {
    const resp = (direction === 'return' ? sampleReturn : sampleOutbound) as SerpGoogleFlightsResponse
    const serpOptionRows = collectAllSerpOptions(resp).length
    const one = processSerpResponse(resp, { ...ctx, direction }, ctx.excludedAirports, ctx.sort)
    const itineraries = mergePerDateUnique([one], input.perDateLimit, ctx.sort)
    // For mock, replicate same results across all dates in the window
    const perDate: PriceWindowPerDateEntry[] = dates.map((date) => ({ date, itineraries: one }))
    const serpDebug: SerpSearchDebugBundle = {
      direction,
      queries: [
        {
          outboundDate: input.centerDate,
          requestParams: { note: 'mock-sample-json' } as SerpSearchParams,
          response: resp,
        },
      ],
    }
    return {
      itineraries,
      perDate,
      meta: { serpOptionRows, mergedItineraries: itineraries.length },
      serpDebug,
    }
  }

  // Run price-sorted and duration-sorted queries in parallel — same approach as searchPriceWindow.
  // Google returns different airline rankings per sort mode; the union captures routes that appear
  // in only one. Price-sorted results come first in dedup so the priced version wins for shared flights.
  const phase: SearchProgressState['phase'] = direction === 'return' ? 'return' : 'outbound'
  let progressMax = 0
  // Rolling counters updated per completed API call (fires before onChunk).
  let rawOptionsAcc = 0
  let withTokenAcc = 0
  const onQueryDone = (q: SerpSearchDebugQuery) => {
    const opts = collectAllSerpOptions(q.response)
    rawOptionsAcc += opts.length
    withTokenAcc += opts.filter((o) => !!o.departure_token).length
  }
  const onChunk = (completed: number, total: number) => {
    if (completed > progressMax) {
      progressMax = completed
      onProgress?.({
        phase,
        current: completed,
        total,
        itinerariesFound: rawOptionsAcc > 0 ? rawOptionsAcc : undefined,
        withToken: withTokenAcc > 0 ? withTokenAcc : undefined,
      })
    }
  }
  const [priceQueries, durationQueries] = await Promise.all([
    fetchGoogleFlightsByDates(dates, dep, arr, input, 'price', onChunk, onQueryDone),
    fetchGoogleFlightsByDates(dates, dep, arr, input, 'duration', onChunk, onQueryDone),
  ])

  let serpOptionRows = 0
  const perDate: PriceWindowPerDateEntry[] = dates.map((date, i) => {
    const pResp = priceQueries[i].response
    const dResp = durationQueries[i].response
    if (pResp.error || pResp.search_metadata?.status === 'Error') {
      throw new Error(pResp.error || 'SerpApi search error')
    }
    if (dResp.error || dResp.search_metadata?.status === 'Error') {
      throw new Error(dResp.error || 'SerpApi search error')
    }
    serpOptionRows += collectAllSerpOptions(pResp).length + collectAllSerpOptions(dResp).length
    const fromPrice = processSerpResponse(pResp, { ...ctx, direction }, ctx.excludedAirports, 'price')
    const fromDuration = processSerpResponse(dResp, { ...ctx, direction }, ctx.excludedAirports, 'price')
    // Union with price-first dedup so shared flights keep their price entry
    const merged = dedupeByScheduleKey([...fromPrice, ...fromDuration])
    return { date, itineraries: merged }
  })

  const itineraries = mergePerDateUnique(
    perDate.map((e) => e.itineraries),
    input.perDateLimit,
    ctx.sort,
  )
  return {
    itineraries,
    perDate,
    meta: { serpOptionRows, mergedItineraries: itineraries.length },
    serpDebug: { direction, queries: [...priceQueries, ...durationQueries] },
  }
}
