import type { RegionId } from '../data/regions'
import { REGION_IDS_IN_UI_ORDER } from '../data/regions'
import { expandRegionsToAirports } from './filters'
import type { AirportRow } from './airportTypes'

const OTHER: RegionId = 'otherHubs'

/** Map a country ISO to a non-Other `RegionId` using the merged region lists. */
export function regionIdForCountryIso(iso: string, regionCountries: Record<RegionId, string[]>): RegionId | null {
  const u = iso.trim().toUpperCase()
  for (const rid of REGION_IDS_IN_UI_ORDER) {
    if (rid === OTHER) continue
    if ((regionCountries[rid] ?? []).some((c) => c.trim().toUpperCase() === u)) return rid
  }
  return null
}

/**
 * Where a connection hub belongs in the layover filter: Settings airport override, else directory country → region.
 */
export function resolveHubToRegionId(
  iata: string,
  airportsByIata: Map<string, Pick<AirportRow, 'countryIso'>>,
  regionCountries: Record<RegionId, string[]>,
  airportOverrides: Record<string, RegionId>,
): RegionId {
  const code = iata.trim().toUpperCase()
  const over = airportOverrides[code]
  if (over) return over
  const row = airportsByIata.get(code)
  const country = row?.countryIso?.trim().toUpperCase()
  if (!country) return OTHER
  return regionIdForCountryIso(country, regionCountries) ?? OTHER
}

/**
 * All hub IATAs that count as `rid` for pool counts / checkboxes: country expansion plus override adds/removes.
 */
export function hubIataSetForRegion(
  rid: RegionId,
  regionCountries: Record<RegionId, string[]>,
  countryToAirports: Record<string, string[]>,
  airportOverrides: Record<string, RegionId>,
): Set<string> {
  if (rid === OTHER) return new Set()
  const s = new Set(expandRegionsToAirports([rid], regionCountries, countryToAirports))
  for (const [raw, r] of Object.entries(airportOverrides)) {
    const c = raw.trim().toUpperCase()
    if (r === rid) s.add(c)
    else s.delete(c)
  }
  return s
}
