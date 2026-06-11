import type { Database } from 'sql.js'
import type { NormalizedItinerary } from '../lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PriceVerificationRow = {
  id: number
  routeKey: string    // e.g. "JFK-AUH-MAA|ETIHAD AIRWAYS"
  outDate: string     // "YYYY-MM-DD" — kept for display / range queries
  retDate: string     // "YYYY-MM-DD" (empty string for one-way)
  outDepTime: string  // first outbound departure "YYYY-MM-DD HH:mm" — part of unique key
  retDepTime: string  // first return departure "YYYY-MM-DD HH:mm" — part of unique key
  verifiedPrice: number
  /** Sum of cached out+ret leg prices when verification was recorded (optional). */
  cachedPrice?: number | null
  currency: string
  paxDesc: string     // e.g. "1A+2C"
  note: string
  updatedAt: number   // unix ms
}

/** Short label for verified vs cached totals in the UI. */
export function verificationPriceLabel(
  row: Pick<PriceVerificationRow, 'verifiedPrice' | 'cachedPrice' | 'currency'>,
  format: (n: number, c: string) => string,
): string {
  const v = format(row.verifiedPrice, row.currency)
  if (row.cachedPrice != null && Number.isFinite(row.cachedPrice)) {
    const delta = row.verifiedPrice - row.cachedPrice
    const sign = delta >= 0 ? '+' : ''
    return `${v} (cache ${format(row.cachedPrice, row.currency)}, ${sign}${Math.round(delta)})`
  }
  return v
}

/** Rounded verified − current SERP delta, or null when aligned / unknown. */
export function verificationSerpDelta(
  verifiedPrice: number,
  serpPrice: number | null | undefined,
): number | null {
  if (serpPrice == null || !Number.isFinite(serpPrice) || serpPrice <= 0) return null
  const delta = Math.round(verifiedPrice - serpPrice)
  return delta === 0 ? null : delta
}

/** Between dep and flight list: `YYYY-MM-DD HH:mm::EY2+EY262` */
export const LEG_FLIGHT_SEP = '::'
/** Last-segment arrival when flights are missing: `...::@2026-07-15 11:30` */
export const LEG_ARR_SEP = '@'
/** Trip metadata: duration, layovers, airlines — `#T1860;YAUH1140;AETIHAD` */
export const LEG_META_SEP = '#'

const VKEY_SEP = '\x1e'

function lastArrTime(it: NormalizedItinerary): string {
  const segs = it.segments
  if (segs.length === 0) return ''
  return segs[segs.length - 1]?.arrTime?.trim() ?? ''
}

export function flightNumbersKey(it: NormalizedItinerary): string {
  return it.segments
    .map(s => (s.flightNumber ?? '').trim())
    .filter(Boolean)
    .join('+')
    .toUpperCase()
}

/** Non-technical layovers in order, e.g. `AUH1140+AUH820`. */
export function layoverSignature(it: NormalizedItinerary): string {
  return it.layovers
    .filter(l => !l.isTechnical && l.airport)
    .map(l => `${l.airport}${l.durationMinutes}`)
    .join('+')
}

/** Operating carriers on segments (or itinerary airlines list). */
export function airlineSignature(it: NormalizedItinerary): string {
  const fromSegs = it.segments
    .map(s => (s.airline ?? '').trim().toUpperCase())
    .filter(Boolean)
  if (fromSegs.length) return [...new Set(fromSegs)].join('+')
  return it.airlines.map(a => a.trim().toUpperCase()).filter(Boolean).join('+')
}

function legMetaSuffix(it: NormalizedItinerary): string {
  const parts: string[] = []
  if (it.totalDurationMinutes > 0) parts.push(`T${it.totalDurationMinutes}`)
  const lay = layoverSignature(it)
  if (lay) parts.push(`Y${lay}`)
  const al = airlineSignature(it)
  if (al) parts.push(`A${al}`)
  return parts.length ? `${LEG_META_SEP}${parts.join(';')}` : ''
}

export function legMetaFromImport(parts: {
  durationMin?: number
  layovers?: string
  airlines?: string
}): string {
  const meta: string[] = []
  if (parts.durationMin != null && parts.durationMin > 0) meta.push(`T${parts.durationMin}`)
  const lay = (parts.layovers ?? '').trim().replace(/\s/g, '')
  if (lay) meta.push(`Y${lay}`)
  const al = (parts.airlines ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (al) meta.push(`A${al}`)
  return meta.length ? `${LEG_META_SEP}${meta.join(';')}` : ''
}

export function legKeyFlights(legKey: string): string {
  const beforeArr = legKey.split(LEG_ARR_SEP)[0] ?? legKey
  const i = beforeArr.indexOf(LEG_FLIGHT_SEP)
  return i >= 0 ? beforeArr.slice(i + LEG_FLIGHT_SEP.length) : ''
}

/** Canonical `YYYY-MM-DD HH:mm` so keys survive minor SerpApi time formatting changes. */
export function normalizeDateTimeForKey(raw: string, dateFallback = ''): string {
  const t = raw.trim()
  if (!t) return ''
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(t)) return t
  if (/^\d{2}:\d{2}$/.test(t) && dateFallback) return `${dateFallback} ${t}`
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/.exec(t)
  if (m) return `${m[1]} ${m[2]}`
  return t
}

/**
 * Base leg key (no metadata): dep + flights + last arrival.
 * Same dep clock with different flights (EY 1 vs EY 3) must not collide.
 */
export function legVerificationKeyBase(it: NormalizedItinerary): string {
  const dateHint = it.segments[0]?.depTime?.slice(0, 10) ?? ''
  const dep = normalizeDateTimeForKey(it.segments[0]?.depTime ?? '', dateHint)
  const arrRaw = lastArrTime(it)
  const arr = normalizeDateTimeForKey(arrRaw, arrRaw.slice(0, 10) || dateHint)
  const flights = flightNumbersKey(it)

  if (!dep && !flights && !arr) return ''

  let key = dep
  if (flights) key = key ? `${key}${LEG_FLIGHT_SEP}${flights}` : flights
  if (arr) key = key ? `${key}${LEG_ARR_SEP}${arr}` : arr
  return key
}

/**
 * Full leg key: base + duration, layover hubs/durations, and airlines.
 * Distinguishes e.g. AUH 19h vs AUH 1h40m on the same flight numbers.
 */
export function legVerificationKey(it: NormalizedItinerary): string {
  const base = legVerificationKeyBase(it)
  if (!base) return ''
  return `${base}${legMetaSuffix(it)}`
}

/** Strip `#T…;Y…;A…` metadata for matching rows saved before meta was added. */
export function stripLegMeta(legKey: string): string {
  const i = legKey.indexOf(LEG_META_SEP)
  return i >= 0 ? legKey.slice(0, i) : legKey
}

/** Lookup keys to try for a cached itinerary pair (full, then base without meta). */
export function verificationLookupKeys(
  routeKey: string,
  outIt: NormalizedItinerary,
  retIt: NormalizedItinerary,
): string[] {
  const fullOut = legVerificationKey(outIt)
  const fullRet = legVerificationKey(retIt)
  const baseOut = legVerificationKeyBase(outIt)
  const baseRet = legVerificationKeyBase(retIt)
  const keys = [vKey(routeKey, fullOut, fullRet)]
  if (baseOut !== fullOut || baseRet !== fullRet) {
    keys.push(vKey(routeKey, baseOut, baseRet))
  }
  return keys
}

/**
 * Resolve a stored verification for an itinerary pair.
 * Exact key match only (full leg identity, then base dep/flights/arr) — no fuzzy date/flight bleed.
 */
export function lookupVerificationRow(
  verifications: Map<string, PriceVerificationRow>,
  routeKey: string,
  outIt: NormalizedItinerary,
  retIt: NormalizedItinerary,
): PriceVerificationRow | undefined {
  for (const k of verificationLookupKeys(routeKey, outIt, retIt)) {
    const hit = verifications.get(k)
    if (hit) return hit
  }
  return undefined
}

export function legKeyDepTime(legKey: string): string {
  const beforeArr = legKey.split(LEG_ARR_SEP)[0] ?? legKey
  const i = beforeArr.indexOf(LEG_FLIGHT_SEP)
  return i >= 0 ? beforeArr.slice(0, i) : beforeArr
}

/** Human-readable summary of a stored leg key for UI labels. */
export function describeLegKey(legKey: string): string {
  const base = stripLegMeta(legKey)
  if (!base.trim()) return 'unknown'
  const dep = legKeyDepTime(base)
  const depClock = dep.length >= 16 ? dep.slice(11, 16) : dep
  const fl = legKeyFlights(base).replace(/\+/g, ' + ')
  const parts: string[] = []
  if (depClock) parts.push(depClock)
  if (fl) parts.push(fl)
  const arrIdx = base.indexOf(LEG_ARR_SEP)
  if (arrIdx >= 0) {
    let arr = base.slice(arrIdx + LEG_ARR_SEP.length)
    const metaI = arr.indexOf(LEG_META_SEP)
    if (metaI >= 0) arr = arr.slice(0, metaI)
    const arrClock = arr.length >= 16 ? arr.slice(11, 16) : arr.trim()
    if (arrClock) parts.push(`arr ${arrClock}`)
  }
  return parts.join(' · ') || base.slice(0, 40)
}

export function describeVerificationLegs(
  row: Pick<PriceVerificationRow, 'outDepTime' | 'retDepTime'>,
): string {
  return `Out ${describeLegKey(row.outDepTime)} · Ret ${describeLegKey(row.retDepTime)}`
}

/** First flight number token from a leg key (for search hints). */
export function legKeySearchToken(legKey: string): string {
  const fl = legKeyFlights(stripLegMeta(legKey))
  if (!fl) {
    const dep = legKeyDepTime(stripLegMeta(legKey))
    return dep.length >= 16 ? dep.slice(11, 16) : dep.slice(0, 5)
  }
  return fl.split('+')[0] ?? ''
}

/** Build leg key from import fields when full itinerary objects are unavailable. */
export function legKeyFromParts(
  depTime: string,
  flights?: string,
  arrTime?: string,
  meta?: { durationMin?: number; layovers?: string; airlines?: string },
): string {
  const dt = depTime.trim()
  const f = (flights ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const arr = (arrTime ?? '').trim()
  let key = dt
  if (f) key = key ? `${key}${LEG_FLIGHT_SEP}${f}` : f
  if (arr) key = key ? `${key}${LEG_ARR_SEP}${arr}` : arr
  return key + legMetaFromImport(meta ?? {})
}

/**
 * Stable lookup key for in-memory Maps (route + outbound leg + return leg).
 */
export function vKey(routeKey: string, outLegKey: string, retLegKey: string): string {
  return `${routeKey}${VKEY_SEP}${outLegKey}${VKEY_SEP}${retLegKey}`
}

export function vKeyFromPair(
  routeKey: string,
  outIt: NormalizedItinerary,
  retIt: NormalizedItinerary,
): string {
  return vKey(routeKey, legVerificationKey(outIt), legVerificationKey(retIt))
}

export function parseVKey(
  key: string,
): { routeKey: string; outLegKey: string; retLegKey: string } | null {
  const parts = key.split(VKEY_SEP)
  if (parts.length !== 3) return null
  return { routeKey: parts[0], outLegKey: parts[1], retLegKey: parts[2] }
}

/** Extract just the date part "YYYY-MM-DD" from a depTime or leg key. */
export function depTimeToDate(depTime: string): string {
  return legKeyDepTime(depTime).slice(0, 10)
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function upsertPriceVerification(
  db: Database,
  row: Omit<PriceVerificationRow, 'id' | 'updatedAt'>,
): void {
  db.run(
    `INSERT INTO price_verification
       (route_key, out_date, ret_date, out_dep_time, ret_dep_time,
        verified_price, cached_price, currency, pax_desc, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(route_key, out_dep_time, ret_dep_time) DO UPDATE SET
       out_date       = excluded.out_date,
       ret_date       = excluded.ret_date,
       verified_price = excluded.verified_price,
       cached_price   = excluded.cached_price,
       currency       = excluded.currency,
       pax_desc       = excluded.pax_desc,
       note           = excluded.note,
       updated_at     = excluded.updated_at`,
    [
      row.routeKey,
      row.outDate || depTimeToDate(row.outDepTime),
      row.retDate || (row.retDepTime ? depTimeToDate(row.retDepTime) : ''),
      row.outDepTime ?? '',
      row.retDepTime ?? '',
      row.verifiedPrice,
      row.cachedPrice ?? null,
      row.currency,
      row.paxDesc ?? '',
      row.note ?? '',
      Date.now(),
    ],
  )
}

export function deletePriceVerification(
  db: Database,
  routeKey: string,
  outDepTime: string,
  retDepTime: string,
): void {
  db.run(
    'DELETE FROM price_verification WHERE route_key = ? AND out_dep_time = ? AND ret_dep_time = ?',
    [routeKey, outDepTime ?? '', retDepTime ?? ''],
  )
}

export function listPriceVerifications(db: Database): PriceVerificationRow[] {
  const result = db.exec(
    `SELECT id, route_key, out_date, ret_date, out_dep_time, ret_dep_time,
            verified_price, cached_price, currency, pax_desc, note, updated_at
     FROM price_verification ORDER BY updated_at DESC`,
  )
  if (!result[0]) return []
  const cols = result[0].columns
  const hasCached = cols.includes('cached_price')
  return result[0].values.map((r) => ({
    id: r[0] as number,
    routeKey: r[1] as string,
    outDate: r[2] as string,
    retDate: r[3] as string,
    outDepTime: r[4] as string,
    retDepTime: r[5] as string,
    verifiedPrice: r[6] as number,
    cachedPrice: hasCached ? (r[7] as number | null) : null,
    currency: (hasCached ? r[8] : r[7]) as string,
    paxDesc: (hasCached ? r[9] : r[8]) as string,
    note: (hasCached ? r[10] : r[9]) as string,
    updatedAt: (hasCached ? r[11] : r[10]) as number,
  }))
}

export function loadVerificationMap(db: Database): Map<string, PriceVerificationRow> {
  const rows = listPriceVerifications(db)
  const map = new Map<string, PriceVerificationRow>()
  for (const row of rows) map.set(vKey(row.routeKey, row.outDepTime, row.retDepTime), row)
  return map
}

// ── JSON import ───────────────────────────────────────────────────────────────

/**
 * Import format accepted by the JSON import dialog.
 * Share this spec with the other program generating the data.
 *
 * REQUIRED fields:
 *   out          — outbound date "YYYY-MM-DD"
 *   price        — verified total price as a number (e.g. 3777)
 *
 * STRONGLY RECOMMENDED (disambiguates itineraries on the same date):
 *   outDepTime   — first outbound departure "YYYY-MM-DD HH:mm" (e.g. "2026-07-12 15:45")
 *   retDepTime   — first return departure   "YYYY-MM-DD HH:mm" (e.g. "2026-09-06 04:15")
 *   outFlights   — "+"-joined flight numbers (recommended — disambiguates same dep time)
 *   retFlights   — "+"-joined return flight numbers
 *   outArrTime   — last outbound arrival (fallback when flight numbers are missing)
 *   retArrTime   — last return arrival (fallback)
 *   outDurationMin / retDurationMin — total leg duration in minutes
 *   outLayovers / retLayovers — e.g. "AUH1140" or "AUH1140+AUH170" (airport + minutes)
 *   outAirlines / retAirlines — e.g. "ETIHAD" or "EY+AI"
 *
 * OPTIONAL fields:
 *   ret          — return date "YYYY-MM-DD" (derived from retDepTime if omitted)
 *   routeKey     — full internal key "JFK-AUH-MAA|ETIHAD AIRWAYS"; if omitted,
 *                  applies to the currently selected route in the UI
 *   currency     — 3-letter code (defaults to app currency)
 *   pax          — passenger description e.g. "1A+2C" (stored as-is)
 *   cachedPrice  — optional cached out+ret sum when verified
 *   note         — free text e.g. flight numbers, screenshot date
 *
 * Example:
 * [
 *   {
 *     "out": "2026-07-12", "outDepTime": "2026-07-12 15:45",
 *     "ret": "2026-09-06", "retDepTime": "2026-09-06 04:15",
 *     "price": 3777, "pax": "1A+2C",
 *     "note": "Etihad EY2+EY264 AUH 1h55m connection"
 *   },
 *   {
 *     "out": "2026-07-12", "outDepTime": "2026-07-12 15:45",
 *     "ret": "2026-09-06", "retDepTime": "2026-09-06 04:15",
 *     "price": 3476, "pax": "1A+2C",
 *     "note": "Etihad EY2+EY264 AUH 19h stopover",
 *     "routeKey": "JFK-AUH-MAA|ETIHAD AIRWAYS"
 *   }
 * ]
 */
export type VerificationImportRow = {
  out?: string; outDate?: string
  ret?: string; retDate?: string
  outDepTime?: string
  retDepTime?: string
  /** "+"-joined flight numbers, e.g. "EY2+EY262" — disambiguates same dep time */
  outFlights?: string
  retFlights?: string
  outArrTime?: string
  retArrTime?: string
  outDurationMin?: number
  retDurationMin?: number
  outLayovers?: string
  retLayovers?: string
  outAirlines?: string
  retAirlines?: string
  price: number
  cachedPrice?: number
  routeKey?: string
  currency?: string
  pax?: string
  note?: string
}

export function importVerificationsFromJson(
  db: Database,
  json: string,
  fallbackRouteKey: string,
  fallbackCurrency: string,
): { count: number; errors: string[] } {
  let rows: VerificationImportRow[]
  try {
    rows = JSON.parse(json) as VerificationImportRow[]
    if (!Array.isArray(rows)) throw new Error('Expected a JSON array')
  } catch (e) {
    return { count: 0, errors: [e instanceof Error ? e.message : 'Invalid JSON'] }
  }

  let count = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const outDate = (row.out ?? row.outDate ?? '').trim()
    const retDate = (row.ret ?? row.retDate ?? '').trim()
    const outDepTime = legKeyFromParts(
      (row.outDepTime ?? '').trim(),
      row.outFlights,
      (row.outArrTime ?? '').trim(),
      {
        durationMin: row.outDurationMin,
        layovers: row.outLayovers,
        airlines: row.outAirlines,
      },
    )
    const retDepTime = legKeyFromParts(
      (row.retDepTime ?? '').trim(),
      row.retFlights,
      (row.retArrTime ?? '').trim(),
      {
        durationMin: row.retDurationMin,
        layovers: row.retLayovers,
        airlines: row.retAirlines,
      },
    )
    const routeKey = (row.routeKey ?? fallbackRouteKey).trim()

    if (!outDate || !/^\d{4}-\d{2}-\d{2}$/.test(outDate)) {
      errors.push(`Row ${i + 1}: missing or invalid "out" date`)
      continue
    }
    if (!Number.isFinite(row.price) || row.price <= 0) {
      errors.push(`Row ${i + 1}: missing or invalid "price"`)
      continue
    }

    upsertPriceVerification(db, {
      routeKey,
      outDate,
      retDate,
      outDepTime,
      retDepTime,
      verifiedPrice: row.price,
      cachedPrice: row.cachedPrice ?? null,
      currency: (row.currency ?? fallbackCurrency).toUpperCase(),
      paxDesc: row.pax ?? '',
      note: row.note ?? '',
    })
    count++
  }

  return { count, errors }
}
