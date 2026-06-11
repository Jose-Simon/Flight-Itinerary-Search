import { minCombinedForDatePair, retDatesForOutboundMin, type PriceWindowDateBounds } from './priceOverrides'
import { makeRouteGroupKey, reverseRouteKey, type PriceWindowResult } from './routeGrouping'
import type { RoundTripPairDeepenState, RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import type { NormalizedItinerary } from './types'

export type PwReturnPick = {
  routeKey: string
  date: string
  pickedIdx: number
  selectedItinerary?: NormalizedItinerary
}

const emptyVerifications = new Map()

/** Pick return cell after outbound change: same return date when possible, else cheapest valid RT. */
export function pickPwReturnForOutbound(opts: {
  outboundRouteKey: string
  outboundDate: string
  preferredRetDate: string | null
  outResult: PriceWindowResult
  retResult: PriceWindowResult
  combos: RoundTripCombo[]
  pairMeta: Map<string, RoundTripPairMeta> | null
  dateBounds?: PriceWindowDateBounds | null
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null
}): PwReturnPick | null {
  const {
    outboundRouteKey,
    outboundDate,
    preferredRetDate,
    outResult,
    retResult,
    combos,
    pairMeta,
    dateBounds = null,
    roundTripDeepenStates = null,
  } = opts

  let pool = combos.filter((c) => c.routeKey === outboundRouteKey && c.outDate === outboundDate)
  if (!pool.length) {
    pool = combos.filter((c) => c.routeKey === outboundRouteKey)
  }
  if (pool.length) {
    const onPreferred = preferredRetDate
      ? pool.filter((c) => c.retDate === preferredRetDate && c.retDate > outboundDate)
      : []
    const candidates = onPreferred.length ? onPreferred : pool.filter((c) => c.retDate > outboundDate)
    if (!candidates.length) return null
    const best = candidates.reduce((a, b) => (b.roundTripPrice < a.roundTripPrice ? b : a))
    return {
      routeKey: makeRouteGroupKey(best.retIt),
      date: best.retDate,
      pickedIdx: 0,
      selectedItinerary: { ...best.retIt, price: best.roundTripPrice },
    }
  }

  const pricedDates: { retDate: string; price: number }[] = []
  for (const retDate of retDatesForOutboundMin(
    outboundRouteKey,
    outboundDate,
    retResult,
    combos,
    emptyVerifications,
    pairMeta,
    dateBounds,
    roundTripDeepenStates,
  )) {
    const p = minCombinedForDatePair(
      outboundRouteKey,
      outboundDate,
      retDate,
      outResult,
      retResult,
      emptyVerifications,
      combos,
      pairMeta,
      dateBounds,
      roundTripDeepenStates,
    )
    if (p != null) pricedDates.push({ retDate, price: p })
  }
  if (!pricedDates.length) return null

  const onPreferred = preferredRetDate
    ? pricedDates.find((x) => x.retDate === preferredRetDate)
    : undefined
  const chosen = onPreferred ?? pricedDates.reduce((a, b) => (b.price < a.price ? b : a))

  const revKey = reverseRouteKey(outboundRouteKey)
  const bucket = retResult.perRouteByDate.get(revKey)?.get(chosen.retDate)
  return {
    routeKey: revKey,
    date: chosen.retDate,
    pickedIdx: 0,
    selectedItinerary: bucket?.bestItinerary,
  }
}
