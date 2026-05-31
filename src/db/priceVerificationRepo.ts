import type { Database } from 'sql.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PriceVerificationRow = {
  id: number
  routeKey: string    // e.g. "JFK-AUH-MAA|ETIHAD AIRWAYS"
  outDate: string     // "YYYY-MM-DD" — kept for display / range queries
  retDate: string     // "YYYY-MM-DD" (empty string for one-way)
  outDepTime: string  // first outbound departure "YYYY-MM-DD HH:mm" — part of unique key
  retDepTime: string  // first return departure "YYYY-MM-DD HH:mm" — part of unique key
  verifiedPrice: number
  currency: string
  paxDesc: string     // e.g. "1A+2C"
  note: string
  updatedAt: number   // unix ms
}

/**
 * Stable lookup key used in Maps throughout the UI.
 * Keyed on dep_times (not dates) so two itineraries on the same calendar
 * day (e.g. EY 2 15:45 stopover vs EY 4 22:20 connection) each get their
 * own entry.  Uses "::" separator to avoid collision with "|" in routeKey.
 */
export function vKey(routeKey: string, outDepTime: string, retDepTime: string): string {
  return `${routeKey}::${outDepTime}::${retDepTime}`
}

/** Extract just the date part "YYYY-MM-DD" from a depTime string. */
export function depTimeToDate(depTime: string): string {
  return depTime.slice(0, 10)
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function upsertPriceVerification(
  db: Database,
  row: Omit<PriceVerificationRow, 'id' | 'updatedAt'>,
): void {
  db.run(
    `INSERT INTO price_verification
       (route_key, out_date, ret_date, out_dep_time, ret_dep_time,
        verified_price, currency, pax_desc, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(route_key, out_dep_time, ret_dep_time) DO UPDATE SET
       out_date       = excluded.out_date,
       ret_date       = excluded.ret_date,
       verified_price = excluded.verified_price,
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
            verified_price, currency, pax_desc, note, updated_at
     FROM price_verification ORDER BY updated_at DESC`,
  )
  if (!result[0]) return []
  return result[0].values.map((r) => ({
    id: r[0] as number,
    routeKey: r[1] as string,
    outDate: r[2] as string,
    retDate: r[3] as string,
    outDepTime: r[4] as string,
    retDepTime: r[5] as string,
    verifiedPrice: r[6] as number,
    currency: r[7] as string,
    paxDesc: r[8] as string,
    note: r[9] as string,
    updatedAt: r[10] as number,
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
 *
 * OPTIONAL fields:
 *   ret          — return date "YYYY-MM-DD" (derived from retDepTime if omitted)
 *   routeKey     — full internal key "JFK-AUH-MAA|ETIHAD AIRWAYS"; if omitted,
 *                  applies to the currently selected route in the UI
 *   currency     — 3-letter code (defaults to app currency)
 *   pax          — passenger description e.g. "1A+2C" (stored as-is)
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
  price: number
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
    const outDepTime = (row.outDepTime ?? '').trim()
    const retDepTime = (row.retDepTime ?? '').trim()
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
      currency: (row.currency ?? fallbackCurrency).toUpperCase(),
      paxDesc: row.pax ?? '',
      note: row.note ?? '',
    })
    count++
  }

  return { count, errors }
}
