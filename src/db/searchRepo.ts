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
 */
export function tryLoadCachedSearchSplitFallback(
  db: Database,
  parts: HashParts,
): NormalizedItinerary[] | null {
  // 1. Exact match first
  const exact = tryLoadCachedSearch(db, parts)
  if (exact) return exact

  // 2. Nothing to split if already single origin + single destination
  if (parts.origins.length <= 1 && parts.destinations.length <= 1) return null

  // 3. Sub-searches: split by each individual origin (holding destinations fixed)
  //    and by each individual destination (holding origins fixed)
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
        // Deduplicate on waypointKey + first segment departure time
        const key = `${it.waypointKey}|${it.segments[0]?.depTime ?? ''}`
        if (!seen.has(key)) {
          seen.add(key)
          all.push(it)
        }
      }
    }
  }

  return found && all.length > 0 ? all : null
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
