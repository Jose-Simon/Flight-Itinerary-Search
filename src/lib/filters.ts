import type { NormalizedItinerary, NormalizedSegment } from './types'
import type { RegionId } from '../data/regions'

export type SortMode = 'duration' | 'flight' | 'stops' | 'layover' | 'price'

/** How min/max leg duration applies when an itinerary has multiple segments. */
export type LegDurationMatchMode = 'all' | 'any'

/**
 * Deduplication mode for the results list.
 * - 'off'      — show all itineraries (one row per date/variant)
 * - 'route'    — one row per airport path (cheapest fare wins)
 * - 'schedule' — one row per airport path + layover durations combo (different connection
 *                lengths are separate rows; still deduplicates exact same-schedule entries)
 */
export type DedupeMode = 'off' | 'route' | 'schedule'

/** Max connections (layovers) allowed when stops max is open — keeps pool usable without “max segments” UI. */
const DEFAULT_MAX_LAYOVERS_CAP = 20

export type FilterState = {
  minLegHours: number | null
  maxLegHours: number | null
  legDurationMatch: LegDurationMatchMode
  minTotalHours: number | null
  maxTotalHours: number | null
  /** Sum of segment airborne times (excludes time on ground between flights). */
  minTotalFlightHours: number | null
  maxTotalFlightHours: number | null
  /** Sum of all layover durations */
  minTotalLayoverHours: number | null
  maxTotalLayoverHours: number | null
  minStops: number | null
  maxStops: number | null
  maxLayovers: number
  excludeTechnicalStops: boolean
  showOpenJaw: boolean
  /**
   * Layover airports must be in this set. `null` = no layover-airport restriction (all regions/airports on).
   */
  allowedLayoverAirports: Set<string> | null
  /** If non-empty, itinerary must include at least one layover at one of these hubs. */
  requiredLayoverHubs: Set<string>
  /** If non-null and non-empty, only these waypoint keys (full airport path) are shown. */
  routeWaypointFilter: Set<string> | null
  sort: SortMode
  /** Min fare (same currency as SerpApi / Settings). Null = no lower bound. */
  minPrice: number | null
  /** Max fare. Null = no upper bound. */
  maxPrice: number | null
}

function sumLayoverMinutes(it: NormalizedItinerary): number {
  return it.layovers.reduce((s, l) => s + l.durationMinutes, 0)
}

/** Scheduled time in the air: sum of segment durations (excludes layovers on the ground). */
export function totalFlightMinutes(it: NormalizedItinerary): number {
  return it.segments.reduce((s, seg) => s + seg.durationMinutes, 0)
}

/**
 * Connection airports between segments (never the final destination).
 * Prefer this over raw `it.layovers` for geography: SerpApi often omits layover rows or misaligns them
 * vs `flights`, which incorrectly fails hub whitelists for valid YUL+FRA, DUB+LHR, etc.
 */
export function connectionLayoverHubs(it: NormalizedItinerary): string[] {
  const segs = it.segments
  const out: string[] = []
  if (segs.length < 2) return out
  for (let i = 0; i < segs.length - 1; i++) {
    if (it.layovers[i]?.isTechnical) continue
    const hub = segs[i]?.arr?.trim().toUpperCase()
    if (hub) out.push(hub)
  }
  return out
}

/** Every non-technical connection hub must be in `allowed`. `null` = no restriction. */
export function passesLayoverAirportWhitelist(it: NormalizedItinerary, allowed: Set<string> | null): boolean {
  if (allowed == null) return true
  for (const hub of connectionLayoverHubs(it)) {
    if (!allowed.has(hub)) return false
  }
  return true
}

export function passesAirlineResultFilter(it: NormalizedItinerary, excludedAirlineCodes: Set<string>): boolean {
  if (excludedAirlineCodes.size === 0) return true
  for (const s of it.segments) {
    const c = s.airline?.trim().toUpperCase()
    if (c && excludedAirlineCodes.has(c)) return false
  }
  return true
}

function segmentMatchesLegHours(seg: NormalizedSegment, f: FilterState): boolean {
  if (f.minLegHours != null && seg.durationMinutes < f.minLegHours * 60) return false
  if (f.maxLegHours != null && seg.durationMinutes > f.maxLegHours * 60) return false
  return true
}

export function passesItineraryFilters(it: NormalizedItinerary, f: FilterState): boolean {
  // Count intermediate airports from the waypoint path rather than segments.length-1
  // so that ground-transfer legs (e.g. HND→NRT bus) are counted as a stop even though
  // they create a gap in the segments array rather than a dedicated segment entry.
  const connections = Math.max(0, it.waypointKey.split('-').length - 2)
  if (connections > f.maxLayovers) return false
  if (f.minStops != null && connections < f.minStops) return false
  if (f.maxStops != null && connections > f.maxStops) return false

  const legBounded = f.minLegHours != null || f.maxLegHours != null
  if (legBounded) {
    if (f.legDurationMatch === 'any') {
      if (!it.segments.some((seg) => segmentMatchesLegHours(seg, f))) return false
    } else {
      for (const seg of it.segments) {
        if (!segmentMatchesLegHours(seg, f)) return false
      }
    }
  }

  if (f.minTotalHours != null && it.totalDurationMinutes < f.minTotalHours * 60) return false
  if (f.maxTotalHours != null && it.totalDurationMinutes > f.maxTotalHours * 60) return false

  const flightMins = totalFlightMinutes(it)
  if (f.minTotalFlightHours != null && flightMins < f.minTotalFlightHours * 60) return false
  if (f.maxTotalFlightHours != null && flightMins > f.maxTotalFlightHours * 60) return false

  const laySum = sumLayoverMinutes(it)
  if (f.minTotalLayoverHours != null && laySum < f.minTotalLayoverHours * 60) return false
  if (f.maxTotalLayoverHours != null && laySum > f.maxTotalLayoverHours * 60) return false

  if (f.excludeTechnicalStops) {
    for (let i = 0; i < Math.max(0, it.segments.length - 1); i++) {
      if (it.layovers[i]?.isTechnical) return false
    }
  }

  if (!f.showOpenJaw && it.openJaw) return false

  if (!passesLayoverAirportWhitelist(it, f.allowedLayoverAirports)) return false

  /** Map pins: keep itineraries whose airport path includes any selected code (layover, origin, or destination). */
  if (f.requiredLayoverHubs.size > 0) {
    const pathCodes = new Set(it.waypointKey.split('-').filter(Boolean).map((c) => c.trim().toUpperCase()))
    let match = false
    for (const req of f.requiredLayoverHubs) {
      if (pathCodes.has(req.trim().toUpperCase())) {
        match = true
        break
      }
    }
    if (!match) return false
  }

  if (f.routeWaypointFilter != null && f.routeWaypointFilter.size > 0) {
    if (!f.routeWaypointFilter.has(it.waypointKey)) return false
  }

  const priceBounded = f.minPrice != null || f.maxPrice != null
  if (priceBounded) {
    const p = it.price
    if (p == null || !Number.isFinite(p)) return false
    if (f.minPrice != null && p < f.minPrice) return false
    if (f.maxPrice != null && p > f.maxPrice) return false
  }

  return true
}

export type AircraftMatchMode = 'any' | 'every'

/** If `selected` is empty, passes. Otherwise filter by segment `airplane` (exact string match after trim). */
export function passesAircraftFilter(
  it: NormalizedItinerary,
  selected: Set<string>,
  mode: AircraftMatchMode,
): boolean {
  if (selected.size === 0) return true
  const legMatches = (seg: NormalizedSegment) => {
    const ap = seg.airplane?.trim()
    if (!ap) return false
    return selected.has(ap)
  }
  if (mode === 'any') return it.segments.some(legMatches)
  return it.segments.length > 0 && it.segments.every(legMatches)
}

/** @deprecated Use passesItineraryFilters */
export const passesFiltersWithExcludedSet = passesItineraryFilters

/**
 * When `excludeOftenDelayed` is true, rejects itineraries where ANY segment is
 * flagged as often delayed by 30+ minutes.
 */
export function passesDelayFilter(
  it: NormalizedItinerary,
  excludeOftenDelayed: boolean,
): boolean {
  if (!excludeOftenDelayed) return true
  return !it.segments.some((s) => s.oftenDelayed === true)
}

/**
 * When `minLegroomIn` is set, rejects itineraries where ANY segment has a known
 * legroom value strictly below the minimum. Segments with unknown legroom are
 * allowed through (can't exclude what we don't know).
 */
export function passesLegroomFilter(
  it: NormalizedItinerary,
  minLegroomIn: number | null,
): boolean {
  if (minLegroomIn == null) return true
  return !it.segments.some((s) => s.legroom != null && s.legroom < minLegroomIn)
}

export function totalLayoverMinutes(it: NormalizedItinerary): number {
  return sumLayoverMinutes(it)
}

function priceSortRank(it: NormalizedItinerary): number {
  const p = it.price
  if (p != null && Number.isFinite(p)) return p
  return Number.POSITIVE_INFINITY
}

export function sortItineraries(list: NormalizedItinerary[], sort: SortMode): NormalizedItinerary[] {
  const out = [...list]
  if (sort === 'duration') {
    out.sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes)
  } else if (sort === 'flight') {
    out.sort((a, b) => totalFlightMinutes(a) - totalFlightMinutes(b))
  } else if (sort === 'stops') {
    out.sort((a, b) => a.segments.length - b.segments.length)
  } else if (sort === 'price') {
    out.sort((a, b) => {
      const pa = priceSortRank(a)
      const pb = priceSortRank(b)
      if (pa !== pb) return pa - pb
      if (a.totalDurationMinutes !== b.totalDurationMinutes) {
        return a.totalDurationMinutes - b.totalDurationMinutes
      }
      return a.waypointKey.localeCompare(b.waypointKey)
    })
  } else {
    out.sort((a, b) => totalLayoverMinutes(a) - totalLayoverMinutes(b))
  }
  return out
}

export function dedupeByWaypoint(items: NormalizedItinerary[]): NormalizedItinerary[] {
  const seen = new Set<string>()
  const out: NormalizedItinerary[] = []
  for (const it of items) {
    if (seen.has(it.waypointKey)) continue
    seen.add(it.waypointKey)
    out.push(it)
  }
  return out
}

/**
 * Distinct option key: airport path + layover airports/durations + segment times.
 * Same waypoint string with different connection length or departure time is kept separate.
 */
export function itineraryScheduleKey(it: NormalizedItinerary): string {
  const lay = it.layovers.length
    ? it.layovers.map((l) => `${l.airport}:${l.durationMinutes}`).join('>')
    : '∅'
  const times = it.segments.map((s) => `${s.depTime ?? '?'}/${s.arrTime ?? '?'}`).join('|')
  return `${it.waypointKey}§${lay}§${times}`
}

export function dedupeByScheduleKey(items: NormalizedItinerary[]): NormalizedItinerary[] {
  const seen = new Set<string>()
  const out: NormalizedItinerary[] = []
  for (const it of items) {
    const k = itineraryScheduleKey(it)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

/** Same schedule key may appear on multiple date pairs with different RT prices — keep cheapest. */
export function dedupeByScheduleKeyKeepMinPrice(items: NormalizedItinerary[]): NormalizedItinerary[] {
  const byKey = new Map<string, NormalizedItinerary>()
  for (const it of items) {
    const k = itineraryScheduleKey(it)
    const prev = byKey.get(k)
    if (!prev) {
      byKey.set(k, it)
      continue
    }
    const prevP = prev.price ?? Infinity
    const nextP = it.price ?? Infinity
    if (nextP < prevP) byKey.set(k, it)
  }
  return [...byKey.values()]
}

/** After filtering: keep the cheapest itinerary per airport path, then re-sort by the active sort. */
export function dedupeDisplayByWaypoint(items: NormalizedItinerary[], sort: SortMode): NormalizedItinerary[] {
  // Always rank by price to pick the best per route — dedup by duration would hide cheaper long-layover
  // variants when the user later applies a min-layover filter or switches the display sort to price.
  const byPrice = sortItineraries([...items], 'price')
  const best = new Map<string, NormalizedItinerary>()
  for (const it of byPrice) {
    if (!best.has(it.waypointKey)) best.set(it.waypointKey, it)
  }
  return sortItineraries([...best.values()], sort)
}

/**
 * Key combining the airport path with each layover's airport and duration.
 * Two itineraries on the same route but with different layover lengths get distinct keys.
 * Does NOT include departure/arrival times, so the same schedule on different calendar dates
 * shares the same key and the cheapest date is kept.
 */
export function routeAndScheduleKey(it: NormalizedItinerary): string {
  const lay = it.layovers.map((l) => `${l.airport}:${l.durationMinutes}`).join('>')
  return `${it.waypointKey}§${lay || '∅'}`
}

/**
 * Keep the cheapest itinerary per (route + layover-duration combo), then re-sort.
 * Itineraries that share an airport path but differ in connection time appear as separate rows.
 * Within each schedule variant the cheapest date wins.
 */
export function dedupeDisplayBySchedule(items: NormalizedItinerary[], sort: SortMode): NormalizedItinerary[] {
  const byPrice = sortItineraries([...items], 'price')
  const best = new Map<string, NormalizedItinerary>()
  for (const it of byPrice) {
    const k = routeAndScheduleKey(it)
    if (!best.has(k)) best.set(k, it)
  }
  return sortItineraries([...best.values()], sort)
}

export function expandRegionsToAirports(
  regionIds: RegionId[],
  regionCountryMap: Record<RegionId, string[]>,
  countryToAirports: Record<string, string[]>,
): Set<string> {
  const set = new Set<string>()
  for (const rid of regionIds) {
    for (const iso of regionCountryMap[rid] ?? []) {
      for (const iata of countryToAirports[iso] ?? []) {
        const u = iata.trim().toUpperCase()
        if (u) set.add(u)
      }
    }
  }
  return set
}

export type HourFieldStrings = {
  minLeg: string
  maxLeg: string
  minTotal: string
  maxTotal: string
  minFlight: string
  maxFlight: string
  minLayover: string
  maxLayover: string
}

export type PriceFieldStrings = {
  min: string
  max: string
}

export type StopsFieldStrings = {
  minStops: string
  maxStops: string
}

function parseHours(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseHoursPair(minS: string, maxS: string): { min: number | null; max: number | null } {
  let minH = parseHours(minS)
  let maxH = parseHours(maxS)
  if (minH != null && maxH != null && minH > maxH) {
    const t = minH
    minH = maxH
    maxH = t
  }
  return { min: minH, max: maxH }
}

function parseStopsInt(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Math.floor(Number(t))
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(20, n))
}

function parsePriceInput(s: string): number | null {
  const t = s.trim().replace(/[$,\s]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parsePricePair(minS: string, maxS: string): { min: number | null; max: number | null } {
  let minP = parsePriceInput(minS)
  let maxP = parsePriceInput(maxS)
  if (minP != null && maxP != null && minP > maxP) {
    const t = minP
    minP = maxP
    maxP = t
  }
  return { min: minP, max: maxP }
}

export function filterStateFromInputs(
  sort: SortMode,
  hours: HourFieldStrings,
  stops: StopsFieldStrings,
  flags: {
    excludeTechnicalStops: boolean
    showOpenJaw: boolean
    allowedLayoverAirports: Set<string> | null
    requiredLayoverHubs: Set<string>
    routeWaypointFilter: Set<string> | null
    legDurationMatch: LegDurationMatchMode
  },
  priceFields: PriceFieldStrings = { min: '', max: '' },
): FilterState {
  const leg = parseHoursPair(hours.minLeg, hours.maxLeg)
  const total = parseHoursPair(hours.minTotal, hours.maxTotal)
  const flight = parseHoursPair(hours.minFlight, hours.maxFlight)
  const lay = parseHoursPair(hours.minLayover, hours.maxLayover)
  const price = parsePricePair(priceFields.min, priceFields.max)

  let minStops = parseStopsInt(stops.minStops)
  let maxStops = parseStopsInt(stops.maxStops)
  if (minStops != null && maxStops != null && minStops > maxStops) {
    const t = minStops
    minStops = maxStops
    maxStops = t
  }

  return {
    minLegHours: leg.min,
    maxLegHours: leg.max,
    legDurationMatch: flags.legDurationMatch,
    minTotalHours: total.min,
    maxTotalHours: total.max,
    minTotalFlightHours: flight.min,
    maxTotalFlightHours: flight.max,
    minTotalLayoverHours: lay.min,
    maxTotalLayoverHours: lay.max,
    minStops,
    maxStops,
    maxLayovers: DEFAULT_MAX_LAYOVERS_CAP,
    excludeTechnicalStops: flags.excludeTechnicalStops,
    showOpenJaw: flags.showOpenJaw,
    allowedLayoverAirports: flags.allowedLayoverAirports,
    requiredLayoverHubs: flags.requiredLayoverHubs,
    routeWaypointFilter: flags.routeWaypointFilter,
    sort,
    minPrice: price.min,
    maxPrice: price.max,
  }
}
