import type { Database } from 'sql.js'
import type { RegionId } from '../data/regions'
import { isRegionId, REGION_IDS_IN_UI_ORDER } from '../data/regions'
import { normalizeStoredAirlineRegion, parseRegionIdFromSettingsToken } from '../lib/airlineRegionGroup'

function isPersistableAirlineRegion(s: string): s is RegionId {
  return isRegionId(s)
}

/** Shipped defaults + user-requested mappings; seeded when the table is empty. */
export const DEFAULT_AIRLINE_UI_REGION_ROWS: Record<string, RegionId> = {
  AI: 'india',
  '6E': 'india',
  QP: 'india',
  DL: 'unitedStates',
  KL: 'europe',
  LO: 'europe',
  AZ: 'europe',
  CX: 'asia',
  SV: 'middleEast',
}

export function loadAirlineUiRegionsFromDb(db: Database): Record<string, RegionId> {
  const out: Record<string, RegionId> = {}
  const stmt = db.prepare('SELECT iata, ui_region FROM airline_ui_region')
  while (stmt.step()) {
    const r = stmt.getAsObject() as { iata: string; ui_region: string }
    const code = String(r.iata).trim().toUpperCase()
    const normalized = normalizeStoredAirlineRegion(String(r.ui_region))
    if (code && normalized && isPersistableAirlineRegion(normalized)) out[code] = normalized
  }
  stmt.free()
  return out
}

export function replaceAllAirlineUiRegions(db: Database, map: Record<string, RegionId>) {
  db.run('DELETE FROM airline_ui_region')
  for (const [iata, reg] of Object.entries(map)) {
    const code = iata.trim().toUpperCase()
    if (!code || !isPersistableAirlineRegion(reg)) continue
    db.run('INSERT OR REPLACE INTO airline_ui_region (iata, ui_region) VALUES (?, ?)', [code, reg])
  }
}

export function seedAirlineUiRegionsIfEmpty(db: Database) {
  const r = db.exec('SELECT COUNT(*) FROM airline_ui_region')
  const count = Number(r[0]?.values[0]?.[0] ?? 0)
  if (count > 0) return
  replaceAllAirlineUiRegions(db, { ...DEFAULT_AIRLINE_UI_REGION_ROWS })
}

/** UI: one row per line, `DL=unitedStates` or `DL: india`. Legacy display names are accepted. */
export function parseAirlineRegionLines(text: string): Record<string, RegionId> {
  const out: Record<string, RegionId> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = /^([A-Za-z0-9]{2})\s*[:=]\s*(.+)$/.exec(t)
    if (!m) continue
    const code = m[1].toUpperCase()
    const reg = parseRegionIdFromSettingsToken(m[2])
    if (reg) out[code] = reg
  }
  return out
}

export function formatAirlineRegionLines(map: Record<string, RegionId>): string {
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, reg]) => `${code}=${reg}`)
    .join('\n')
}

/**
 * One comma-separated IATA list per `RegionId` (for Settings two-column view).
 * The first region in `REGION_IDS_IN_UI_ORDER` wins when the same IATA is repeated.
 */
export function formatIataListByRegion(map: Record<string, RegionId>): Record<RegionId, string> {
  const buckets: Record<RegionId, string[]> = {} as Record<RegionId, string[]>
  for (const id of REGION_IDS_IN_UI_ORDER) {
    buckets[id] = []
  }
  for (const [iata, reg] of Object.entries(map)) {
    if (reg === 'otherHubs') continue
    if (buckets[reg] !== undefined) {
      buckets[reg].push(iata.trim().toUpperCase())
    }
  }
  for (const k of Object.keys(buckets) as RegionId[]) {
    buckets[k].sort()
  }
  const out = {} as Record<RegionId, string>
  for (const id of REGION_IDS_IN_UI_ORDER) {
    if (id === 'otherHubs') {
      out[id] = ''
    } else {
      out[id] = buckets[id].join(', ')
    }
  }
  return out
}

const IATA_RE = /^[A-Z0-9]{2}$/

/**
 * Rebuilds a full IATA → region map. First-occurrence region wins; duplicate codes in later
 * textareas are ignored to match a stable round-trip.
 */
export function buildAirlineMapFromRegionIataText(drafts: Record<RegionId, string>): Record<string, RegionId> {
  const out: Record<string, RegionId> = {}
  for (const id of REGION_IDS_IN_UI_ORDER) {
    if (id === 'otherHubs') continue
    const t = drafts[id] ?? ''
    for (const raw of t.split(/[\s,]+/)) {
      const c = raw.trim().toUpperCase()
      if (!IATA_RE.test(c) || out[c]) continue
      out[c] = id
    }
  }
  return out
}
