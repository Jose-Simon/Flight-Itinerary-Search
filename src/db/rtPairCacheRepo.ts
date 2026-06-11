import type { Database } from 'sql.js'
import {
  cachedRouteCoversRequest,
  filterStoredRoundTripPair,
  isExactCachedRoute,
  normRouteCsv,
  routeMatchRank,
} from '../lib/cacheRouteMatch'
import { computeSearchParamsHash } from './searchHash'
import {
  parseStoredRoundTripPair,
  type StoredRoundTripPairV1,
} from '../lib/storedRoundTripPair'
import { getCacheTtlMs } from './searchRepo'

export type RtPairCacheBase = {
  origins: string[]
  destinations: string[]
  maxSegments: number
  mockMode: boolean
  paxDesc: string
}

export type RtPairCacheKey = RtPairCacheBase & {
  outDate: string
  retDate: string
}

export type RtPairCacheRouteStats = {
  /** Fresh rows for this route + pax (any date pair). */
  routeFresh: number
  /** Rows for this route + pax but past TTL. */
  routeStale: number
  /** All fresh rows in the table (any route). */
  totalFresh: number
  /** All rows for this route + pax regardless of TTL. */
  routeTotal: number
}

export type LoadRtPairCacheOpts = {
  /** Database mode: use rows even when past cache TTL. */
  allowStale?: boolean
}

function normRoute(codes: string[]): string {
  return normRouteCsv(codes)
}

/** Parse `d:roundTrip|o:EWR,JFK,PHL|a:MAA,TRV|…` stored in params_hash. */
export function routeFromParamsHash(paramsHash: string): { origins: string; destinations: string } | null {
  const oMatch = /\|o:([^|]+)/.exec(paramsHash)
  const aMatch = /\|a:([^|]+)/.exec(paramsHash)
  if (!oMatch?.[1] || !aMatch?.[1]) return null
  return { origins: oMatch[1], destinations: aMatch[1] }
}

export function routeHashPrefix(origins: string[], destinations: string[]): string {
  return `d:roundTrip|o:${normRoute(origins)}|a:${normRoute(destinations)}|`
}

function cacheKeyParts(key: RtPairCacheKey): {
  paramsHash: string
  outDate: string
  retDate: string
  paxDesc: string
  mockMode: number
  origins: string
  destinations: string
  routePrefix: string
} {
  return {
    paramsHash: computeSearchParamsHash({
      direction: 'roundTrip',
      origins: key.origins,
      destinations: key.destinations,
      centerDate: key.outDate,
      flexDays: 0,
      maxSegments: key.maxSegments,
      mockMode: key.mockMode,
      returnDate: key.retDate,
    }),
    outDate: key.outDate,
    retDate: key.retDate,
    paxDesc: key.paxDesc,
    mockMode: key.mockMode ? 1 : 0,
    origins: normRoute(key.origins),
    destinations: normRoute(key.destinations),
    routePrefix: routeHashPrefix(key.origins, key.destinations),
  }
}

function parsePayloadRow(
  row: { updated_at: number; payload_json: string },
  ttl: number,
  now: number,
  allowStale: boolean,
) {
  const updatedAt = Number(row.updated_at)
  if (!allowStale && now - updatedAt > ttl) return null
  try {
    const payload = parseStoredRoundTripPair(JSON.parse(row.payload_json))
    if (!payload) return null
    return { payload, updatedAt }
  } catch {
    return null
  }
}

/** Backfill origins/destinations on rows saved before route columns existed. */
export function backfillRtPairCacheRoutes(db: Database): number {
  const info = db.exec("SELECT name FROM pragma_table_info('rt_pair_cache')")
  const cols = (info[0]?.values ?? []).map((r) => r[0] as string)
  if (!cols.includes('origins')) return 0

  const need = db.prepare(
    `SELECT 1 FROM rt_pair_cache WHERE origins = '' OR origins IS NULL LIMIT 1`,
  )
  const hasEmpty = need.step()
  need.free()
  if (!hasEmpty) return 0

  const sel = db.prepare(
    `SELECT id, params_hash FROM rt_pair_cache WHERE origins = '' OR origins IS NULL`,
  )
  const upd = db.prepare(`UPDATE rt_pair_cache SET origins = ?, destinations = ? WHERE id = ?`)
  let n = 0
  while (sel.step()) {
    const row = sel.getAsObject() as { id: number; params_hash: string }
    const route = routeFromParamsHash(row.params_hash)
    if (!route) continue
    upd.run([route.origins, route.destinations, row.id])
    n++
  }
  sel.free()
  upd.free()
  return n
}

export function saveRtPairCache(db: Database, key: RtPairCacheKey, payload: StoredRoundTripPairV1): void {
  const k = cacheKeyParts(key)
  const json = JSON.stringify(payload)
  const now = Date.now()
  db.run(
    `INSERT INTO rt_pair_cache (updated_at, params_hash, out_date, ret_date, pax_desc, mock_mode, payload_json, origins, destinations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(params_hash, out_date, ret_date, pax_desc, mock_mode)
     DO UPDATE SET
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json,
       origins = excluded.origins,
       destinations = excluded.destinations`,
    [now, k.paramsHash, k.outDate, k.retDate, k.paxDesc, k.mockMode, json, k.origins, k.destinations],
  )
}

function finalizeRtPairHit(
  hit: { payload: StoredRoundTripPairV1; updatedAt: number },
  key: RtPairCacheKey,
  cachedOrigins: string,
  cachedDestinations: string,
): { payload: StoredRoundTripPairV1; updatedAt: number } | null {
  const filtered = filterStoredRoundTripPair(hit.payload, key.origins, key.destinations)
  const hasData =
    filtered.ranked.length > 0 ||
    filtered.combos.length > 0 ||
    Object.keys(filtered.initialMinByRoute).length > 0
  if (!hasData) return null
  if (
    isExactCachedRoute(cachedOrigins, cachedDestinations, normRoute(key.origins), normRoute(key.destinations))
  ) {
    return hit
  }
  return { payload: filtered, updatedAt: hit.updatedAt }
}

export function loadRtPairCache(
  db: Database,
  key: RtPairCacheKey,
  opts?: LoadRtPairCacheOpts,
): { payload: StoredRoundTripPairV1; updatedAt: number } | null {
  const allowStale = opts?.allowStale === true
  const k = cacheKeyParts(key)
  const ttl = getCacheTtlMs(db)
  const now = Date.now()

  const tryRow = (row: { updated_at: number; payload_json: string }) =>
    parsePayloadRow(row, ttl, now, allowStale)

  const exact = db.prepare(
    `SELECT updated_at, payload_json FROM rt_pair_cache
     WHERE params_hash = ? AND out_date = ? AND ret_date = ? AND pax_desc = ? AND mock_mode = ?`,
  )
  exact.bind([k.paramsHash, k.outDate, k.retDate, k.paxDesc, k.mockMode])
  if (exact.step()) {
    const row = exact.getAsObject() as { updated_at: number; payload_json: string }
    exact.free()
    const hit = tryRow(row)
    if (hit) return finalizeRtPairHit(hit, key, k.origins, k.destinations)
  } else {
    exact.free()
  }

  const route = db.prepare(
    `SELECT updated_at, payload_json, origins, destinations, params_hash FROM rt_pair_cache
     WHERE out_date = ? AND ret_date = ? AND pax_desc = ? AND mock_mode = ?
     ORDER BY updated_at DESC LIMIT 50`,
  )
  route.bind([k.outDate, k.retDate, k.paxDesc, k.mockMode])

  let best: {
    hit: { payload: StoredRoundTripPairV1; updatedAt: number }
    rank: number
    cachedOrigins: string
    cachedDestinations: string
  } | null = null

  while (route.step()) {
    const row = route.getAsObject() as {
      updated_at: number
      payload_json: string
      origins: string
      destinations: string
      params_hash: string
    }
    const cachedOrigins = row.origins || routeFromParamsHash(row.params_hash)?.origins || ''
    const cachedDestinations = row.destinations || routeFromParamsHash(row.params_hash)?.destinations || ''
    const rank = routeMatchRank(cachedOrigins, cachedDestinations, k.origins, k.destinations)
    if (rank < 0) continue
    const hit = tryRow(row)
    if (!hit) continue
    if (!best || rank < best.rank) {
      best = { hit, rank, cachedOrigins, cachedDestinations }
      if (rank === 0) break
    }
  }
  route.free()

  if (!best) return null
  return finalizeRtPairHit(best.hit, key, best.cachedOrigins, best.cachedDestinations)
}

export type RtPairCacheBatchHit = {
  outDate: string
  retDate: string
  payload: StoredRoundTripPairV1
  updatedAt: number
}

type RtPairCacheBatchRowPick = {
  updated_at: number
  payload_json: string
  origins: string
  destinations: string
  params_hash: string
  out_date: string
  ret_date: string
}

type RtPairCacheBatchRowCandidate = {
  row: RtPairCacheBatchRowPick
  rank: number
  cachedOrigins: string
  cachedDestinations: string
}

function selectRtPairCacheBatchRows(
  db: Database,
  base: RtPairCacheBase,
  pairs: { outDate: string; retDate: string }[],
): Map<string, RtPairCacheBatchRowCandidate> {
  const reqOrigins = normRoute(base.origins)
  const reqDestinations = normRoute(base.destinations)
  const mock = base.mockMode ? 1 : 0
  const pairKeys = new Set(pairs.map((p) => `${p.outDate}|${p.retDate}`))
  const outDates = [...new Set(pairs.map((p) => p.outDate))]
  const retDates = [...new Set(pairs.map((p) => p.retDate))]

  const stmt = db.prepare(
    `SELECT updated_at, payload_json, origins, destinations, params_hash, out_date, ret_date
     FROM rt_pair_cache
     WHERE pax_desc = ? AND mock_mode = ?
       AND out_date IN (${outDates.map(() => '?').join(',')})
       AND ret_date IN (${retDates.map(() => '?').join(',')})`,
  )
  stmt.bind([base.paxDesc, mock, ...outDates, ...retDates])

  const bestByPair = new Map<string, RtPairCacheBatchRowCandidate>()
  while (stmt.step()) {
    const row = stmt.getAsObject() as RtPairCacheBatchRowPick
    const cellKey = `${row.out_date}|${row.ret_date}`
    if (!pairKeys.has(cellKey)) continue

    const cachedOrigins = row.origins || routeFromParamsHash(row.params_hash)?.origins || ''
    const cachedDestinations =
      row.destinations || routeFromParamsHash(row.params_hash)?.destinations || ''
    const rank = routeMatchRank(cachedOrigins, cachedDestinations, reqOrigins, reqDestinations)
    if (rank < 0) continue

    const prev = bestByPair.get(cellKey)
    if (!prev || rank < prev.rank) {
      bestByPair.set(cellKey, { row, rank, cachedOrigins, cachedDestinations })
    }
  }
  stmt.free()
  return bestByPair
}

function finalizeRtPairCacheBatchRows(
  base: RtPairCacheBase,
  picks: Map<string, RtPairCacheBatchRowCandidate>,
  opts: LoadRtPairCacheOpts | undefined,
  db: Database,
): RtPairCacheBatchHit[] {
  const allowStale = opts?.allowStale === true
  const ttl = getCacheTtlMs(db)
  const now = Date.now()
  const out: RtPairCacheBatchHit[] = []
  for (const [, entry] of picks) {
    const hit = parsePayloadRow(entry.row, ttl, now, allowStale)
    if (!hit) continue
    const key: RtPairCacheKey = {
      ...base,
      outDate: entry.row.out_date,
      retDate: entry.row.ret_date,
    }
    const finalized = finalizeRtPairHit(hit, key, entry.cachedOrigins, entry.cachedDestinations)
    if (!finalized) continue
    out.push({
      outDate: entry.row.out_date,
      retDate: entry.row.ret_date,
      payload: finalized.payload,
      updatedAt: finalized.updatedAt,
    })
  }
  return out
}

/** Load many date pairs in one query (Database price-window restore). */
export function loadRtPairCacheBatch(
  db: Database,
  base: RtPairCacheBase,
  pairs: { outDate: string; retDate: string }[],
  opts?: LoadRtPairCacheOpts,
): RtPairCacheBatchHit[] {
  if (!pairs.length) return []
  const picks = selectRtPairCacheBatchRows(db, base, pairs)
  return finalizeRtPairCacheBatchRows(base, picks, opts, db)
}

/** Same as loadRtPairCacheBatch but yields while parsing large payload_json blobs. */
export async function loadRtPairCacheBatchAsync(
  db: Database,
  base: RtPairCacheBase,
  pairs: { outDate: string; retDate: string }[],
  opts?: LoadRtPairCacheOpts,
): Promise<RtPairCacheBatchHit[]> {
  if (!pairs.length) return []
  const allowStale = opts?.allowStale === true
  const ttl = getCacheTtlMs(db)
  const now = Date.now()
  const picks = selectRtPairCacheBatchRows(db, base, pairs)
  const out: RtPairCacheBatchHit[] = []
  let i = 0
  for (const [, entry] of picks) {
    const hit = parsePayloadRow(entry.row, ttl, now, allowStale)
    if (hit) {
      const key: RtPairCacheKey = {
        ...base,
        outDate: entry.row.out_date,
        retDate: entry.row.ret_date,
      }
      const finalized = finalizeRtPairHit(hit, key, entry.cachedOrigins, entry.cachedDestinations)
      if (finalized) {
        out.push({
          outDate: entry.row.out_date,
          retDate: entry.row.ret_date,
          payload: finalized.payload,
          updatedAt: finalized.updatedAt,
        })
      }
    }
    i++
    if (i % 6 === 0) await new Promise<void>((r) => setTimeout(r, 0))
  }
  return out
}

function countRtPairRowsForRoute(
  db: Database,
  base: RtPairCacheBase,
  freshOnly: boolean,
  now: number,
  ttl: number,
): number {
  const reqOrigins = normRoute(base.origins)
  const reqDestinations = normRoute(base.destinations)
  const mock = base.mockMode ? 1 : 0
  const stmt = db.prepare(
    `SELECT origins, destinations, params_hash, updated_at FROM rt_pair_cache
     WHERE pax_desc = ? AND mock_mode = ?`,
  )
  stmt.bind([base.paxDesc, mock])
  let n = 0
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      origins: string
      destinations: string
      params_hash: string
      updated_at: number
    }
    const cachedOrigins = row.origins || routeFromParamsHash(row.params_hash)?.origins || ''
    const cachedDestinations =
      row.destinations || routeFromParamsHash(row.params_hash)?.destinations || ''
    if (!cachedRouteCoversRequest(cachedOrigins, cachedDestinations, reqOrigins, reqDestinations)) {
      continue
    }
    const updatedAt = Number(row.updated_at)
    if (freshOnly && now - updatedAt > ttl) continue
    if (!freshOnly && now - updatedAt <= ttl) continue
    n++
  }
  stmt.free()
  return n
}

export function rtPairCacheRouteStats(db: Database, base: RtPairCacheBase): RtPairCacheRouteStats {
  const ttl = getCacheTtlMs(db)
  const now = Date.now()

  const totalStmt = db.prepare(`SELECT COUNT(*) AS n FROM rt_pair_cache WHERE updated_at >= ?`)
  totalStmt.bind([now - ttl])
  totalStmt.step()
  const totalFresh = Number((totalStmt.getAsObject() as { n: number }).n)
  totalStmt.free()

  return {
    routeFresh: countRtPairRowsForRoute(db, base, true, now, ttl),
    routeStale: countRtPairRowsForRoute(db, base, false, now, ttl),
    totalFresh,
    routeTotal: countRtPairRowsForRoute(db, base, true, now, ttl) +
      countRtPairRowsForRoute(db, base, false, now, ttl),
  }
}

export function rtPairCacheFreshness(
  db: Database,
  key: RtPairCacheKey,
): 'fresh' | 'stale' | 'missing' {
  if (loadRtPairCache(db, key)) return 'fresh'
  if (loadRtPairCache(db, key, { allowStale: true })) return 'stale'
  return 'missing'
}
