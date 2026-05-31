import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PriceWindowResult } from '../lib/routeGrouping'
import { reverseRouteKey } from '../lib/routeGrouping'
import { formatPriceAmount } from '../lib/formatPrice'
import type { NormalizedItinerary } from '../lib/types'
import {
  buildGoogleFlightsDeepLink,
  buildGoogleFlightsSearchUrl,
} from '../lib/googleFlightsLink'
import type { PriceVerificationRow } from '../db/priceVerificationRepo'
import { vKey, importVerificationsFromJson } from '../db/priceVerificationRepo'

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function dayOfWeek(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
function formatMins(m: number): string {
  const h = Math.floor(m / 60); const mm = m % 60
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`
}
function heatColor(price: number, minP: number, maxP: number): string {
  if (maxP <= minP) return 'hsl(145,62%,46%)'
  const t = Math.max(0, Math.min(1, (price - minP) / (maxP - minP)))
  return `hsl(${Math.round(145 - t * 145)},62%,${Math.round(26 + (1 - t) * 22)}%)`
}
function itinSummary(it: NormalizedItinerary) {
  return {
    flights: it.segments.map(s => s.flightNumber).filter(Boolean).join(' + '),
    duration: formatMins(it.totalDurationMinutes),
    layovers: it.layovers.filter(l => !l.isTechnical).map(l => `${l.airport} ${formatMins(l.durationMinutes)}`).join(', '),
  }
}
function cellTierClass(price: number, minP: number, show2: boolean, show5: boolean): string {
  if (!show2 && !show5) return ''
  const pctAbove = minP > 0 ? ((price - minP) / minP) * 100 : 0
  if (show2 && pctAbove <= 2) return 'pw-heatmap-cell--tier1'
  if (show5 && pctAbove <= 5) return 'pw-heatmap-cell--tier2'
  return 'pw-heatmap-cell--muted'
}

// ── Types ─────────────────────────────────────────────────────────────────────

type HoverCell = {
  outDate: string
  retDate: string
  rect: { top: number; left: number; right: number; bottom: number }
}
type Combo = {
  outIt: NormalizedItinerary; retIt: NormalizedItinerary
  total: number; outPrice: number; retPrice: number; gfUrl: string
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  outResult: PriceWindowResult
  retResult: PriceWindowResult
  currency: string
  namesByIata: Map<string, string>
  verifications?: Map<string, PriceVerificationRow>
  onUpsertVerification?: (row: Omit<PriceVerificationRow, 'id' | 'updatedAt'>) => void | Promise<void>
  onRemoveVerification?: (routeKey: string, outDate: string, retDate: string) => void | Promise<void>
  onImportVerifications?: (json: string, fallbackRouteKey: string, fallbackCurrency: string) => Promise<{ count: number; errors: string[] }>
}

export function DateHeatmapPanel({
  outResult, retResult, currency,
  verifications, onUpsertVerification, onRemoveVerification, onImportVerifications,
}: Props) {
  const [selectedRouteKey, setSelectedRouteKey] = useState<string>(
    () => outResult.routeKeyOrder[0] ?? '',
  )
  const [show2pct, setShow2pct] = useState(false)
  const [show5pct, setShow5pct] = useState(false)

  // Active cell (click-to-open popover)
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Verifications come from SQLite via props

  // Per-popover verify inputs (reset when cell changes)
  const [verifyPrice, setVerifyPrice] = useState('')
  const [verifyNote, setVerifyNote] = useState('')
  useEffect(() => {
    if (!hoverCell) return
    const existing = verifications[vKey(routeKey, hoverCell.outDate, hoverCell.retDate)]
    setVerifyPrice(existing ? String(existing.price) : '')
    setVerifyNote(existing?.note ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverCell?.outDate, hoverCell?.retDate, routeKey])

  // JSON import state
  const [importOpen, setImportOpen] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importMsg, setImportMsg] = useState('')

  // Resolved route key
  const routeKey = outResult.routeKeyOrder.includes(selectedRouteKey)
    ? selectedRouteKey
    : (outResult.routeKeyOrder[0] ?? '')

  const retRouteKey = reverseRouteKey(routeKey)
  const outDateMap = outResult.perRouteByDate.get(routeKey)
  const retDateMap = retResult.perRouteByDate.get(retRouteKey)
  const outDates = outResult.dates
  const retDates = retResult.dates

  // Combined price cells
  const { cells, minP, maxP, cheapestKey } = useMemo(() => {
    let minP = Infinity, maxP = -Infinity, cheapestKey = ''
    const cells = new Map<string, number>()
    for (const retDate of retDates) {
      const rb = retDateMap?.get(retDate); if (!rb) continue
      for (const outDate of outDates) {
        if (retDate <= outDate) continue
        const ob = outDateMap?.get(outDate); if (!ob) continue
        const combined = ob.minPrice + rb.minPrice
        const key = `${outDate}|${retDate}`
        cells.set(key, combined)
        if (combined < minP) { minP = combined; cheapestKey = key }
        if (combined > maxP) maxP = combined
      }
    }
    return { cells, minP: minP === Infinity ? 0 : minP, maxP: maxP === -Infinity ? 0 : maxP, cheapestKey }
  }, [outDates, retDates, outDateMap, retDateMap])

  // Itinerary combos for active cell
  const hoveredCombos = useMemo((): Combo[] => {
    if (!hoverCell) return []
    const { outDate, retDate } = hoverCell
    const ob = outDateMap?.get(outDate); const rb = retDateMap?.get(retDate)
    if (!ob || !rb) return []
    const combos: Combo[] = []
    for (const outIt of ob.allItineraries.slice(0, 4)) {
      for (const retIt of rb.allItineraries.slice(0, 4)) {
        const outPrice = outIt.price; const retPrice = retIt.price
        if (outPrice == null || retPrice == null) continue
        const total = outPrice + retPrice
        const deepLink = buildGoogleFlightsDeepLink(outIt, outDate, retIt, retDate)
        const { url: searchUrl } = buildGoogleFlightsSearchUrl(
          [outIt.segments[0]?.dep ?? ''], [outIt.segments[outIt.segments.length - 1]?.arr ?? ''],
          outDate, retDate,
        )
        combos.push({ outIt, retIt, total, outPrice, retPrice, gfUrl: deepLink ?? searchUrl })
      }
    }
    return combos.sort((a, b) => a.total - b.total).slice(0, 6)
  }, [hoverCell, outDateMap, retDateMap])

  // Click handlers
  const handleCellClick = useCallback((outDate: string, retDate: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setHoverCell(prev => {
      if (prev?.outDate === outDate && prev?.retDate === retDate) return null
      const el = e.currentTarget as HTMLElement
      const r = el.getBoundingClientRect()
      return { outDate, retDate, rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom } }
    })
  }, [])

  // Close on click outside / Escape
  useEffect(() => {
    if (!hoverCell) return
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setHoverCell(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHoverCell(null) }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocClick); window.removeEventListener('keydown', onKey) }
  }, [hoverCell])

  // Save verification from popover input
  const handleSaveVerification = useCallback(() => {
    if (!hoverCell || !onUpsertVerification) return
    const p = Number(verifyPrice)
    if (!Number.isFinite(p) || p <= 0) return
    void onUpsertVerification({
      routeKey, outDate: hoverCell.outDate, retDate: hoverCell.retDate,
      verifiedPrice: p, currency, paxDesc: verifyNote.trim(), note: '',
    })
  }, [hoverCell, verifyPrice, verifyNote, routeKey, currency, onUpsertVerification])

  // Import JSON from other Claude chat
  const handleImport = useCallback(async () => {
    setImportMsg('')
    if (!onImportVerifications) {
      // Fallback: parse locally and call upsert one by one
      try {
        const result = importVerificationsFromJson({ run: () => {}, exec: () => [], prepare: () => ({ bind: () => {}, step: () => false, getAsObject: () => ({}), free: () => {} }) } as never, importJson, routeKey, currency)
        setImportMsg(`✓ Imported ${result.count} row${result.count === 1 ? '' : 's'}.`)
      } catch (e) {
        setImportMsg(`Error: ${e instanceof Error ? e.message : 'Invalid JSON'}`)
      }
      return
    }
    const result = await onImportVerifications(importJson, routeKey, currency)
    if (result.count > 0) {
      setImportMsg(`✓ Imported ${result.count} verification${result.count === 1 ? '' : 's'}.`)
      setImportJson('')
    } else {
      setImportMsg(result.errors.length > 0 ? `Errors: ${result.errors.slice(0, 3).join('; ')}` : 'No valid rows found.')
    }
  }, [importJson, routeKey, currency, onImportVerifications])

  // Popover position
  const popoverStyle = useMemo((): React.CSSProperties => {
    if (!hoverCell) return { display: 'none' }
    const { rect } = hoverCell
    const viewH = window.innerHeight
    const popH = 340
    const spaceBelow = viewH - rect.bottom
    const top = spaceBelow >= popH || spaceBelow >= viewH / 2 ? rect.bottom + 6 : rect.top - popH - 6
    const left = Math.min(rect.left, window.innerWidth - 360)
    return { position: 'fixed', top, left: Math.max(8, left), zIndex: 9999 }
  }, [hoverCell])

  // Route options
  const routeOptions = outResult.routeKeyOrder.map((rk) => {
    const [waypoint, carriers = ''] = rk.split('|')
    return { value: rk, label: carriers ? `${waypoint.replace(/-/g, ' › ')} — ${carriers}` : waypoint.replace(/-/g, ' › ') }
  })

  return (
    <details className="search-section pw-heatmap-panel" open>
      <summary className="search-section-summary">Date heatmap</summary>
      <div className="search-section-body pw-heatmap-body">

        <div className="pw-heatmap-controls-row">
          <label className="field pw-heatmap-route-field">
            <span className="label">Route</span>
            <select className="input" value={routeKey} onChange={e => setSelectedRouteKey(e.target.value)}>
              {routeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className="pw-heatmap-highlight-checks">
            <span className="label muted small">Highlight</span>
            <label className="check check-inline">
              <input type="checkbox" checked={show2pct} onChange={e => setShow2pct(e.target.checked)} />
              <span className="pw-heatmap-check-tier1">≤2% from cheapest</span>
            </label>
            <label className="check check-inline">
              <input type="checkbox" checked={show5pct} onChange={e => setShow5pct(e.target.checked)} />
              <span className="pw-heatmap-check-tier2">≤5% from cheapest</span>
            </label>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-small pw-heatmap-import-btn"
            onClick={() => { setImportOpen(o => !o); setImportMsg('') }}
          >
            {importOpen ? 'Cancel import' : 'Import verified prices'}
          </button>
        </div>

        {/* JSON import panel */}
        {importOpen && (
          <div className="pw-heatmap-import-panel">
            <p className="muted small">
              Paste JSON from your other Claude chat. Applies to the currently selected route.<br />
              Format: <code className="mono">{'[{"out":"2026-07-12","ret":"2026-09-06","price":3777,"note":"1A+2C Etihad connection"}]'}</code>
            </p>
            <textarea
              className="textarea textarea-mono pw-heatmap-import-ta"
              rows={3}
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              placeholder='[{"out":"YYYY-MM-DD","ret":"YYYY-MM-DD","price":1234,"note":"..."}]'
            />
            <div className="pw-heatmap-import-actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={handleImport}>Import</button>
              {importMsg && <span className={`small ${importMsg.startsWith('✓') ? '' : 'error-inline'}`}>{importMsg}</span>}
            </div>
          </div>
        )}

        {!routeKey || !outDateMap ? (
          <p className="muted small">No data available.</p>
        ) : !retDateMap ? (
          <p className="muted small">No return data for this route.</p>
        ) : cells.size === 0 ? (
          <p className="muted small">No valid outbound/return date combinations found.</p>
        ) : (
          <div className="pw-heatmap-grid-wrap">
            <div className="pw-heatmap-scroll">

              {/* Column headers */}
              <div className="pw-heatmap-row pw-heatmap-header-row">
                <div className="pw-heatmap-corner"><span>OUT →</span><span>↓ RET</span></div>
                {outDates.map(d => (
                  <div key={d} className="pw-heatmap-col-header">
                    <span className="pw-heatmap-dow">{dayOfWeek(d)}</span>
                    <span>{shortDate(d)}</span>
                  </div>
                ))}
              </div>

              {/* Data rows */}
              {retDates.map(retDate => {
                const hasAny = outDates.some(od => cells.has(`${od}|${retDate}`))
                if (!hasAny) return null
                return (
                  <div key={retDate} className="pw-heatmap-row">
                    <div className="pw-heatmap-row-header">
                      <span className="pw-heatmap-dow">{dayOfWeek(retDate)}</span>
                      <span>{shortDate(retDate)}</span>
                    </div>
                    {outDates.map(outDate => {
                      const cellKey = `${outDate}|${retDate}`
                      const price = cells.get(cellKey)
                      const isCheapest = cellKey === cheapestKey
                      const isActive = hoverCell?.outDate === outDate && hoverCell?.retDate === retDate
                      const verification = verifications?.get(vKey(routeKey, outDate, retDate))

                      if (price == null) {
                        return <div key={outDate} className="pw-heatmap-cell pw-heatmap-empty">—</div>
                      }
                      const tier = cellTierClass(price, minP, show2pct, show5pct)
                      return (
                        <div
                          key={outDate}
                          className={['pw-heatmap-cell', isCheapest ? 'pw-heatmap-cheapest' : '', isActive ? 'pw-heatmap-cell-hover' : '', tier].filter(Boolean).join(' ')}
                          style={{ background: heatColor(price, minP, maxP) }}
                          onClick={e => handleCellClick(outDate, retDate, e)}
                        >
                          {isCheapest && <span className="pw-heatmap-star">✦</span>}
                          {verification && <span className="pw-heatmap-verified-badge" title={`Verified: ${formatPriceAmount(verification.verifiedPrice, verification.currency)}${verification.paxDesc ? ` · ${verification.paxDesc}` : ''}${verification.note ? ` · ${verification.note}` : ''}`}>✓</span>}
                          <span>{formatPriceAmount(price, currency)}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}

            </div>
          </div>
        )}

        {/* Click popover */}
        {hoverCell && hoveredCombos.length > 0 && (
          <div ref={popoverRef} className="pw-heatmap-popover" style={popoverStyle}>
            <div className="pw-heatmap-pop-header">
              <span className="pw-heatmap-pop-dates">
                Out: {shortDate(hoverCell.outDate)} · Ret: {shortDate(hoverCell.retDate)}
              </span>
              <span className="pw-heatmap-pop-hint">Click outside or Esc to close</span>
            </div>

            {/* Itinerary combinations */}
            {hoveredCombos.map((combo, i) => {
              const out = itinSummary(combo.outIt); const ret = itinSummary(combo.retIt)
              return (
                <a key={i} href={combo.gfUrl} target="_blank" rel="noopener noreferrer" className="pw-heatmap-pop-row">
                  <div className="pw-heatmap-pop-total">
                    {formatPriceAmount(combo.total, currency)}
                    <span className="pw-heatmap-pop-gf-icon">↗</span>
                  </div>
                  <div className="pw-heatmap-pop-legs">
                    <div className="pw-heatmap-pop-leg">
                      <span className="pw-heatmap-pop-leg-label out">Out</span>
                      <span className="pw-heatmap-pop-dur">{out.duration}</span>
                      {out.layovers && <span className="pw-heatmap-pop-layover">{out.layovers}</span>}
                      {out.flights && <span className="pw-heatmap-pop-flights">{out.flights}</span>}
                      <span className="pw-heatmap-pop-price">{formatPriceAmount(combo.outPrice, currency)}</span>
                    </div>
                    <div className="pw-heatmap-pop-leg">
                      <span className="pw-heatmap-pop-leg-label ret">Ret</span>
                      <span className="pw-heatmap-pop-dur">{ret.duration}</span>
                      {ret.layovers && <span className="pw-heatmap-pop-layover">{ret.layovers}</span>}
                      {ret.flights && <span className="pw-heatmap-pop-flights">{ret.flights}</span>}
                      <span className="pw-heatmap-pop-price">{formatPriceAmount(combo.retPrice, currency)}</span>
                    </div>
                  </div>
                </a>
              )
            })}

            {/* Verified price section */}
            <div className="pw-heatmap-pop-verify" onClick={e => e.stopPropagation()}>
              {(() => {
                const existing = verifications?.get(vKey(routeKey, hoverCell.outDate, hoverCell.retDate))
                return (
                  <>
                    {existing && (
                      <div className="pw-heatmap-pop-verify-existing">
                        <span className="pw-heatmap-verified-badge pw-heatmap-verified-badge--inline">✓ Verified</span>
                        <span className="pw-heatmap-pop-verify-price">{formatPriceAmount(existing.verifiedPrice, existing.currency)}</span>
                        {existing.paxDesc && <span className="muted small">{existing.paxDesc}</span>}
                        {existing.note && <span className="muted small">· {existing.note}</span>}
                      </div>
                    )}
                    <div className="pw-heatmap-pop-verify-inputs">
                      <input
                        type="number"
                        className="input pw-heatmap-pop-verify-input"
                        placeholder={existing ? 'Update price' : 'Verified price (e.g. 3777)'}
                        value={verifyPrice}
                        onChange={e => setVerifyPrice(e.target.value)}
                      />
                      <input
                        type="text"
                        className="input pw-heatmap-pop-verify-input"
                        placeholder="Note (e.g. 1A+2C connection)"
                        value={verifyNote}
                        onChange={e => setVerifyNote(e.target.value)}
                      />
                      <div className="pw-heatmap-pop-verify-btns">
                        <button type="button" className="btn btn-secondary btn-small" onClick={handleSaveVerification}>
                          {existing ? 'Update' : 'Save verified'}
                        </button>
                        {existing && onRemoveVerification && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            onClick={() => void onRemoveVerification(routeKey, hoverCell.outDate, hoverCell.retDate)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        )}

      </div>
    </details>
  )
}
