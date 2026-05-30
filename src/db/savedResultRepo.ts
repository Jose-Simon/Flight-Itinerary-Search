import type { Database } from 'sql.js'
import type { SavedResultLeg, SavedResultPayload, SavedResultPayloadV1, SavedResultPayloadV2, SavedResultRow } from './savedResultTypes'

export function upsertSavedResult(db: Database, leg: SavedResultLeg, scheduleKey: string, payload: SavedResultPayload) {
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
      const payload = JSON.parse(o.payload_json) as Record<string, unknown>
      let parsed: SavedResultPayload | null = null

      if (payload?.v === 1 && payload.itinerary) {
        parsed = payload as unknown as SavedResultPayloadV1
      } else if (payload?.v === 2 && payload.outboundItinerary && payload.returnItinerary) {
        parsed = payload as unknown as SavedResultPayloadV2
      }

      if (!parsed) continue

      const leg: SavedResultLeg =
        o.leg === 'return' ? 'return' : o.leg === 'roundtrip' ? 'roundtrip' : 'outbound'

      out.push({
        id: Number(o.id),
        createdAt: Number(o.created_at),
        leg,
        scheduleKey: String(o.schedule_key),
        payload: parsed,
      })
    } catch {
      /* skip malformed rows */
    }
  }
  stmt.free()
  return out
}

export function deleteSavedResultByKey(db: Database, leg: SavedResultLeg, scheduleKey: string) {
  db.run('DELETE FROM saved_result WHERE leg = ? AND schedule_key = ?', [leg, scheduleKey])
}
