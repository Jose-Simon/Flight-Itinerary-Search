import type { RouteDateBucket, PriceWindowResult } from './routeGrouping'
import {
  minCombinedForDatePair,
  minCombinedForOutboundDate,
  minCombinedForPairedReturnDate,
  minCombinedForReturnDate,
  type PriceOverrideMap,
  type PriceWindowDateBounds,
  type OutboundLegFilter,
  type ReturnLegFilter,
} from './priceOverrides'
import type { RoundTripPairDeepenState, RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import type { RtTokenPriceIndex } from './rtTokenRoutePrice'

export type PwPanelCellPriceMode =
  | 'total_or_outbound'
  | 'return_paired'
  | 'return_unpaired'

export type ComputePwPanelCellPriceOpts = {
  mode: PwPanelCellPriceMode
  routeKey: string
  axisDate: string
  bucket?: RouteDateBucket
  outResult: PriceWindowResult
  retResult?: PriceWindowResult | null
  pairedOutboundResult?: PriceWindowResult | null
  pairedOutboundRouteKey?: string | null
  pairedOutboundDate?: string | null
  selectedReturnDate?: string | null
  verifications: PriceOverrideMap
  roundTripCombos?: RoundTripCombo[] | null
  roundTripPairMeta?: Map<string, RoundTripPairMeta> | null
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null
  rtTokenIndex?: RtTokenPriceIndex | null
  dateBounds?: PriceWindowDateBounds | null
  outboundLegFilter?: OutboundLegFilter
  returnLegFilter?: ReturnLegFilter
  maxPrice?: number | null
}

/** Same price logic as PriceWindowPanel grid cells (shared with validation). */
export function computePwPanelCellPrice(opts: ComputePwPanelCellPriceOpts): number | null {
  const {
    mode,
    routeKey,
    axisDate,
    bucket,
    outResult,
    retResult = null,
    pairedOutboundResult = null,
    pairedOutboundRouteKey = null,
    pairedOutboundDate = null,
    selectedReturnDate = null,
    verifications,
    roundTripCombos = null,
    roundTripPairMeta = null,
    roundTripDeepenStates = null,
    rtTokenIndex = null,
    dateBounds = null,
    outboundLegFilter,
    returnLegFilter,
    maxPrice = null,
  } = opts

  const cacheOutMin = bucket?.minPrice ?? Infinity
  let price: number

  if (mode === 'total_or_outbound' && retResult) {
    let combined: number | null
    if (selectedReturnDate && selectedReturnDate > axisDate) {
      combined = minCombinedForDatePair(
        routeKey,
        axisDate,
        selectedReturnDate,
        outResult,
        retResult,
        verifications,
        roundTripCombos,
        roundTripPairMeta,
        dateBounds,
        roundTripDeepenStates,
        outboundLegFilter,
        returnLegFilter,
      )
    } else {
      combined = minCombinedForOutboundDate(
        routeKey,
        axisDate,
        outResult,
        retResult,
        verifications,
        roundTripCombos,
        roundTripPairMeta,
        dateBounds,
        roundTripDeepenStates,
        outboundLegFilter ? undefined : rtTokenIndex,
        outboundLegFilter,
        returnLegFilter,
      )
    }
    if (combined == null) return null
    price = combined
  } else if (mode === 'return_paired' && pairedOutboundResult && pairedOutboundRouteKey) {
    if (pairedOutboundDate) {
      const combined = minCombinedForDatePair(
        pairedOutboundRouteKey,
        pairedOutboundDate,
        axisDate,
        pairedOutboundResult,
        outResult,
        verifications,
        roundTripCombos,
        roundTripPairMeta,
        dateBounds,
        roundTripDeepenStates,
        outboundLegFilter,
        returnLegFilter,
      )
      if (combined == null) return null
      price = combined
    } else {
      const combined = minCombinedForPairedReturnDate(
        pairedOutboundRouteKey,
        routeKey,
        axisDate,
        pairedOutboundResult.dates,
        verifications,
        roundTripCombos,
        roundTripPairMeta,
        roundTripDeepenStates,
      )
      if (combined == null) return null
      price = combined
    }
  } else if (mode === 'return_unpaired' && pairedOutboundResult) {
    const combined = minCombinedForReturnDate(
      routeKey,
      axisDate,
      pairedOutboundResult,
      outResult,
      verifications,
      roundTripCombos,
      roundTripPairMeta,
      roundTripDeepenStates,
    )
    if (combined == null) return null
    price = combined
  } else if (roundTripPairMeta?.size) {
    return null
  } else {
    if (!Number.isFinite(cacheOutMin)) return null
    price = cacheOutMin
  }

  if (maxPrice != null && price > maxPrice) return null
  return price
}
