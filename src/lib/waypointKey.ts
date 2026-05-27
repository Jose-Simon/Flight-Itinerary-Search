import type { SerpFlightSegment } from './serpapiTypes'

/** Ordered airport codes: dep → … → final arr (consecutive duplicates collapsed). */
export function waypointKeyFromSegments(flights: SerpFlightSegment[]): string {
  const codes: string[] = []
  const push = (c: string | undefined) => {
    if (!c) return
    if (codes.length && codes[codes.length - 1] === c) return
    codes.push(c)
  }
  for (const f of flights) {
    push(f.departure_airport?.id)
    push(f.arrival_airport?.id)
  }
  return codes.join('-')
}
