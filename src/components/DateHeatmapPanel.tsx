import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PriceWindowResult } from '../lib/routeGrouping'
import { reverseRouteKey } from '../lib/routeGrouping'
import { formatPriceAmount } from '../lib/formatPrice'
import type { NormalizedItinerary } from '../lib/types'
import {
  buildGoogleFlightsDeepLink,
  buildGoogleFlightsSearchUrl,
} from '../lib/googleFlightsLink'

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function dayOfWeek(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}

function formatMins(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`
}

function heatColor(price: number, minP: number, maxP: number): string {
  if (maxP <= minP) return 'hsl(145,62%,46%)'
  const t = Math.max(0, Math.min(1, (price - minP) / (maxP - minP)))
  const hue = Math.round(145 - t * 145)
  const light = Math.round(26 + (1 - t) * 22)
  return `hsl(${hue},62%,${light}%)`
}

function itinSummary(it: NormalizedItinerary): { flights: string; duration: string; layovers: string } {
  const flights = it.segments
    .map((s) => s.flightNumber)
    .filter(Boolean)
    .join(' + ')
  const duration = formatMins(it.totalDurationMinutes)
  const layovers = it.layovers
    .filter((l) => !l.isTechnical)
    .map((l) => `${l.airport} ${formatMins(l.durationMinutes)}`)
    .join(', ')
  return { flights, duration, layovers }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type HoverCell = {
  outDate: string
  retDate: string
  rect: { top: number; left: number; right: number; bottom: number }
}

type Combo = {
  outIt: NormalizedItinerary
  retIt: NormalizedItinerary
  total: number
  outPrice: number
  retPrice: number
  gfUrl: string
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  outResult: PriceWindowResult
  retResult: PriceWindowResult
  currency: string
  namesByIata: Map<string, string>
}

export function DateHeatmapPanel({ outResult, retResult, currency }: Props) {
  const [selectedRouteKey, setSelectedRouteKey] = useState<string>(
    () => outResult.routeKeyOrder[0] ?? '',
  )
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep route key valid when results change
  const routeKey = outResult.routeKeyOrder.includes(selectedRouteKey)
    ? selectedRouteKey
    : (outResult.routeKeyOrder[0] ?? '')

  const retRouteKey = reverseRouteKey(routeKey)
  const outDateMap = outResult.perRouteByDate.get(routeKey)
  const retDateMap = retResult.perRouteByDate.get(retRouteKey)
  const outDates = outResult.dates
  const retDates = retResult.dates

  // Cross-join outbound × return dates into combined-price cells
  const { cells, minP, maxP, cheapestKey } = useMemo(() => {
    let minP = Infinity
    let maxP = -Infinity
    let cheapestKey = ''
    const cells = new Map<string, number>()

    for (const retDate of retDates) {
      const retBucket = retDateMap?.get(retDate)
      if (!retBucket) continue
      for (const outDate of outDates) {
        if (retDate <= outDate) continue
        const outBucket = outDateMap?.get(outDate)
        if (!outBucket) continue
        const combined = outBucket.minPrice + retBucket.minPrice
        const key = `${outDate}|${retDate}`
        cells.set(key, combined)
        if (combined < minP) { minP = combined; cheapestKey = key }
        if (combined > maxP) maxP = combined
      }
    }

    return { cells, minP: minP === Infinity ? 0 : minP, maxP: maxP === -Infinity ? 0 : maxP, cheapestKey }
  }, [outDates, retDates, outDateMap, retDateMap])

  // Top itinerary combinations for the currently hovered cell
  const hoveredCombos = useMemo((): Combo[] => {
    if (!hoverCell) return []
    const { outDate, retDate } = hoverCell
    const outBucket = outDateMap?.get(outDate)
    const retBucket = retDateMap?.get(retDate)
    if (!outBucket || !retBucket) return []

    const outIts = outBucket.allItineraries.slice(0, 4)
    const retIts = retBucket.allItineraries.slice(0, 4)
    const combos: Combo[] = []

    for (const outIt of outIts) {
      for (const retIt of retIts) {
        const outPrice = outIt.price
        const retPrice = retIt.price
        if (outPrice == null || retPrice == null) continue

        const total = outPrice + retPrice
        const deepLink = buildGoogleFlightsDeepLink(outIt, outDate, retIt, retDate)
        const { url: searchUrl } = buildGoogleFlightsSearchUrl(
          [outIt.segments[0]?.dep ?? ''],
          [outIt.segments[outIt.segments.length - 1]?.arr ?? ''],
          outDate,
          retDate,
        )
        combos.push({ outIt, retIt, total, outPrice, retPrice, gfUrl: deepLink ?? searchUrl })
      }
    }

    return combos.sort((a, b) => a.total - b.total).slice(0, 6)
  }, [hoverCell, outDateMap, retDateMap])

  // Hover handlers with enter/leave timer so mouse can move into the popover
  const handleCellEnter = useCallback((outDate: string, retDate: string, e: React.MouseEvent) => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    setHoverCell({ outDate, retDate, rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom } })
  }, [])

  const handleCellLeave = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => setHoverCell(null), 180)
  }, [])

  const handlePopoverEnter = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
  }, [])

  const handlePopoverLeave = useCallback(() => {
    setHoverCell(null)
  }, [])

  // Close popover on Escape
  useEffect(() => {
    if (!hoverCell) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHoverCell(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hoverCell])

  // Route dropdown options
  const routeOptions = outResult.routeKeyOrder.map((rk) => {
    const [waypoint, carriers = ''] = rk.split('|')
    const path = waypoint.replace(/-/g, ' › ')
    return { value: rk, label: carriers ? `${path} — ${carriers}` : path }
  })

  // Popover position: prefer below the cell, flip above if too close to bottom
  const popoverStyle = useMemo((): React.CSSProperties => {
    if (!hoverCell) return { display: 'none' }
    const { rect } = hoverCell
    const viewH = window.innerHeight
    const popH = 280 // estimated popover height
    const spaceBelow = viewH - rect.bottom
    const top = spaceBelow >= popH || spaceBelow >= viewH / 2
      ? rect.bottom + 6
      : rect.top - popH - 6
    const left = Math.min(rect.left, window.innerWidth - 360)
    return { position: 'fixed', top, left: Math.max(8, left), zIndex: 9999 }
  }, [hoverCell])

  return (
    <details className="search-section pw-heatmap-panel" open>
      <summary className="search-section-summary">Date heatmap</summary>
      <div className="search-section-body pw-heatmap-body">

        <label className="field pw-heatmap-route-field">
          <span className="label">Route</span>
          <select
            className="input"
            value={routeKey}
            onChange={(e) => setSelectedRouteKey(e.target.value)}
          >
            {routeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        {!routeKey || !outDateMap ? (
          <p className="muted small">No data available.</p>
        ) : !retDateMap ? (
          <p className="muted small">No return data for this route.</p>
        ) : cells.size === 0 ? (
          <p className="muted small">No valid outbound/return date combinations found.</p>
        ) : (
          <div className="pw-heatmap-grid-wrap">
            <div className="pw-heatmap-scroll">

              {/* Header row: outbound dates */}
              <div className="pw-heatmap-row pw-heatmap-header-row">
                <div className="pw-heatmap-corner">
                  <span>OUT →</span>
                  <span>↓ RET</span>
                </div>
                {outDates.map((d) => (
                  <div key={d} className="pw-heatmap-col-header">
                    <span className="pw-heatmap-dow">{dayOfWeek(d)}</span>
                    <span>{shortDate(d)}</span>
                  </div>
                ))}
              </div>

              {/* Data rows: one per return date */}
              {retDates.map((retDate) => {
                const hasAny = outDates.some((od) => cells.has(`${od}|${retDate}`))
                if (!hasAny) return null
                return (
                  <div key={retDate} className="pw-heatmap-row">
                    <div className="pw-heatmap-row-header">
                      <span className="pw-heatmap-dow">{dayOfWeek(retDate)}</span>
                      <span>{shortDate(retDate)}</span>
                    </div>
                    {outDates.map((outDate) => {
                      const key = `${outDate}|${retDate}`
                      const price = cells.get(key)
                      const isCheapest = key === cheapestKey
                      const isHovered = hoverCell?.outDate === outDate && hoverCell?.retDate === retDate

                      if (price == null) {
                        return <div key={outDate} className="pw-heatmap-cell pw-heatmap-empty">—</div>
                      }
                      return (
                        <div
                          key={outDate}
                          className={`pw-heatmap-cell${isCheapest ? ' pw-heatmap-cheapest' : ''}${isHovered ? ' pw-heatmap-cell-hover' : ''}`}
                          style={{ background: heatColor(price, minP, maxP) }}
                          onMouseEnter={(e) => handleCellEnter(outDate, retDate, e)}
                          onMouseLeave={handleCellLeave}
                        >
                          {isCheapest && <span className="pw-heatmap-star">✦</span>}
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

        {/* ── Hover popover ─────────────────────────────────────────────── */}
        {hoverCell && hoveredCombos.length > 0 && (
          <div
            className="pw-heatmap-popover"
            style={popoverStyle}
            onMouseEnter={handlePopoverEnter}
            onMouseLeave={handlePopoverLeave}
          >
            <div className="pw-heatmap-pop-header">
              <span className="pw-heatmap-pop-dates">
                Out: {shortDate(hoverCell.outDate)} · Ret: {shortDate(hoverCell.retDate)}
              </span>
              <span className="pw-heatmap-pop-hint">Hover to keep open · click to open GF</span>
            </div>
            {hoveredCombos.map((combo, i) => {
              const out = itinSummary(combo.outIt)
              const ret = itinSummary(combo.retIt)
              return (
                <a
                  key={i}
                  href={combo.gfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pw-heatmap-pop-row"
                >
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
          </div>
        )}

      </div>
    </details>
  )
}
