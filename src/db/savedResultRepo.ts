import type { Database } from 'sql.js'
import type { SavedResultLeg, SavedResultPayloadV1, SavedResultRow } from './savedResultTypes'

export function upsertSavedResult(db: Database, leg: SavedResultLeg, scheduleKey: string, payload: SavedResultPayloadV1) {
  const json = JSON.stringify(payload)
  db.run(
    `INSERT INTO saved_result (created_at, leg, schedule_key, payload_json) VALUES (?, ?, ?, ?)
     ON CONFLICT(leg, schedule_key) DO UPDATE SET
       created_at = excluded.created_at,
       payload_json = excluded.payload_json`,
    [Date.now(), leg, scheduleKey, json],
  )
}

export function listSavedResults(db: Database): SavedResultRow[] {
  const stmt = db.prepare(
    `SELECT id, created_at, leg, schedule_key, payload_json FROM saved_result ORDER BY created_at DESC`,
  )
  const out: SavedResultRow[] = []
  while (stmt.step()) {
    const o = stmt.getAsObject() as {
      id: number
      created_at: number
      leg: string
      schedule_key: string
      payload_json: string
    }
    try {
      const payload = JSON.parse(o.payload_json) as SavedResultPayloadV1
      if (payload?.v !== 1 || !payload.itinerary) continue
      const leg = o.leg === 'return' ? 'return' : 'outbound'
      out.push({
        id: Number(o.id),
        createdAt: Number(o.created_at),
        leg,
        scheduleKey: String(o.schedule_key),
        payload,
      })
    } catch {
      /* skip */
    }
  }
  stmt.free()
  return out
}

export function deleteSavedResultByKey(db: Database, leg: SavedResultLeg, scheduleKey: string) {
  db.run('DELETE FROM saved_result WHERE leg = ? AND schedule_key = ?', [leg, scheduleKey])
}
