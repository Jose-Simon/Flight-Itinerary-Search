import { makeRouteGroupKey } from './routeGrouping'
import type { StoredRoundTripPairV1 } from './storedRoundTripPair'
import type { RoundTripPairMeta } from './roundTripPairMeta'
import type { NormalizedItinerary } from './types'

export function normRouteCsv(codes: string[]): string {
  return [...codes].map((x) => x.trim().toUpperCase()).filter(Boolean).sort().join(',')
}

export function csvToAirportSet(csv: string): Set<string> {
  return new Set(
    csv
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  )
}

/** Cached search route covers the requested airports (subset match). */
export function cachedRouteCoversRequest(
  cachedOrigins: string,
  cachedDestinations: string,
  reqOrigins: string,
  reqDestinations: string,
): boolean {
  const cachedO = csvToAirportSet(cachedOrigins)
  const cachedD = csvToAirportSet(cachedDestinations)
  const reqO = csvToAirportSet(reqOrigins)
  const reqD = csvToAirportSet(reqDestinations)
  if (!reqO.size || !reqD.size) return false
  return [...reqO].every((o) => cachedO.has(o)) && [...reqD].every((d) => cachedD.has(d))
}

export function isExactCachedRoute(
  cachedOrigins: string,
  cachedDestinations: string,
  reqOrigins: string,
  reqDestinations: string,
): boolean {
  return cachedOrigins === reqOrigins && cachedDestinations === reqDestinations
}

/** Lower is better: 0 = exact, 1+ = superset with extra airports. -1 = no match. */
export function routeMatchRank(
  cachedOrigins: string,
  cachedDestinations: string,
  reqOrigins: string,
  reqDestinations: string,
): number {
  if (!cachedRouteCoversRequest(cachedOrigins, cachedDestinations, reqOrigins, reqDestinations)) {
    return -1
  }
  if (isExactCachedRoute(cachedOrigins, cachedDestinations, reqOrigins, reqDestinations)) return 0
  const extra =
    csvToAirportSet(cachedOrigins).size -
    csvToAirportSet(reqOrigins).size +
    (csvToAirportSet(cachedDestinations).size - csvToAirportSet(reqDestinations).size)
  return extra
}

export function itineraryMatchesRequestedEndpoints(
  it: NormalizedItinerary,
  wantOrigins: Set<string>,
  wantDestinations: Set<string>,
  leg: 'outbound' | 'return',
): boolean {
  const firstDep = it.segments[0]?.dep?.trim().toUpperCase()
  const lastArr = it.segments[it.segments.length - 1]?.arr?.trim().toUpperCase()
  if (!firstDep || !lastArr) return false
  if (leg === 'outbound') {
    return wantOrigins.has(firstDep) && wantDestinations.has(lastArr)
  }
  return wantDestinations.has(firstDep) && wantOrigins.has(lastArr)
}

export function routeGroupKeyMatchesEndpoints(
  routeKey: string,
  wantOrigins: Set<string>,
  wantDestinations: Set<string>,
): boolean {
  const waypoint = routeKey.split('|')[0] ?? ''
  const airports = waypoint.split('-').filter(Boolean)
  if (airports.length < 2) return false
  const origin = airports[0]!.toUpperCase()
  const dest = airports[airports.length - 1]!.toUpperCase()
  return wantOrigins.has(origin) && wantDestinations.has(dest)
}

function filterPairMeta(
  meta: RoundTripPairMeta,
  initialMinByRoute: Record<string, number>,
  rankedLen: number,
  fetchedCount: number,
): RoundTripPairMeta {
  let globalInitialMin = Infinity
  for (const p of Object.values(initialMinByRoute)) {
    if (p > 0) globalInitialMin = Math.min(globalInitialMin, p)
  }
  return {
    ...meta,
    initialMinByRoute,
    globalInitialMin: globalInitialMin < Infinity ? globalInitialMin : null,
    rankedCount: rankedLen,
    fetchedCount: Math.min(fetchedCount, rankedLen),
  }
}

/** Narrow a stored RT pair payload to the requested origin/destination subset. */
export function filterStoredRoundTripPair(
  payload: StoredRoundTripPairV1,
  origins: string[],
  destinations: string[],
): StoredRoundTripPairV1 {
  const wantOrigins = csvToAirportSet(normRouteCsv(origins))
  const wantDests = csvToAirportSet(normRouteCsv(destinations))

  const ranked = payload.ranked.filter(({ it }) =>
    itineraryMatchesRequestedEndpoints(it, wantOrigins, wantDests, 'outbound'),
  )
  const combos = payload.combos.filter(
    (c) =>
      itineraryMatchesRequestedEndpoints(c.outIt, wantOrigins, wantDests, 'outbound') &&
      itineraryMatchesRequestedEndpoints(c.retIt, wantDests, wantOrigins, 'return'),
  )

  const initialMinByRoute: Record<string, number> = {}
  for (const [rk, p] of Object.entries(payload.initialMinByRoute)) {
    if (p > 0 && routeGroupKeyMatchesEndpoints(rk, wantOrigins, wantDests)) {
      initialMinByRoute[rk] = p
    }
  }
  for (const { it } of ranked) {
    const rk = makeRouteGroupKey(it)
    const p = it.price
    if (p != null && p > 0) {
      initialMinByRoute[rk] = Math.min(initialMinByRoute[rk] ?? Infinity, p)
    }
  }

  const pairMeta = filterPairMeta(payload.pairMeta, initialMinByRoute, ranked.length, payload.fetchedCount)

  return {
    ...payload,
    ranked,
    combos,
    initialMinByRoute,
    globalInitialMin: pairMeta.globalInitialMin,
    pairMeta,
  }
}
