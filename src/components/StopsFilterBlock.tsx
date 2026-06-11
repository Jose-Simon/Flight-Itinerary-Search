import { useMemo } from 'react'
import type { NormalizedItinerary } from '../lib/types'
import { stopsDistribution } from '../lib/resultInsights'

type Props = {
  /** Merged pool for this direction (distribution bar only). */
  distributionSource: NormalizedItinerary[]
  stopsMin: string
  stopsMax: string
  onStopsMin: (v: string) => void
  onStopsMax: (v: string) => void
}

export function StopsFilterBlock({ distributionSource, stopsMin, stopsMax, onStopsMin, onStopsMax }: Props) {
  const stops = useMemo(() => stopsDistribution(distributionSource), [distributionSource])
  const maxC = Math.max(1, ...stops.map((s) => s.count))
  const hasData = distributionSource.length > 0

  return (
    <div className="stops-filter-block">
      <div className="filter-section-title sub">Stops</div>
      {hasData ? (
        <div className="search-insights-stops-bar stops-filter-visual" role="img" aria-label="Stops in pool">
          {stops.map((s) => (
            <div
              key={s.key}
              className="search-insights-stops-seg"
              style={{ flex: `${Math.max(0.08, s.count / maxC)} 1 0` }}
              title={`${s.label}: ${s.count} in pool`}
            >
              <span className="search-insights-stops-seg-label">{s.label}</span>
              <span className="search-insights-stops-seg-n">{s.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small stops-filter-visual-empty">
          Run a search to see stop mix in the pool. During a round-trip price scan, the pool fills as routes load.
        </p>
      )}
      <div className="grid-2 tight-gap">
        <label className="field-tight">
          <span className="label">Stops min</span>
          <input
            className="input"
            type="number"
            min={0}
            max={20}
            step={1}
            placeholder="Any"
            value={stopsMin}
            onChange={(e) => onStopsMin(e.target.value)}
          />
        </label>
        <label className="field-tight">
          <span className="label">Stops max</span>
          <input
            className="input"
            type="number"
            min={0}
            max={20}
            step={1}
            placeholder="Any"
            value={stopsMax}
            onChange={(e) => onStopsMax(e.target.value)}
          />
        </label>
      </div>
    </div>
  )
}
