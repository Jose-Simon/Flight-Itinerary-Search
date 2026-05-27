import type { NormalizedItinerary } from './types'

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

export type ItineraryInsightStats = {
  count: number
  cheapest: number | null
  medianPrice: number | null
  highest: number | null
  fastestMins: number | null
  medianMins: number | null
  slowestMins: number | null
}

/** Stats from itineraries that have the needed fields (price / duration always on itinerary). */
export function itineraryInsightStats(items: NormalizedItinerary[]): ItineraryInsightStats {
  const count = items.length
  const prices = items.map((it) => it.price).filter((p): p is number => p != null && Number.isFinite(p))
  const durs = items.map((it) => it.totalDurationMinutes).filter((m) => Number.isFinite(m))

  const pricesSorted = [...prices].sort((a, b) => a - b)
  const dursSorted = [...durs].sort((a, b) => a - b)

  return {
    count,
    cheapest: pricesSorted.length ? pricesSorted[0]! : null,
    medianPrice: medianSorted(pricesSorted),
    highest: pricesSorted.length ? pricesSorted[pricesSorted.length - 1]! : null,
    fastestMins: dursSorted.length ? dursSorted[0]! : null,
    medianMins: medianSorted(dursSorted),
    slowestMins: dursSorted.length ? dursSorted[dursSorted.length - 1]! : null,
  }
}

export function formatDurationHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  if (h <= 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
