import type { Database } from 'sql.js'
import type { SavedSearchPayloadV1, SavedSearchRow } from './savedSearchTypes'

const DEFAULT_KEY = 'default_saved_search_payload_v1'
const MAX_ROWS = 80

export function insertSavedSearch(db: Database, name: string, payload: SavedSearchPayloadV1) {
  const json = JSON.stringify(payload)
  db.run(`INSERT INTO saved_search (created_at, name, payload_json) VALUES (?, ?, ?)`, [
    Date.now(),
    name.trim() || 'Saved search',
    json,
  ])
  const cntStmt = db.prepare('SELECT COUNT(*) AS c FROM saved_search')
  cntStmt.step()
  const total = Number((cntStmt.getAsObject() as { c: number }).c)
  cntStmt.free()
  if (total > MAX_ROWS) {
    const toDrop = total - MAX_ROWS
    db.run(
      `DELETE FROM saved_search WHERE id IN (
         SELECT id FROM saved_search ORDER BY created_at ASC LIMIT ?
       )`,
      [toDrop],
    )
  }
}

export function listSavedSearches(db: Database, limit = 100): SavedSearchRow[] {
  const stmt = db.prepare(
    `SELECT id, created_at, name, payload_json FROM saved_search ORDER BY created_at DESC LIMIT ?`,
  )
  stmt.bind([limit])
  const out: SavedSearchRow[] = []
  while (stmt.step()) {
    const o = stmt.getAsObject() as {
      id: number
      created_at: number
      name: string
      payload_json: string
    }
    try {
      const payload = JSON.parse(o.payload_json) as SavedSearchPayloadV1
      if (payload?.v !== 1) continue
      out.push({
        id: Number(o.id),
        createdAt: Number(o.created_at),
        name: String(o.name),
        payload,
      })
    } catch {
      /* skip */
    }
  }
  stmt.free()
  return out
}

export function deleteSavedSearch(db: Database, id: number) {
  db.run('DELETE FROM saved_search WHERE id = ?', [id])
}

export function getDefaultSavedSearchPayload(db: Database): SavedSearchPayloadV1 | null {
  const stmt = db.prepare('SELECT value FROM app_kv WHERE key = ?')
  stmt.bind([DEFAULT_KEY])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as { value: string }
  stmt.free()
  try {
    const p = JSON.parse(row.value) as SavedSearchPayloadV1
    return p?.v === 1 ? p : null
  } catch {
    return null
  }
}

export function setDefaultSavedSearchPayload(db: Database, payload: SavedSearchPayloadV1) {
  const json = JSON.stringify(payload)
  db.run(
    `INSERT INTO app_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [DEFAULT_KEY, json],
  )
}
