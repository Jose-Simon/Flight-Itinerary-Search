import { useMemo } from 'react'
import type { NormalizedItinerary } from '../lib/types'
import { currencySuffixSymbol, formatPriceAmount } from '../lib/formatPrice'

function collectPrices(itineraries: NormalizedItinerary[]): number[] {
  const out: number[] = []
  for (const it of itineraries) {
    const p = it.price
    if (p != null && Number.isFinite(p)) out.push(p)
  }
  return out
}

type Hist = {
  counts: number[]
  lo: number
  hi: number
  binWidth: number
  empty: boolean
}

const PLACEHOLDER_BINS = 8

/** ~uniform bins between data min and max (priced itineraries only). */
function buildPriceHistogram(values: number[], targetBars = 20): Hist {
  if (values.length === 0) {
    return { counts: new Array(PLACEHOLDER_BINS).fill(0), lo: 0, hi: 800, binWidth: 100, empty: true }
  }
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  let lo = minV
  let hi = maxV
  if (hi <= lo) {
    hi = lo + 1
  }
  const nBins = Math.min(40, Math.max(10, targetBars))
  const span = hi - lo
  const binWidth = span / nBins
  const counts = new Array(nBins).fill(0)
  for (const v of values) {
    let i = Math.floor((v - lo) / binWidth)
    if (i < 0) i = 0
    if (i >= nBins) i = nBins - 1
    counts[i]++
  }
  return { counts, lo, hi, binWidth, empty: false }
}

function parseNum(s: string): number | null {
  const t = s.trim().replace(/[$,\s]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function xAxisLabelStep(binCount: number): number {
  if (binCount <= 12) return 1
  if (binCount <= 24) return 2
  return Math.max(2, Math.ceil(binCount / 10))
}

function snapRangeBounds(lo: number, hi: number): { loI: number; hiI: number; step: number } {
  const loI = Math.floor(lo)
  const hiI = Math.ceil(hi)
  const span = Math.max(1, hiI - loI)
  const step = Math.max(1, Math.round(span / 150))
  return { loI, hiI, step }
}

type Props = {
  distributionSource: NormalizedItinerary[]
  minStr: string
  maxStr: string
  onMin: (v: string) => void
  onMax: (v: string) => void
  currencyCode: string
}

export function PriceHistogramFilter({ distributionSource, minStr, maxStr, onMin, onMax, currencyCode }: Props) {
  const values = useMemo(() => collectPrices(distributionSource), [distributionSource])
  const { counts, lo, hi, binWidth, empty } = useMemo(() => buildPriceHistogram(values), [values])

  const minN = parseNum(minStr)
  const maxN = parseNum(maxStr)
  const maxC = Math.max(1, ...counts)

  const { loI, hiI, step } = useMemo(() => snapRangeBounds(lo, hi), [lo, hi])
  const xStep = useMemo(() => xAxisLabelStep(counts.length), [counts.length])
  const sym = currencySuffixSymbol(currencyCode)

  const minSlider = Math.min(Math.max(minN ?? loI, loI), hiI)
  const maxSlider = Math.max(Math.min(maxN ?? hiI, hiI), loI)

  const fmt = (n: number) => formatPriceAmount(n, currencyCode)

  const rangeLabel =
    minN != null || maxN != null
      ? `filter ${fmt(minN ?? lo)}–${fmt(maxN ?? hi)}`
      : empty
        ? 'set range below (applies when results load)'
        : `pool ${fmt(lo)}–${fmt(hi)}`

  return (
    <div className="duration-hist-row hist--blue">
      <div className="duration-hist-head">
        <span className="duration-hist-title">Total price</span>
        <span className="duration-hist-range-label muted small">{empty ? 'no fares in pool' : rangeLabel}</span>
      </div>
      <div className="duration-hist-chart">
        <div
          className="duration-hist-bars"
          role="img"
          aria-label="Price distribution; each column is a fare band from the current result pool"
        >
          {counts.map((c, i) => {
            const binLo = lo + i * binWidth
            const binHi = lo + (i + 1) * binWidth
            const inRange = (minN == null || binHi > minN) && (maxN == null || binLo <= maxN)
            const h = Math.round((c / maxC) * 100)
            return (
              <div
                key={i}
                className={`duration-hist-bar ${inRange ? 'duration-hist-bar--in' : ''}`}
                style={{ flex: '1 1 0', height: `${Math.max(8, h)}%` }}
                title={`${fmt(binLo)} – ${fmt(binHi)} · ${c} itineraries`}
              />
            )
          })}
        </div>
        <div className="duration-hist-xaxis" aria-hidden>
          {counts.map((_, i) => {
            const at = lo + i * binWidth
            const showLabel = i % xStep === 0
            return (
              <div
                key={i}
                className={`duration-hist-xlabel${showLabel ? '' : ' duration-hist-xlabel--empty'}`}
                style={{ flex: '1 1 0' }}
                title={showLabel ? `${fmt(at)}+` : undefined}
              >
                {showLabel && !empty ? formatPriceAmount(Math.round(at), currencyCode) : null}
              </div>
            )
          })}
        </div>
      </div>
      <div className="duration-hist-sliders">
        <label className="duration-hist-slider-label muted tiny">Adjust range ({sym})</label>
        <div className="duration-hist-dual-range">
          <input
            type="range"
            className="duration-hist-range duration-hist-range--min"
            min={loI}
            max={hiI}
            step={step}
            value={minSlider}
            onChange={(e) => onMin(e.target.value)}
          />
          <input
            type="range"
            className="duration-hist-range duration-hist-range--max"
            min={loI}
            max={hiI}
            step={step}
            value={maxSlider}
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
            <span className="duration-hist-suffix">{sym}</span>
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
            <span className="duration-hist-suffix">{sym}</span>
          </div>
        </label>
      </div>
    </div>
  )
}
