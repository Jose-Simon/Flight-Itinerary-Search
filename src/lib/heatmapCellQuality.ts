import type { PriceWindowResult } from './routeGrouping'
import { reverseRouteKey } from './routeGrouping'
import {
  cellHasDetailedItineraries,
  resolveHeatmapCellMeta,
  type HeatmapCellMeta,
} from './heatmapCellMeta'
import {
  effectiveCombinedPrice,
  isDatePairInBounds,
  listCombinedPricesForOutbound,
} from './priceOverrides'
import { routeKeysFromPairMeta, type RoundTripPairDeepenState, type RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import type { PriceOverrideMap, PriceWindowDateBounds } from './priceOverrides'
import type { RtTokenPriceIndex } from './rtTokenRoutePrice'

/** Cell data completeness for heatmap / price-window grids. */
export type HeatmapCellQuality = 'perfect' | 'return_missing' | 'derived' | 'empty'

export type HeatmapQualityDef = {
  icon: string
  label: string
  title: string
}

export const HEATMAP_QUALITY_DEFS: Record<HeatmapCellQuality, HeatmapQualityDef> = {
  perfect: {
    icon: '●',
    label: 'Complete',
    title: 'Outbound and return itineraries with price (token expand or cache).',
  },
  return_missing: {
    icon: '○',
    label: 'Return missing',
    title: 'Token outbound on this pair — return itineraries not loaded yet.',
  },
  derived: {
    icon: '˜',
    label: 'Derived',
    title: 'Price imputed from token-backed outbounds on other date pairs (same airline/route).',
  },
  empty: {
    icon: '—',
    label: 'No data',
    title: 'No price or scan data for this cell.',
  },
}

export const HEATMAP_QUALITY_ORDER: HeatmapCellQuality[] = [
  'perfect',
  'return_missing',
  'derived',
  'empty',
]

export type HeatmapQualityBucketTotals = {
  cells: number
  itineraries: number
}

export type HeatmapQualityTotals = Record<HeatmapCellQuality, HeatmapQualityBucketTotals>

export function emptyHeatmapQualityTotals(): HeatmapQualityTotals {
  return {
    perfect: { cells: 0, itineraries: 0 },
    return_missing: { cells: 0, itineraries: 0 },
    derived: { cells: 0, itineraries: 0 },
    empty: { cells: 0, itineraries: 0 },
  }
}

function emptyQualityTotals(): HeatmapQualityTotals {
  return emptyHeatmapQualityTotals()
}

/** Priced round-trip itinerary options for one route × date pair (combos or leg crosses). */
export function countRoutePairItineraries(
  routeKey: string,
  outDate: string,
  retDate: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
): number {
  let n = 0
  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      const p = effectiveCombinedPrice(c.outIt, c.retIt, verifications, routeKey, c.roundTripPrice)
      if (p > 0) n++
    }
    if (n > 0) return n
  }
  const ob = outResult.perRouteByDate.get(routeKey)?.get(outDate)
  const rb = retResult.perRouteByDate.get(reverseRouteKey(routeKey))?.get(retDate)
  if (!ob || !rb) return 0
  for (const outIt of ob.allItineraries) {
    for (const retIt of rb.allItineraries) {
      const p = effectiveCombinedPrice(outIt, retIt, verifications, routeKey)
      if (p > 0) n++
    }
  }
  return n
}

/** Sum cells + itinerary counts per quality across all routes and out×ret pairs in bounds. */
export function computeHeatmapQualityTotals(
  outResult: PriceWindowResult | null | undefined,
  retResult: PriceWindowResult | null | undefined,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  pairMeta?: Map<string, RoundTripPairMeta> | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
  tokenIndex?: RtTokenPriceIndex | null,
): HeatmapQualityTotals {
  const totals = emptyQualityTotals()
  if (!outResult || !retResult) return totals

  const routeKeys =
    pairMeta && pairMeta.size > 0
      ? routeKeysFromPairMeta([...pairMeta.values()])
      : outResult.routeKeyOrder

  const cellBudget = routeKeys.length * outResult.dates.length * retResult.dates.length
  const countItineraries = cellBudget <= 2500

  for (const routeKey of routeKeys) {
    for (const outDate of outResult.dates) {
      for (const retDate of retResult.dates) {
        if (!isDatePairInBounds(outDate, retDate, dateBounds)) continue
        const q = resolvePairCellQuality(
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
        )
        totals[q].cells += 1
        if (countItineraries) {
          totals[q].itineraries += countRoutePairItineraries(
            routeKey,
            outDate,
            retDate,
            outResult,
            retResult,
            verifications,
            roundTripCombos,
          )
        }
      }
    }
  }
  return totals
}

export function qualityBucketCountTitle(
  bucket: HeatmapQualityBucketTotals,
  quality: HeatmapCellQuality,
): string {
  const def = HEATMAP_QUALITY_DEFS[quality]
  if (bucket.cells === 0) return `${def.label}: none`
  if (bucket.itineraries > 0) {
    return `${def.label}: ${bucket.cells} cell${bucket.cells === 1 ? '' : 's'} · ${bucket.itineraries} itinerary${bucket.itineraries === 1 ? '' : 'ies'}`
  }
  return `${def.label}: ${bucket.cells} cell${bucket.cells === 1 ? '' : 's'} · no itineraries loaded`
}

export function resolveHeatmapCellQuality(
  meta: HeatmapCellMeta | null | undefined,
  hasDetailedItineraries: boolean,
): HeatmapCellQuality {
  if (!meta) return 'empty'
  if (hasDetailedItineraries) return 'perfect'
  if (meta.serpDerived) return 'derived'
  return 'return_missing'
}

export function isHeatmapQualityVisible(
  quality: HeatmapCellQuality,
  activeFilter: ReadonlySet<HeatmapCellQuality> | null | undefined,
): boolean {
  if (!activeFilter || activeFilter.size === 0) return true
  return activeFilter.has(quality)
}

/** Out × ret pair cell. */
export function resolvePairCellQuality(
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
): HeatmapCellQuality {
  const meta = resolveHeatmapCellMeta(
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
  )
  if (!meta) return 'empty'
  const hasDetail = cellHasDetailedItineraries(
    routeKey,
    outDate,
    retDate,
    outResult,
    retResult,
    roundTripCombos,
  )
  return resolveHeatmapCellQuality(meta, hasDetail)
}

/** Route × outbound date (price-window outbound / total row). */
export function resolveOutboundRouteDateQuality(
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
): HeatmapCellQuality {
  if (tokenIndex) {
    let bestQ: HeatmapCellQuality = 'empty'
    let bestPrice = Infinity
    for (const retDate of retResult.dates) {
      if (retDate <= outDate) continue
      const meta = resolveHeatmapCellMeta(
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
      )
      if (!meta) continue
      const q = resolveHeatmapCellQuality(
        meta,
        cellHasDetailedItineraries(
          routeKey,
          outDate,
          retDate,
          outResult,
          retResult,
          roundTripCombos,
        ),
      )
      if (meta.price < bestPrice) {
        bestPrice = meta.price
        bestQ = q
      }
    }
    return bestQ
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
  if (!rows.length) {
    let fallback: HeatmapCellQuality = 'empty'
    for (const retDate of retResult.dates) {
      if (retDate <= outDate) continue
      const q = resolvePairCellQuality(
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
      )
      if (q === 'empty') continue
      if (fallback === 'empty') fallback = q
      else if (q === 'derived' || (q === 'return_missing' && fallback === 'perfect')) fallback = q
    }
    return fallback
  }
  let bestQ: HeatmapCellQuality = 'empty'
  let bestPrice = Infinity
  for (const row of rows) {
    const q = resolvePairCellQuality(
      routeKey,
      outDate,
      row.retDate,
      outResult,
      retResult,
      verifications,
      roundTripCombos,
      pairMeta,
      dateBounds,
      roundTripDeepenStates,
      tokenIndex,
    )
    if (row.combined < bestPrice) {
      bestPrice = row.combined
      bestQ = q
    }
  }
  return bestQ
}

/** Route × return date when outbound route is fixed. */
export function resolveReturnRouteDateQuality(
  outboundRouteKey: string,
  _retRouteKey: string,
  retDate: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  pairMeta?: Map<string, RoundTripPairMeta> | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
  tokenIndex?: RtTokenPriceIndex | null,
): HeatmapCellQuality {
  let bestQ: HeatmapCellQuality = 'empty'
  let bestPrice = Infinity
  for (const outDate of outResult.dates) {
    if (retDate <= outDate) continue
    const meta = resolveHeatmapCellMeta(
      outboundRouteKey,
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
    )
    if (meta == null) continue
    const q = resolveHeatmapCellQuality(
      meta,
      cellHasDetailedItineraries(
        outboundRouteKey,
        outDate,
        retDate,
        outResult,
        retResult,
        roundTripCombos,
      ),
    )
    if (meta.price < bestPrice) {
      bestPrice = meta.price
      bestQ = q
    }
  }
  return bestQ
}

/** One-way or cache-only route × date. */
export function resolveOneWayRouteDateQuality(
  routeKey: string,
  date: string,
  result: PriceWindowResult,
): HeatmapCellQuality {
  const bucket = result.perRouteByDate.get(routeKey)?.get(date)
  if (!bucket?.allItineraries?.length) return 'empty'
  if (bucket.minPrice != null && bucket.minPrice > 0) return 'perfect'
  return 'empty'
}

/**
 * Panel-accurate quality totals: counts one entry per visible outbound-date cell
 * (route × outDate), using the same quality resolver the panel badges use.
 *
 * Use this for the HeatmapQualityFilterBar so the counts match what the user
 * sees on screen instead of the 2D out×ret matrix used by computeHeatmapQualityTotals.
 *
 * `itineraries` = number of outbound itinerary options in the outbound bucket for
 * that cell (what the OPTIONS panel offers for that date).
 */
export function computePanelQualityTotals(
  outResult: PriceWindowResult | null | undefined,
  retResult: PriceWindowResult | null | undefined,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  pairMeta?: Map<string, RoundTripPairMeta> | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null,
  tokenIndex?: RtTokenPriceIndex | null,
): HeatmapQualityTotals {
  const totals = emptyQualityTotals()
  if (!outResult) return totals

  const routeKeys = outResult.routeKeyOrder

  for (const routeKey of routeKeys) {
    for (const outDate of outResult.dates) {
      // Resolve quality the same way the panel badge does for this cell.
      const q: HeatmapCellQuality = retResult
        ? resolveOutboundRouteDateQuality(
            routeKey,
            outDate,
            outResult,
            retResult,
            verifications,
            roundTripCombos,
            pairMeta,
            dateBounds,
            roundTripDeepenStates,
            tokenIndex,
          )
        : resolveOneWayRouteDateQuality(routeKey, outDate, outResult)

      if (q === 'empty') continue  // empty cells aren't shown in the grid

      totals[q].cells += 1
      // Count available outbound itinerary options for this cell.
      const bucket = outResult.perRouteByDate.get(routeKey)?.get(outDate)
      if (bucket?.allItineraries) {
        totals[q].itineraries += bucket.allItineraries.length
      }
    }
  }
  return totals
}
