import type { AirportRow } from './airportTypes'
import { isLikelyCommercialPassengerAirport } from './airportCommercialHeuristic'

const EARTH_RADIUS_KM = 6371

/** Great-circle distance between two WGS84 points (km). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r1 = (lat1 * Math.PI) / 180
  const r2 = (lat2 * Math.PI) / 180
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

export type NearbyAirport = { row: AirportRow; distanceKm: number }

export const NEARBY_AIRPORT_MAX = 5

/** Minimum km to any anchor; `Infinity` if no valid anchor coords. */
export function minDistanceKmToAnchors(
  row: AirportRow,
  anchorRows: AirportRow[],
): number {
  if (row.lat == null || row.lon == null || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) {
    return Infinity
  }
  let min = Infinity
  for (const a of anchorRows) {
    if (a.lat == null || a.lon == null || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue
    const d = haversineKm(row.lat, row.lon, a.lat, a.lon)
    if (d < min) min = d
  }
  return min
}

/**
 * Closest `maxCount` airports to any anchor (by minimum distance), excluding given IATAs and anchors themselves.
 * Skips entries that look like military / heliport / closed (heuristic on name + city); typed search is unchanged.
 */
export function nearbyAirportsForAnchors(
  airports: AirportRow[],
  anchorIatas: string[],
  opts: { maxCount?: number; excludeIatas?: Set<string> },
): NearbyAirport[] {
  const maxCount = opts.maxCount ?? NEARBY_AIRPORT_MAX
  const exclude = opts.excludeIatas ?? new Set<string>()
  const anchorU = anchorIatas.map((c) => c.trim().toUpperCase()).filter(Boolean)
  const anchorRows: AirportRow[] = []
  const byIata = new Map<string, AirportRow>()
  for (const a of airports) {
    const u = a.iata.trim().toUpperCase()
    byIata.set(u, a)
  }
  for (const u of anchorU) {
    const r = byIata.get(u)
    if (r) anchorRows.push(r)
  }
  if (anchorRows.length === 0) return []

  const scored: NearbyAirport[] = []
  for (const row of airports) {
    const u = row.iata.trim().toUpperCase()
    if (exclude.has(u)) continue
    if (anchorU.includes(u)) continue
    if (!isLikelyCommercialPassengerAirport(row)) continue
    const distanceKm = minDistanceKmToAnchors(row, anchorRows)
    if (!Number.isFinite(distanceKm) || distanceKm === Infinity) continue
    scored.push({ row, distanceKm })
  }
  scored.sort((a, b) => a.distanceKm - b.distanceKm || a.row.iata.localeCompare(b.row.iata))
  return scored.slice(0, maxCount)
}
