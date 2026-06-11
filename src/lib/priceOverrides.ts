import {
  legVerificationKey,
  legVerificationKeyBase,
  lookupVerificationRow,
  stripLegMeta,
  type PriceVerificationRow,
} from '../db/priceVerificationRepo'
import { itineraryScheduleKey } from './filters'
import { makeRouteGroupKey, reverseRouteKey, type PriceWindowResult } from './routeGrouping'
import { minRoundTripForDatePair } from './roundTripPricing'
import { type RoundTripPairDeepenState, type RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import type { NormalizedItinerary } from './types'
import {
  maxTokenRouteFallback,
  maxTokenRouteOnOutboundDay,
  maxTokenRouteOtherOutboundDays,
  routeHasTokenOnPair,
  tokenRoutePriceForPair,
  tokenRoutePriceFromIndex,
  type RtTokenPriceIndex,
  type TokenRoutePriceSource,
} from './rtTokenRoutePrice'

export type ResolvedRoundTripSelection = {
  bestRetDate: string
  bestRetIt: NormalizedItinerary | null
  bundledPrice: number | null
  combo: RoundTripCombo | null
}

export type PriceOverrideMap = Map<string, PriceVerificationRow>

export type OutboundLegFilter = (it: NormalizedItinerary) => boolean
export type ReturnLegFilter = OutboundLegFilter

/** Active price-window search calendar (outbound + return columns). */
export type PriceWindowDateBounds = {
  outboundStart: string
  outboundEnd: string
  returnStart: string
  returnEnd: string
}

export function isOutboundDateInBounds(
  outDate: string,
  bounds?: PriceWindowDateBounds | null,
): boolean {
  if (!bounds) return true
  return outDate >= bounds.outboundStart && outDate <= bounds.outboundEnd
}

export function isReturnDateInBounds(
  retDate: string,
  outDate: string,
  bounds?: PriceWindowDateBounds | null,
): boolean {
  if (retDate <= outDate) return false
  if (!bounds) return true
  return retDate >= bounds.returnStart && retDate <= bounds.returnEnd
}

export function isDatePairInBounds(
  outDate: string,
  retDate: string,
  bounds?: PriceWindowDateBounds | null,
): boolean {
  return isOutboundDateInBounds(outDate, bounds) && isReturnDateInBounds(retDate, outDate, bounds)
}

export type SerpScanPriceSource = TokenRoutePriceSource

/**
 * Token-backed RT price for this airline/route on (out, ret).
 * No departure_token on this route → null (cell stays blank unless combos/verify).
 */
export function serpScanPriceForRoute(
  routeKey: string,
  outDate: string,
  retDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripCombos?: RoundTripCombo[] | null,
  tokenIndex?: RtTokenPriceIndex | null,
): { price: number; source: SerpScanPriceSource } | null {
  return tokenRoutePriceForPair(
    routeKey,
    outDate,
    retDate,
    deepenStates,
    dateBounds,
    roundTripCombos,
    tokenIndex,
  )
}

export function scanPriceForRouteOnPair(
  routeKey: string,
  outDate: string,
  retDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null | undefined,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripCombos?: RoundTripCombo[] | null,
  outboundFilter?: OutboundLegFilter,
  verifications?: PriceOverrideMap,
  returnLegFilter?: ReturnLegFilter,
): number | null {
  if (outboundFilter) {
    return filteredDirectSerpPriceForRouteOnPair(
      routeKey,
      outDate,
      retDate,
      deepenStates,
      roundTripCombos,
      outboundFilter,
      verifications,
      returnLegFilter,
    )
  }
  return serpScanPriceForRoute(routeKey, outDate, retDate, deepenStates, dateBounds, roundTripCombos)?.price ?? null
}

/** Bundled RT for one outbound schedule — verification wins over stale token `it.price`. */
function effectiveBundledPriceForOutboundOnPair(
  outIt: NormalizedItinerary,
  routeKey: string,
  outDate: string,
  retDate: string,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  fallbackPrice?: number | null,
): number | null {
  const outSk = itineraryScheduleKey(outIt)
  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      if (itineraryScheduleKey(c.outIt) !== outSk) continue
      return effectiveCombinedPrice(c.outIt, c.retIt, verifications, routeKey, c.roundTripPrice)
    }
  }
  const outKey = legVerificationKey(outIt)
  for (const row of verifiedRowsForDatePair(verifications, routeKey, outDate, retDate)) {
    if (row.outDepTime === outKey && row.verifiedPrice > 0) return row.verifiedPrice
  }
  const p = fallbackPrice ?? outIt.price ?? null
  return p != null && p > 0 ? p : null
}

/** Direct token/combo prices on this pair that pass the outbound leg filter (no imputation). */
export function filteredDirectSerpPriceForRouteOnPair(
  routeKey: string,
  outDate: string,
  retDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  roundTripCombos?: RoundTripCombo[] | null,
  outboundFilter?: OutboundLegFilter,
  verifications?: PriceOverrideMap,
  returnLegFilter?: ReturnLegFilter,
): number | null {
  const overrides = verifications ?? new Map()
  let min = Infinity
  const state = deepenStates?.find((s) => s.outDate === outDate && s.retDate === retDate)
  if (state) {
    for (const { it, token } of state.ranked) {
      if (!token?.trim()) continue
      if (makeRouteGroupKey(it) !== routeKey) continue
      if (outboundFilter && !outboundFilter(it)) continue
      const p = effectiveBundledPriceForOutboundOnPair(
        it,
        routeKey,
        outDate,
        retDate,
        overrides,
        roundTripCombos,
        it.price,
      )
      if (p != null && p > 0) min = Math.min(min, p)
    }
  }
  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      if (outboundFilter && !outboundFilter(c.outIt)) continue
      if (returnLegFilter && !returnLegFilter(c.retIt)) continue
      const p = effectiveCombinedPrice(c.outIt, c.retIt, overrides, routeKey, c.roundTripPrice)
      if (p > 0) min = Math.min(min, p)
    }
  }
  return min < Infinity ? min : null
}

/** Token/combo RT price for one exact outbound schedule on a date pair. */
export function minTokenPriceForScheduleOnPair(
  outIt: NormalizedItinerary,
  routeKey: string,
  outDate: string,
  retDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  roundTripCombos?: RoundTripCombo[] | null,
  verifications?: PriceOverrideMap,
): number | null {
  const outSk = itineraryScheduleKey(outIt)
  let min = Infinity
  const state = deepenStates?.find((s) => s.outDate === outDate && s.retDate === retDate)
  if (state) {
    for (const { it, token } of state.ranked) {
      if (!token?.trim()) continue
      if (makeRouteGroupKey(it) !== routeKey) continue
      if (itineraryScheduleKey(it) !== outSk) continue
      const p = effectiveBundledPriceForOutboundOnPair(
        it,
        routeKey,
        outDate,
        retDate,
        verifications ?? new Map(),
        roundTripCombos,
        it.price,
      )
      if (p != null && p > 0) min = Math.min(min, p)
    }
  }
  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      if (itineraryScheduleKey(c.outIt) !== outSk) continue
      const p = effectiveCombinedPrice(
        c.outIt,
        c.retIt,
        verifications ?? new Map(),
        routeKey,
        c.roundTripPrice,
      )
      if (p > 0) min = Math.min(min, p)
    }
  }
  return min < Infinity ? min : null
}

export function filterRoundTripCombosToBounds(
  combos: RoundTripCombo[],
  bounds: PriceWindowDateBounds,
): RoundTripCombo[] {
  return combos.filter((c) => isDatePairInBounds(c.outDate, c.retDate, bounds))
}

export function filterPairMetaListToBounds(
  meta: RoundTripPairMeta[],
  bounds: PriceWindowDateBounds,
): RoundTripPairMeta[] {
  return meta.filter((m) => isDatePairInBounds(m.outDate, m.retDate, bounds))
}

export function firstDepTime(it: NormalizedItinerary): string {
  return it.segments[0]?.depTime?.trim() ?? ''
}

/** Lookup override by exact itinerary pair (stored separately from SerpApi cache). */
export function lookupVerification(
  verifications: PriceOverrideMap,
  routeKey: string,
  outIt: NormalizedItinerary,
  retIt: NormalizedItinerary,
): PriceVerificationRow | undefined {
  return lookupVerificationRow(verifications, routeKey, outIt, retIt)
}

/** Combined round-trip price: override wins, then bundled RT fare, else leg sums. */
export function effectiveCombinedPrice(
  outIt: NormalizedItinerary,
  retIt: NormalizedItinerary,
  verifications: PriceOverrideMap,
  routeKey: string,
  roundTripPrice?: number,
): number {
  const row = lookupVerification(verifications, routeKey, outIt, retIt)
  if (row?.verifiedPrice != null && Number.isFinite(row.verifiedPrice) && row.verifiedPrice > 0) {
    return row.verifiedPrice
  }
  if (roundTripPrice != null && roundTripPrice > 0) return roundTripPrice
  return (outIt.price ?? 0) + (retIt.price ?? 0)
}

export function cacheCombinedPrice(outIt: NormalizedItinerary, retIt: NormalizedItinerary): number {
  return (outIt.price ?? 0) + (retIt.price ?? 0)
}

/** Best return date + bundled fare for an outbound cell (matches grid pricing). */
export function resolveRoundTripSelection(opts: {
  routeKey: string
  outDate: string
  outIt: NormalizedItinerary
  outResult: PriceWindowResult
  retResult: PriceWindowResult
  verifications: PriceOverrideMap
  roundTripCombos?: RoundTripCombo[] | null
  roundTripPairMeta?: Map<string, RoundTripPairMeta> | null
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null
  selectedReturnDate?: string | null
  selectedReturnIt?: NormalizedItinerary | null
}): ResolvedRoundTripSelection {
  const {
    routeKey,
    outDate,
    outIt,
    outResult,
    retResult,
    verifications,
    roundTripCombos,
    roundTripPairMeta,
    roundTripDeepenStates,
    selectedReturnDate,
    selectedReturnIt,
  } = opts

  const outSk = itineraryScheduleKey(outIt)
  const combosForOut =
    roundTripCombos?.filter(
      (c) =>
        c.routeKey === routeKey &&
        c.outDate === outDate &&
        c.retDate > outDate &&
        itineraryScheduleKey(c.outIt) === outSk,
    ) ?? []

  const pickFromCombo = (c: RoundTripCombo): ResolvedRoundTripSelection => ({
    bestRetDate: c.retDate,
    bestRetIt: c.retIt,
    bundledPrice: effectiveCombinedPrice(c.outIt, c.retIt, verifications, routeKey, c.roundTripPrice),
    combo: c,
  })

  if (selectedReturnDate && selectedReturnDate > outDate) {
    const retSk = selectedReturnIt ? itineraryScheduleKey(selectedReturnIt) : null
    const exact =
      combosForOut.find(
        (c) =>
          c.retDate === selectedReturnDate &&
          (retSk == null || itineraryScheduleKey(c.retIt) === retSk),
      ) ?? combosForOut.find((c) => c.retDate === selectedReturnDate)
    if (exact) return pickFromCombo(exact)

    const schedulePrice = minTokenPriceForScheduleOnPair(
      outIt,
      routeKey,
      outDate,
      selectedReturnDate,
      roundTripDeepenStates,
      roundTripCombos,
      verifications,
    )
    if (schedulePrice != null) {
      return {
        bestRetDate: selectedReturnDate,
        bestRetIt: selectedReturnIt ?? null,
        bundledPrice: schedulePrice,
        combo: null,
      }
    }

    const p = minCombinedForDatePair(
      routeKey,
      outDate,
      selectedReturnDate,
      outResult,
      retResult,
      verifications,
      roundTripCombos,
      roundTripPairMeta,
      undefined,
      roundTripDeepenStates,
    )
    return {
      bestRetDate: selectedReturnDate,
      bestRetIt: selectedReturnIt ?? null,
      bundledPrice: p,
      combo: null,
    }
  }

  if (combosForOut.length) {
    const best = combosForOut.reduce((a, b) => (a.roundTripPrice <= b.roundTripPrice ? a : b))
    return pickFromCombo(best)
  }

  let bestRetDate = ''
  let bestPrice = Infinity
  for (const retDate of retResult.dates) {
    if (retDate <= outDate) continue
    const p = minCombinedForDatePair(
      routeKey,
      outDate,
      retDate,
      outResult,
      retResult,
      verifications,
      roundTripCombos,
      roundTripPairMeta,
      undefined,
      roundTripDeepenStates,
    )
    if (p != null && p < bestPrice) {
      bestPrice = p
      bestRetDate = retDate
    }
  }

  if (bestRetDate && bestPrice < Infinity) {
    const anyCombo = roundTripCombos?.find(
      (c) => c.routeKey === routeKey && c.outDate === outDate && c.retDate === bestRetDate,
    )
    if (anyCombo) return pickFromCombo(anyCombo)
    return {
      bestRetDate,
      bestRetIt: null,
      bundledPrice: bestPrice,
      combo: null,
    }
  }

  const fallback = outIt.price != null && outIt.price > 0 ? outIt.price : null
  return { bestRetDate: '', bestRetIt: null, bundledPrice: fallback, combo: null }
}

/** All stored verifications for one route × outbound × return calendar cell. */
export function verifiedRowsForDatePair(
  verifications: PriceOverrideMap,
  routeKey: string,
  outDate: string,
  retDate: string,
): PriceVerificationRow[] {
  const rows: PriceVerificationRow[] = []
  for (const row of verifications.values()) {
    if (row.routeKey === routeKey && row.outDate === outDate && row.retDate === retDate) {
      rows.push(row)
    }
  }
  return rows
}

export function minVerifiedPriceForDatePair(
  verifications: PriceOverrideMap,
  routeKey: string,
  outDate: string,
  retDate: string,
): number | null {
  let min: number | null = null
  for (const row of verifiedRowsForDatePair(verifications, routeKey, outDate, retDate)) {
    if (row.verifiedPrice > 0) {
      min = min == null ? row.verifiedPrice : Math.min(min, row.verifiedPrice)
    }
  }
  return min
}

/** Return dates considered for outbound-column min + tooltip (single source of truth). */
export function retDatesForOutboundMin(
  routeKey: string,
  outDate: string,
  retResult: PriceWindowResult,
  roundTripCombos?: RoundTripCombo[] | null,
  verifications?: PriceOverrideMap,
  _pairMeta?: Map<string, RoundTripPairMeta> | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
): string[] {
  const inWindow = (retDate: string) => isReturnDateInBounds(retDate, outDate, dateBounds)
  const s = new Set<string>()
  const retMap = retResult.perRouteByDate.get(reverseRouteKey(routeKey))
  if (retMap) {
    for (const d of retMap.keys()) {
      if (inWindow(d)) s.add(d)
    }
  }
  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey === routeKey && c.outDate === outDate && inWindow(c.retDate)) s.add(c.retDate)
    }
  }
  if (verifications) {
    for (const row of verifications.values()) {
      if (row.routeKey === routeKey && row.outDate === outDate && inWindow(row.retDate)) {
        s.add(row.retDate)
      }
    }
  }
  if (roundTripDeepenStates?.length || roundTripCombos?.length) {
    const routeMaxOnOut = maxTokenRouteOnOutboundDay(
      routeKey,
      outDate,
      roundTripDeepenStates,
      roundTripCombos,
    )
    const routeMaxOtherOut = maxTokenRouteOtherOutboundDays(
      routeKey,
      outDate,
      roundTripDeepenStates,
      dateBounds,
      roundTripCombos,
    )
    for (const state of roundTripDeepenStates ?? []) {
      if (state.outDate !== outDate || !inWindow(state.retDate)) continue
      if (
        routeHasTokenOnPair(routeKey, state.outDate, state.retDate, roundTripDeepenStates, roundTripCombos)
      ) {
        s.add(state.retDate)
      } else if (routeMaxOnOut != null || routeMaxOtherOut != null) {
        s.add(state.retDate)
      }
    }
  }
  if (s.size === 0) return retResult.dates.filter((d) => inWindow(d))
  return [...s].sort()
}

export type OutboundReturnPriceRow = {
  retDate: string
  combined: number
  /** Return-leg one-way min from cache bucket, if loaded. */
  retLegMin: number | null
}

/** All return-date round-trip options for one outbound cell, cheapest first. */
export function listCombinedPricesForOutbound(
  routeKey: string,
  outDate: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  pairMeta?: Map<string, RoundTripPairMeta> | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
): OutboundReturnPriceRow[] {
  if (!isOutboundDateInBounds(outDate, dateBounds)) return []
  const retMap = retResult.perRouteByDate.get(reverseRouteKey(routeKey))
  const rows: OutboundReturnPriceRow[] = []
  for (const retDate of retDatesForOutboundMin(
    routeKey,
    outDate,
    retResult,
    roundTripCombos,
    verifications,
    pairMeta,
    dateBounds,
    roundTripDeepenStates,
  )) {
    const combined = minCombinedForDatePair(
      routeKey,
      outDate,
      retDate,
      outResult,
      retResult,
      verifications,
      roundTripCombos,
      pairMeta,
      dateBounds,
      roundTripDeepenStates,
    )
    if (combined == null) continue
    rows.push({
      retDate,
      combined,
      retLegMin: retMap?.get(retDate)?.minPrice ?? null,
    })
  }
  rows.sort((a, b) => a.combined - b.combined)
  return rows
}

/** Lowest Serp/bundled fare from loaded itineraries (respects manual verifications). */
export function minItineraryPriceForDatePair(
  routeKey: string,
  outDate: string,
  retDate: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  outboundFilter?: OutboundLegFilter,
  returnLegFilter?: ReturnLegFilter,
): number | null {
  if (retDate <= outDate) return null
  const schedulePrices: number[] = []
  const seenOut = new Set<string>()

  const consider = (outIt: NormalizedItinerary, priceFn: () => number | null) => {
    if (outboundFilter && !outboundFilter(outIt)) return
    const outSk = itineraryScheduleKey(outIt)
    if (seenOut.has(outSk)) return
    seenOut.add(outSk)
    const p = priceFn()
    if (p != null && p > 0) schedulePrices.push(p)
  }

  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      if (returnLegFilter && !returnLegFilter(c.retIt)) continue
      consider(c.outIt, () =>
        minPriceForOutboundScheduleOnPair(
          c.outIt,
          routeKey,
          outDate,
          retDate,
          verifications,
          roundTripCombos,
          returnLegFilter,
        ),
      )
    }
  }

  const ob = outResult.perRouteByDate.get(routeKey)?.get(outDate)
  const rb = retResult.perRouteByDate.get(reverseRouteKey(routeKey))?.get(retDate)
  if (ob && rb) {
    for (const outIt of ob.allItineraries) {
      consider(outIt, () => {
        let min = Infinity
        for (const retIt of rb.allItineraries) {
          if (returnLegFilter && !returnLegFilter(retIt)) continue
          const p = effectiveCombinedPrice(outIt, retIt, verifications, routeKey)
          if (p > 0 && p < min) min = p
        }
        if (min < Infinity) return min
        return minPriceForOutboundScheduleOnPair(
          outIt,
          routeKey,
          outDate,
          retDate,
          verifications,
          roundTripCombos,
          returnLegFilter,
        )
      })
    }
  }

  return schedulePrices.length ? Math.min(...schedulePrices) : null
}

/** Stored verification for this outbound schedule on a calendar pair (any return leg). */
export function verifiedPriceForOutboundScheduleOnPair(
  verifications: PriceOverrideMap,
  routeKey: string,
  outDate: string,
  retDate: string,
  outIt: NormalizedItinerary,
): number | null {
  const outKey = legVerificationKey(outIt)
  const outKeyBase = legVerificationKeyBase(outIt)
  for (const row of verifiedRowsForDatePair(verifications, routeKey, outDate, retDate)) {
    const rowOut = row.outDepTime
    const rowOutBase = stripLegMeta(rowOut)
    if (
      rowOut === outKey ||
      rowOutBase === outKeyBase ||
      stripLegMeta(outKey) === rowOutBase
    ) {
      return row.verifiedPrice > 0 ? row.verifiedPrice : null
    }
  }
  return null
}

/**
 * Best RT price for one outbound schedule on a date pair.
 * Verified fare wins over cheaper alternate return pairings on the same outbound.
 */
export function minPriceForOutboundScheduleOnPair(
  outIt: NormalizedItinerary,
  routeKey: string,
  outDate: string,
  retDate: string,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  returnLegFilter?: ReturnLegFilter,
): number | null {
  const outSk = itineraryScheduleKey(outIt)

  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      if (itineraryScheduleKey(c.outIt) !== outSk) continue
      if (returnLegFilter && !returnLegFilter(c.retIt)) continue
      const row = lookupVerification(verifications, routeKey, c.outIt, c.retIt)
      if (row?.verifiedPrice != null && row.verifiedPrice > 0) return row.verifiedPrice
    }

    let min = Infinity
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      if (itineraryScheduleKey(c.outIt) !== outSk) continue
      if (returnLegFilter && !returnLegFilter(c.retIt)) continue
      const p = effectiveCombinedPrice(c.outIt, c.retIt, verifications, routeKey, c.roundTripPrice)
      if (p > 0) min = Math.min(min, p)
    }
    if (min < Infinity) return min
  } else {
    const verified = verifiedPriceForOutboundScheduleOnPair(
      verifications,
      routeKey,
      outDate,
      retDate,
      outIt,
    )
    if (verified != null) return verified
  }

  return effectiveBundledPriceForOutboundOnPair(
    outIt,
    routeKey,
    outDate,
    retDate,
    verifications,
    roundTripCombos,
    outIt.price,
  )
}

/** Lowest combined price for one outbound × return date pair (all itinerary combos). */
export function minCombinedForDatePair(
  routeKey: string,
  outDate: string,
  retDate: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  _pairMeta?: Map<string, RoundTripPairMeta> | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
  outboundFilter?: OutboundLegFilter,
  returnLegFilter?: ReturnLegFilter,
): number | null {
  if (!isDatePairInBounds(outDate, retDate, dateBounds)) return null

  const schedulePrices: number[] = []
  const seenOut = new Set<string>()

  const considerOutbound = (outIt: NormalizedItinerary) => {
    if (outboundFilter && !outboundFilter(outIt)) return
    const outSk = itineraryScheduleKey(outIt)
    if (seenOut.has(outSk)) return
    seenOut.add(outSk)
    const p = minPriceForOutboundScheduleOnPair(
      outIt,
      routeKey,
      outDate,
      retDate,
      verifications,
      roundTripCombos,
      returnLegFilter,
    )
    if (p != null && p > 0) schedulePrices.push(p)
  }

  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      considerOutbound(c.outIt)
    }
  }

  const ob = outResult.perRouteByDate.get(routeKey)?.get(outDate)
  if (ob?.allItineraries.length) {
    for (const outIt of ob.allItineraries) considerOutbound(outIt)
    return schedulePrices.length ? Math.min(...schedulePrices) : null
  }

  if (schedulePrices.length) return Math.min(...schedulePrices)

  let min = Infinity

  const scanPrice = scanPriceForRouteOnPair(
    routeKey,
    outDate,
    retDate,
    roundTripDeepenStates,
    dateBounds,
    roundTripCombos,
    outboundFilter,
    verifications,
    returnLegFilter,
  )
  if (scanPrice != null && scanPrice < min) min = scanPrice

  const rb = retResult.perRouteByDate.get(reverseRouteKey(routeKey))?.get(retDate)
  if (ob && rb) {
    for (const outIt of ob.allItineraries) {
      if (outboundFilter && !outboundFilter(outIt)) continue
      for (const retIt of rb.allItineraries) {
        if (returnLegFilter && !returnLegFilter(retIt)) continue
        const p = effectiveCombinedPrice(outIt, retIt, verifications, routeKey)
        if (p > 0 && p < min) min = p
      }
    }
  }

  const minVer = minVerifiedPriceForDatePair(verifications, routeKey, outDate, retDate)
  if (minVer != null && minVer < min) min = minVer

  return min < Infinity ? min : null
}

/**
 * Best round-trip price for one airline/route × outbound day: min across return dates.
 * Each return date uses scanPriceForRouteOnPair (own Serp price or same-airline max that out day).
 */
export function minCombinedForOutboundDate(
  routeKey: string,
  outDate: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  pairMeta?: Map<string, RoundTripPairMeta> | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
  tokenIndex?: RtTokenPriceIndex | null,
  outboundFilter?: OutboundLegFilter,
  returnLegFilter?: ReturnLegFilter,
): number | null {
  if (outboundFilter) {
    let min = Infinity
    for (const retDate of retResult.dates) {
      if (retDate <= outDate) continue
      if (!isDatePairInBounds(outDate, retDate, dateBounds)) continue
      const p = minCombinedForDatePair(
        routeKey,
        outDate,
        retDate,
        outResult,
        retResult,
        verifications,
        roundTripCombos,
        pairMeta,
        dateBounds,
        roundTripDeepenStates,
        outboundFilter,
        returnLegFilter,
      )
      if (p != null) min = Math.min(min, p)
    }
    return min < Infinity ? min : null
  }

  if (tokenIndex) {
    let min = Infinity
    for (const retDate of retResult.dates) {
      if (retDate <= outDate) continue
      if (!isDatePairInBounds(outDate, retDate, dateBounds)) continue
      let cellMin = Infinity
      const tok = tokenRoutePriceFromIndex(tokenIndex, routeKey, outDate, retDate)
      if (tok) cellMin = Math.min(cellMin, tok.price)
      if (roundTripCombos?.length) {
        const comboMin = minRoundTripForDatePair(
          roundTripCombos,
          routeKey,
          outDate,
          retDate,
          verifications,
        )
        if (comboMin != null) cellMin = Math.min(cellMin, comboMin)
      }
      const minVer = minVerifiedPriceForDatePair(verifications, routeKey, outDate, retDate)
      if (minVer != null) cellMin = Math.min(cellMin, minVer)
      if (cellMin < Infinity) min = Math.min(min, cellMin)
    }
    if (min < Infinity) return min
    if (roundTripDeepenStates?.length || roundTripCombos?.length) {
      return maxTokenRouteFallback(routeKey, outDate, roundTripDeepenStates, dateBounds, roundTripCombos)
    }
    return null
  }

  const rows = listCombinedPricesForOutbound(
    routeKey,
    outDate,
    outResult,
    retResult,
    verifications,
    roundTripCombos,
    pairMeta,
    dateBounds,
    roundTripDeepenStates,
  )
  if (rows.length) return Math.min(...rows.map((r) => r.combined))
  if (roundTripDeepenStates?.length || roundTripCombos?.length) {
    return maxTokenRouteFallback(routeKey, outDate, roundTripDeepenStates, dateBounds, roundTripCombos)
  }
  return null
}

/** Best bundled RT for a return-path row when outbound route is fixed (deepened combos). */
export function minCombinedForPairedReturnDate(
  outboundRouteKey: string,
  retRouteKey: string,
  retDate: string,
  outDates: string[],
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  _pairMeta?: Map<string, RoundTripPairMeta> | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
): number | null {
  let min = Infinity
  for (const outDate of outDates) {
    if (retDate <= outDate) continue
    if (roundTripCombos?.length) {
      for (const c of roundTripCombos) {
        if (c.routeKey !== outboundRouteKey || c.outDate !== outDate || c.retDate !== retDate) continue
        if (makeRouteGroupKey(c.retIt) !== retRouteKey) continue
        const row = lookupVerificationRow(verifications, c.routeKey, c.outIt, c.retIt)
        const p =
          row?.verifiedPrice != null && row.verifiedPrice > 0 ? row.verifiedPrice : c.roundTripPrice
        if (p > 0 && p < min) min = p
      }
    }
    if (retRouteKey === reverseRouteKey(outboundRouteKey)) {
      const tokenPrice = scanPriceForRouteOnPair(
        outboundRouteKey,
        outDate,
        retDate,
        roundTripDeepenStates,
        undefined,
        roundTripCombos,
      )
      if (tokenPrice != null && tokenPrice < min) min = tokenPrice
    }
  }
  return min < Infinity ? min : null
}

/** Best round-trip price for a return date column (min across valid outbound dates). */
export function minCombinedForReturnDate(
  routeKey: string,
  retDate: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  pairMeta?: Map<string, RoundTripPairMeta> | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
): number | null {
  /** Return-panel rows use reversed keys; pairMeta and combos index by outbound route. */
  const outboundRouteKey = reverseRouteKey(routeKey)
  let min = Infinity
  for (const outDate of outResult.dates) {
    if (retDate <= outDate) continue
    const p = minCombinedForDatePair(
      outboundRouteKey,
      outDate,
      retDate,
      outResult,
      retResult,
      verifications,
      roundTripCombos,
      pairMeta,
      undefined,
      roundTripDeepenStates,
    )
    if (p != null && p < min) min = p
  }
  return min < Infinity ? min : null
}

/** Cheapest initial scan price on an outbound date (any route). */
export function globalMinByOutboundDateFromPairMeta(
  pairMeta: Map<string, RoundTripPairMeta>,
  outDate: string,
): number | null {
  let min = Infinity
  for (const meta of pairMeta.values()) {
    if (meta.outDate !== outDate) continue
    const p = meta.globalInitialMin
    if (p != null && p > 0 && p < min) min = p
  }
  return min < Infinity ? min : null
}

/** Latest override for a calendar cell (any itinerary combo on that date pair). */
export function latestVerificationForCell(
  verifications: PriceOverrideMap,
  routeKey: string,
  outDate: string,
  retDate: string,
): PriceVerificationRow | undefined {
  let best: PriceVerificationRow | undefined
  for (const row of verifications.values()) {
    if (row.routeKey !== routeKey || row.outDate !== outDate || row.retDate !== retDate) continue
    if (!best || (row.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = row
  }
  return best
}

export function routeKeyForItinerary(it: NormalizedItinerary): string {
  return makeRouteGroupKey(it)
}
