import type { Database } from 'sql.js'
import type { NormalizedItinerary } from '../lib/types'
import type { HashParts } from './searchHash'
import { computeSearchParamsHash } from './searchHash'
import { DateTime } from 'luxon'

const DEFAULT_TTL_H = 24

export function getCacheTtlMs(db: Database): number {
  const r = db.exec("SELECT value FROM app_kv WHERE key = 'cache_ttl_hours'")
  const v = r[0]?.values[0]?.[0]
  const h = v != null ? Number(v) : DEFAULT_TTL_H
  return (Number.isFinite(h) && h > 0 ? h : DEFAULT_TTL_H) * 60 * 60 * 1000
}

export function setCacheTtlHours(db: Database, hours: number) {
  db.run('INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)', [
    'cache_ttl_hours',
    String(Math.max(1, Math.min(168, Math.floor(hours)))),
  ])
}

function lastInsertId(db: Database): number {
  const r = db.exec('SELECT last_insert_rowid() AS id')
  return Number(r[0]?.values[0]?.[0])
}

export function storeSearchResults(
  db: Database,
  parts: HashParts,
  items: NormalizedItinerary[],
  tzByIata: Map<string, string>,
) {
  const hash = computeSearchParamsHash(parts)
  const mock = parts.mockMode ? 1 : 0
  const origins = [...parts.origins].sort().join(',')
  const dests = [...parts.destinations].sort().join(',')

  db.run('BEGIN')
  try {
    db.run(
      'DELETE FROM search_run WHERE params_hash = ? AND direction = ? AND mock_mode = ?',
      [hash, parts.direction, mock],
    )
    db.run(
      `INSERT INTO search_run (created_at, params_hash, direction, origins, destinations, center_date, flex_days, max_segments, mock_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(),
        hash,
        parts.direction,
        origins,
        dests,
        parts.centerDate,
        parts.flexDays,
        parts.maxSegments,
        mock,
      ],
    )
    const searchRunId = lastInsertId(db)

    for (const it of items) {
      db.run(
        `INSERT INTO itinerary (search_run_id, waypoint_key, total_duration_mins, open_jaw, airlines_json, raw_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          searchRunId,
          it.waypointKey,
          it.totalDurationMinutes,
          it.openJaw ? 1 : 0,
          JSON.stringify(it.airlines),
          JSON.stringify(it),
        ],
      )
      const itinId = lastInsertId(db)

      it.segments.forEach((s, i) => {
        const depTz = tzByIata.get(s.dep) ?? ''
        const arrTz = tzByIata.get(s.arr) ?? ''
        let depHour: number | null = null
        if (s.depTime && depTz) {
          const dt = DateTime.fromFormat(s.depTime.trim(), 'yyyy-MM-dd HH:mm', { zone: depTz })
          if (dt.isValid) depHour = dt.hour
        } else if (s.depTime) {
          const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):/.exec(s.depTime)
          if (m) depHour = Number(m[2])
        }
        db.run(
          `INSERT INTO segment (itinerary_id, leg_index, dep_iata, arr_iata, dep_local, arr_local, dep_tz, arr_tz, dep_hour_local, duration_mins, airline, flight_number, airplane)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            itinId,
            i,
            s.dep,
            s.arr,
            s.depTime ?? null,
            s.arrTime ?? null,
            depTz || null,
            arrTz || null,
            depHour,
            s.durationMinutes,
            s.airline ?? null,
            s.flightNumber ?? null,
            s.airplane ?? null,
          ],
        )
      })

      it.layovers.forEach((l, i) => {
        db.run(
          `INSERT INTO layover_row (itinerary_id, layover_index, airport, duration_mins, is_technical, excluded_region_allowed)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            itinId,
            i,
            l.airport,
            l.durationMinutes,
            l.isTechnical ? 1 : 0,
            l.excludedRegionButAllowed ? 1 : 0,
          ],
        )
      })
    }

    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
}

/**
 * Fallback lookup that matches on route + date only, ignoring settings
 * (gl, hl, currency, deepSearch, showHidden).  Used when the exact hash
 * misses — e.g. the user changed gl/currency since the API search ran.
 * Returns null when no entry exists or the most recent one has expired.
 */
export function tryLoadCachedSearchByRoute(
  db: Database,
  parts: Pick<HashParts, 'direction' | 'origins' | 'destinations' | 'centerDate' | 'flexDays' | 'mockMode'>,
): NormalizedItinerary[] | null {
  const mock = parts.mockMode ? 1 : 0
  const origins = [...parts.origins].sort().join(',')
  const dests = [...parts.destinations].sort().join(',')
  const ttl = getCacheTtlMs(db)
  const now = Date.now()

  const stmt = db.prepare(
    `SELECT id, created_at FROM search_run
     WHERE direction = ? AND origins = ? AND destinations = ?
       AND center_date = ? AND flex_days = ? AND mock_mode = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
  stmt.bind([parts.direction, origins, dests, parts.centerDate, parts.flexDays, mock])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as { id: number; created_at: number }
  stmt.free()
  if (now - Number(row.created_at) > ttl) return null

  const runId = Number(row.id)
  const q = db.prepare('SELECT raw_json FROM itinerary WHERE search_run_id = ? ORDER BY id')
  q.bind([runId])
  const out: NormalizedItinerary[] = []
  while (q.step()) {
    const j = (q.getAsObject() as { raw_json: string }).raw_json
    try { out.push(JSON.parse(j) as NormalizedItinerary) } catch { /* skip */ }
  }
  q.free()
  return out.length ? out : null
}

/**
 * Like tryLoadCachedSearch but when a combined multi-origin or multi-destination
 * search misses the exact hash, tries each origin and each destination individually
 * and merges the results.  Allows e.g. "MAA + TRV" to reuse caches built from
 * separate single-destination searches.
 *
 * Also handles the reverse case via tryLoadCachedSearchSupersetFallback: if the
 * user previously searched JFK+EWR+PHL→MAA and now searches just JFK→MAA, the
 * cached multi-origin run is reused and filtered to the requested subset.
 */
export function tryLoadCachedSearchSplitFallback(
  db: Database,
  parts: HashParts,
): NormalizedItinerary[] | null {
  // 1. Exact match first
  const exact = tryLoadCachedSearch(db, parts)
  if (exact) return exact

  // 2. Split fallback: multi-origin/dest → try each individually and merge
  if (parts.origins.length > 1 || parts.destinations.length > 1) {
    const subSearches: Array<Pick<HashParts, 'origins' | 'destinations'>> = []
    if (parts.origins.length > 1) {
      for (const o of parts.origins) {
        subSearches.push({ origins: [o], destinations: parts.destinations })
      }
    }
    if (parts.destinations.length > 1) {
      for (const d of parts.destinations) {
        subSearches.push({ origins: parts.origins, destinations: [d] })
      }
    }

    const all: NormalizedItinerary[] = []
    const seen = new Set<string>()
    let found = false

    for (const sub of subSearches) {
      const results = tryLoadCachedSearch(db, { ...parts, ...sub })
      if (results) {
        found = true
        for (const it of results) {
          const key = `${it.waypointKey}|${it.segments[0]?.depTime ?? ''}`
          if (!seen.has(key)) { seen.add(key); all.push(it) }
        }
      }
    }

    if (found && all.length > 0) return all
  }

  // 3. Superset fallback: the requested airports are a subset of a previously cached run
  //    e.g. searched JFK+EWR+PHL→MAA before; now searching just JFK→MAA
  return tryLoadCachedSearchSupersetFallback(db, parts)
}

/**
 * Finds a recent cached run whose origins ⊇ parts.origins AND destinations ⊇ parts.destinations,
 * then filters the loaded itineraries to only those matching the requested airports.
 * Handles the case where the user narrows a previously broad search (e.g. removes EWR/PHL).
 */
function tryLoadCachedSearchSupersetFallback(
  db: Database,
  parts: HashParts,
): NormalizedItinerary[] | null {
  const ttl = getCacheTtlMs(db)
  const now = Date.now()
  const mock = parts.mockMode ? 1 : 0

  // Load recent candidate runs matching direction/dates/segments/mock within TTL
  const stmt = db.prepare(
    `SELECT id, origins, destinations FROM search_run
     WHERE direction = ? AND mock_mode = ? AND center_date = ?
       AND flex_days = ? AND max_segments = ? AND created_at >= ?
     ORDER BY created_at DESC LIMIT 50`,
  )
  stmt.bind([parts.direction, mock, parts.centerDate, parts.flexDays, parts.maxSegments, now - ttl])
  const rows: Array<{ id: number; origins: string; destinations: string }> = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as { id: number; origins: string; destinations: string })
  }
  stmt.free()

  const wantOrigins = new Set(parts.origins.map((s) => s.trim().toUpperCase()))
  const wantDests = new Set(parts.destinations.map((s) => s.trim().toUpperCase()))

  for (const row of rows) {
    const cachedOrigins = new Set(row.origins.split(',').map((s) => s.trim().toUpperCase()))
    const cachedDests = new Set(row.destinations.split(',').map((s) => s.trim().toUpperCase()))

    // wantOrigins ⊆ cachedOrigins AND wantDests ⊆ cachedDests (must be a strict superset)
    const originsOk = [...wantOrigins].every((o) => cachedOrigins.has(o))
    const destsOk = [...wantDests].every((d) => cachedDests.has(d))
    const isSuperset = cachedOrigins.size > wantOrigins.size || cachedDests.size > wantDests.size
    if (!originsOk || !destsOk || !isSuperset) continue

    // Load and filter itineraries to the requested origin/destination subset
    const q = db.prepare('SELECT raw_json FROM itinerary WHERE search_run_id = ? ORDER BY id')
    q.bind([Number(row.id)])
    const filtered: NormalizedItinerary[] = []
    while (q.step()) {
      const j = (q.getAsObject() as { raw_json: string }).raw_json
      try {
        const it = JSON.parse(j) as NormalizedItinerary
        const firstDep = it.segments[0]?.dep?.toUpperCase()
        const lastArr = it.segments[it.segments.length - 1]?.arr?.toUpperCase()
        if (
          (!firstDep || wantOrigins.has(firstDep)) &&
          (!lastArr || wantDests.has(lastArr))
        ) {
          filtered.push(it)
        }
      } catch { /* skip */ }
    }
    q.free()

    if (filtered.length > 0) return filtered
  }

  return null
}

export function tryLoadCachedSearch(db: Database, parts: HashParts): NormalizedItinerary[] | null {
  const hash = computeSearchParamsHash(parts)
  const mock = parts.mockMode ? 1 : 0
  const ttl = getCacheTtlMs(db)
  const now = Date.now()

  const stmt = db.prepare(
    `SELECT id, created_at FROM search_run
     WHERE params_hash = ? AND direction = ? AND mock_mode = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
  stmt.bind([hash, parts.direction, mock])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as { id: number; created_at: number }
  stmt.free()
  if (now - Number(row.created_at) > ttl) return null

  const runId = Number(row.id)
  const q = db.prepare('SELECT raw_json FROM itinerary WHERE search_run_id = ? ORDER BY id')
  q.bind([runId])
  const out: NormalizedItinerary[] = []
  while (q.step()) {
    const j = (q.getAsObject() as { raw_json: string }).raw_json
    try {
      out.push(JSON.parse(j) as NormalizedItinerary)
    } catch {
      /* skip */
    }
  }
  q.free()
  return out.length ? out : null
}
