import { lookupVerificationRow } from '../db/priceVerificationRepo'
import { minPriceForOutboundScheduleOnPair, type PriceOverrideMap } from './priceOverrides'
import {
  dedupeByScheduleKey,
  dedupeByScheduleKeyKeepMinPrice,
  itineraryScheduleKey,
  passesAirlineResultFilter,
  passesAircraftFilter,
  passesItineraryFilters,
  type AircraftMatchMode,
  type FilterState,
} from './filters'
import { passesTimeBucketFilter, type TimeOfDayBucket } from './timeBuckets'
import { passesLandingTimeRange, passesTakeoffTimeRange } from './timeRangeFilter'
import {
  makeRouteGroupKey,
  reverseRouteKey,
  type PriceWindowResult,
  type RouteDateBucket,
} from './routeGrouping'
import { routeKeysFromPairMeta, type RoundTripPairDeepenState, type RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import type { NormalizedItinerary } from './types'

function addItineraryToBucket(
  map: Map<string, Map<string, RouteDateBucket>>,
  routeKey: string,
  date: string,
  it: NormalizedItinerary,
) {
  if (!map.has(routeKey)) map.set(routeKey, new Map())
  const dateMap = map.get(routeKey)!
  const existing = dateMap.get(date)
  if (!existing) {
    dateMap.set(date, { minPrice: it.price ?? Infinity, bestItinerary: it, allItineraries: [it] })
    return
  }
  existing.allItineraries.push(it)
  const p = it.price ?? Infinity
  if (p < existing.minPrice) {
    existing.minPrice = p
    existing.bestItinerary = it
  }
}

/** Empty route grids with date axes only (heatmap prices come from pairMeta). */
export function buildPriceWindowShellFromPairMeta(pairs: RoundTripPairMeta[]): {
  outResult: PriceWindowResult
  retResult: PriceWindowResult
} {
  const outDates = [...new Set(pairs.map((p) => p.outDate))].sort()
  const retDates = [...new Set(pairs.map((p) => p.retDate))].sort()
  const routeKeyOrder = routeKeysFromPairMeta(pairs)
  const empty: PriceWindowResult = {
    dates: [],
    globalMinByDate: new Map(),
    globalTopRoutesByDate: new Map(),
    perRouteByDate: new Map(),
    routeKeyOrder: [],
  }
  return {
    outResult: { ...empty, dates: outDates, routeKeyOrder },
    retResult: { ...empty, dates: retDates, routeKeyOrder: routeKeyOrder.map(reverseRouteKey) },
  }
}

/** Build heatmap / price-window views from bundled round-trip combos. */
export function buildPriceWindowFromRoundTripCombos(combos: RoundTripCombo[]): {
  outResult: PriceWindowResult
  retResult: PriceWindowResult
} {
  const outPerRoute = new Map<string, Map<string, RouteDateBucket>>()
  const retPerRoute = new Map<string, Map<string, RouteDateBucket>>()
  const outDates = new Set<string>()
  const retDates = new Set<string>()

  for (const c of combos) {
    outDates.add(c.outDate)
    retDates.add(c.retDate)
    const outLeg = { ...c.outIt, price: c.roundTripPrice }
    const retLeg = { ...c.retIt, price: c.roundTripPrice }
    addItineraryToBucket(outPerRoute, c.routeKey, c.outDate, outLeg)
    addItineraryToBucket(retPerRoute, makeRouteGroupKey(c.retIt), c.retDate, retLeg)
  }

  for (const dateMap of outPerRoute.values()) {
    for (const bucket of dateMap.values()) {
      bucket.allItineraries = dedupeByScheduleKey(bucket.allItineraries)
      bucket.allItineraries.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
      bucket.minPrice = bucket.allItineraries[0]?.price ?? bucket.minPrice
      bucket.bestItinerary = bucket.allItineraries[0] ?? bucket.bestItinerary
    }
  }
  for (const dateMap of retPerRoute.values()) {
    for (const bucket of dateMap.values()) {
      bucket.allItineraries = dedupeByScheduleKey(bucket.allItineraries)
      bucket.allItineraries.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
      bucket.minPrice = bucket.allItineraries[0]?.price ?? bucket.minPrice
      bucket.bestItinerary = bucket.allItineraries[0] ?? bucket.bestItinerary
    }
  }

  const buildResult = (
    perRouteByDate: Map<string, Map<string, RouteDateBucket>>,
    dates: string[],
  ): PriceWindowResult => {
    const globalMin = new Map<string, number>()
    for (const date of dates) {
      let min = Infinity
      for (const dateMap of perRouteByDate.values()) {
        const p = dateMap.get(date)?.minPrice
        if (p != null && p < min) min = p
      }
      if (min < Infinity) globalMin.set(date, min)
    }
    const routeOverallMin = new Map<string, number>()
    for (const [routeKey, dateMap] of perRouteByDate) {
      let min = Infinity
      for (const { minPrice } of dateMap.values()) {
        if (minPrice < min) min = minPrice
      }
      routeOverallMin.set(routeKey, min)
    }
    const routeKeyOrder = [...perRouteByDate.keys()].sort(
      (a, b) => (routeOverallMin.get(a) ?? Infinity) - (routeOverallMin.get(b) ?? Infinity),
    )
    return {
      dates,
      globalMinByDate: globalMin,
      globalTopRoutesByDate: new Map(),
      perRouteByDate,
      routeKeyOrder,
    }
  }

  const outDateList = [...outDates].sort()
  const retDateList = [...retDates].sort()

  return {
    outResult: buildResult(outPerRoute, outDateList),
    retResult: buildResult(retPerRoute, retDateList),
  }
}

function mergeRouteDateBucket(a: RouteDateBucket, b: RouteDateBucket): RouteDateBucket {
  const allItineraries = dedupeByScheduleKey([...a.allItineraries, ...b.allItineraries])
  allItineraries.sort((x, y) => (x.price ?? Infinity) - (y.price ?? Infinity))
  const best = allItineraries[0] ?? a.bestItinerary
  const minPrice = Math.min(a.minPrice, b.minPrice, best.price ?? Infinity)
  return { minPrice, bestItinerary: best, allItineraries }
}

/** Keep full pair-meta route list; overlay deepened combo buckets where present. */
export function mergePriceWindowResults(
  base: PriceWindowResult,
  overlay: PriceWindowResult,
): PriceWindowResult {
  const dates = [...new Set([...base.dates, ...overlay.dates])].sort()
  const routeKeyOrder = [...base.routeKeyOrder]
  const seen = new Set(routeKeyOrder)
  for (const rk of overlay.routeKeyOrder) {
    if (!seen.has(rk)) {
      routeKeyOrder.push(rk)
      seen.add(rk)
    }
  }

  const perRouteByDate = new Map<string, Map<string, RouteDateBucket>>()
  for (const rk of routeKeyOrder) {
    const mergedDates = new Map<string, RouteDateBucket>()
    const baseMap = base.perRouteByDate.get(rk)
    const overlayMap = overlay.perRouteByDate.get(rk)
    if (baseMap) {
      for (const [d, bucket] of baseMap) {
        mergedDates.set(d, {
          minPrice: bucket.minPrice,
          bestItinerary: bucket.bestItinerary,
          allItineraries: [...bucket.allItineraries],
        })
      }
    }
    if (overlayMap) {
      for (const [d, bucket] of overlayMap) {
        const prev = mergedDates.get(d)
        mergedDates.set(d, prev ? mergeRouteDateBucket(prev, bucket) : {
          minPrice: bucket.minPrice,
          bestItinerary: bucket.bestItinerary,
          allItineraries: [...bucket.allItineraries],
        })
      }
    }
    if (mergedDates.size > 0) perRouteByDate.set(rk, mergedDates)
  }

  const globalMinByDate = new Map<string, number>()
  for (const date of dates) {
    let min = Infinity
    for (const dateMap of perRouteByDate.values()) {
      const p = dateMap.get(date)?.minPrice
      if (p != null && p < min) min = p
    }
    if (min < Infinity) globalMinByDate.set(date, min)
  }

  return {
    dates,
    globalMinByDate,
    globalTopRoutesByDate: overlay.globalTopRoutesByDate.size
      ? overlay.globalTopRoutesByDate
      : base.globalTopRoutesByDate,
    perRouteByDate,
    routeKeyOrder,
  }
}

/** Return route rows that pair with a selected outbound route (from deepened combos). */
export function returnRouteKeysForOutbound(
  outboundRouteKey: string,
  combos: RoundTripCombo[] | null | undefined,
  fallbackOrder: string[],
  outboundDate?: string | null,
): string[] {
  const keys = new Set<string>()
  if (combos?.length) {
    for (const c of combos) {
      if (c.routeKey !== outboundRouteKey) continue
      if (outboundDate && c.outDate !== outboundDate) continue
      keys.add(makeRouteGroupKey(c.retIt))
    }
  }
  if (keys.size > 0) {
    const mins = new Map<string, number>()
    for (const k of keys) mins.set(k, Infinity)
    for (const c of combos!) {
      if (c.routeKey !== outboundRouteKey) continue
      if (outboundDate && c.outDate !== outboundDate) continue
      const rk = makeRouteGroupKey(c.retIt)
      const p = c.roundTripPrice
      if (p > 0 && p < (mins.get(rk) ?? Infinity)) mins.set(rk, p)
    }
    return [...keys].sort((a, b) => (mins.get(a) ?? Infinity) - (mins.get(b) ?? Infinity))
  }
  const rev = reverseRouteKey(outboundRouteKey)
  return fallbackOrder.includes(rev) ? [rev] : []
}

/** Return itinerary options for a cell when an outbound route is selected (combos + bucket). */
export function returnItinerariesForCell(
  outboundRouteKey: string,
  outboundDate: string | undefined,
  retRouteKey: string,
  retDate: string,
  retBucket: RouteDateBucket | undefined,
  combos?: RoundTripCombo[] | null,
): NormalizedItinerary[] {
  const fromCombos: NormalizedItinerary[] = []
  if (combos?.length) {
    for (const c of combos) {
      if (c.routeKey !== outboundRouteKey || c.retDate !== retDate) continue
      if (outboundDate && c.outDate !== outboundDate) continue
      if (makeRouteGroupKey(c.retIt) !== retRouteKey) continue
      fromCombos.push({ ...c.retIt, price: c.roundTripPrice })
    }
  }
  const dedupedCombos = dedupeByScheduleKeyKeepMinPrice(fromCombos)
  if (dedupedCombos.length) {
    dedupedCombos.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    return dedupedCombos
  }
  if (retBucket?.allItineraries.length) {
    return retBucket.allItineraries.filter((it) => makeRouteGroupKey(it) === retRouteKey)
  }
  return []
}

/** Outbound itinerary options for a route+date cell (grid bucket, combos, or initial ranked scan). */
export function outboundItinerariesForCell(
  routeKey: string,
  outDate: string,
  bucket: RouteDateBucket | undefined,
  combos?: RoundTripCombo[] | null,
  deepenStates?: RoundTripPairDeepenState[] | null,
  legFilter?: ((it: NormalizedItinerary) => boolean) | null,
  deepenByOutDate?: Map<string, RoundTripPairDeepenState[]> | null,
): NormalizedItinerary[] {
  const passes = legFilter ?? (() => true)

  if (bucket?.allItineraries.length) {
    const filtered = bucket.allItineraries.filter(passes)
    if (filtered.length) return filtered
    // if filter removes everything fall through to combos/ranked (filter applied there too)
  }
  const fromCombos: NormalizedItinerary[] = []
  if (combos?.length) {
    for (const c of combos) {
      if (c.routeKey === routeKey && c.outDate === outDate) {
        const it = { ...c.outIt, price: c.roundTripPrice }
        if (passes(it)) fromCombos.push(it)
      }
    }
  }
  const dedupedCombos = dedupeByScheduleKeyKeepMinPrice(fromCombos)
  if (dedupedCombos.length) {
    dedupedCombos.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    return dedupedCombos
  }

  const statesForDay = deepenByOutDate?.get(outDate)
  const stateList = statesForDay ?? deepenStates
  if (stateList?.length) {
    const fromRanked: NormalizedItinerary[] = []
    for (const s of stateList) {
      if (!statesForDay && s.outDate !== outDate) continue
      for (const { it } of s.ranked) {
        if (makeRouteGroupKey(it) === routeKey && passes(it)) fromRanked.push(it)
      }
    }
    const deduped = dedupeByScheduleKeyKeepMinPrice(fromRanked)
    deduped.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    return deduped
  }
  return []
}

export function comboScheduleKey(c: RoundTripCombo): string {
  return `${itineraryScheduleKey(c.outIt)}|${itineraryScheduleKey(c.retIt)}`
}

export function minRoundTripForDatePair(
  combos: RoundTripCombo[],
  routeKey: string,
  outDate: string,
  retDate: string,
  verifications: PriceOverrideMap,
  outboundFilter?: (it: NormalizedItinerary) => boolean,
  returnLegFilter?: (it: NormalizedItinerary) => boolean,
): number | null {
  if (retDate <= outDate) return null
  const schedulePrices: number[] = []
  const seenOut = new Set<string>()
  for (const c of combos) {
    if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
    if (outboundFilter && !outboundFilter(c.outIt)) continue
    if (returnLegFilter && !returnLegFilter(c.retIt)) continue
    const outSk = itineraryScheduleKey(c.outIt)
    if (seenOut.has(outSk)) continue
    seenOut.add(outSk)
    const p = minPriceForOutboundScheduleOnPair(
      c.outIt,
      routeKey,
      outDate,
      retDate,
      verifications,
      combos,
      returnLegFilter,
    )
    if (p != null && p > 0) schedulePrices.push(p)
  }
  return schedulePrices.length ? Math.min(...schedulePrices) : null
}

export function minRoundTripForOutboundDate(
  combos: RoundTripCombo[],
  routeKey: string,
  outDate: string,
  verifications: PriceOverrideMap,
): number | null {
  let min = Infinity
  for (const c of combos) {
    if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate <= outDate) continue
    const row = lookupVerificationRow(verifications, routeKey, c.outIt, c.retIt)
    const p =
      row?.verifiedPrice != null && row.verifiedPrice > 0 ? row.verifiedPrice : c.roundTripPrice
    if (p > 0 && p < min) min = p
  }
  return min < Infinity ? min : null
}

export function allRoundTripCombosForRoute(combos: RoundTripCombo[], routeKey: string): RoundTripCombo[] {
  return combos.filter((c) => c.routeKey === routeKey)
}

export function routeKeyForCombo(c: RoundTripCombo): string {
  return makeRouteGroupKey(c.outIt)
}

export function filterRoundTripCombos(
  combos: RoundTripCombo[],
  opts: {
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
  },
): RoundTripCombo[] {
  return combos.filter(
    (c) =>
      passesItineraryFilters(c.outIt, opts.filterOut) &&
      passesItineraryFilters(c.retIt, opts.filterRet) &&
      passesAirlineResultFilter(c.outIt, opts.airlineExcludedCodes) &&
      passesAirlineResultFilter(c.retIt, opts.airlineExcludedCodes) &&
      passesAircraftFilter(c.outIt, opts.aircraftFilterSet, opts.aircraftMatchMode) &&
      passesAircraftFilter(c.retIt, opts.aircraftFilterSet, opts.aircraftMatchMode) &&
      passesTimeBucketFilter(c.outIt, opts.timeBucketsOut, opts.tzByIata) &&
      passesTimeBucketFilter(c.retIt, opts.timeBucketsRet, opts.tzByIata) &&
      passesTakeoffTimeRange(
        c.outIt,
        opts.outTakeoffMin,
        opts.outTakeoffMax,
        opts.tzByIata,
      ) &&
      passesLandingTimeRange(
        c.outIt,
        opts.outLandingMin,
        opts.outLandingMax,
        opts.tzByIata,
      ) &&
      passesTakeoffTimeRange(
        c.retIt,
        opts.retTakeoffMin,
        opts.retTakeoffMax,
        opts.tzByIata,
      ) &&
      passesLandingTimeRange(
        c.retIt,
        opts.retLandingMin,
        opts.retLandingMax,
        opts.tzByIata,
      ),
  )
}
