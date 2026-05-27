import { DateTime } from 'luxon'
import type { NormalizedItinerary } from './types'

export type TimeOfDayBucket = 'morning' | 'afternoon' | 'evening' | 'overnight'

/** Local hour 0–23 at first departure airport. */
export function firstLegDepartureHourLocal(
  it: NormalizedItinerary,
  tzByIata: Map<string, string>,
): number | null {
  const seg = it.segments[0]
  if (!seg?.depTime) return null
  const tz = tzByIata.get(seg.dep) ?? ''
  if (!tz) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(seg.depTime)
    if (m) return Number(m[2])
    return null
  }
  const dt = DateTime.fromFormat(seg.depTime.trim(), 'yyyy-MM-dd HH:mm', { zone: tz })
  if (!dt.isValid) return null
  return dt.hour
}

/** Morning 05–11, afternoon 12–16, evening 17–21, overnight 22–04. */
export function hourToBucket(h: number): TimeOfDayBucket {
  if (h >= 5 && h <= 11) return 'morning'
  if (h >= 12 && h <= 16) return 'afternoon'
  if (h >= 17 && h <= 21) return 'evening'
  return 'overnight'
}

export function itineraryFirstLegBucket(
  it: NormalizedItinerary,
  tzByIata: Map<string, string>,
): TimeOfDayBucket | null {
  const h = firstLegDepartureHourLocal(it, tzByIata)
  if (h === null) return null
  return hourToBucket(h)
}

export function passesTimeBucketFilter(
  it: NormalizedItinerary,
  selected: Set<TimeOfDayBucket>,
  tzByIata: Map<string, string>,
): boolean {
  if (selected.size === 0) return true
  const b = itineraryFirstLegBucket(it, tzByIata)
  if (b === null) return true
  return selected.has(b)
}
