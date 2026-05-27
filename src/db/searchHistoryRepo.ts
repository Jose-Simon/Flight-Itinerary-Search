import type { Database } from 'sql.js'
import type { SearchHistorySnapshotV1, SearchHistoryRow } from './searchHistoryTypes'

const MAX_ROWS = 60

export function appendSearchHistory(
  db: Database,
  snapshot: SearchHistorySnapshotV1,
  outboundCount: number,
  returnCount: number,
) {
  const json = JSON.stringify(snapshot)
  db.run(
    `INSERT INTO search_history (created_at, snapshot_json, outbound_count, return_count) VALUES (?, ?, ?, ?)`,
    [Date.now(), json, outboundCount, returnCount],
  )
  const cntStmt = db.prepare('SELECT COUNT(*) AS c FROM search_history')
  cntStmt.step()
  const total = Number((cntStmt.getAsObject() as { c: number }).c)
  cntStmt.free()
  if (total > MAX_ROWS) {
    const toDrop = total - MAX_ROWS
    db.run(
      `DELETE FROM search_history WHERE id IN (
         SELECT id FROM search_history ORDER BY created_at ASC LIMIT ?
       )`,
      [toDrop],
    )
  }
}

export function listSearchHistory(db: Database, limit = 30): SearchHistoryRow[] {
  const stmt = db.prepare(
    `SELECT id, created_at, snapshot_json, outbound_count, return_count
     FROM search_history ORDER BY created_at DESC LIMIT ?`,
  )
  stmt.bind([limit])
  const out: SearchHistoryRow[] = []
  while (stmt.step()) {
    const o = stmt.getAsObject() as {
      id: number
      created_at: number
      snapshot_json: string
      outbound_count: number
      return_count: number
    }
    try {
      const snapshot = JSON.parse(o.snapshot_json) as SearchHistorySnapshotV1
      if (snapshot?.v !== 1) continue
      out.push({
        id: Number(o.id),
        createdAt: Number(o.created_at),
        snapshot,
        outboundCount: Number(o.outbound_count),
        returnCount: Number(o.return_count),
      })
    } catch {
      /* skip */
    }
  }
  stmt.free()
  return out
}

export function deleteSearchHistoryEntry(db: Database, id: number) {
  db.run('DELETE FROM search_history WHERE id = ?', [id])
}
