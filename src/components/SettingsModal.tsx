import { useEffect, useRef, useState } from 'react'
import { REGION_IDS_IN_UI_ORDER, REGION_LABELS, type RegionId } from '../data/regions'
import {
  buildAirlineMapFromRegionIataText,
  formatIataListByRegion,
} from '../db/airlineRegionRepo'
import { buildAirportMapFromRegionDraft, formatAirportListByRegion } from '../db/airportRegionRepo'
import type { SerpCaptureListRow, SerpCaptureStoredRecord } from '../db/serpCaptureRepo'
import { downloadJson } from '../lib/serpDebugExport'
import type { PersistedSettings } from '../hooks/usePersistedSettings'

type Props = {
  open: boolean
  onClose: () => void
  settings: PersistedSettings
  onChange: (p: Partial<PersistedSettings>) => void
  regionCountries: Record<RegionId, string[]>
  onRegionTextChange: (id: RegionId, text: string) => void
  airlineUiRegions: Record<string, RegionId>
  onReplaceAirlineMappings: (m: Record<string, RegionId>) => void
  airportUiRegions: Record<string, RegionId>
  onReplaceAirportMappings: (m: Record<string, RegionId>) => void
  onResetRegions: () => void
  cacheTtlHours: number
  onCacheTtlChange: (hours: number) => void
  onDownloadDb: () => void
  onResetSqlite: () => void
  getSerpCaptureRows: () => Promise<SerpCaptureListRow[]>
  getSerpCaptureStoredRecord: (id: number) => Promise<SerpCaptureStoredRecord | null>
  onDeleteSerpCapture: (id: number) => void | Promise<void>
}

export function SettingsModal({
  open,
  onClose,
  settings,
  onChange,
  regionCountries,
  onRegionTextChange,
  airlineUiRegions,
  onReplaceAirlineMappings,
  airportUiRegions,
  onReplaceAirportMappings,
  onResetRegions,
  cacheTtlHours,
  onCacheTtlChange,
  onDownloadDb,
  onResetSqlite,
  getSerpCaptureRows,
  getSerpCaptureStoredRecord,
  onDeleteSerpCapture,
}: Props) {
  const [airlineDraftByRegion, setAirlineDraftByRegion] = useState<Record<RegionId, string>>(() =>
    formatIataListByRegion(airlineUiRegions),
  )
  const airlineDraftRef = useRef(airlineDraftByRegion)
  const airlinePropsRef = useRef(airlineUiRegions)
  const airlineSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [airportDraftByRegion, setAirportDraftByRegion] = useState<Record<RegionId, string>>(() =>
    formatAirportListByRegion(airportUiRegions),
  )
  const airportDraftRef = useRef(airportDraftByRegion)
  const airportPropsRef = useRef(airportUiRegions)
  const airportSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [serpCaptureRows, setSerpCaptureRows] = useState<SerpCaptureListRow[]>([])

  useEffect(() => {
    airlinePropsRef.current = airlineUiRegions
  }, [airlineUiRegions])

  useEffect(() => {
    airportPropsRef.current = airportUiRegions
  }, [airportUiRegions])

  const scheduleAirlineSave = () => {
    if (airlineSaveDebounceRef.current) clearTimeout(airlineSaveDebounceRef.current)
    airlineSaveDebounceRef.current = setTimeout(() => {
      airlineSaveDebounceRef.current = null
      const built = buildAirlineMapFromRegionIataText(airlineDraftRef.current)
      for (const [c, r] of Object.entries(airlinePropsRef.current)) {
        if (r === 'otherHubs' && built[c] === undefined) {
          built[c] = 'otherHubs'
        }
      }
      onReplaceAirlineMappings(built)
    }, 400)
  }

  const scheduleAirportSave = () => {
    if (airportSaveDebounceRef.current) clearTimeout(airportSaveDebounceRef.current)
    airportSaveDebounceRef.current = setTimeout(() => {
      airportSaveDebounceRef.current = null
      const built = buildAirportMapFromRegionDraft(airportDraftRef.current)
      for (const [c, r] of Object.entries(airportPropsRef.current)) {
        if (r === 'otherHubs' && built[c] === undefined) {
          built[c] = 'otherHubs'
        }
      }
      onReplaceAirportMappings(built)
    }, 400)
  }

  useEffect(() => {
    if (open) {
      const f = formatIataListByRegion(airlineUiRegions)
      setAirlineDraftByRegion(f)
      airlineDraftRef.current = f
    }
  }, [open, airlineUiRegions])

  useEffect(() => {
    if (open) {
      const f = formatAirportListByRegion(airportUiRegions)
      setAirportDraftByRegion(f)
      airportDraftRef.current = f
    }
  }, [open, airportUiRegions])

  useEffect(() => {
    if (!open) return
    void getSerpCaptureRows().then(setSerpCaptureRows)
  }, [open, getSerpCaptureRows])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal">
        <header className="modal-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span className="label">SerpApi API key</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              placeholder="Stored in this browser only (localStorage)"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.mockMode}
              onChange={(e) => onChange({ mockMode: e.target.checked })}
            />
            Mock data mode (no API calls)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.deepSearch}
              onChange={(e) => onChange({ deepSearch: e.target.checked })}
            />
            Deep search (slower, higher SerpApi fidelity)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.showHidden}
              onChange={(e) => onChange({ showHidden: e.target.checked })}
            />
            Request hidden / “view more” results (show_hidden)
          </label>
          <h3 className="h3">Result cards</h3>
          <p className="muted small">
            Layover rows and the duration bar use these thresholds. “Long” is strictly longer than the first value;
            “short” is strictly shorter than the second.
          </p>
          <div className="row2">
            <label className="field">
              <span className="label">Long layover over (hours)</span>
              <input
                className="input"
                type="number"
                min={0.5}
                max={72}
                step={0.5}
                value={settings.layoverLongMinHours}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  let v = Math.min(72, Math.max(0.5, n))
                  if (v <= settings.layoverShortMaxHours) {
                    v = settings.layoverShortMaxHours + 0.25
                  }
                  onChange({ layoverLongMinHours: v })
                }}
              />
            </label>
            <label className="field">
              <span className="label">Short layover under (hours)</span>
              <input
                className="input"
                type="number"
                min={0.25}
                max={24}
                step={0.25}
                value={settings.layoverShortMaxHours}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  let v = Math.min(24, Math.max(0.25, n))
                  if (v >= settings.layoverLongMinHours) {
                    v = Math.max(0.25, settings.layoverLongMinHours - 0.25)
                  }
                  onChange({ layoverShortMaxHours: v })
                }}
              />
            </label>
          </div>
          <div className="row3">
            <label className="field">
              <span className="label">gl</span>
              <input className="input" value={settings.gl} onChange={(e) => onChange({ gl: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">hl</span>
              <input className="input" value={settings.hl} onChange={(e) => onChange({ hl: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">currency</span>
              <input
                className="input"
                value={settings.currency}
                onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
              />
            </label>
          </div>

          <hr className="sep" />
          <h3 className="h3">Local SQLite (sql.js)</h3>
          <p className="muted small">
            Region lists, search snapshots, segment/layover durations, and local departure hours are stored in a
            browser SQLite database (IndexedDB). Adjust regions here — no build step required.
          </p>
          <label className="field">
            <span className="label">Cache TTL (hours)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={168}
              value={cacheTtlHours}
              onChange={(e) => onCacheTtlChange(Number(e.target.value))}
            />
            <span className="muted small">
              Skip SerpApi when a matching Search API run is newer than this (TTL still applies when merging snapshots).
            </span>
          </label>
          <div className="settings-db-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onDownloadDb}
              title="Download a copy of the local SQLite database as a .sqlite file"
            >
              Download SQLite DB
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (window.confirm('Delete the entire local SQLite database and reseed defaults?')) onResetSqlite()
              }}
            >
              Reset local database
            </button>
          </div>

          <h3 className="h3">Saved SerpApi captures</h3>
          <p className="muted small">
            Each <strong>Search API</strong> run stores the full proxy response (per flex date), request params, and the
            derived analysis (segment hubs vs API layovers). Kept locally in SQLite; oldest rows are removed after{' '}
            <strong>20</strong> captures. Use these files for offline debugging without re-calling SerpApi.
          </p>
          {serpCaptureRows.length === 0 ? (
            <p className="muted small">No captures yet — run a search with “Search API” selected.</p>
          ) : (
            <ul className="serp-capture-list">
              {serpCaptureRows.map((row) => {
                let summary = row.summary_json
                try {
                  const p = JSON.parse(row.summary_json) as {
                    origins?: string[]
                    destinations?: string[]
                    outboundDate?: string
                  }
                  summary = `${(p.origins ?? []).join(',')} → ${(p.destinations ?? []).join(',')} · out ${p.outboundDate ?? ''}`
                } catch {
                  /* keep raw */
                }
                return (
                  <li key={row.id} className="serp-capture-row">
                    <span className="mono small">
                      #{row.id} · {new Date(row.created_at).toLocaleString()}
                      {row.mock_mode ? ' · mock' : ''}
                    </span>
                    <span className="muted small serp-capture-summary">{summary}</span>
                    <span className="serp-capture-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-tiny"
                        onClick={async () => {
                          const rec = await getSerpCaptureStoredRecord(row.id)
                          if (rec) downloadJson(`serp-capture-${row.id}.json`, rec)
                        }}
                      >
                        Download JSON
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-tiny"
                        onClick={async () => {
                          if (window.confirm('Delete this saved capture?')) {
                            await onDeleteSerpCapture(row.id)
                            setSerpCaptureRows(await getSerpCaptureRows())
                          }
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <hr className="sep" />
          <h3 className="h3">Regions, airlines, and airports</h3>
          <p className="muted small">
            <strong>Countries (left):</strong> which ISO country codes belong in each region — this drives both the
            airline &amp; layover filters. <strong>Airline IATA (right, 2-letter):</strong> optional overrides; e.g.{' '}
            <code className="mono">DL</code> is Delta Air Lines. <strong>Airport IATA (3-letter):</strong> optional
            layover-bucket overrides (e.g. move a hub to a different region than its directory country). First region in
            list order wins if the same code appears twice.
          </p>
          <p className="region-column-head row2" aria-hidden>
            <span className="label muted">Countries (ISO-2)</span>
            <span className="label muted">Airline + airport IATA</span>
          </p>
          {REGION_IDS_IN_UI_ORDER.map((id) =>
            id === 'otherHubs' ? (
              <div key={id} className="field">
                <span className="label">{REGION_LABELS[id]}</span>
                <p className="muted small">
                  Not editable: airlines or layover airports that do not map are grouped here in the result filters.
                </p>
              </div>
            ) : (
              <div key={id} className="row2 region-pair">
                <label className="field">
                  <span className="label">{REGION_LABELS[id]}</span>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={regionCountries[id]?.join(', ') ?? ''}
                    onChange={(e) => onRegionTextChange(id, e.target.value)}
                  />
                </label>
                <div className="field region-pair-overrides">
                  <label className="field">
                    <span className="label" title={REGION_LABELS[id]}>
                      Airline IATA (2)
                    </span>
                    <textarea
                      className="textarea textarea-mono"
                      rows={2}
                      spellCheck={false}
                      aria-label={`Airline IATA codes for ${REGION_LABELS[id]}`}
                      value={airlineDraftByRegion[id] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        const next = { ...airlineDraftRef.current, [id]: v }
                        airlineDraftRef.current = next
                        setAirlineDraftByRegion(next)
                        scheduleAirlineSave()
                      }}
                    />
                  </label>
                  <label className="field">
                    <span className="label">Airport IATA (3)</span>
                    <textarea
                      className="textarea textarea-mono"
                      rows={2}
                      spellCheck={false}
                      placeholder="e.g. LHR, CDG"
                      aria-label={`Airport IATA codes for ${REGION_LABELS[id]}`}
                      value={airportDraftByRegion[id] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        const next = { ...airportDraftRef.current, [id]: v }
                        airportDraftRef.current = next
                        setAirportDraftByRegion(next)
                        scheduleAirportSave()
                      }}
                    />
                  </label>
                </div>
              </div>
            ),
          )}
          <button type="button" className="btn btn-secondary" onClick={onResetRegions}>
            Reset regions, airline, and airport mappings to defaults
          </button>
        </div>
      </div>
    </div>
  )
}
