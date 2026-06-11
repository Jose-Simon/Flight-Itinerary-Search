import type { Database } from 'sql.js'
import type { SerpCaptureDownloadPayload } from '../lib/serpDebugExport'

export type SerpCaptureStoredRecord = {
  version: 1
  savedAt: string
  mockMode: boolean
  origins: string[]
  destinations: string[]
  outboundDate: string
  outboundEnd: string
  returnDate: string | null
  returnEnd: string | null
  deepSearch: boolean
  showHidden: boolean
  gl: string
  hl: string
  currency: string
  data: SerpCaptureDownloadPayload
}

export type SerpCaptureListRow = {
  id: number
  created_at: number
  mock_mode: number
  summary_json: string
}

/** Fields passed to `saveSerpApiCapture` (excluding stored record envelope). */
export type SerpCaptureSaveSummary = Omit<SerpCaptureStoredRecord, 'version' | 'savedAt' | 'data'> & {
  searchGoal?: 'discovery' | 'priceWindow'
}

const MAX_CAPTURES = 20

export function saveSerpApiCapture(
  db: Database,
  summary: SerpCaptureSaveSummary,
  data: SerpCaptureStoredRecord['data'],
) {
  const record: SerpCaptureStoredRecord = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...summary,
    data,
  }
  const payloadJson = JSON.stringify(record)
  const summaryJson = JSON.stringify({
    searchGoal: summary.searchGoal ?? 'discovery',
    origins: summary.origins,
    destinations: summary.destinations,
    outboundDate: summary.outboundDate,
    outboundEnd: summary.outboundEnd,
    returnDate: summary.returnDate,
    returnEnd: summary.returnEnd,
  })
  db.run(
    'INSERT INTO serp_api_capture (created_at, mock_mode, summary_json, payload_json) VALUES (?, ?, ?, ?)',
    [Date.now(), summary.mockMode ? 1 : 0, summaryJson, payloadJson],
  )
  trimOldCaptures(db, MAX_CAPTURES)
}

function trimOldCaptures(db: Database, keep: number) {
  const countR = db.exec('SELECT COUNT(*) AS c FROM serp_api_capture')
  const n = Number(countR[0]?.values[0]?.[0] ?? 0)
  if (n <= keep) return
  const del = n - keep
  const stmt = db.prepare('SELECT id FROM serp_api_capture ORDER BY created_at ASC LIMIT ?')
  stmt.bind([del])
  const ids: number[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id?: number }
    if (row.id != null) ids.push(row.id)
  }
  stmt.free()
  for (const id of ids) {
    db.run('DELETE FROM serp_api_capture WHERE id = ?', [id])
  }
}

export function listSerpCaptures(db: Database, limit = 30): SerpCaptureListRow[] {
  const stmt = db.prepare(
    'SELECT id, created_at, mock_mode, summary_json FROM serp_api_capture ORDER BY created_at DESC LIMIT ?',
  )
  stmt.bind([limit])
  const out: SerpCaptureListRow[] = []
  while (stmt.step()) {
    const r = stmt.getAsObject() as {
      id: number
      created_at: number
      mock_mode: number
      summary_json: string
    }
    out.push(r)
  }
  stmt.free()
  return out
}

export function loadSerpCaptureRecord(db: Database, id: number): SerpCaptureStoredRecord | null {
  const stmt = db.prepare('SELECT payload_json FROM serp_api_capture WHERE id = ?')
  stmt.bind([id])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const raw = stmt.getAsObject() as { payload_json?: string }
  stmt.free()
  try {
    return JSON.parse(String(raw.payload_json ?? '')) as SerpCaptureStoredRecord
  } catch {
    return null
  }
}

export function deleteSerpCapture(db: Database, id: number) {
  db.run('DELETE FROM serp_api_capture WHERE id = ?', [id])
}
