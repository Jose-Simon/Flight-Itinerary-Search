import type { NormalizedItinerary } from './types'

/** Reverse a routeKey: JFK-DXB-MAA|EK → MAA-DXB-JFK|EK */
export function reverseRouteKey(routeKey: string): string {
  const [waypoint, carriers = ''] = routeKey.split('|')
  const reversed = waypoint.split('-').reverse().join('-')
  return carriers ? `${reversed}|${carriers}` : reversed
}

/** RouteGroupKey = airport path + sorted unique marketing carrier codes. */
export function makeRouteGroupKey(it: NormalizedItinerary): string {
  const carriers = [
    ...new Set(
      it.segments
        .map((s) => s.airline?.trim().toUpperCase())
        .filter((c): c is string => Boolean(c)),
    ),
  ]
    .sort()
    .join(',')
  return `${it.waypointKey}|${carriers}`
}

export type RouteDateBucket = {
  minPrice: number
  bestItinerary: NormalizedItinerary
  /** All itineraries for this route+date, sorted cheapest first. */
  allItineraries: NormalizedItinerary[]
}

export type DateTopRoute = {
  routeKey: string
  minPrice: number
  bestItinerary: NormalizedItinerary
}

export type PriceWindowResult = {
  dates: string[]
  globalMinByDate: Map<string, number>
  globalTopRoutesByDate: Map<string, DateTopRoute[]>
  perRouteByDate: Map<string, Map<string, RouteDateBucket>>
  /** Route keys ordered by overall min price across all dates (cheapest first). */
  routeKeyOrder: string[]
}

const TOP_ROUTES_PER_DATE = 5

export function buildPriceWindowResult(
  perDateItineraries: { date: string; itineraries: NormalizedItinerary[] }[],
): PriceWindowResult {
  const dates = perDateItineraries.map((d) => d.date)
  const globalMinByDate = new Map<string, number>()
  const globalTopRoutesByDate = new Map<string, DateTopRoute[]>()
  const perRouteByDate = new Map<string, Map<string, RouteDateBucket>>()

  for (const { date, itineraries } of perDateItineraries) {
    let globalMin: number | null = null
    const dateRouteMap = new Map<string, {
      minPrice: number
      bestItinerary: NormalizedItinerary
      allItineraries: NormalizedItinerary[]
    }>()

    for (const it of itineraries) {
      const price = it.price
      if (price == null || !Number.isFinite(price)) continue

      if (globalMin == null || price < globalMin) globalMin = price

      const routeKey = makeRouteGroupKey(it)
      const existing = dateRouteMap.get(routeKey)
      if (!existing) {
        dateRouteMap.set(routeKey, { minPrice: price, bestItinerary: it, allItineraries: [it] })
      } else {
        existing.allItineraries.push(it)
        if (price < existing.minPrice) {
          existing.minPrice = price
          existing.bestItinerary = it
        }
      }
    }

    // Sort each bucket's itineraries cheapest-first
    for (const bucket of dateRouteMap.values()) {
      bucket.allItineraries.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    }

    if (globalMin != null) globalMinByDate.set(date, globalMin)

    for (const [routeKey, { minPrice, bestItinerary, allItineraries }] of dateRouteMap) {
      if (!perRouteByDate.has(routeKey)) perRouteByDate.set(routeKey, new Map())
      perRouteByDate.get(routeKey)!.set(date, { minPrice, bestItinerary, allItineraries })
    }

    const sortedRoutes = [...dateRouteMap.entries()]
      .sort((a, b) => a[1].minPrice - b[1].minPrice)
      .slice(0, TOP_ROUTES_PER_DATE)
      .map(([routeKey, { minPrice, bestItinerary }]) => ({ routeKey, minPrice, bestItinerary }))
    globalTopRoutesByDate.set(date, sortedRoutes)
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

  return { dates, globalMinByDate, globalTopRoutesByDate, perRouteByDate, routeKeyOrder }
}
