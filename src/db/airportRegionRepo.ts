import type { Database } from 'sql.js'
import type { RegionId } from '../data/regions'
import { isRegionId, REGION_IDS_IN_UI_ORDER } from '../data/regions'
import { normalizeStoredAirlineRegion } from '../lib/airlineRegionGroup'
import { formatIataListByRegion } from './airlineRegionRepo'

function isPersistableAirportRegion(s: string): s is RegionId {
  return isRegionId(s)
}

export function loadAirportUiRegionsFromDb(db: Database): Record<string, RegionId> {
  const out: Record<string, RegionId> = {}
  const stmt = db.prepare('SELECT iata, ui_region FROM airport_ui_region')
  while (stmt.step()) {
    const r = stmt.getAsObject() as { iata: string; ui_region: string }
    const code = String(r.iata).trim().toUpperCase()
    const normalized = normalizeStoredAirlineRegion(String(r.ui_region))
    if (code && normalized && isPersistableAirportRegion(normalized)) out[code] = normalized
  }
  stmt.free()
  return out
}

export function replaceAllAirportUiRegions(db: Database, map: Record<string, RegionId>) {
  db.run('DELETE FROM airport_ui_region')
  for (const [iata, reg] of Object.entries(map)) {
    const code = iata.trim().toUpperCase()
    if (!code || !isPersistableAirportRegion(reg)) continue
    db.run('INSERT OR REPLACE INTO airport_ui_region (iata, ui_region) VALUES (?, ?)', [code, reg])
  }
}

/** IATA location codes are 3 letters (e.g. LHR, JFK). */
const AP_RE = /^[A-Z0-9]{3}$/

/**
 * Same per-region textarea rules as airlines: first region in list order wins on duplicates.
 */
export function buildAirportMapFromRegionDraft(drafts: Record<RegionId, string>): Record<string, RegionId> {
  const out: Record<string, RegionId> = {}
  for (const id of REGION_IDS_IN_UI_ORDER) {
    if (id === 'otherHubs') continue
    const t = drafts[id] ?? ''
    for (const raw of t.split(/[\s,]+/)) {
      const c = raw.trim().toUpperCase()
      if (!AP_RE.test(c) || out[c]) continue
      out[c] = id
    }
  }
  return out
}

export { formatIataListByRegion as formatAirportListByRegion }
