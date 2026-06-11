import type { SerpFlightOption, SerpFlightSegment } from './serpapiTypes'
import type { NormalizedItinerary, NormalizedLayover, NormalizedSegment } from './types'
import { waypointKeyFromSegments } from './waypointKey'

function extensionsText(segments: SerpFlightSegment[]): string {
  return segments
    .flatMap((s) => s.extensions ?? [])
    .join(' ')
    .toLowerCase()
}

/** Normalize for comparison (e.g. "EY 185" vs "EY185"). */
function normalizedFlightNumber(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  return raw.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Heuristic: explicit “technical” in extensions, or a short ground time on what looks like one
 * flight (same flight number before/after). Different flight numbers ⇒ connection, not technical.
 */
export function isTechnicalLayover(
  durationMinutes: number,
  prev?: SerpFlightSegment,
  next?: SerpFlightSegment,
): boolean {
  const fnPrev = normalizedFlightNumber(prev?.flight_number)
  const fnNext = normalizedFlightNumber(next?.flight_number)
  if (fnPrev && fnNext && fnPrev !== fnNext) return false

  const ext = `${extensionsText([prev].filter(Boolean) as SerpFlightSegment[])} ${extensionsText([next].filter(Boolean) as SerpFlightSegment[])}`
  if (ext.includes('technical')) return true
  if (durationMinutes > 0 && durationMinutes <= 55) return true
  return false
}

export function normalizeSerpOption(
  opt: SerpFlightOption,
  ctx: {
    /** Full set of searched destination airports — used for open-jaw detection. */
    destinations?: string[]
    direction: 'outbound' | 'return'
    /** Industry open-jaw is a round-trip pattern (arrive one city, return from another). */
    roundTrip?: boolean
    /** @deprecated use destinations[] instead */
    primaryDestination?: string
    /** @deprecated use destinations[] instead */
    multipleDestinations?: boolean
  },
): NormalizedItinerary | null {
  const flights = opt.flights ?? []
  if (!flights.length) return null

  const segments: NormalizedSegment[] = flights.map((f) => ({
    dep: f.departure_airport?.id ?? '',
    arr: f.arrival_airport?.id ?? '',
    depTime: f.departure_airport?.time,
    arrTime: f.arrival_airport?.time,
    durationMinutes: f.duration ?? 0,
    airline: f.airline,
    airlineLogo: f.airline_logo,
    flightNumber: f.flight_number,
    airplane: f.airplane,
  }))

  const layoversRaw = opt.layovers ?? []
  const layovers: NormalizedLayover[] = layoversRaw.map((l, i) => {
    const prev = flights[i]
    const next = flights[i + 1]
    const dm = l.duration ?? 0
    const tech = isTechnicalLayover(dm, prev, next)
    return {
      airport: l.id ?? '',
      name: l.name,
      durationMinutes: dm,
      isTechnical: tech,
    }
  })

  const airlines = [...new Set(flights.map((f) => f.airline).filter(Boolean))] as string[]

  let openJaw = false
  const rt = ctx.roundTrip === true
  if (rt) {
    // Build the effective destinations set: prefer new destinations[] array, fall back to legacy primaryDestination
    const destSet = ctx.destinations && ctx.destinations.length > 0
      ? new Set(ctx.destinations)
      : ctx.primaryDestination
        ? new Set([ctx.primaryDestination])
        : null
    if (destSet) {
      if (ctx.direction === 'outbound') {
        const last = segments[segments.length - 1]?.arr
        if (last && !destSet.has(last)) openJaw = true
      } else {
        const first = segments[0]?.dep
        if (first && !destSet.has(first)) openJaw = true
      }
    }
  }

  return {
    waypointKey: waypointKeyFromSegments(flights),
    segments,
    layovers,
    totalDurationMinutes: opt.total_duration ?? 0,
    airlines,
    ...(opt.price != null && Number.isFinite(opt.price) ? { price: opt.price } : {}),
    openJaw,
    raw: opt,
  }
}

export function collectAllSerpOptions(resp: {
  best_flights?: SerpFlightOption[]
  other_flights?: SerpFlightOption[]
}): SerpFlightOption[] {
  return [...(resp.best_flights ?? []), ...(resp.other_flights ?? [])]
}

/** Mark layovers that sit in an excluded region but are kept as technical stops. */
export function markExcludedRegionLayovers(
  it: NormalizedItinerary,
  excludedAirports: Set<string>,
): NormalizedItinerary {
  const layovers = it.layovers.map((l) => {
    if (!l.airport || !excludedAirports.has(l.airport)) return l
    if (l.isTechnical) {
      return { ...l, excludedRegionButAllowed: true }
    }
    return l
  })
  return { ...it, layovers }
}
