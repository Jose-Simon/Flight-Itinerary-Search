import { DateTime } from 'luxon'
import type { NormalizedItinerary } from './types'

export type TimeRangeFieldStrings = {
  takeoffMin: string
  takeoffMax: string
  landingMin: string
  landingMax: string
}

/** Minutes from midnight [0, 1439] at the departure airport (first segment). */
export function firstLegTakeoffMinutesLocal(
  it: NormalizedItinerary,
  tzByIata: Map<string, string>,
): number | null {
  const seg = it.segments[0]
  if (!seg?.depTime) return null
  const tz = tzByIata.get(seg.dep) ?? ''
  if (!tz) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(seg.depTime)
    if (m) return Number(m[2]) * 60 + Number(m[3])
    return null
  }
  const dt = DateTime.fromFormat(seg.depTime.trim(), 'yyyy-MM-dd HH:mm', { zone: tz })
  if (!dt.isValid) return null
  return dt.hour * 60 + dt.minute
}

/** Minutes from midnight at the arrival airport (last segment). */
export function lastLegLandingMinutesLocal(
  it: NormalizedItinerary,
  tzByIata: Map<string, string>,
): number | null {
  const seg = it.segments[it.segments.length - 1]
  if (!seg?.arrTime) return null
  const tz = tzByIata.get(seg.arr) ?? ''
  if (!tz) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(seg.arrTime)
    if (m) return Number(m[2]) * 60 + Number(m[3])
    return null
  }
  const dt = DateTime.fromFormat(seg.arrTime.trim(), 'yyyy-MM-dd HH:mm', { zone: tz })
  if (!dt.isValid) return null
  return dt.hour * 60 + dt.minute
}

/** Accepts `HH:MM`, compact `HHMM` / `HMM` (e.g. 1215 → 12:15, 815 → 08:15), or integer minutes 0–1439. */
export function parseTimeFilterMinutes(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (hm) {
    const h = Number(hm[1])
    const mm = Number(hm[2])
    if (h >= 0 && h < 24 && mm >= 0 && mm < 60) return h * 60 + mm
    return null
  }
  if (/^\d{4}$/.test(t)) {
    const h = Number(t.slice(0, 2))
    const mm = Number(t.slice(2, 4))
    if (h >= 0 && h < 24 && mm >= 0 && mm < 60) return h * 60 + mm
    return null
  }
  if (/^\d{3}$/.test(t)) {
    const h = Number(t[0])
    const mm = Number(t.slice(1))
    if (h >= 0 && h < 24 && mm >= 0 && mm < 60) return h * 60 + mm
    return null
  }
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (!Number.isInteger(n)) return null
  if (n >= 0 && n <= 1439) return n
  return null
}

/** If the string parses as a time, return normalized `HH:MM`; otherwise return it unchanged. */
export function canonicalTimeInputString(s: string): string {
  const t = s.trim()
  if (!t) return ''
  const m = parseTimeFilterMinutes(t)
  if (m != null) return formatClockMinutes(m)
  return t
}

export function formatClockMinutes(m: number): string {
  const x = Math.max(0, Math.min(1439, Math.round(m)))
  const h = Math.floor(x / 60)
  const mm = x % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function parsePair(minS: string, maxS: string): { min: number | null; max: number | null } {
  let minM = parseTimeFilterMinutes(minS)
  let maxM = parseTimeFilterMinutes(maxS)
  if (minM != null && maxM != null && minM > maxM) {
    const x = minM
    minM = maxM
    maxM = x
  }
  return { min: minM, max: maxM }
}

export function parseTakeoffLandingBounds(fields: TimeRangeFieldStrings): {
  takeoffMin: number | null
  takeoffMax: number | null
  landingMin: number | null
  landingMax: number | null
} {
  const t = parsePair(fields.takeoffMin, fields.takeoffMax)
  const l = parsePair(fields.landingMin, fields.landingMax)
  return {
    takeoffMin: t.min,
    takeoffMax: t.max,
    landingMin: l.min,
    landingMax: l.max,
  }
}

export function passesTakeoffTimeRange(
  it: NormalizedItinerary,
  minM: number | null,
  maxM: number | null,
  tzByIata: Map<string, string>,
): boolean {
  if (minM == null && maxM == null) return true
  const v = firstLegTakeoffMinutesLocal(it, tzByIata)
  if (v == null) return false
  if (minM != null && v < minM) return false
  if (maxM != null && v > maxM) return false
  return true
}

export function passesLandingTimeRange(
  it: NormalizedItinerary,
  minM: number | null,
  maxM: number | null,
  tzByIata: Map<string, string>,
): boolean {
  if (minM == null && maxM == null) return true
  const v = lastLegLandingMinutesLocal(it, tzByIata)
  if (v == null) return false
  if (minM != null && v < minM) return false
  if (maxM != null && v > maxM) return false
  return true
}
