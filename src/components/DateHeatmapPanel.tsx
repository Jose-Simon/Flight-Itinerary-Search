import { useMemo, useState } from 'react'
import type { PriceWindowResult } from '../lib/routeGrouping'
import { reverseRouteKey } from '../lib/routeGrouping'
import { formatPriceAmount } from '../lib/formatPrice'

function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function dayOfWeek(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}

function heatColor(price: number, minP: number, maxP: number): string {
  if (maxP <= minP) return 'hsl(145,62%,46%)'
  const t = Math.max(0, Math.min(1, (price - minP) / (maxP - minP)))
  const hue = Math.round(145 - t * 145)
  const light = Math.round(26 + (1 - t) * 22)
  return `hsl(${hue},62%,${light}%)`
}

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
    const cells = new Map<string, number>() // "outDate|retDate" → combined price

    for (const retDate of retDates) {
      const retBucket = retDateMap?.get(retDate)
      if (!retBucket) continue
      for (const outDate of outDates) {
        if (retDate <= outDate) continue // return must be after outbound
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

  // Route dropdown options
  const routeOptions = outResult.routeKeyOrder.map((rk) => {
    const [waypoint, carriers = ''] = rk.split('|')
    const path = waypoint.replace(/-/g, ' › ')
    return { value: rk, label: carriers ? `${path} — ${carriers}` : path }
  })

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
                // Skip rows with no data at all
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

                      if (price == null) {
                        return <div key={outDate} className="pw-heatmap-cell pw-heatmap-empty">—</div>
                      }
                      return (
                        <div
                          key={outDate}
                          className={`pw-heatmap-cell${isCheapest ? ' pw-heatmap-cheapest' : ''}`}
                          style={{ background: heatColor(price, minP, maxP) }}
                          title={`Out ${shortDate(outDate)} · Ret ${shortDate(retDate)} · ${formatPriceAmount(price, currency)}`}
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
      </div>
    </details>
  )
}
