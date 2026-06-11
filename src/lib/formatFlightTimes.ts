import { DateTime } from 'luxon'
import type { NormalizedItinerary, NormalizedSegment } from './types'

function parseAtAirport(raw: string | undefined, iata: string, tzByIata: Map<string, string>): DateTime | null {
  if (!raw?.trim()) return null
  const z = tzByIata.get(iata) || 'UTC'
  const dt = DateTime.fromFormat(raw.trim(), 'yyyy-MM-dd HH:mm', { zone: z })
  return dt.isValid ? dt : null
}

function displayDt(dt: DateTime, displayZone: string): DateTime {
  const o = displayZone.trim()
  return o ? dt.setZone(o) : dt
}

export type TimelineEndpoint = { time: string; dayPlus: number }

/** Per-segment timeline labels (local at each airport, or converted to display TZ override). */
export function formatSegmentTimeline(
  s: NormalizedSegment,
  tzByIata: Map<string, string>,
  displayZone: string,
): { dep: TimelineEndpoint; arr: TimelineEndpoint; overnight: boolean } {
  const depDt0 = parseAtAirport(s.depTime, s.dep, tzByIata)
  const arrDt0 = parseAtAirport(s.arrTime, s.arr, tzByIata)
  const depShow = depDt0 ? displayDt(depDt0, displayZone) : null
  const arrShow = arrDt0 ? displayDt(arrDt0, displayZone) : null

  let dayPlus = 0
  if (depShow && arrShow) {
    const ms = arrShow.startOf('day').toMillis() - depShow.startOf('day').toMillis()
    dayPlus = Math.max(0, Math.round(ms / 86_400_000))
  }

  const dep: TimelineEndpoint = {
    time: depShow ? depShow.toFormat('h:mm a') : s.depTime ?? '—',
    dayPlus: 0,
  }
  const arr: TimelineEndpoint = {
    time: arrShow ? arrShow.toFormat('h:mm a') : s.arrTime ?? '—',
    dayPlus,
  }

  const overnight =
    dayPlus >= 1 || (s.durationMinutes >= 300 && depShow != null && depShow.hour >= 19)

  return { dep, arr, overnight }
}

/** Header line e.g. "Departure · Sun, May 10". */
/** First departure instant in the display zone (for +day offsets vs trip start). */
export function tripStartDisplayAnchor(
  firstSeg: NormalizedSegment | undefined,
  tzByIata: Map<string, string>,
  displayZone: string,
): DateTime | null {
  if (!firstSeg) return null
  const depDt0 = parseAtAirport(firstSeg.depTime, firstSeg.dep, tzByIata)
  if (!depDt0) return null
  return displayDt(depDt0, displayZone)
}

/**
 * Departure time-of-day in minutes (0–1439) converted to the display timezone.
 * Used by the Timeline Gantt X-axis so bars shift when the user changes their display TZ.
 */
export function depMinOfDayInZone(
  seg: NormalizedSegment,
  tzByIata: Map<string, string>,
  displayZone: string,
): number {
  const dt0 = parseAtAirport(seg.depTime, seg.dep, tzByIata)
  if (!dt0) {
    const [hh, mm] = (seg.depTime?.split(' ')[1] ?? '').split(':').map(Number)
    return (hh || 0) * 60 + (mm || 0)
  }
  const shown = displayZone.trim() ? dt0.setZone(displayZone.trim()) : dt0
  return shown.hour * 60 + shown.minute
}

/** Calendar days after trip-start day (0 = same day as first departure). */
export function calendarDayOffsetFromTripStart(
  raw: string | undefined,
  iata: string,
  tripStart: DateTime | null,
  tzByIata: Map<string, string>,
  displayZone: string,
): number {
  if (!tripStart || !raw?.trim()) return 0
  const dt0 = parseAtAirport(raw, iata, tzByIata)
  if (!dt0) return 0
  const show = displayDt(dt0, displayZone)
  const start = displayDt(tripStart, displayZone)
  const ms = show.startOf('day').toMillis() - start.startOf('day').toMillis()
  return Math.max(0, Math.round(ms / 86_400_000))
}

export function formatFirstDepartureHeading(
  s: NormalizedSegment | undefined,
  tzByIata: Map<string, string>,
  displayZone: string,
): string {
  if (!s?.depTime?.trim()) return 'Itinerary'
  const dt0 = parseAtAirport(s.depTime, s.dep, tzByIata)
  if (!dt0) return 'Itinerary'
  const show = displayDt(dt0, displayZone)
  return `Departure · ${show.toFormat('ccc, MMM d')}`
}

/**
 * Short departure date for inline display in the itinerary route header.
 * Returns e.g. "Mon Aug 1" or null if the segment has no parseable departure time.
 */
export function formatDepartureDate(
  s: NormalizedSegment | undefined,
  tzByIata: Map<string, string>,
  displayZone: string,
): string | null {
  if (!s?.depTime?.trim()) return null
  const dt0 = parseAtAirport(s.depTime, s.dep, tzByIata)
  if (!dt0) return null
  const show = displayDt(dt0, displayZone)
  return show.toFormat('ccc MMM d')
}

/** One stop entry in a compact times chain: IATA code, formatted time, and +day offset from trip start. */
export type TimesChainStop = { iata: string; time: string; dayPlus: number }

/**
 * Compact departure/arrival chain for inline display.
 * Returns one entry per airport visited:
 *   - All segment departure airports (with departure time)
 *   - The final arrival airport (with arrival time)
 *
 * E.g. for JFK→DOH→MAA:
 *   [ {iata:'JFK', time:'6:15 pm', dayPlus:0},
 *     {iata:'DOH', time:'8:20 pm', dayPlus:1},
 *     {iata:'MAA', time:'2:30 am', dayPlus:2} ]
 */
export function formatTimesChain(
  it: NormalizedItinerary,
  tzByIata: Map<string, string>,
  displayZone: string,
): TimesChainStop[] {
  if (!it.segments.length) return []
  const tripStart = tripStartDisplayAnchor(it.segments[0], tzByIata, displayZone)

  const result: TimesChainStop[] = []

  for (const s of it.segments) {
    const dt0 = parseAtAirport(s.depTime, s.dep, tzByIata)
    if (!dt0) return []  // bail if any time is missing
    const shown = displayDt(dt0, displayZone)
    const dayPlus = tripStart
      ? Math.max(0, Math.round((shown.startOf('day').toMillis() - displayDt(tripStart, displayZone).startOf('day').toMillis()) / 86_400_000))
      : 0
    result.push({ iata: s.dep, time: shown.toFormat('h:mm a'), dayPlus })
  }

  // Final arrival
  const last = it.segments[it.segments.length - 1]
  const arrDt0 = parseAtAirport(last.arrTime, last.arr, tzByIata)
  if (!arrDt0) return []
  const arrShown = displayDt(arrDt0, displayZone)
  const arrDay = tripStart
    ? Math.max(0, Math.round((arrShown.startOf('day').toMillis() - displayDt(tripStart, displayZone).startOf('day').toMillis()) / 86_400_000))
    : 0
  result.push({ iata: last.arr, time: arrShown.toFormat('h:mm a'), dayPlus: arrDay })

  return result
}

/** Show segment times in a chosen IANA zone (falls back to raw local strings). */
export function formatSegmentTimes(
  s: NormalizedSegment,
  tzByIata: Map<string, string>,
  displayZone: string,
): { dep: string; arr: string } {
  const fmt = (raw: string | undefined, iata: string) => {
    if (!raw) return '—'
    const z = tzByIata.get(iata)
    if (!displayZone) {
      return z ? `${raw} (${z})` : raw
    }
    if (!z) return `${raw} (no TZ)`
    const dt = DateTime.fromFormat(raw.trim(), 'yyyy-MM-dd HH:mm', { zone: z })
    if (!dt.isValid) return raw
    return dt.setZone(displayZone).toFormat('MMM d, HH:mm ZZZZ')
  }
  return { dep: fmt(s.depTime, s.dep), arr: fmt(s.arrTime, s.arr) }
}
