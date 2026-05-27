import type { SerpGoogleFlightsResponse } from './serpapiTypes'
import type { NormalizedItinerary } from './types'
import {
  collectAllSerpOptions,
  markExcludedRegionLayovers,
  normalizeSerpOption,
} from './normalizeFlight'
import { dedupeByScheduleKey, itineraryScheduleKey, sortItineraries, type SortMode } from './filters'

export type NormalizeContext = {
  primaryDestination?: string
  direction: 'outbound' | 'return'
  multipleDestinations?: boolean
  roundTrip?: boolean
}

/**
 * Normalize SerpApi options into itineraries. Does not apply layover/hour/open-jaw filters —
 * those run in the UI so users can change filters without shrinking the stored pool.
 */
export function processSerpResponse(
  resp: SerpGoogleFlightsResponse,
  ctx: NormalizeContext,
  excludedAirports: Set<string>,
  sort: SortMode,
): NormalizedItinerary[] {
  const opts = collectAllSerpOptions(resp)
  let list: NormalizedItinerary[] = []
  for (const o of opts) {
    const n = normalizeSerpOption(o, ctx)
    if (n) list.push(markExcludedRegionLayovers(n, excludedAirports))
  }
  list = dedupeByScheduleKey(list)
  list = sortItineraries(list, sort)
  return list
}

/**
 * Merge per-date lists: dedupe by full schedule key across the flex window.
 * When `perDateLimit` is finite, each departure day contributes at most that many new keys.
 * Use `Infinity` to keep every distinct itinerary returned for each day (typical ~low hundreds per response).
 */
export function mergePerDateUnique(
  perDate: NormalizedItinerary[][],
  perDateLimit: number,
  sort: SortMode,
): NormalizedItinerary[] {
  const capped = Number.isFinite(perDateLimit)
  const global = new Map<string, NormalizedItinerary>()
  for (const batch of perDate) {
    let added = 0
    const sorted = sortItineraries(batch, sort)
    for (const it of sorted) {
      if (capped && added >= perDateLimit) break
      const k = itineraryScheduleKey(it)
      if (global.has(k)) continue
      global.set(k, it)
      added++
    }
  }
  return sortItineraries([...global.values()], sort)
}
