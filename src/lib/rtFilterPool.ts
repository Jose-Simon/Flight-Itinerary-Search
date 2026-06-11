import {
  itineraryScheduleKey,
  passesAircraftFilter,
  passesAirlineResultFilter,
  passesItineraryFilters,
  type AircraftMatchMode,
  type FilterState,
} from './filters'
import { passesTimeBucketFilter, type TimeOfDayBucket } from './timeBuckets'
import { passesLandingTimeRange, passesTakeoffTimeRange } from './timeRangeFilter'
import { makeRouteGroupKey } from './routeGrouping'
import { roundTripPairCellKey, type RoundTripPairDeepenState, type RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import type { NormalizedItinerary } from './types'

/** Options shared with {@link import('./roundTripPricing').filterRoundTripCombos}. */
export type RtLegFilterOpts = {
  filterOut: FilterState
  filterRet: FilterState
  airlineExcludedCodes: Set<string>
  aircraftFilterSet: Set<string>
  aircraftMatchMode: AircraftMatchMode
  timeBucketsOut: Set<TimeOfDayBucket>
  timeBucketsRet: Set<TimeOfDayBucket>
  tzByIata: Map<string, string>
  outTakeoffMin: number | null
  outTakeoffMax: number | null
  outLandingMin: number | null
  outLandingMax: number | null
  retTakeoffMin: number | null
  retTakeoffMax: number | null
  retLandingMin: number | null
  retLandingMax: number | null
}

export function rankedItinerariesByRoute(
  ranked: { it: NormalizedItinerary; token: string }[],
): Map<string, NormalizedItinerary[]> {
  const byRoute = new Map<string, NormalizedItinerary[]>()
  for (const { it } of ranked) {
    const rk = makeRouteGroupKey(it)
    const list = byRoute.get(rk)
    if (list) list.push(it)
    else byRoute.set(rk, [it])
  }
  return byRoute
}

/** One route→itineraries map per date pair (reuse when filtering many pairs). */
export function buildDeepenRouteIndexByCell(
  deepenStates: RoundTripPairDeepenState[],
): Map<string, Map<string, NormalizedItinerary[]>> {
  const out = new Map<string, Map<string, NormalizedItinerary[]>>()
  for (const s of deepenStates) {
    out.set(roundTripPairCellKey(s.outDate, s.retDate), rankedItinerariesByRoute(s.ranked))
  }
  return out
}

export function dedupeRtPoolItineraries(list: NormalizedItinerary[]): NormalizedItinerary[] {
  const seen = new Set<string>()
  const out: NormalizedItinerary[] = []
  for (const it of list) {
    const k = itineraryScheduleKey(it)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

/** Outbound + return legs from in-flight RT scan (ranked summaries and deepened combos). */
export function buildRtFilterPool(
  deepenStates: RoundTripPairDeepenState[],
  combos: RoundTripCombo[],
): { outbound: NormalizedItinerary[]; return: NormalizedItinerary[] } {
  const out: NormalizedItinerary[] = []
  const ret: NormalizedItinerary[] = []
  for (const s of deepenStates) {
    for (const { it } of s.ranked) out.push(it)
  }
  for (const c of combos) {
    out.push(c.outIt)
    ret.push(c.retIt)
  }
  return {
    outbound: dedupeRtPoolItineraries(out),
    return: dedupeRtPoolItineraries(ret),
  }
}

/**
 * Slim pool for sidebar histograms: combo legs, deepened ranked rows, and one
 * cheapest token-ranked outbound per route (not every ranked row × date pair).
 */
export function buildRtFilterDistributionPool(
  deepenStates: RoundTripPairDeepenState[],
  combos: RoundTripCombo[],
): { outbound: NormalizedItinerary[]; return: NormalizedItinerary[] } {
  const seenOut = new Set<string>()
  const seenRet = new Set<string>()
  const out: NormalizedItinerary[] = []
  const ret: NormalizedItinerary[] = []
  const pushOut = (it: NormalizedItinerary) => {
    const k = itineraryScheduleKey(it)
    if (seenOut.has(k)) return
    seenOut.add(k)
    out.push(it)
  }
  const pushRet = (it: NormalizedItinerary) => {
    const k = itineraryScheduleKey(it)
    if (seenRet.has(k)) return
    seenRet.add(k)
    ret.push(it)
  }

  for (const c of combos) {
    pushOut(c.outIt)
    pushRet(c.retIt)
  }

  const cheapestTokenByRoute = new Map<string, NormalizedItinerary>()
  for (const state of deepenStates) {
    for (let i = 0; i < state.fetchedCount; i++) {
      const row = state.ranked[i]
      if (row?.it) pushOut(row.it)
    }
    for (const { it, token } of state.ranked) {
      if (!token?.trim()) continue
      const rk = makeRouteGroupKey(it)
      const p = it.price ?? Infinity
      const prev = cheapestTokenByRoute.get(rk)
      if (!prev || (prev.price ?? Infinity) > p) cheapestTokenByRoute.set(rk, it)
    }
  }
  for (const it of cheapestTokenByRoute.values()) pushOut(it)

  return { outbound: out, return: ret }
}

/** Index deepen states by outbound date (faster cell option lists). */
export function buildDeepenStatesByOutDate(
  deepenStates: RoundTripPairDeepenState[],
): Map<string, RoundTripPairDeepenState[]> {
  const byOut = new Map<string, RoundTripPairDeepenState[]>()
  for (const s of deepenStates) {
    const list = byOut.get(s.outDate)
    if (list) list.push(s)
    else byOut.set(s.outDate, [s])
  }
  return byOut
}

export function passesRtOutboundLegFilter(it: NormalizedItinerary, opts: RtLegFilterOpts): boolean {
  return (
    passesItineraryFilters(it, opts.filterOut) &&
    passesAirlineResultFilter(it, opts.airlineExcludedCodes) &&
    passesAircraftFilter(it, opts.aircraftFilterSet, opts.aircraftMatchMode) &&
    passesTimeBucketFilter(it, opts.timeBucketsOut, opts.tzByIata) &&
    passesTakeoffTimeRange(it, opts.outTakeoffMin, opts.outTakeoffMax, opts.tzByIata) &&
    passesLandingTimeRange(it, opts.outLandingMin, opts.outLandingMax, opts.tzByIata)
  )
}

export function passesRtReturnLegFilter(it: NormalizedItinerary, opts: RtLegFilterOpts): boolean {
  return (
    passesItineraryFilters(it, opts.filterRet) &&
    passesAirlineResultFilter(it, opts.airlineExcludedCodes) &&
    passesAircraftFilter(it, opts.aircraftFilterSet, opts.aircraftMatchMode) &&
    passesTimeBucketFilter(it, opts.timeBucketsRet, opts.tzByIata) &&
    passesTakeoffTimeRange(it, opts.retTakeoffMin, opts.retTakeoffMax, opts.tzByIata) &&
    passesLandingTimeRange(it, opts.retLandingMin, opts.retLandingMax, opts.tzByIata)
  )
}

/** Single pass over ranked outbounds — faster than building a full route→itineraries map. */
function outboundRoutesPassingFilters(
  deepen: RoundTripPairDeepenState,
  opts: RtLegFilterOpts,
): Set<string> {
  const allowed = new Set<string>()
  for (const { it } of deepen.ranked) {
    const rk = makeRouteGroupKey(it)
    if (allowed.has(rk)) continue
    if (passesRtOutboundLegFilter(it, opts)) allowed.add(rk)
  }
  for (const c of deepen.combos) {
    if (c.outDate !== deepen.outDate || c.retDate !== deepen.retDate) continue
    if (!passesRtOutboundLegFilter(c.outIt, opts)) continue
    if (!passesRtReturnLegFilter(c.retIt, opts)) continue
    allowed.add(c.routeKey)
  }
  return allowed
}

/** Route keys on a date pair that pass current filters (outbound summary and/or deepened combos). */
export function allowedRouteKeysForPair(
  meta: RoundTripPairMeta,
  deepen: RoundTripPairDeepenState | undefined,
  opts: RtLegFilterOpts,
  routeIndex?: Map<string, NormalizedItinerary[]>,
): Set<string> {
  const allowed = new Set<string>()
  if (deepen) {
    const passing =
      routeIndex && deepen.ranked.length > 0
        ? (() => {
            const out = new Set<string>()
            for (const rk of Object.keys(meta.initialMinByRoute)) {
              const its = routeIndex.get(rk)
              if (its?.some((it) => passesRtOutboundLegFilter(it, opts))) out.add(rk)
            }
            for (const c of deepen.combos) {
              if (c.outDate !== meta.outDate || c.retDate !== meta.retDate) continue
              if (!passesRtOutboundLegFilter(c.outIt, opts)) continue
              if (!passesRtReturnLegFilter(c.retIt, opts)) continue
              out.add(c.routeKey)
            }
            return out
          })()
        : outboundRoutesPassingFilters(deepen, opts)
    for (const rk of passing) {
      if (rk in meta.initialMinByRoute) allowed.add(rk)
    }
  }
  if (allowed.size === 0) return allowed
  const filtered = new Set<string>()
  for (const rk of Object.keys(meta.initialMinByRoute)) {
    if (allowed.has(rk)) filtered.add(rk)
  }
  return filtered
}

export function filterPairMetaForDisplay(
  meta: RoundTripPairMeta,
  deepen: RoundTripPairDeepenState | undefined,
  opts: RtLegFilterOpts,
): RoundTripPairMeta {
  const hasDeepenPayload = Boolean(deepen && (deepen.ranked.length > 0 || deepen.combos.length > 0))
  if (!hasDeepenPayload) {
    if (deepen && Object.keys(meta.initialMinByRoute).length > 0) {
      return { ...meta, initialMinByRoute: {}, globalInitialMin: null }
    }
    return meta
  }
  const allowed = allowedRouteKeysForPair(meta, deepen, opts)
  if (allowed.size === 0) {
    return { ...meta, initialMinByRoute: {}, globalInitialMin: null }
  }
  const initialMinByRoute: Record<string, number> = {}
  let globalInitialMin = Infinity
  for (const [rk, p] of Object.entries(meta.initialMinByRoute)) {
    if (!allowed.has(rk) || p <= 0) continue
    initialMinByRoute[rk] = p
    globalInitialMin = Math.min(globalInitialMin, p)
  }
  return {
    ...meta,
    initialMinByRoute,
    globalInitialMin: globalInitialMin < Infinity ? globalInitialMin : null,
  }
}

export function filterPairMetaListForDisplay(
  metaList: RoundTripPairMeta[],
  deepenStates: RoundTripPairDeepenState[],
  opts: RtLegFilterOpts,
): RoundTripPairMeta[] {
  const deepenByKey = new Map(
    deepenStates.map((s) => [roundTripPairCellKey(s.outDate, s.retDate), s]),
  )
  return metaList.map((meta) =>
    filterPairMetaForDisplay(meta, deepenByKey.get(roundTripPairCellKey(meta.outDate, meta.retDate)), opts),
  )
}

/** Unfetched ranked outbounds on a pair that pass current outbound leg filters. */
export function pendingFilteredRankedCount(
  deepen: RoundTripPairDeepenState,
  opts: RtLegFilterOpts,
): number {
  let n = 0
  for (let i = deepen.fetchedCount; i < deepen.ranked.length; i++) {
    if (passesRtOutboundLegFilter(deepen.ranked[i].it, opts)) n++
  }
  return n
}

/** Put filter-passing unfetched outbounds first so deepen batches target visible routes. */
export function reorderDeepenStateForLegFilters(
  deepen: RoundTripPairDeepenState,
  opts: RtLegFilterOpts,
): RoundTripPairDeepenState {
  const prefix = deepen.ranked.slice(0, deepen.fetchedCount)
  const tail = deepen.ranked.slice(deepen.fetchedCount)
  const passing = tail.filter((r) => passesRtOutboundLegFilter(r.it, opts))
  const rest = tail.filter((r) => !passesRtOutboundLegFilter(r.it, opts))
  passing.sort((a, b) => (a.it.price ?? Infinity) - (b.it.price ?? Infinity))
  return { ...deepen, ranked: [...prefix, ...passing, ...rest] }
}

export type FilteredReturnDeepenPair = {
  meta: RoundTripPairMeta
  deepen: RoundTripPairDeepenState
}

/** Date pairs visible on the filtered heatmap that still need return fetches for filter-passing outbounds. */
export function eligiblePairsForFilteredReturnDeepen(
  filteredMetaList: RoundTripPairMeta[],
  deepenStates: RoundTripPairDeepenState[],
  opts: RtLegFilterOpts,
): FilteredReturnDeepenPair[] {
  const deepenByKey = new Map(
    deepenStates.map((s) => [roundTripPairCellKey(s.outDate, s.retDate), s]),
  )
  const out: FilteredReturnDeepenPair[] = []
  for (const meta of filteredMetaList) {
    if (meta.globalInitialMin == null || meta.globalInitialMin <= 0) continue
    const deepen = deepenByKey.get(roundTripPairCellKey(meta.outDate, meta.retDate))
    if (!deepen || pendingFilteredRankedCount(deepen, opts) <= 0) continue
    out.push({ meta, deepen })
  }
  return out.sort((a, b) => (a.meta.globalInitialMin ?? Infinity) - (b.meta.globalInitialMin ?? Infinity))
}

/** Baseline min across filtered heatmap cells (and optional $ override) for optional ±% band. */
export function filteredHeatmapBaselineMin(
  visibleMeta: RoundTripPairMeta[],
  filteredCombos: RoundTripCombo[],
  baselineOverride: number,
): number | null {
  let min = Infinity
  for (const m of visibleMeta) {
    const p = m.globalInitialMin
    if (p != null && p > 0) min = Math.min(min, p)
  }
  for (const c of filteredCombos) {
    if (c.roundTripPrice > 0) min = Math.min(min, c.roundTripPrice)
  }
  if (baselineOverride > 0) min = Math.min(min, baselineOverride)
  return min < Infinity ? min : null
}
