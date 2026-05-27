import type { Database } from 'sql.js'
import {
  cloneDefaultRegions,
  DEFAULT_REGION_COUNTRIES,
  isRegionId,
  REGION_IDS_IN_UI_ORDER,
  REGION_LABELS,
  type RegionId,
} from '../data/regions'

const LEGACY_LS = 'flight-itinerary-discovery-settings-v1'
const APP_KV_REGION_MODEL = 'region_model_version'

/** v1 (finer) region_id keys still present in some IndexedDB exports → v2 `RegionId`. */
const V1_REGION_ID_REMAP: Record<string, RegionId> = {
  canada: 'northAmerica',
  centralAmericaCaribbean: 'northAmerica',
  europeWest: 'europe',
  easternEurope: 'europe',
  russiaCis: 'europe',
  china: 'asia',
  northeastAsia: 'asia',
  southeastAsia: 'asia',
  centralAsia: 'asia',
  southAsia: 'asia',
}

function getAppKv(db: Database, key: string): string | null {
  const stmt = db.prepare('SELECT value FROM app_kv WHERE key = ?')
  stmt.bind([key])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const o = stmt.getAsObject() as { value: string }
  stmt.free()
  return o.value == null ? null : String(o.value)
}

function setAppKv(db: Database, key: string, value: string) {
  db.run('INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)', [key, value])
}

function targetRegionIdForStoredRow(regionId: string): RegionId | null {
  if (V1_REGION_ID_REMAP[regionId]) return V1_REGION_ID_REMAP[regionId]
  if (isRegionId(regionId)) return regionId
  return null
}

/** Keep SQLite \`region_catalog\` in sync with app constants (for ad-hoc queries / debugging). */
export function syncRegionCatalog(db: Database) {
  for (let i = 0; i < REGION_IDS_IN_UI_ORDER.length; i++) {
    const id = REGION_IDS_IN_UI_ORDER[i]
    const isComputed = id === 'otherHubs' ? 1 : 0
    db.run(
      'INSERT OR REPLACE INTO region_catalog (region_id, display_label, sort_order, is_computed) VALUES (?, ?, ?, ?)',
      [id, REGION_LABELS[id], i, isComputed],
    )
  }
}

export function loadRegionsFromDb(db: Database): Record<RegionId, string[]> {
  const out = {} as Record<RegionId, string[]>
  for (const k of REGION_IDS_IN_UI_ORDER) {
    out[k] = []
  }
  const stmt = db.prepare('SELECT region_id, country_iso FROM region_country ORDER BY region_id, country_iso')
  while (stmt.step()) {
    const row = stmt.getAsObject() as { region_id: string; country_iso: string }
    const rid = row.region_id as RegionId
    if (out[rid] !== undefined && !out[rid].includes(row.country_iso)) {
      out[rid].push(row.country_iso)
    }
  }
  stmt.free()
  for (const k of REGION_IDS_IN_UI_ORDER) {
    if (out[k].length === 0) out[k] = [...DEFAULT_REGION_COUNTRIES[k]]
  }
  return out
}

export function replaceAllRegions(db: Database, map: Record<RegionId, string[]>) {
  db.run('DELETE FROM region_country')
  for (const rid of Object.keys(map) as RegionId[]) {
    for (const iso of map[rid] ?? []) {
      const u = iso.trim().toUpperCase()
      if (u) db.run('INSERT OR IGNORE INTO region_country (region_id, country_iso) VALUES (?, ?)', [rid, u])
    }
  }
}

export function seedRegionsIfEmpty(db: Database) {
  const r = db.exec('SELECT COUNT(*) FROM region_country')
  const count = Number(r[0]?.values[0]?.[0] ?? 0)
  if (count > 0) return

  try {
    const raw = localStorage.getItem(LEGACY_LS)
    if (raw) {
      const p = JSON.parse(raw) as { regionCountries?: Record<RegionId, string[]> }
      if (p.regionCountries && typeof p.regionCountries === 'object') {
        replaceAllRegions(db, { ...cloneDefaultRegions(), ...p.regionCountries })
        return
      }
    }
  } catch {
    /* ignore */
  }
  replaceAllRegions(db, cloneDefaultRegions())
}

/**
 * One-time: merge v1 `region_country` / `airline_ui_region` rows into v2 `RegionId` buckets.
 * Safe to re-run: exits early when `app_kv.region_model_version` is already 2.
 */
export function migrateRegionModelV2(db: Database) {
  if (getAppKv(db, APP_KV_REGION_MODEL) === '2') return

  const byTarget = {} as Record<RegionId, Set<string>>
  for (const k of REGION_IDS_IN_UI_ORDER) {
    byTarget[k] = new Set()
  }
  const stmt = db.prepare('SELECT region_id, country_iso FROM region_country')
  while (stmt.step()) {
    const row = stmt.getAsObject() as { region_id: string; country_iso: string }
    const t = String(row.region_id)
    const target = targetRegionIdForStoredRow(t)
    if (!target) continue
    const u = String(row.country_iso).trim().toUpperCase()
    if (u) byTarget[target].add(u)
  }
  stmt.free()

  const defaults = cloneDefaultRegions()
  const merged: Record<RegionId, string[]> = {} as Record<RegionId, string[]>
  for (const k of REGION_IDS_IN_UI_ORDER) {
    const a = Array.from(byTarget[k]).sort()
    merged[k] = a.length > 0 ? a : defaults[k] ?? []
  }
  replaceAllRegions(db, merged)

  for (const sql of [
    "UPDATE airline_ui_region SET ui_region = 'northAmerica' WHERE ui_region IN ('canada', 'centralAmericaCaribbean')",
    "UPDATE airline_ui_region SET ui_region = 'europe' WHERE ui_region IN ('europeWest', 'easternEurope', 'russiaCis')",
    "UPDATE airline_ui_region SET ui_region = 'asia' WHERE ui_region IN ('china', 'northeastAsia', 'southeastAsia', 'centralAsia', 'southAsia')",
  ]) {
    try {
      db.run(sql)
    } catch {
      /* ignore if column missing, etc. */
    }
  }

  setAppKv(db, APP_KV_REGION_MODEL, '2')
}
