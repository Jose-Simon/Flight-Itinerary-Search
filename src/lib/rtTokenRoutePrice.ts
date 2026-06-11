import { makeRouteGroupKey } from './routeGrouping'
import type { RoundTripPairDeepenState } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'

export type PriceWindowDateBounds = {
  outboundStart: string
  outboundEnd: string
  returnStart: string
  returnEnd: string
}

export type TokenRoutePriceSource = 'direct' | 'same_out_day' | 'other_out_day'

/** Precomputed token/combo prices — O(1) heatmap lookup instead of scanning all ranked outbounds. */
export type RtTokenPriceIndex = {
  pairMin: Map<string, number>
  outDayMax: Map<string, number>
  otherOutDayMax: Map<string, number>
}

function pairRouteKey(outDate: string, retDate: string, routeKey: string): string {
  return `${outDate}|${retDate}|${routeKey}`
}

function outRouteKey(outDate: string, routeKey: string): string {
  return `${outDate}|${routeKey}`
}

function isOutboundInBounds(outDate: string, bounds?: PriceWindowDateBounds | null): boolean {
  if (!bounds) return true
  return outDate >= bounds.outboundStart && outDate <= bounds.outboundEnd
}

function comboPricesForRouteOnPair(
  routeKey: string,
  outDate: string,
  retDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  roundTripCombos?: RoundTripCombo[] | null,
): number[] {
  const prices: number[] = []
  const state = deepenStates?.find((s) => s.outDate === outDate && s.retDate === retDate)
  if (state?.combos.length) {
    for (const c of state.combos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      if (c.roundTripPrice > 0) prices.push(c.roundTripPrice)
    }
  }
  if (roundTripCombos?.length) {
    for (const c of roundTripCombos) {
      if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
      if (c.roundTripPrice > 0) prices.push(c.roundTripPrice)
    }
  }
  return prices
}

/** Token-ranked or deepened combo prices for one route on one date pair. */
export function tokenedPricesForRouteOnPair(
  routeKey: string,
  outDate: string,
  retDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  roundTripCombos?: RoundTripCombo[] | null,
): number[] {
  const prices: number[] = [...comboPricesForRouteOnPair(routeKey, outDate, retDate, deepenStates, roundTripCombos)]
  if (!deepenStates?.length) return prices
  const state = deepenStates.find((s) => s.outDate === outDate && s.retDate === retDate)
  if (!state) return prices
  for (const { it, token } of state.ranked) {
    if (!token?.trim()) continue
    if (makeRouteGroupKey(it) !== routeKey) continue
    const p = it.price
    if (p != null && p > 0) prices.push(p)
  }
  return prices
}

export function routeHasTokenOnPair(
  routeKey: string,
  outDate: string,
  retDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  roundTripCombos?: RoundTripCombo[] | null,
): boolean {
  return tokenedPricesForRouteOnPair(routeKey, outDate, retDate, deepenStates, roundTripCombos).length > 0
}

function tokenedPricesOnOutboundDay(
  routeKey: string,
  outDate: string,
  deepenStates: RoundTripPairDeepenState[],
  roundTripCombos?: RoundTripCombo[] | null,
): number[] {
  const prices: number[] = []
  for (const state of deepenStates) {
    if (state.outDate !== outDate) continue
    prices.push(
      ...tokenedPricesForRouteOnPair(routeKey, state.outDate, state.retDate, deepenStates, roundTripCombos),
    )
  }
  return prices
}

function tokenedPricesOtherOutboundDays(
  routeKey: string,
  outDate: string,
  deepenStates: RoundTripPairDeepenState[],
  dateBounds?: PriceWindowDateBounds | null,
  roundTripCombos?: RoundTripCombo[] | null,
): number[] {
  const prices: number[] = []
  for (const state of deepenStates) {
    if (state.outDate === outDate) continue
    if (!isOutboundInBounds(state.outDate, dateBounds)) continue
    prices.push(
      ...tokenedPricesForRouteOnPair(routeKey, state.outDate, state.retDate, deepenStates, roundTripCombos),
    )
  }
  return prices
}

function maxTokenPrice(prices: number[]): number | null {
  if (!prices.length) return null
  return Math.max(...prices)
}

function minTokenPrice(prices: number[]): number | null {
  if (!prices.length) return null
  return Math.min(...prices)
}

function bumpPairMin(map: Map<string, number>, key: string, price: number): void {
  const prev = map.get(key)
  if (prev == null || price < prev) map.set(key, price)
}

function bumpOutDayMax(map: Map<string, number>, key: string, price: number): void {
  const prev = map.get(key)
  if (prev == null || price > prev) map.set(key, price)
}

function addIndexedPrice(
  pairMin: Map<string, number>,
  outDayMax: Map<string, number>,
  outDate: string,
  retDate: string,
  routeKey: string,
  price: number,
): void {
  if (price <= 0 || !Number.isFinite(price)) return
  bumpPairMin(pairMin, pairRouteKey(outDate, retDate, routeKey), price)
  bumpOutDayMax(outDayMax, outRouteKey(outDate, routeKey), price)
}

/** Build once when deepen states load; reused for every heatmap cell. */
export function buildRtTokenPriceIndex(
  deepenStates?: RoundTripPairDeepenState[] | null,
  roundTripCombos?: RoundTripCombo[] | null,
  dateBounds?: PriceWindowDateBounds | null,
): RtTokenPriceIndex | null {
  if (!deepenStates?.length && !roundTripCombos?.length) return null

  const pairMin = new Map<string, number>()
  const outDayMax = new Map<string, number>()

  for (const state of deepenStates ?? []) {
    for (const { it, token } of state.ranked) {
      if (!token?.trim()) continue
      const p = it.price
      if (p == null || p <= 0) continue
      addIndexedPrice(pairMin, outDayMax, state.outDate, state.retDate, makeRouteGroupKey(it), p)
    }
    for (const c of state.combos) {
      if (c.roundTripPrice > 0) {
        addIndexedPrice(pairMin, outDayMax, c.outDate, c.retDate, c.routeKey, c.roundTripPrice)
      }
    }
  }
  for (const c of roundTripCombos ?? []) {
    if (c.roundTripPrice > 0) {
      addIndexedPrice(pairMin, outDayMax, c.outDate, c.retDate, c.routeKey, c.roundTripPrice)
    }
  }

  const outDates = new Set<string>()
  for (const key of outDayMax.keys()) {
    outDates.add(key.slice(0, key.indexOf('|')))
  }

  const routesByOut = new Map<string, Set<string>>()
  for (const key of outDayMax.keys()) {
    const sep = key.indexOf('|')
    const o = key.slice(0, sep)
    const rk = key.slice(sep + 1)
    let set = routesByOut.get(o)
    if (!set) {
      set = new Set()
      routesByOut.set(o, set)
    }
    set.add(rk)
  }

  const otherOutDayMax = new Map<string, number>()
  for (const [outDate, routes] of routesByOut) {
    if (!isOutboundInBounds(outDate, dateBounds)) continue
    for (const routeKey of routes) {
      let maxOther = -Infinity
      for (const otherOut of outDates) {
        if (otherOut === outDate || !isOutboundInBounds(otherOut, dateBounds)) continue
        const v = outDayMax.get(outRouteKey(otherOut, routeKey))
        if (v != null && v > maxOther) maxOther = v
      }
      if (maxOther > -Infinity) otherOutDayMax.set(outRouteKey(outDate, routeKey), maxOther)
    }
  }

  return { pairMin, outDayMax, otherOutDayMax }
}

export function tokenRoutePriceFromIndex(
  index: RtTokenPriceIndex,
  routeKey: string,
  outDate: string,
  retDate: string,
): { price: number; source: TokenRoutePriceSource } | null {
  const direct = index.pairMin.get(pairRouteKey(outDate, retDate, routeKey))
  if (direct != null) return { price: direct, source: 'direct' }
  const sameDay = index.outDayMax.get(outRouteKey(outDate, routeKey))
  if (sameDay != null) return { price: sameDay, source: 'same_out_day' }
  const otherDay = index.otherOutDayMax.get(outRouteKey(outDate, routeKey))
  if (otherDay != null) return { price: otherDay, source: 'other_out_day' }
  return null
}

/**
 * RT scan price for display: only from ranked outbounds that have departure_token.
 * Direct on pair → min token price; else impute max from same outbound day, then other days.
 */
export function tokenRoutePriceForPair(
  routeKey: string,
  outDate: string,
  retDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripCombos?: RoundTripCombo[] | null,
  tokenIndex?: RtTokenPriceIndex | null,
): { price: number; source: TokenRoutePriceSource } | null {
  if (tokenIndex) return tokenRoutePriceFromIndex(tokenIndex, routeKey, outDate, retDate)
  if (!deepenStates?.length && !roundTripCombos?.length) return null

  const onPair = tokenedPricesForRouteOnPair(routeKey, outDate, retDate, deepenStates, roundTripCombos)
  const direct = minTokenPrice(onPair)
  if (direct != null) return { price: direct, source: 'direct' }

  if (!deepenStates?.length) return null

  const sameDay = maxTokenPrice(
    tokenedPricesOnOutboundDay(routeKey, outDate, deepenStates, roundTripCombos),
  )
  if (sameDay != null) return { price: sameDay, source: 'same_out_day' }

  const otherDay = maxTokenPrice(
    tokenedPricesOtherOutboundDays(routeKey, outDate, deepenStates, dateBounds, roundTripCombos),
  )
  if (otherDay != null) return { price: otherDay, source: 'other_out_day' }

  return null
}

export function maxTokenRouteOnOutboundDay(
  routeKey: string,
  outDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  roundTripCombos?: RoundTripCombo[] | null,
): number | null {
  if (!deepenStates?.length && !roundTripCombos?.length) return null
  if (!deepenStates?.length) {
    const prices: number[] = []
    for (const c of roundTripCombos ?? []) {
      if (c.routeKey !== routeKey || c.outDate !== outDate) continue
      if (c.roundTripPrice > 0) prices.push(c.roundTripPrice)
    }
    return maxTokenPrice(prices)
  }
  return maxTokenPrice(tokenedPricesOnOutboundDay(routeKey, outDate, deepenStates, roundTripCombos))
}

export function maxTokenRouteOtherOutboundDays(
  routeKey: string,
  outDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripCombos?: RoundTripCombo[] | null,
): number | null {
  if (!deepenStates?.length && !roundTripCombos?.length) return null
  if (!deepenStates?.length) {
    const prices: number[] = []
    for (const c of roundTripCombos ?? []) {
      if (c.routeKey !== routeKey || c.outDate === outDate) continue
      if (!isOutboundInBounds(c.outDate, dateBounds)) continue
      if (c.roundTripPrice > 0) prices.push(c.roundTripPrice)
    }
    return maxTokenPrice(prices)
  }
  return maxTokenPrice(
    tokenedPricesOtherOutboundDays(routeKey, outDate, deepenStates, dateBounds, roundTripCombos),
  )
}

export function maxTokenRouteFallback(
  routeKey: string,
  outDate: string,
  deepenStates?: RoundTripPairDeepenState[] | null,
  dateBounds?: PriceWindowDateBounds | null,
  roundTripCombos?: RoundTripCombo[] | null,
): number | null {
  const sameDay = maxTokenRouteOnOutboundDay(routeKey, outDate, deepenStates, roundTripCombos)
  if (sameDay != null) return sameDay
  return maxTokenRouteOtherOutboundDays(routeKey, outDate, deepenStates, dateBounds, roundTripCombos)
}
