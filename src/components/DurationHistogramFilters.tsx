import { useMemo, type ReactNode } from 'react'
import type { NormalizedItinerary } from '../lib/types'
import type { HourFieldStrings, LegDurationMatchMode } from '../lib/filters'
import { totalFlightMinutes, totalLayoverMinutes } from '../lib/filters'

type Variant = 'trip' | 'flight' | 'leg' | 'layover'

function collectHours(itineraries: NormalizedItinerary[], variant: Variant): number[] {
  const out: number[] = []
  for (const it of itineraries) {
    if (variant === 'trip') {
      out.push(it.totalDurationMinutes / 60)
    } else if (variant === 'flight') {
      out.push(totalFlightMinutes(it) / 60)
    } else if (variant === 'leg') {
      for (const s of it.segments) out.push(s.durationMinutes / 60)
    } else {
      out.push(totalLayoverMinutes(it) / 60)
    }
  }
  return out
}

/**
 * One-hour bins [k, k+1) so the x-axis reads 16–17h, 17–18h, …
 * `lo` = first bin start, `hi` = end of last bin (integer, exclusive upper).
 */
function buildHourlyHistogram(values: number[], variant: Variant) {
  if (values.length === 0) {
    const defaultSpan = variant === 'layover' ? 12 : 8
    return { counts: new Array(defaultSpan).fill(0), lo: 0, hi: defaultSpan, empty: true as const }
  }
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  let lo = Math.floor(minV)
  let hi = Math.ceil(maxV)
  if (lo >= hi) hi = lo + 1
  lo = Math.max(0, lo)
  if (hi <= lo) hi = lo + 1
  const counts = new Array(hi - lo).fill(0)
  for (const v of values) {
    let k = Math.floor(v)
    if (k < lo) k = lo
    if (k > hi - 1) k = hi - 1
    const i = k - lo
    counts[i]++
  }
  return { counts, lo, hi, empty: false as const }
}

function parseNum(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** One label per bar when few bins; wider steps when many, to keep the x-axis readable. */
function xAxisHourStep(binCount: number): number {
  if (binCount <= 18) return 1
  if (binCount <= 36) return 2
  return Math.max(2, Math.ceil(binCount / 12))
}

function DurationRow({
  title,
  variant,
  color,
  distributionSource,
  minStr,
  maxStr,
  onMin,
  onMax,
  legMatch,
  onLegMatch,
  legMatchRadioName,
}: {
  title: string
  variant: Variant
  color: 'blue' | 'violet' | 'green' | 'orange'
  distributionSource: NormalizedItinerary[]
  minStr: string
  maxStr: string
  onMin: (v: string) => void
  onMax: (v: string) => void
  legMatch?: LegDurationMatchMode
  onLegMatch?: (m: LegDurationMatchMode) => void
  legMatchRadioName?: string
}) {
  const values = useMemo(() => collectHours(distributionSource, variant), [distributionSource, variant])
  const { counts, lo, hi } = useMemo(() => buildHourlyHistogram(values, variant), [values, variant])

  const minN = parseNum(minStr)
  const maxN = parseNum(maxStr)
  const maxC = Math.max(1, ...counts)

  const colorClass =
    color === 'blue'
      ? 'hist--blue'
      : color === 'violet'
        ? 'hist--violet'
        : color === 'green'
          ? 'hist--green'
          : 'hist--orange'

  const xStep = useMemo(() => xAxisHourStep(counts.length), [counts.length])

  const rangeLabel =
    minN != null || maxN != null
      ? `range ${(minN ?? lo).toFixed(0)}–${(maxN ?? hi).toFixed(0)}h`
      : `pool ${lo}–${hi}h`

  return (
    <div className={`duration-hist-row ${colorClass}`}>
      <div className="duration-hist-head">
        <span className="duration-hist-title">{title}</span>
        <span className="duration-hist-range-label muted small">{rangeLabel}</span>
      </div>
      <div className="duration-hist-chart" style={{ minWidth: `${Math.max(200, counts.length * 8)}px` }}>
        <div className="duration-hist-bars" role="img" aria-label={`${title} distribution, one hour per column`}>
          {counts.map((c, i) => {
            const binLo = lo + i
            const binHi = lo + i + 1
            /* Hour bins [binLo, binHi); match filter [minN, maxN] when set. */
            const inRange =
              (minN == null || binHi > minN) && (maxN == null || binLo <= maxN)
            const h = Math.round((c / maxC) * 100)
            return (
              <div
                key={i}
                className={`duration-hist-bar ${inRange ? 'duration-hist-bar--in' : ''}`}
                style={{ flex: '1 1 0', height: `${Math.max(8, h)}%` }}
                title={`${binLo}–${binHi}h · ${c} itineraries`}
              />
            )
          })}
        </div>
        <div className="duration-hist-xaxis" aria-hidden>
          {counts.map((_, i) => {
            const hour = lo + i
            const showLabel = i % xStep === 0
            return (
              <div
                key={i}
                className={`duration-hist-xlabel${showLabel ? '' : ' duration-hist-xlabel--empty'}`}
                style={{ flex: '1 1 0' }}
                title={showLabel ? `${hour}–${hour + 1} h` : undefined}
              >
                {showLabel ? hour : null}
              </div>
            )
          })}
        </div>
      </div>
      <div className="duration-hist-sliders">
        <label className="duration-hist-slider-label muted tiny">Adjust range (hours)</label>
        <div className="duration-hist-dual-range">
          <input
            type="range"
            className="duration-hist-range duration-hist-range--min"
            min={lo}
            max={hi}
            step={0.5}
            value={Math.min(Math.max(minN ?? lo, lo), hi)}
            onChange={(e) => onMin(e.target.value)}
          />
          <input
            type="range"
            className="duration-hist-range duration-hist-range--max"
            min={lo}
            max={hi}
            step={0.5}
            value={Math.max(Math.min(maxN ?? hi, hi), lo)}
            onChange={(e) => onMax(e.target.value)}
          />
        </div>
      </div>
      <div className="grid-2 tight-gap duration-hist-inputs">
        <label className="field-tight duration-hist-input-wrap">
          <span className="label">Min</span>
          <div className="duration-hist-input-inner">
            <input
              className="input duration-hist-input"
              inputMode="decimal"
              placeholder="Any"
              value={minStr}
              onChange={(e) => onMin(e.target.value)}
            />
            <span className="duration-hist-suffix">h</span>
          </div>
        </label>
        <label className="field-tight duration-hist-input-wrap">
          <span className="label">Max</span>
          <div className="duration-hist-input-inner">
            <input
              className="input duration-hist-input"
              inputMode="decimal"
              placeholder="Any"
              value={maxStr}
              onChange={(e) => onMax(e.target.value)}
            />
            <span className="duration-hist-suffix">h</span>
          </div>
        </label>
      </div>
      {variant === 'leg' && legMatch != null && onLegMatch != null && legMatchRadioName != null ? (
        <div className="duration-hist-leg-match" role="group" aria-label="How leg min and max apply">
          <span className="duration-hist-leg-match-label muted tiny">Apply leg min/max to</span>
          <div className="duration-hist-leg-match-options">
            <label className="check check-inline">
              <input
                type="radio"
                name={legMatchRadioName}
                checked={legMatch === 'all'}
                onChange={() => onLegMatch('all')}
              />
              Every leg
            </label>
            <label className="check check-inline">
              <input
                type="radio"
                name={legMatchRadioName}
                checked={legMatch === 'any'}
                onChange={() => onLegMatch('any')}
              />
              At least one leg
            </label>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type Props = {
  distributionSource: NormalizedItinerary[]
  hours: HourFieldStrings
  onHour: (key: keyof HourFieldStrings, value: string) => void
  legDurationMatch: LegDurationMatchMode
  onLegDurationMatch: (m: LegDurationMatchMode) => void
  /** Distinct `name` for radio inputs (outbound vs return panels). */
  legMatchRadioGroup: string
  /** When true, omit the outer `.duration-hist-block` wrapper (parent supplies it). */
  noOuterBlock?: boolean
  /** Rendered after “Total flight duration” and before “Leg duration” (e.g. chip row for match mode). */
  legMatchExtra?: ReactNode
  /** When true, leg row does not show inline radios (use `legMatchExtra` instead). */
  hideLegMatchRadios?: boolean
}

export function DurationHistogramFilters({
  distributionSource,
  hours,
  onHour,
  legDurationMatch,
  onLegDurationMatch,
  legMatchRadioGroup,
  noOuterBlock = false,
  legMatchExtra,
  hideLegMatchRadios = false,
}: Props) {
  const legMatchProps =
    hideLegMatchRadios
      ? {}
      : {
          legMatch: legDurationMatch,
          onLegMatch: onLegDurationMatch,
          legMatchRadioName: legMatchRadioGroup,
        }
  const inner = (
    <>
      <DurationRow
        title="Total trip duration"
        variant="trip"
        color="blue"
        distributionSource={distributionSource}
        minStr={hours.minTotal}
        maxStr={hours.maxTotal}
        onMin={(v) => onHour('minTotal', v)}
        onMax={(v) => onHour('maxTotal', v)}
      />
      <DurationRow
        title="Total flight duration"
        variant="flight"
        color="violet"
        distributionSource={distributionSource}
        minStr={hours.minFlight}
        maxStr={hours.maxFlight}
        onMin={(v) => onHour('minFlight', v)}
        onMax={(v) => onHour('maxFlight', v)}
      />
      {legMatchExtra}
      <DurationRow
        title="Leg duration (per segment)"
        variant="leg"
        color="green"
        distributionSource={distributionSource}
        minStr={hours.minLeg}
        maxStr={hours.maxLeg}
        onMin={(v) => onHour('minLeg', v)}
        onMax={(v) => onHour('maxLeg', v)}
        {...legMatchProps}
      />
      <DurationRow
        title="Layover duration"
        variant="layover"
        color="orange"
        distributionSource={distributionSource}
        minStr={hours.minLayover}
        maxStr={hours.maxLayover}
        onMin={(v) => onHour('minLayover', v)}
        onMax={(v) => onHour('maxLayover', v)}
      />
    </>
  )
  return noOuterBlock ? inner : <div className="duration-hist-block">{inner}</div>
}
