import type { NormalizedItinerary } from './types'

const MAX_AIRPORTS_FOR_DEEP_LINK = 2

/** Natural-language style URL; may not reproduce exact multi-stop routing. */
export function buildGoogleFlightsSearchUrl(
  origins: string[],
  destinations: string[],
  outboundDate: string,
  returnDate: string | null,
): { url: string; reliable: boolean } {
  const reliable =
    origins.length <= MAX_AIRPORTS_FOR_DEEP_LINK &&
    destinations.length <= MAX_AIRPORTS_FOR_DEEP_LINK

  const from = origins.join(',')
  const to = destinations.join(',')
  let q = `Flights from ${from} to ${to} on ${outboundDate}`
  if (returnDate) q += ` through ${returnDate}`
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`
  return { url, reliable }
}

export function itineraryDetailsText(
  it: NormalizedItinerary,
  label: string,
  date: string,
): string {
  const lines = [
    `${label} — ${date}`,
    `Waypoints: ${it.waypointKey}`,
    `Total: ${Math.round(it.totalDurationMinutes / 60)}h ${it.totalDurationMinutes % 60}m`,
    ...it.segments.map(
      (s, i) =>
        `  ${i + 1}. ${s.dep} → ${s.arr}  ${s.airline ?? ''} ${s.flightNumber ?? ''}  ${fmt(s.durationMinutes)}  ${s.airplane ?? ''}`,
    ),
  ]
  if (it.layovers.length) {
    lines.push('Layovers:')
    for (const l of it.layovers) {
      lines.push(
        `  ${l.airport}  ${fmt(l.durationMinutes)}${l.isTechnical ? ' (technical?)' : ''}${l.excludedRegionButAllowed ? ' [excluded region]' : ''}`,
      )
    }
  }
  return lines.join('\n')
}

function fmt(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}m`
}
