import type { AirportRow } from './airportTypes'

/**
 * OpenFlights data has no airport “type”. For nearby suggestions we drop entries that
 * look like military / non–scheduled-passenger facilities based on name + city text.
 * Typed search still lists every IATA in the directory.
 */
const NON_COMMERCIAL_NAME_HINTS: RegExp[] = [
  /\bnaval\b/i,
  /\bair\s*station\b/i,
  /\bair\s*base\b/i,
  /\bair\s*force\b|\bairforce\b/i,
  /\braf\b/i,
  /\bafb\b/i,
  /\bmcas\b/i,
  /\bnas\b/i,
  /\bmilitary\b/i,
  /\bcoast\s*guard\b/i,
  /\bmarine\s+corps\b/i,
  /\bspace\s*force\b/i,
  /\bjoint\s+reserve\b/i,
  /\breserve\s+base\b/i,
  /\bnational\s+guard\b/i,
  /\bauxiliary\s+field\b/i,
  /\bproving\s+ground/i,
  /\bwarbirds?\b/i,
  /\b\(closed\)/i,
  /\btraining\s+base\b/i,
  /\bweapons\s+station\b/i,
  /\barmy\s+airfield\b/i,
  /\bheliport\b/i,
]

export function isLikelyCommercialPassengerAirport(row: AirportRow): boolean {
  const hay = `${row.name} ${row.city}`.toLowerCase()
  for (const re of NON_COMMERCIAL_NAME_HINTS) {
    if (re.test(hay)) return false
  }
  return true
}
