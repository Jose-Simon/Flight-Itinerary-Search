import type { Database } from 'sql.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PriceVerificationRow = {
  id: number
  routeKey: string  // e.g. "JFK-AUH-MAA|ETIHAD AIRWAYS"
  outDate: string   // "YYYY-MM-DD"
  retDate: string   // "YYYY-MM-DD" (empty string for one-way)
  verifiedPrice: number
  currency: string
  paxDesc: string   // e.g. "1A+2C"
  note: string
  updatedAt: number // unix ms
}

/**
 * Stable lookup key used in Maps throughout the UI.
 * Uses "::" separator to avoid collision with "|" already in routeKey.
 */
export function vKey(routeKey: string, outDate: string, retDate: string): string {
  return `${routeKey}::${outDate}::${retDate}`
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function upsertPriceVerification(
  db: Database,
  row: Omit<PriceVerificationRow, 'id' | 'updatedAt'>,
): void {
  db.run(
    `INSERT INTO price_verification
       (route_key, out_date, ret_date, verified_price, currency, pax_desc, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(route_key, out_date, ret_date) DO UPDATE SET
       verified_price = excluded.verified_price,
       currency       = excluded.currency,
       pax_desc       = excluded.pax_desc,
       note           = excluded.note,
       updated_at     = excluded.updated_at`,
    [
      row.routeKey, row.outDate, row.retDate ?? '',
      row.verifiedPrice, row.currency, row.paxDesc ?? '', row.note ?? '',
      Date.now(),
    ],
  )
}

export function deletePriceVerification(
  db: Database,
  routeKey: string,
  outDate: string,
  retDate: string,
): void {
  db.run(
    'DELETE FROM price_verification WHERE route_key = ? AND out_date = ? AND ret_date = ?',
    [routeKey, outDate, retDate ?? ''],
  )
}

export function listPriceVerifications(db: Database): PriceVerificationRow[] {
  const result = db.exec(
    'SELECT id, route_key, out_date, ret_date, verified_price, currency, pax_desc, note, updated_at FROM price_verification ORDER BY updated_at DESC',
  )
  if (!result[0]) return []
  return result[0].values.map((r) => ({
    id: r[0] as number,
    routeKey: r[1] as string,
    outDate: r[2] as string,
    retDate: r[3] as string,
    verifiedPrice: r[4] as number,
    currency: r[5] as string,
    paxDesc: r[6] as string,
    note: r[7] as string,
    updatedAt: r[8] as number,
  }))
}

export function loadVerificationMap(db: Database): Map<string, PriceVerificationRow> {
  const rows = listPriceVerifications(db)
  const map = new Map<string, PriceVerificationRow>()
  for (const row of rows) map.set(vKey(row.routeKey, row.outDate, row.retDate), row)
  return map
}

// ── JSON import ───────────────────────────────────────────────────────────────

/**
 * Import format accepted by the JSON import dialog.
 * Communicate this to the other program generating the data.
 *
 * REQUIRED fields:
 *   out      — outbound date "YYYY-MM-DD"
 *   ret      — return date "YYYY-MM-DD" (omit or "" for one-way)
 *   price    — verified total price as a number (e.g. 3777)
 *
 * OPTIONAL fields:
 *   routeKey — full internal key "JFK-AUH-MAA|ETIHAD AIRWAYS"; if omitted,
 *              the import applies to the currently selected route in the UI
 *   currency — 3-letter code (defaults to the app's currency setting)
 *   pax      — passenger description e.g. "1A+2C" (stored as-is, no effect on calc)
 *   note     — free text e.g. "Etihad AUH 1h55m connection — GF screenshot 2026-05-31"
 *
 * Example:
 * [
 *   { "out": "2026-07-12", "ret": "2026-09-06", "price": 3777, "pax": "1A+2C",
 *     "note": "Etihad AUH 1h55m connection" },
 *   { "out": "2026-07-12", "ret": "2026-09-06", "price": 3476, "pax": "1A+2C",
 *     "note": "Etihad AUH 19h stopover",
 *     "routeKey": "JFK-AUH-MAA|ETIHAD AIRWAYS" }
 * ]
 */
export type VerificationImportRow = {
  out?: string; outDate?: string
  ret?: string; retDate?: string
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
      verifiedPrice: row.price,
      currency: (row.currency ?? fallbackCurrency).toUpperCase(),
      paxDesc: row.pax ?? '',
      note: row.note ?? '',
    })
    count++
  }

  return { count, errors }
}
