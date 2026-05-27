import type { NormalizedItinerary } from './types'
import { connectionLayoverHubs } from './filters'

export type LayoverHubRow = { code: string; count: number }

export type StopsBucket = { key: 'nonstop' | 'oneStop' | 'multi'; label: string; count: number }

/** Count itineraries per airline IATA (once per itinerary if that airline flies any segment). */
export function itineraryCountsByAirline(items: NormalizedItinerary[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    const codes = new Set<string>()
    for (const s of it.segments) {
      const c = s.airline?.trim().toUpperCase()
      if (c) codes.add(c)
    }
    for (const c of codes) {
      m.set(c, (m.get(c) ?? 0) + 1)
    }
  }
  return m
}

/** Layover airport frequency across itineraries (connection airports only). */
export function layoverHubCounts(items: NormalizedItinerary[]): LayoverHubRow[] {
  const m = new Map<string, number>()
  for (const it of items) {
    for (const c of connectionLayoverHubs(it)) {
      m.set(c, (m.get(c) ?? 0) + 1)
    }
  }
  return [...m.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

export function stopsDistribution(items: NormalizedItinerary[]): StopsBucket[] {
  let nonstop = 0
  let oneStop = 0
  let multi = 0
  for (const it of items) {
    const n = it.segments.length
    if (n <= 1) nonstop += 1
    else if (n === 2) oneStop += 1
    else multi += 1
  }
  return [
    { key: 'nonstop', label: 'Nonstop', count: nonstop },
    { key: 'oneStop', label: '1 stop', count: oneStop },
    { key: 'multi', label: '2+ stops', count: multi },
  ]
}
