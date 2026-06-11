import type { PriceWindowResult } from './routeGrouping'
import { reverseRouteKey } from './routeGrouping'
import { minRoundTripForDatePair } from './roundTripPricing'
import { roundTripPairCellKey, type RoundTripPairDeepenState, type RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import {
  effectiveCombinedPrice,
  filteredDirectSerpPriceForRouteOnPair,
  isDatePairInBounds,
  minCombinedForDatePair,
  minItineraryPriceForDatePair,
  minVerifiedPriceForDatePair,
  serpScanPriceForRoute,
  type PriceOverrideMap,
  type PriceWindowDateBounds,
  type OutboundLegFilter,
  type ReturnLegFilter,
} from './priceOverrides'
import type { RtTokenPriceIndex } from './rtTokenRoutePrice'

export type HeatmapCellDisplayKind =
  | 'verified'
  | 'combo'
  | 'itinerary'
  | 'serp_direct'
  | 'serp_imputed_same_out'
  | 'serp_imputed_other_out'

export type HeatmapCellMeta = {
  price: number
  winningKind: HeatmapCellDisplayKind
  /** Shown price comes from imputed Serp summaries, not this pair's direct scan. */
  serpDerived: boolean
  imputeSource?: 'same_out_day' | 'other_out_day'
  /** No return-token / cache itineraries for this pair — summary or imputed scan only. */
  summaryOnly: boolean
  /** This date pair has some but not all return routes expanded. */
  partialExpand: boolean
}

export function cellHasDetailedItineraries(
  routeKey: string,
  outDate: string,
  retDate: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  roundTripCombos?: RoundTripCombo[] | null,
): boolean {
  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey === routeKey && c.outDate === outDate && c.retDate === retDate) return true
    }
  }
  const ob = outResult.perRouteByDate.get(routeKey)?.get(outDate)
  const rb = retResult.perRouteByDate.get(reverseRouteKey(routeKey))?.get(retDate)
  return Boolean(ob?.allItineraries?.length && rb?.allItineraries?.length)
}

function serpKindFromSource(
  source: 'direct' | 'same_out_day' | 'other_out_day',
): HeatmapCellDisplayKind {
  if (source === 'direct') return 'serp_direct'
  if (source === 'same_out_day') return 'serp_imputed_same_out'
  return 'serp_imputed_other_out'
}

/** Lowest displayed heatmap price + provenance flags for one route × date pair. */
export function resolveHeatmapCellMeta(
  routeKey: string,
  outDate: string,
  retDate: string,
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
): HeatmapCellMeta | null {
  if (!isDatePairInBounds(outDate, retDate, dateBounds)) return null

  const candidates: { price: number; kind: HeatmapCellDisplayKind }[] = []

  if (roundTripCombos?.length) {
    const fromCombos = minRoundTripForDatePair(
      roundTripCombos,
      routeKey,
      outDate,
      retDate,
      verifications,
      outboundFilter,
      returnLegFilter,
    )
    if (fromCombos != null) candidates.push({ price: fromCombos, kind: 'combo' })
  }

  const itineraryMin = minItineraryPriceForDatePair(
    routeKey,
    outDate,
    retDate,
    outResult,
    retResult,
    verifications,
    roundTripCombos,
    outboundFilter,
    returnLegFilter,
  )
  if (itineraryMin != null) candidates.push({ price: itineraryMin, kind: 'itinerary' })

  if (outboundFilter) {
    const filteredSerp = filteredDirectSerpPriceForRouteOnPair(
      routeKey,
      outDate,
      retDate,
      roundTripDeepenStates,
      roundTripCombos,
      outboundFilter,
      verifications,
      returnLegFilter,
    )
    if (filteredSerp != null) candidates.push({ price: filteredSerp, kind: 'serp_direct' })
  } else if (roundTripDeepenStates?.length || roundTripCombos?.length || tokenIndex) {
    const serp = serpScanPriceForRoute(
      routeKey,
      outDate,
      retDate,
      roundTripDeepenStates,
      dateBounds,
      roundTripCombos,
      tokenIndex,
    )
    if (serp != null) candidates.push({ price: serp.price, kind: serpKindFromSource(serp.source) })
  }

  const ob = outResult.perRouteByDate.get(routeKey)?.get(outDate)
  const rb = retResult.perRouteByDate.get(reverseRouteKey(routeKey))?.get(retDate)
  if (ob && rb) {
    for (const outIt of ob.allItineraries) {
      if (outboundFilter && !outboundFilter(outIt)) continue
      for (const retIt of rb.allItineraries) {
        if (returnLegFilter && !returnLegFilter(retIt)) continue
        const p = effectiveCombinedPrice(outIt, retIt, verifications, routeKey)
        if (p > 0) candidates.push({ price: p, kind: 'itinerary' })
      }
    }
  }

  const minVer = minVerifiedPriceForDatePair(verifications, routeKey, outDate, retDate)
  if (minVer != null) candidates.push({ price: minVer, kind: 'verified' })

  const unifiedPrice = minCombinedForDatePair(
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
  if (unifiedPrice == null) return null

  const win = candidates.length
    ? candidates.reduce((a, b) => (a.price <= b.price ? a : b))
    : { price: unifiedPrice, kind: 'verified' as HeatmapCellDisplayKind }
  const displayKind: HeatmapCellDisplayKind =
    minVer != null && unifiedPrice === minVer ? 'verified' : win.kind
  const pm = pairMeta?.get(roundTripPairCellKey(outDate, retDate))
  const partialExpand =
    pm != null && pm.rankedCount > 0 && pm.fetchedCount > 0 && pm.fetchedCount < pm.rankedCount
  const summaryOnly = !cellHasDetailedItineraries(
    routeKey,
    outDate,
    retDate,
    outResult,
    retResult,
    roundTripCombos,
  )

  const serpDerived =
    win.kind === 'serp_imputed_same_out' || win.kind === 'serp_imputed_other_out'
  const imputeSource =
    win.kind === 'serp_imputed_same_out'
      ? 'same_out_day'
      : win.kind === 'serp_imputed_other_out'
        ? 'other_out_day'
        : undefined

  return {
    price: unifiedPrice,
    winningKind: displayKind,
    serpDerived,
    imputeSource,
    summaryOnly,
    partialExpand,
  }
}

export function heatmapDerivedTitle(meta: HeatmapCellMeta): string {
  if (!meta.serpDerived) return ''
  if (meta.imputeSource === 'same_out_day') {
    return 'Derived: max token-backed price from this airline’s other return dates on the same outbound day.'
  }
  return 'Derived: max token-backed price from this airline on other outbound days (no token on this pair).'
}

export function heatmapSummaryOnlyTitle(): string {
  return 'Token outbound on this pair — return itineraries not loaded yet.'
}

export function heatmapPartialExpandTitle(fetched: number, ranked: number): string {
  return `Partial expand: ${fetched} of ${ranked} outbound routes on this date pair have return details.`
}

/** Heatmap grid: one price per out|ret cell with provenance flags. */
export function buildHeatmapCells(
  routeKey: string,
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
): {
  cells: Map<string, number>
  cellMeta: Map<string, HeatmapCellMeta>
  minP: number
  maxP: number
  cheapestKey: string
} {
  let minP = Infinity
  let maxP = -Infinity
  let cheapestKey = ''
  const cells = new Map<string, number>()
  const cellMeta = new Map<string, HeatmapCellMeta>()

  for (const retDate of retResult.dates) {
    for (const outDate of outResult.dates) {
      const resolved = resolveHeatmapCellMeta(
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
        tokenIndex,
        outboundFilter,
        returnLegFilter,
      )
      if (resolved == null) continue
      const p = resolved.price
      const key = `${outDate}|${retDate}`
      cells.set(key, p)
      cellMeta.set(key, resolved)
      if (p < minP) {
        minP = p
        cheapestKey = key
      }
      if (p > maxP) maxP = p
    }
  }

  return {
    cells,
    cellMeta,
    minP: minP === Infinity ? 0 : minP,
    maxP: maxP === -Infinity ? 0 : maxP,
    cheapestKey,
  }
}
