import { REGION_IDS_IN_UI_ORDER, type RegionId } from '../data/regions'
import { connectionLayoverHubs } from './filters'
import { resolveHubToRegionId } from './layoverHubRegion'
import type { NormalizedItinerary } from './types'
import type { AirportRow } from './airportTypes'

/** Region bucket for layover airports not covered by any static region country list. */
export const OTHER_HUBS_REGION_ID: RegionId = 'otherHubs'

const CORE_REGION_IDS = REGION_IDS_IN_UI_ORDER.filter((id) => id !== OTHER_HUBS_REGION_ID)

/** ISO codes assigned to at least one non-Other region (from Settings + defaults). */
export function coveredCountryIsoSet(regionCountries: Record<RegionId, string[]>): Set<string> {
  const s = new Set<string>()
  for (const rid of CORE_REGION_IDS) {
    for (const iso of regionCountries[rid] ?? []) {
      const u = iso.trim().toUpperCase()
      if (u) s.add(u)
    }
  }
  return s
}

/**
 * Hubs that resolve to the **Other** bucket: missing directory, unknown country, or not in any region list; also
 * explicit override to `otherHubs` in Settings. Uses merged region country lists and optional airport IATA
 * overrides.
 */
export function unmappedLayoverHubStats(
  rawItineraries: NormalizedItinerary[],
  airportsByIata: Map<string, AirportRow>,
  regionCountries: Record<RegionId, string[]>,
  airportUiRegions: Record<string, RegionId> = {},
): { iataCounts: { iata: string; count: number }[]; hubSet: Set<string> } {
  const counts = new Map<string, number>()
  for (const it of rawItineraries) {
    for (const iata of connectionLayoverHubs(it)) {
      const u = iata.trim().toUpperCase()
      const r = resolveHubToRegionId(u, airportsByIata, regionCountries, airportUiRegions)
      if (r !== OTHER_HUBS_REGION_ID) continue
      counts.set(u, (counts.get(u) ?? 0) + 1)
    }
  }
  const iataCounts = [...counts.entries()]
    .map(([iata, count]) => ({ iata, count }))
    .sort((a, b) => b.count - a.count || a.iata.localeCompare(b.iata))
  return { iataCounts, hubSet: new Set(counts.keys()) }
}
