import { resolveHeatmapCellMeta } from './heatmapCellMeta'
import { computePwPanelCellPrice } from './pwPanelCellPrice'
import { pickPwReturnForOutbound } from './pwReturnAutoPick'
import {
  minCombinedForDatePair,
  type PriceOverrideMap,
  type PriceWindowDateBounds,
  type OutboundLegFilter,
} from './priceOverrides'
import type { PriceWindowResult } from './routeGrouping'
import type { RoundTripPairDeepenState, RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import type { RtTokenPriceIndex } from './rtTokenRoutePrice'

export type PwPriceConsistencyContext = {
  outResult: PriceWindowResult
  retResult: PriceWindowResult
  verifications?: PriceOverrideMap
  roundTripCombos?: RoundTripCombo[] | null
  roundTripPairMeta?: Map<string, RoundTripPairMeta> | null
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null
  rtTokenIndex?: RtTokenPriceIndex | null
  dateBounds?: PriceWindowDateBounds | null
  outboundLegFilter?: OutboundLegFilter
  maxPrice?: number | null
}

export type PwPriceMismatch = {
  routeKey: string
  outDate: string
  retDate: string
  field: string
  expected: number
  actual: number
}

export type PwCellPriceSnapshot = {
  routeKey: string
  outDate: string
  retDate: string
  totalGrid: number | null
  outboundGrid: number | null
  returnGrid: number | null
  heatmap: number | null
  pairMin: number | null
  heroFare: number | null
}

const emptyVerifications = new Map() as PriceOverrideMap

/** Prices all five views should agree on for one outbound cell + auto-picked return. */
export function snapshotPricesForCell(
  ctx: PwPriceConsistencyContext,
  routeKey: string,
  outDate: string,
): PwCellPriceSnapshot | null {
  const verifications = ctx.verifications ?? emptyVerifications
  const retPick = pickPwReturnForOutbound({
    outboundRouteKey: routeKey,
    outboundDate: outDate,
    preferredRetDate: null,
    outResult: ctx.outResult,
    retResult: ctx.retResult,
    combos: ctx.roundTripCombos ?? [],
    pairMeta: ctx.roundTripPairMeta ?? null,
    dateBounds: ctx.dateBounds ?? null,
    roundTripDeepenStates: ctx.roundTripDeepenStates ?? null,
  })
  if (!retPick) return null

  const retDate = retPick.date
  const retRouteKey = retPick.routeKey
  const bucket = ctx.outResult.perRouteByDate.get(routeKey)?.get(outDate)
  const retBucket = ctx.retResult.perRouteByDate.get(retRouteKey)?.get(retDate)

  const shared = {
    outResult: ctx.outResult,
    retResult: ctx.retResult,
    verifications,
    roundTripCombos: ctx.roundTripCombos ?? null,
    roundTripPairMeta: ctx.roundTripPairMeta ?? null,
    roundTripDeepenStates: ctx.roundTripDeepenStates ?? null,
    rtTokenIndex: ctx.rtTokenIndex ?? null,
    dateBounds: ctx.dateBounds ?? null,
    outboundLegFilter: ctx.outboundLegFilter,
    maxPrice: ctx.maxPrice ?? null,
    selectedReturnDate: retDate,
  }

  const pairMin = minCombinedForDatePair(
    routeKey,
    outDate,
    retDate,
    ctx.outResult,
    ctx.retResult,
    verifications,
    ctx.roundTripCombos,
    ctx.roundTripPairMeta,
    ctx.dateBounds,
    ctx.roundTripDeepenStates,
    ctx.outboundLegFilter,
  )

  const totalGrid = computePwPanelCellPrice({
    ...shared,
    mode: 'total_or_outbound',
    routeKey,
    axisDate: outDate,
    bucket,
  })
  const outboundGrid = computePwPanelCellPrice({
    ...shared,
    mode: 'total_or_outbound',
    routeKey,
    axisDate: outDate,
    bucket,
  })
  const returnGrid = computePwPanelCellPrice({
    ...shared,
    mode: 'return_paired',
    routeKey: retRouteKey,
    axisDate: retDate,
    bucket: retBucket,
    pairedOutboundResult: ctx.outResult,
    pairedOutboundRouteKey: routeKey,
    pairedOutboundDate: outDate,
  })
  const heatmapMeta = resolveHeatmapCellMeta(
    routeKey,
    outDate,
    retDate,
    ctx.outResult,
    ctx.retResult,
    verifications,
    ctx.roundTripCombos,
    ctx.roundTripPairMeta,
    ctx.dateBounds,
    ctx.roundTripDeepenStates,
    ctx.rtTokenIndex,
    ctx.outboundLegFilter,
  )

  return {
    routeKey,
    outDate,
    retDate,
    totalGrid,
    outboundGrid,
    returnGrid,
    heatmap: heatmapMeta?.price ?? null,
    pairMin,
    heroFare: pairMin,
  }
}

function collectMismatches(snapshot: PwCellPriceSnapshot): PwPriceMismatch[] {
  const mismatches: PwPriceMismatch[] = []
  const anchor = snapshot.pairMin
  if (anchor == null) return mismatches

  const checks: { field: keyof PwCellPriceSnapshot; value: number | null }[] = [
    { field: 'totalGrid', value: snapshot.totalGrid },
    { field: 'outboundGrid', value: snapshot.outboundGrid },
    { field: 'returnGrid', value: snapshot.returnGrid },
    { field: 'heatmap', value: snapshot.heatmap },
    { field: 'heroFare', value: snapshot.heroFare },
  ]

  for (const { field, value } of checks) {
    if (value == null) continue
    if (value !== anchor) {
      mismatches.push({
        routeKey: snapshot.routeKey,
        outDate: snapshot.outDate,
        retDate: snapshot.retDate,
        field,
        expected: anchor,
        actual: value,
      })
    }
  }
  return mismatches
}

/** Walk every priced cell in the total/outbound grid and report cross-panel mismatches. */
export function validateAllTotalGridCells(ctx: PwPriceConsistencyContext): {
  checked: number
  skipped: number
  mismatches: PwPriceMismatch[]
} {
  let checked = 0
  let skipped = 0
  const mismatches: PwPriceMismatch[] = []

  for (const routeKey of ctx.outResult.routeKeyOrder) {
    const dateMap = ctx.outResult.perRouteByDate.get(routeKey)
    if (!dateMap) continue
    for (const outDate of ctx.outResult.dates) {
      const bucket = dateMap.get(outDate)
      const cellPrice = computePwPanelCellPrice({
        mode: 'total_or_outbound',
        routeKey,
        axisDate: outDate,
        bucket,
        outResult: ctx.outResult,
        retResult: ctx.retResult,
        verifications: ctx.verifications ?? emptyVerifications,
        roundTripCombos: ctx.roundTripCombos,
        roundTripPairMeta: ctx.roundTripPairMeta,
        roundTripDeepenStates: ctx.roundTripDeepenStates,
        rtTokenIndex: ctx.rtTokenIndex,
        dateBounds: ctx.dateBounds,
        outboundLegFilter: ctx.outboundLegFilter,
        maxPrice: ctx.maxPrice,
      })
      if (cellPrice == null) {
        skipped++
        continue
      }

      const snap = snapshotPricesForCell(ctx, routeKey, outDate)
      if (!snap) {
        skipped++
        continue
      }
      checked++
      mismatches.push(...collectMismatches(snap))
    }
  }

  return { checked, skipped, mismatches }
}
