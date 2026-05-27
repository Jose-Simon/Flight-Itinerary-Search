import { useMemo } from 'react'
import type { NormalizedItinerary } from '../lib/types'
import {
  canonicalTimeInputString,
  firstLegTakeoffMinutesLocal,
  formatClockMinutes,
  lastLegLandingMinutesLocal,
  parseTimeFilterMinutes,
} from '../lib/timeRangeFilter'

type Kind = 'takeoff' | 'landing'

function collectMinutes(itineraries: NormalizedItinerary[], tzByIata: Map<string, string>, kind: Kind): number[] {
  const out: number[] = []
  for (const it of itineraries) {
    const v =
      kind === 'takeoff' ? firstLegTakeoffMinutesLocal(it, tzByIata) : lastLegLandingMinutesLocal(it, tzByIata)
    if (v != null) out.push(v)
  }
  return out
}

function buildHourlyClockHistogram(values: number[]) {
  if (values.length === 0) {
    return { counts: new Array(24).fill(0), empty: true as const }
  }
  const counts = new Array(24).fill(0)
  for (const v of values) {
    counts[Math.min(23, Math.max(0, Math.floor(v / 60)))]++
  }
  return { counts, empty: false as const }
}

function TimeOfDayRangeRow({
  title,
  kind,
  colorClass,
  distributionSource,
  tzByIata,
  minStr,
  maxStr,
  onMin,
  onMax,
}: {
  title: string
  kind: Kind
  colorClass: string
  distributionSource: NormalizedItinerary[]
  tzByIata: Map<string, string>
  minStr: string
  maxStr: string
  onMin: (v: string) => void
  onMax: (v: string) => void
}) {
  const values = useMemo(
    () => collectMinutes(distributionSource, tzByIata, kind),
    [distributionSource, tzByIata, kind],
  )
  const { counts, empty } = useMemo(() => buildHourlyClockHistogram(values), [values])

  const poolMin = empty ? 0 : Math.min(...values)
  const poolMax = empty ? 1439 : Math.max(...values)

  const minN = parseTimeFilterMinutes(minStr)
  const maxN = parseTimeFilterMinutes(maxStr)

  const rangeLabel =
    minN != null || maxN != null
      ? `range ${formatClockMinutes(minN ?? poolMin)} — ${formatClockMinutes(maxN ?? poolMax)}`
      : empty
        ? 'no times in pool'
        : `pool ${formatClockMinutes(poolMin)} — ${formatClockMinutes(poolMax)}`

  const maxC = Math.max(1, ...counts)
  const xStep = 3

  const minSlider = Math.min(Math.max(minN ?? poolMin, 0), 1439)
  const maxSlider = Math.max(Math.min(maxN ?? poolMax, 1439), 0)

  return (
    <div className={`duration-hist-row ${colorClass}`}>
      <div className="duration-hist-head">
        <span className="duration-hist-title">{title}</span>
        <span className="duration-hist-range-label muted small">{rangeLabel}</span>
      </div>
      <div className="duration-hist-chart" style={{ minWidth: `${Math.max(200, counts.length * 10)}px` }}>
        <div
          className="duration-hist-bars"
          role="img"
          aria-label={`${title} distribution, one hour per column, local time`}
        >
          {counts.map((c, i) => {
            const binLo = i * 60
            const binHi = (i + 1) * 60
            const inRange = (minN == null || binHi > minN) && (maxN == null || binLo <= maxN)
            const h = Math.round((c / maxC) * 100)
            return (
              <div
                key={i}
                className={`duration-hist-bar ${inRange ? 'duration-hist-bar--in' : ''}`}
                style={{ flex: '1 1 0', height: `${Math.max(8, h)}%` }}
                title={`${formatClockMinutes(binLo)}–${formatClockMinutes(binHi - 1)} · ${c} itineraries`}
              />
            )
          })}
        </div>
        <div className="duration-hist-xaxis" aria-hidden>
          {counts.map((_, i) => {
            const showLabel = i % xStep === 0
            return (
              <div
                key={i}
                className={`duration-hist-xlabel${showLabel ? '' : ' duration-hist-xlabel--empty'}`}
                style={{ flex: '1 1 0' }}
                title={showLabel ? `${String(i).padStart(2, '0')}:00` : undefined}
              >
                {showLabel ? `${String(i).padStart(2, '0')}` : null}
              </div>
            )
          })}
        </div>
      </div>
      <div className="duration-hist-sliders">
        <label className="duration-hist-slider-label muted tiny">Adjust range (local time)</label>
        <div className="duration-hist-dual-range">
          <input
            type="range"
            className="duration-hist-range duration-hist-range--min"
            min={0}
            max={1439}
            step={15}
            value={minSlider}
            onChange={(e) => onMin(formatClockMinutes(Number(e.target.value)))}
            disabled={empty}
          />
          <input
            type="range"
            className="duration-hist-range duration-hist-range--max"
            min={0}
            max={1439}
            step={15}
            value={maxSlider}
            onChange={(e) => onMax(formatClockMinutes(Number(e.target.value)))}
            disabled={empty}
          />
        </div>
      </div>
      <div className="grid-2 tight-gap duration-hist-inputs">
        <label className="field-tight duration-hist-input-wrap">
          <span className="label">Min</span>
          <div className="duration-hist-input-inner">
            <input
              className="input duration-hist-input duration-hist-input--no-suffix"
              placeholder="HH:MM"
              value={minStr}
              onChange={(e) => onMin(e.target.value)}
              onBlur={() => onMin(canonicalTimeInputString(minStr))}
              disabled={empty}
              aria-label={`${title} minimum, HH:MM`}
            />
          </div>
        </label>
        <label className="field-tight duration-hist-input-wrap">
          <span className="label">Max</span>
          <div className="duration-hist-input-inner">
            <input
              className="input duration-hist-input duration-hist-input--no-suffix"
              placeholder="HH:MM"
              value={maxStr}
              onChange={(e) => onMax(e.target.value)}
              onBlur={() => onMax(canonicalTimeInputString(maxStr))}
              disabled={empty}
              aria-label={`${title} maximum, HH:MM`}
            />
          </div>
        </label>
      </div>
    </div>
  )
}

type Props = {
  distributionSource: NormalizedItinerary[]
  tzByIata: Map<string, string>
  takeoffMin: string
  takeoffMax: string
  landingMin: string
  landingMax: string
  onTakeoffMin: (v: string) => void
  onTakeoffMax: (v: string) => void
  onLandingMin: (v: string) => void
  onLandingMax: (v: string) => void
}

export function TakeoffLandingHistogramFilters({
  distributionSource,
  tzByIata,
  takeoffMin,
  takeoffMax,
  landingMin,
  landingMax,
  onTakeoffMin,
  onTakeoffMax,
  onLandingMin,
  onLandingMax,
}: Props) {
  return (
    <div className="takeoff-landing-hist-wrap">
      <p className="muted tiny takeoff-landing-hist-hint">
        Takeoff is the first departure; landing is the final arrival. Times use each airport’s local clock.
      </p>
      <TimeOfDayRangeRow
        title="Takeoff time"
        kind="takeoff"
        colorClass="hist--blue"
        distributionSource={distributionSource}
        tzByIata={tzByIata}
        minStr={takeoffMin}
        maxStr={takeoffMax}
        onMin={onTakeoffMin}
        onMax={onTakeoffMax}
      />
      <TimeOfDayRangeRow
        title="Landing time"
        kind="landing"
        colorClass="hist--violet"
        distributionSource={distributionSource}
        tzByIata={tzByIata}
        minStr={landingMin}
        maxStr={landingMax}
        onMin={onLandingMin}
        onMax={onLandingMax}
      />
    </div>
  )
}
