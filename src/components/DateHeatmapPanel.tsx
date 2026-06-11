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
import {
  importVerificationsFromJson,
  legKeyDepTime,
  legKeyFromParts,
  describeVerificationLegs,
  flightNumbersKey,
  legKeyFlights,
  legKeySearchToken,
  legVerificationKey,
  lookupVerificationRow,
  stripLegMeta,
  vKey,
  vKeyFromPair,
  verificationSerpDelta,
} from '../db/priceVerificationRepo'
import type { AirlinesMeta } from '../lib/airlineMetaLookup'
import { buildHeatmapCells } from '../lib/heatmapCellMeta'
import { tokenRoutePriceFromIndex, type RtTokenPriceIndex } from '../lib/rtTokenRoutePrice'
import {
  HEATMAP_QUALITY_DEFS,
  resolvePairCellQuality,
  type HeatmapCellQuality,
} from '../lib/heatmapCellQuality'
import { HeatmapQualityBadge, heatmapQualityCellClass } from './HeatmapQualityFilter'
import {
  cacheCombinedPrice,
  effectiveCombinedPrice,
  isOutboundDateInBounds,
  type PriceOverrideMap,
  type PriceWindowDateBounds,
} from '../lib/priceOverrides'
import {
  expansionBadgeLabel,
  roundTripPairCellKey,
  type RoundTripPairDeepenState,
  type RoundTripPairMeta,
} from '../lib/roundTripPairMeta'
import type { RoundTripCombo } from '../lib/roundTripTypes'
import { RouteLabelCell } from './RouteLabelCell'

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
function pctAboveBaseline(price: number, baseline: number): number {
  if (baseline <= 0) return Infinity
  return ((price - baseline) / baseline) * 100
}

type HeatmapHighlightFlags = {
  show2pctLocal: boolean
  show5pctLocal: boolean
  show2pctGlobal: boolean
  show5pctGlobal: boolean
  show10pctGlobal: boolean
  show15pctGlobal: boolean
  show20pctGlobal: boolean
}

const HEATMAP_PCT_THRESHOLDS: {
  pct: number
  tierClass: string
  flag: keyof HeatmapHighlightFlags
  scope: 'local' | 'global'
}[] = [
  { pct: 2, tierClass: 'pw-heatmap-cell--tier1', flag: 'show2pctLocal', scope: 'local' },
  { pct: 5, tierClass: 'pw-heatmap-cell--tier2', flag: 'show5pctLocal', scope: 'local' },
  { pct: 2, tierClass: 'pw-heatmap-cell--tier1', flag: 'show2pctGlobal', scope: 'global' },
  { pct: 5, tierClass: 'pw-heatmap-cell--tier2', flag: 'show5pctGlobal', scope: 'global' },
  { pct: 10, tierClass: 'pw-heatmap-cell--tier3', flag: 'show10pctGlobal', scope: 'global' },
  { pct: 15, tierClass: 'pw-heatmap-cell--tier4', flag: 'show15pctGlobal', scope: 'global' },
  { pct: 20, tierClass: 'pw-heatmap-cell--tier5', flag: 'show20pctGlobal', scope: 'global' },
]

function cellTierClass(
  price: number,
  localBaseline: number,
  globalBaseline: number,
  flags: HeatmapHighlightFlags,
): string {
  const active = HEATMAP_PCT_THRESHOLDS.filter(t => flags[t.flag])
  if (active.length === 0) return ''

  const pctLocal = pctAboveBaseline(price, localBaseline)
  const pctGlobal = pctAboveBaseline(price, globalBaseline)

  let bestTier: string | null = null
  let bestPct = Infinity
  for (const t of active) {
    const pct = t.scope === 'local' ? pctLocal : pctGlobal
    if (pct <= t.pct && t.pct < bestPct) {
      bestPct = t.pct
      bestTier = t.tierClass
    }
  }
  return bestTier ?? 'pw-heatmap-cell--muted'
}

function cellHighlightClass(
  price: number,
  localBaseline: number,
  globalBaseline: number,
  flags: HeatmapHighlightFlags,
  showVerified: boolean,
  isVerified: boolean,
): string {
  if (showVerified) {
    return isVerified ? 'pw-heatmap-cell--verified' : 'pw-heatmap-cell--muted'
  }
  return cellTierClass(price, localBaseline, globalBaseline, flags)
}

/** All verification rows for a calendar cell (route + out/ret dates). */
function verifiedRowsForCell(
  verifications: PriceOverrideMap,
  routeKey: string,
  outDate: string,
  retDate: string,
): PriceVerificationRow[] {
  const rows: PriceVerificationRow[] = []
  for (const row of verifications.values()) {
    if (row.routeKey === routeKey && row.outDate === outDate && row.retDate === retDate) {
      rows.push(row)
    }
  }
  return rows
}

function minVerifiedFromRows(rows: PriceVerificationRow[]): number | null {
  let min: number | null = null
  for (const row of rows) {
    if (row.verifiedPrice > 0) {
      min = min == null ? row.verifiedPrice : Math.min(min, row.verifiedPrice)
    }
  }
  return min
}

function comboSearchHaystack(combo: Combo): string {
  const out = itinSummary(combo.outIt)
  const ret = itinSummary(combo.retIt)
  const depOut = combo.outIt.segments[0]?.depTime?.slice(11) ?? ''
  const depRet = combo.retIt.segments[0]?.depTime?.slice(11) ?? ''
  return [out.flights, ret.flights, out.layovers, ret.layovers, depOut, depRet, out.duration, ret.duration]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function comboMatchesFilter(combo: Combo, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, '')
  if (!q) return true
  const hay = comboSearchHaystack(combo).replace(/\s+/g, '')
  return hay.includes(q)
}

type VerificationComboMatch = {
  row: PriceVerificationRow
  combo: Combo | null
  score: number
  exact: boolean
}

/** Score how well a cache combo matches a stored verification row (for highlighting). */
function scoreComboForVerification(combo: Combo, row: PriceVerificationRow): number {
  let score = 0
  const rowOutFl = legKeyFlights(stripLegMeta(row.outDepTime)).toUpperCase()
  const rowRetFl = legKeyFlights(stripLegMeta(row.retDepTime)).toUpperCase()
  const comboOutFl = flightNumbersKey(combo.outIt)
  const comboRetFl = flightNumbersKey(combo.retIt)

  if (rowOutFl && comboOutFl) {
    if (rowOutFl === comboOutFl) score += 45
    else if (rowOutFl.split('+').every(f => comboOutFl.includes(f))) score += 28
  }
  if (rowRetFl && comboRetFl) {
    if (rowRetFl === comboRetFl) score += 45
    else if (rowRetFl.split('+').every(f => comboRetFl.includes(f))) score += 28
  }

  const rowOutDep = legKeyDepTime(stripLegMeta(row.outDepTime))
  const comboOutDep = combo.outIt.segments[0]?.depTime?.trim().slice(0, 16) ?? ''
  if (rowOutDep && comboOutDep && rowOutDep === comboOutDep) score += 20

  const rowRetDep = legKeyDepTime(stripLegMeta(row.retDepTime))
  const comboRetDep = combo.retIt.segments[0]?.depTime?.trim().slice(0, 16) ?? ''
  if (rowRetDep && comboRetDep && rowRetDep === comboRetDep) score += 20

  if (row.cachedPrice != null && row.cachedPrice > 0) {
    const diff = Math.abs(combo.cacheTotal - row.cachedPrice)
    score += Math.max(0, 25 - Math.round(diff / 40))
  }

  return score
}

function bestComboForVerification(
  row: PriceVerificationRow,
  combos: Combo[],
  routeKey: string,
  verifications: PriceOverrideMap,
): VerificationComboMatch {
  const exact = combos.find(c => {
    const hit = lookupVerificationRow(verifications, routeKey, c.outIt, c.retIt)
    return hit != null
      && hit.outDepTime === row.outDepTime
      && hit.retDepTime === row.retDepTime
  })
  if (exact) {
    return { row, combo: exact, score: 200, exact: true }
  }

  let best: { combo: Combo; score: number } | null = null
  for (const combo of combos) {
    const s = scoreComboForVerification(combo, row)
    if (!best || s > best.score) best = { combo, score: s }
  }
  const threshold = 35
  if (best && best.score >= threshold) {
    return { row, combo: best.combo, score: best.score, exact: false }
  }
  return { row, combo: null, score: best?.score ?? 0, exact: false }
}

const AUTO_RELINK_MIN_SCORE = 35

function parsePriceInput(s: string): number | null {
  const n = Number(s.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function countWithinPctOfBaseline(prices: number[], baseline: number, pct: number): number {
  if (baseline <= 0) return 0
  return prices.filter(p => ((p - baseline) / baseline) * 100 <= pct).length
}

function priceMedian(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

function formatRouteLabel(routeKey: string): string {
  const [waypoint, carriers = ''] = routeKey.split('|')
  const path = waypoint.replace(/-/g, ' › ')
  return carriers ? `${path} — ${carriers}` : path
}

type LayoverDurationBucket = 'short' | 'medium' | 'long'

const LAYOVER_BUCKET_LABELS: Record<LayoverDurationBucket, string> = {
  short: '< 6 hrs',
  medium: '6–18 hrs',
  long: '18 hrs+',
}

function maxNonTechnicalLayoverMinutes(it: NormalizedItinerary): number | null {
  const lays = it.layovers.filter(l => !l.isTechnical)
  if (lays.length === 0) return null
  return Math.max(...lays.map(l => l.durationMinutes))
}

function layoverDurationBucket(minutes: number): LayoverDurationBucket {
  const hours = minutes / 60
  if (hours < 6) return 'short'
  if (hours < 18) return 'medium'
  return 'long'
}

type RouteHeatmapStats = {
  label: string
  minPrice: number | null
  medianPrice: number | null
  totalCombos: number
  within2pctLocal: number
  within5pctLocal: number
  within2pctGlobal: number
  within5pctGlobal: number
  within10pctGlobal: number
  within15pctGlobal: number
  within20pctGlobal: number
  outboundLayover: Record<LayoverDurationBucket, number>
  returnLayover: Record<LayoverDurationBucket, number>
}

function emptyLayoverCounts(): Record<LayoverDurationBucket, number> {
  return { short: 0, medium: 0, long: 0 }
}

function computeRouteHeatmapStats(
  rk: string,
  outResult: PriceWindowResult,
  retResult: PriceWindowResult,
  verifications: PriceOverrideMap,
  roundTripCombos?: RoundTripCombo[] | null,
  localBaseline?: number | null,
  globalBaseline?: number | null,
): RouteHeatmapStats {
  const label = formatRouteLabel(rk)
  const empty: RouteHeatmapStats = {
    label,
    minPrice: null,
    medianPrice: null,
    totalCombos: 0,
    within2pctLocal: 0,
    within5pctLocal: 0,
    within2pctGlobal: 0,
    within5pctGlobal: 0,
    within10pctGlobal: 0,
    within15pctGlobal: 0,
    within20pctGlobal: 0,
    outboundLayover: emptyLayoverCounts(),
    returnLayover: emptyLayoverCounts(),
  }

  const prices: number[] = []
  const outboundLayover = emptyLayoverCounts()
  const returnLayover = emptyLayoverCounts()

  const combosForRoute = roundTripCombos?.filter((c) => c.routeKey === rk) ?? []
  if (combosForRoute.length > 0) {
    for (const c of combosForRoute) {
      const combined = effectiveCombinedPrice(c.outIt, c.retIt, verifications, rk, c.roundTripPrice)
      if (!Number.isFinite(combined) || combined <= 0) continue
      prices.push(combined)
      const outLay = maxNonTechnicalLayoverMinutes(c.outIt)
      if (outLay != null) outboundLayover[layoverDurationBucket(outLay)]++
      const retLay = maxNonTechnicalLayoverMinutes(c.retIt)
      if (retLay != null) returnLayover[layoverDurationBucket(retLay)]++
    }
  } else {
    const retRk = reverseRouteKey(rk)
    const outDateMap = outResult.perRouteByDate.get(rk)
    const retDateMap = retResult.perRouteByDate.get(retRk)
    if (!outDateMap || !retDateMap) return empty

    for (const retDate of retResult.dates) {
      const rb = retDateMap.get(retDate)
      if (!rb) continue
      for (const outDate of outResult.dates) {
        if (retDate <= outDate) continue
        const ob = outDateMap.get(outDate)
        if (!ob) continue
        for (const outIt of ob.allItineraries) {
          for (const retIt of rb.allItineraries) {
            const combined = effectiveCombinedPrice(outIt, retIt, verifications, rk)
            if (!Number.isFinite(combined) || combined <= 0) continue
            prices.push(combined)
            const outLay = maxNonTechnicalLayoverMinutes(outIt)
            if (outLay != null) outboundLayover[layoverDurationBucket(outLay)]++
            const retLay = maxNonTechnicalLayoverMinutes(retIt)
            if (retLay != null) returnLayover[layoverDurationBucket(retLay)]++
          }
        }
      }
    }
  }

  if (prices.length === 0) return empty

  const sorted = [...prices].sort((a, b) => a - b)
  const minPrice = sorted[0] ?? null
  const medianPrice = priceMedian(sorted)
  const local = localBaseline ?? minPrice
  const global = globalBaseline ?? minPrice
  const within2pctLocal = local != null ? countWithinPctOfBaseline(prices, local, 2) : 0
  const within5pctLocal = local != null ? countWithinPctOfBaseline(prices, local, 5) : 0
  const within2pctGlobal = global != null ? countWithinPctOfBaseline(prices, global, 2) : 0
  const within5pctGlobal = global != null ? countWithinPctOfBaseline(prices, global, 5) : 0
  const within10pctGlobal = global != null ? countWithinPctOfBaseline(prices, global, 10) : 0
  const within15pctGlobal = global != null ? countWithinPctOfBaseline(prices, global, 15) : 0
  const within20pctGlobal = global != null ? countWithinPctOfBaseline(prices, global, 20) : 0

  return {
    label,
    minPrice,
    medianPrice,
    totalCombos: prices.length,
    within2pctLocal,
    within5pctLocal,
    within2pctGlobal,
    within5pctGlobal,
    within10pctGlobal,
    within15pctGlobal,
    within20pctGlobal,
    outboundLayover,
    returnLayover,
  }
}

function maxPriceWithinPctOfLowest(lowest: number, pct: number): number {
  return Math.round(lowest * (1 + pct / 100))
}

const HEATMAP_GLOBAL_LOWEST_KEY = 'flight-itinerary-discovery-heatmap-global-lowest-v1'

function loadPersistedGlobalLowest(): number | null {
  try {
    const raw = localStorage.getItem(HEATMAP_GLOBAL_LOWEST_KEY)
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null
  } catch {
    return null
  }
}

function HeatmapHighlightPanel({
  stats,
  currency,
  localLowest,
  globalLowest,
  allRoutesAutoLowest,
  savedGlobalLowest,
  onGlobalLowestChange,
  onGlobalLowestReset,
  show2pctLocal,
  setShow2pctLocal,
  show5pctLocal,
  setShow5pctLocal,
  show2pctGlobal,
  setShow2pctGlobal,
  show5pctGlobal,
  setShow5pctGlobal,
  show10pctGlobal,
  setShow10pctGlobal,
  show15pctGlobal,
  setShow15pctGlobal,
  show20pctGlobal,
  setShow20pctGlobal,
  showVerified,
  setShowVerified,
  verifiedCellCount,
  verifiedCellsList,
  onFocusVerifiedCell,
  gridLowestNote,
  importOpen,
  onToggleImport,
}: {
  stats: RouteHeatmapStats
  currency: string
  localLowest: number
  /** Effective baseline used for ≤% bands (saved override or refreshed min). */
  globalLowest: number
  /** Lowest combo from current cache across all routes. */
  allRoutesAutoLowest: number
  /** User-saved override, persisted in localStorage. */
  savedGlobalLowest: number | null
  onGlobalLowestChange: (n: number) => void
  onGlobalLowestReset: () => void
  show2pctLocal: boolean
  setShow2pctLocal: (v: boolean) => void
  show5pctLocal: boolean
  setShow5pctLocal: (v: boolean) => void
  show2pctGlobal: boolean
  setShow2pctGlobal: (v: boolean) => void
  show5pctGlobal: boolean
  setShow5pctGlobal: (v: boolean) => void
  show10pctGlobal: boolean
  setShow10pctGlobal: (v: boolean) => void
  show15pctGlobal: boolean
  setShow15pctGlobal: (v: boolean) => void
  show20pctGlobal: boolean
  setShow20pctGlobal: (v: boolean) => void
  showVerified: boolean
  setShowVerified: (v: boolean) => void
  verifiedCellCount: number
  verifiedCellsList: Array<{
    outDate: string
    retDate: string
    price: number
    linkedToCache: boolean
  }>
  onFocusVerifiedCell: (outDate: string, retDate: string) => void
  gridLowestNote: string | null
  importOpen: boolean
  onToggleImport: () => void
}) {
  const lowestCombo = stats.minPrice != null ? formatPriceAmount(stats.minPrice, currency) : '—'
  const med = stats.medianPrice != null ? formatPriceAmount(stats.medianPrice, currency) : '—'
  const itins = stats.totalCombos.toLocaleString()
  const local2Max = localLowest > 0 ? formatPriceAmount(maxPriceWithinPctOfLowest(localLowest, 2), currency) : '—'
  const local5Max = localLowest > 0 ? formatPriceAmount(maxPriceWithinPctOfLowest(localLowest, 5), currency) : '—'
  const globalBaseline = globalLowest > 0 ? globalLowest : 0
  const global2Max = globalBaseline > 0 ? formatPriceAmount(maxPriceWithinPctOfLowest(globalBaseline, 2), currency) : '—'
  const global5Max = globalBaseline > 0 ? formatPriceAmount(maxPriceWithinPctOfLowest(globalBaseline, 5), currency) : '—'
  const global10Max = globalBaseline > 0 ? formatPriceAmount(maxPriceWithinPctOfLowest(globalBaseline, 10), currency) : '—'
  const global15Max = globalBaseline > 0 ? formatPriceAmount(maxPriceWithinPctOfLowest(globalBaseline, 15), currency) : '—'
  const global20Max = globalBaseline > 0 ? formatPriceAmount(maxPriceWithinPctOfLowest(globalBaseline, 20), currency) : '—'
  const displayGlobalLowest = savedGlobalLowest ?? (allRoutesAutoLowest > 0 ? allRoutesAutoLowest : 0)
  const showRefreshedGlobal =
    savedGlobalLowest != null &&
    allRoutesAutoLowest > 0 &&
    Math.round(savedGlobalLowest) !== Math.round(allRoutesAutoLowest)

  return (
    <div className="pw-heatmap-highlight-panel">
      <span className="pw-heatmap-panel-title">Highlight</span>
      <div className="pw-heatmap-summary-row">
        <div className="pw-heatmap-summary-stats">
          <div className="pw-heatmap-summary-item">
            <span className="pw-heatmap-summary-label" title="Cheapest round-trip itinerary combo on this route">Lowest combo</span>
            <span className="pw-heatmap-summary-value">{lowestCombo}</span>
          </div>
          <div className="pw-heatmap-summary-item">
            <span className="pw-heatmap-summary-label">Median</span>
            <span className="pw-heatmap-summary-value">{med}</span>
          </div>
          <div className="pw-heatmap-summary-item">
            <span className="pw-heatmap-summary-label">Itineraries</span>
            <span className="pw-heatmap-summary-value">{itins}</span>
          </div>
        </div>
        <div className="pw-heatmap-summary-actions">
          <label className="check pw-heatmap-highlight-check pw-heatmap-highlight-check--verified">
            <input type="checkbox" checked={showVerified} onChange={e => setShowVerified(e.target.checked)} />
            <span className="pw-heatmap-check-verified">
              Verified prices
              <span className="pw-heatmap-check-count">
                {' '}· {verifiedCellCount} {verifiedCellCount === 1 ? 'cell' : 'cells'}
              </span>
            </span>
          </label>
          <button type="button" className="btn btn-ghost btn-small pw-heatmap-import-btn" onClick={onToggleImport}>
            {importOpen ? 'Cancel import' : 'Import verified prices'}
          </button>
        </div>
      </div>
      {showVerified && verifiedCellsList.length > 0 && (
        <ul className="pw-heatmap-verified-cells-list">
          {verifiedCellsList.map(c => (
            <li key={`${c.outDate}|${c.retDate}`}>
              <button
                type="button"
                className="pw-heatmap-verified-cells-btn"
                onClick={() => onFocusVerifiedCell(c.outDate, c.retDate)}
                title={c.linkedToCache
                  ? 'Jump to cell — linked to a cached itinerary combo'
                  : 'Jump to cell — saved verification (leg key may not match current cache; re-save from popover to link)'}
              >
                <span className="pw-heatmap-verified-cells-dates">
                  Out {shortDate(c.outDate)} · Ret {shortDate(c.retDate)}
                </span>
                <span className="pw-heatmap-verified-cells-price">
                  {formatPriceAmount(c.price, currency)}
                </span>
                {!c.linkedToCache && (
                  <span className="pw-heatmap-verified-cells-warn" aria-label="Not linked to cache">⚠</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="pw-heatmap-highlight-grid">
        <div className="pw-heatmap-highlight-col">
          <span className="pw-heatmap-highlight-subhead">Local (this route)</span>
          <p className="pw-heatmap-baseline-hint muted small">Same as lowest combo — used for ≤% thresholds on this route.</p>
          <div className="pw-heatmap-lowest-row">
            <span className="pw-heatmap-lowest-label">Lowest combo</span>
            <span className="pw-heatmap-lowest-value">
              {localLowest > 0 ? formatPriceAmount(localLowest, currency) : '—'}
            </span>
          </div>
          {gridLowestNote && <p className="pw-heatmap-baseline-hint pw-heatmap-baseline-hint--warn muted small">{gridLowestNote}</p>}
          <label className="check pw-heatmap-highlight-check">
            <input type="checkbox" checked={show2pctLocal} onChange={e => setShow2pctLocal(e.target.checked)} />
            <span>
              ≤2% of local lowest ({local2Max})
              <span className="pw-heatmap-check-count"> · {stats.within2pctLocal} itineraries</span>
            </span>
          </label>
          <label className="check pw-heatmap-highlight-check">
            <input type="checkbox" checked={show5pctLocal} onChange={e => setShow5pctLocal(e.target.checked)} />
            <span>
              ≤5% of local lowest ({local5Max})
              <span className="pw-heatmap-check-count"> · {stats.within5pctLocal} itineraries</span>
            </span>
          </label>
        </div>
        <div className="pw-heatmap-highlight-col">
          <span className="pw-heatmap-highlight-subhead">Global (all routes)</span>
          <p className="pw-heatmap-baseline-hint muted small">Cheapest combo on any route — adjust if an outlier skews bands.</p>
          <div className="pw-heatmap-lowest-row">
            <span className="pw-heatmap-lowest-label">Lowest combo</span>
            <span className="pw-heatmap-lowest-value">
              {displayGlobalLowest > 0 ? formatPriceAmount(displayGlobalLowest, currency) : '—'}
            </span>
          </div>
          {showRefreshedGlobal && (
            <p className="pw-heatmap-baseline-hint muted small">
              Refreshed lowest: {formatPriceAmount(allRoutesAutoLowest, currency)}
            </p>
          )}
          {!savedGlobalLowest && allRoutesAutoLowest > 0 && (
            <p className="pw-heatmap-baseline-hint muted small">
              From current cache — edit below to override and keep across refreshes.
            </p>
          )}
          <div className="pw-heatmap-lowest-adjust">
            <input
              type="text"
              className="input pw-heatmap-lowest-input"
              inputMode="numeric"
              aria-label="Adjust global lowest price"
              placeholder={allRoutesAutoLowest > 0 ? formatPriceAmount(allRoutesAutoLowest, currency) : 'Adjust…'}
              value={savedGlobalLowest != null ? String(savedGlobalLowest) : ''}
              onChange={(e) => {
                const n = parsePriceInput(e.target.value)
                if (n != null) onGlobalLowestChange(n)
              }}
            />
            {savedGlobalLowest != null && (
              <button type="button" className="btn btn-ghost btn-tiny" onClick={onGlobalLowestReset}>
                Reset
              </button>
            )}
          </div>
          <label className="check pw-heatmap-highlight-check">
            <input type="checkbox" checked={show2pctGlobal} onChange={e => setShow2pctGlobal(e.target.checked)} />
            <span>
              ≤2% of global lowest ({global2Max})
              <span className="pw-heatmap-check-count"> · {stats.within2pctGlobal} itineraries</span>
            </span>
          </label>
          <label className="check pw-heatmap-highlight-check">
            <input type="checkbox" checked={show5pctGlobal} onChange={e => setShow5pctGlobal(e.target.checked)} />
            <span>
              ≤5% of global lowest ({global5Max})
              <span className="pw-heatmap-check-count"> · {stats.within5pctGlobal} itineraries</span>
            </span>
          </label>
          <label className="check pw-heatmap-highlight-check">
            <input type="checkbox" checked={show10pctGlobal} onChange={e => setShow10pctGlobal(e.target.checked)} />
            <span>
              ≤10% of global lowest ({global10Max})
              <span className="pw-heatmap-check-count"> · {stats.within10pctGlobal} itineraries</span>
            </span>
          </label>
          <label className="check pw-heatmap-highlight-check">
            <input type="checkbox" checked={show15pctGlobal} onChange={e => setShow15pctGlobal(e.target.checked)} />
            <span>
              ≤15% of global lowest ({global15Max})
              <span className="pw-heatmap-check-count"> · {stats.within15pctGlobal} itineraries</span>
            </span>
          </label>
          <label className="check pw-heatmap-highlight-check">
            <input type="checkbox" checked={show20pctGlobal} onChange={e => setShow20pctGlobal(e.target.checked)} />
            <span>
              ≤20% of global lowest ({global20Max})
              <span className="pw-heatmap-check-count"> · {stats.within20pctGlobal} itineraries</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  )
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
  cacheTotal: number
  outPrice: number
  retPrice: number
  gfUrl: string
  comboKey: string
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  outResult: PriceWindowResult
  retResult: PriceWindowResult
  currency: string
  namesByIata: Map<string, string>
  airlineDirectory?: Record<string, string>
  airlinesMeta?: AirlinesMeta
  paxDesc?: string
  verifications?: Map<string, PriceVerificationRow>
  onUpsertVerification?: (row: Omit<PriceVerificationRow, 'id' | 'updatedAt'>) => void | Promise<void>
  onRemoveVerification?: (routeKey: string, outDepTime: string, retDepTime: string) => void | Promise<void>
  onImportVerifications?: (json: string, fallbackRouteKey: string, fallbackCurrency: string) => Promise<{ count: number; errors: string[] }>
  /** SerpApi bundled round-trip fares (when price window used RT date-pair search). */
  roundTripCombos?: RoundTripCombo[] | null
  /** Initial-scan metadata per date pair (Phase 1 heatmap). */
  roundTripPairMeta?: Map<string, RoundTripPairMeta> | null
  /** Ranked outbound options with departure_token (token-only pricing). */
  roundTripDeepenStates?: RoundTripPairDeepenState[] | null
  /** Precomputed token prices for heatmap cells (avoids scanning all ranked outbounds). */
  rtTokenIndex?: RtTokenPriceIndex | null
  /** When no routes are deepened yet, default the grid to this outbound route (from Total/Outbound pick). */
  preferredRouteKey?: string | null
  /** Search calendar limits (cells outside this range are hidden). */
  dateBounds?: PriceWindowDateBounds | null
  /** When non-empty, only matching quality cells stay vivid; others dim. */
  qualityFilter?: ReadonlySet<HeatmapCellQuality>
  /** Restrict heatmap prices to outbound legs passing sidebar filters. */
  outboundLegFilter?: (it: NormalizedItinerary) => boolean
  /** Restrict heatmap prices to return legs passing sidebar filters. */
  returnLegFilter?: (it: NormalizedItinerary) => boolean
}

export function DateHeatmapPanel({
  outResult, retResult, currency, namesByIata,
  airlineDirectory = {},
  airlinesMeta = {},
  paxDesc = '',
  verifications, onUpsertVerification, onRemoveVerification, onImportVerifications,
  roundTripCombos = null,
  roundTripPairMeta = null,
  roundTripDeepenStates = null,
  rtTokenIndex = null,
  preferredRouteKey = null,
  dateBounds = null,
  qualityFilter,
  outboundLegFilter,
  returnLegFilter,
}: Props) {
  const [selectedRouteKey, setSelectedRouteKey] = useState<string>(
    () => outResult.routeKeyOrder[0] ?? '',
  )
  const [show2pctLocal, setShow2pctLocal] = useState(false)
  const [show5pctLocal, setShow5pctLocal] = useState(false)
  const [show2pctGlobal, setShow2pctGlobal] = useState(false)
  const [show5pctGlobal, setShow5pctGlobal] = useState(false)
  const [show10pctGlobal, setShow10pctGlobal] = useState(false)
  const [show15pctGlobal, setShow15pctGlobal] = useState(false)
  const [show20pctGlobal, setShow20pctGlobal] = useState(false)
  const [showVerified, setShowVerified] = useState(false)

  const highlightFlags: HeatmapHighlightFlags = useMemo(() => ({
    show2pctLocal,
    show5pctLocal,
    show2pctGlobal,
    show5pctGlobal,
    show10pctGlobal,
    show15pctGlobal,
    show20pctGlobal,
  }), [show2pctLocal, show5pctLocal, show2pctGlobal, show5pctGlobal, show10pctGlobal, show15pctGlobal, show20pctGlobal])
  const [routeMenuOpen, setRouteMenuOpen] = useState(false)
  /** Override for global cheapest across all routes (outlier adjustment). */
  const [globalCheapestOverride, setGlobalCheapestOverride] = useState<number | null>(() => loadPersistedGlobalLowest())

  useEffect(() => {
    if (globalCheapestOverride != null && globalCheapestOverride > 0) {
      localStorage.setItem(HEATMAP_GLOBAL_LOWEST_KEY, String(Math.round(globalCheapestOverride)))
    } else {
      localStorage.removeItem(HEATMAP_GLOBAL_LOWEST_KEY)
    }
  }, [globalCheapestOverride])

  // Active cell (click-to-open popover)
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const routePickerRef = useRef<HTMLDivElement>(null)

  // Verifications come from SQLite via props

  // JSON import state
  const [importOpen, setImportOpen] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importMsg, setImportMsg] = useState('')

  const overrideMap: PriceOverrideMap = verifications ?? new Map()

  /** Grid + stats route: deepened routes in picker, else the outbound you selected in Total/Outbound. */
  const routeKey = useMemo(() => {
    const bookable = new Set<string>()
    for (const c of roundTripCombos ?? []) bookable.add(c.routeKey)
    const bookableList = outResult.routeKeyOrder.filter((rk) => bookable.has(rk))
    if (bookableList.includes(selectedRouteKey)) return selectedRouteKey
    if (preferredRouteKey && outResult.routeKeyOrder.includes(preferredRouteKey)) return preferredRouteKey
    return bookableList[0]
      ?? (outResult.routeKeyOrder.includes(selectedRouteKey) ? selectedRouteKey : outResult.routeKeyOrder[0] ?? '')
  }, [roundTripCombos, outResult.routeKeyOrder, selectedRouteKey, preferredRouteKey])

  // Per-combo verify price inputs: keyed by comboKey, reset when active cell changes
  const [comboVerifyInputs, setComboVerifyInputs] = useState<Record<string, string>>({})
  const [popComboFilter, setPopComboFilter] = useState('')
  useEffect(() => {
    setComboVerifyInputs({})
    setPopComboFilter('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverCell?.outDate, hoverCell?.retDate, routeKey])

  const retRouteKey = reverseRouteKey(routeKey)
  const outDateMap = outResult.perRouteByDate.get(routeKey)
  const retDateMap = retResult.perRouteByDate.get(retRouteKey)
  const outDates = useMemo(
    () => outResult.dates.filter((d) => isOutboundDateInBounds(d, dateBounds)),
    [outResult.dates, dateBounds],
  )
  const retDates = useMemo(
    () =>
      retResult.dates.filter((d) =>
        dateBounds
          ? d >= dateBounds.returnStart && d <= dateBounds.returnEnd
          : true,
      ),
    [retResult.dates, dateBounds],
  )

  const minVerifiedPriceForCell = useCallback((
    outDate: string,
    retDate: string,
  ): number | null => {
    const ob = outDateMap?.get(outDate)
    const rb = retDateMap?.get(retDate)
    if (!ob || !rb) return null
    let min: number | null = null
    for (const outIt of ob.allItineraries) {
      for (const retIt of rb.allItineraries) {
        const row = lookupVerificationRow(overrideMap, routeKey, outIt, retIt)
        if (row?.verifiedPrice != null && row.verifiedPrice > 0) {
          min = min == null ? row.verifiedPrice : Math.min(min, row.verifiedPrice)
        }
      }
    }
    return min
  }, [overrideMap, routeKey, outDateMap, retDateMap])

  const verifiedCellCount = useMemo(() => {
    const seen = new Set<string>()
    for (const row of overrideMap.values()) {
      if (row.routeKey === routeKey && row.outDate && row.retDate) {
        seen.add(`${row.outDate}|${row.retDate}`)
      }
    }
    return seen.size
  }, [overrideMap, routeKey])

  const cellLinksToCache = useCallback((
    outDate: string,
    retDate: string,
  ): boolean => {
    const ob = outDateMap?.get(outDate)
    const rb = retDateMap?.get(retDate)
    if (!ob || !rb) return false
    for (const outIt of ob.allItineraries) {
      for (const retIt of rb.allItineraries) {
        if (lookupVerificationRow(overrideMap, routeKey, outIt, retIt)) return true
      }
    }
    return false
  }, [overrideMap, routeKey, outDateMap, retDateMap])

  const verifiedCellsList = useMemo(() => {
    const byCell = new Map<string, { outDate: string; retDate: string; price: number; linkedToCache: boolean }>()
    for (const row of overrideMap.values()) {
      if (row.routeKey !== routeKey || !row.outDate || !row.retDate) continue
      const k = `${row.outDate}|${row.retDate}`
      const prev = byCell.get(k)
      const price = row.verifiedPrice > 0
        ? (prev ? Math.min(prev.price, row.verifiedPrice) : row.verifiedPrice)
        : (prev?.price ?? 0)
      byCell.set(k, {
        outDate: row.outDate,
        retDate: row.retDate,
        price,
        linkedToCache: cellLinksToCache(row.outDate, row.retDate),
      })
    }
    return [...byCell.values()]
      .filter(c => c.price > 0)
      .sort((a, b) => a.outDate.localeCompare(b.outDate) || a.retDate.localeCompare(b.retDate))
  }, [overrideMap, routeKey, cellLinksToCache])

  const [focusedVerifyCell, setFocusedVerifyCell] = useState<string | null>(null)

  const focusVerifiedCell = useCallback((outDate: string, retDate: string) => {
    setShowVerified(true)
    setFocusedVerifyCell(`${outDate}|${retDate}`)
    const el = document.querySelector(
      `[data-heatmap-cell="${outDate}|${retDate}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    if (el) {
      const r = el.getBoundingClientRect()
      setHoverCell({ outDate, retDate, rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom } })
    }
  }, [])

  const { cells, minP, maxP, cheapestKey } = useMemo(
    () =>
      buildHeatmapCells(
        routeKey,
        outResult,
        retResult,
        overrideMap,
        roundTripCombos,
        roundTripPairMeta,
        dateBounds,
        roundTripDeepenStates,
        outboundLegFilter ? undefined : rtTokenIndex,
        outboundLegFilter,
        returnLegFilter,
      ),
    [routeKey, outResult, retResult, overrideMap, roundTripCombos, roundTripPairMeta, dateBounds, roundTripDeepenStates, rtTokenIndex, outboundLegFilter, returnLegFilter],
  )

  const serpCells = useMemo(() => {
    if (outboundLegFilter) {
      return buildHeatmapCells(
        routeKey,
        outResult,
        retResult,
        new Map(),
        roundTripCombos,
        roundTripPairMeta,
        dateBounds,
        roundTripDeepenStates,
        undefined,
        outboundLegFilter,
        returnLegFilter,
      ).cells
    }
    if (rtTokenIndex) {
      const cells = new Map<string, number>()
      for (const retDate of retResult.dates) {
        for (const outDate of outResult.dates) {
          const serp = tokenRoutePriceFromIndex(rtTokenIndex, routeKey, outDate, retDate)
          if (serp) cells.set(`${outDate}|${retDate}`, serp.price)
        }
      }
      return cells
    }
    return buildHeatmapCells(
      routeKey,
      outResult,
      retResult,
      new Map(),
      roundTripCombos,
      roundTripPairMeta,
      dateBounds,
      roundTripDeepenStates,
      rtTokenIndex,
    ).cells
  }, [routeKey, outResult, retResult, roundTripCombos, roundTripPairMeta, dateBounds, roundTripDeepenStates, rtTokenIndex, outboundLegFilter, returnLegFilter])

  // Itinerary combos for active cell
  const hoveredCombos = useMemo((): Combo[] => {
    if (!hoverCell) return []
    const { outDate, retDate } = hoverCell
    const combos: Combo[] = []

    if (roundTripCombos?.length) {
      for (const c of roundTripCombos) {
        if (c.routeKey !== routeKey || c.outDate !== outDate || c.retDate !== retDate) continue
        const cacheTotal = effectiveCombinedPrice(
          c.outIt,
          c.retIt,
          overrideMap,
          routeKey,
          c.roundTripPrice,
        )
        if (cacheTotal <= 0) continue
        const deepLink = buildGoogleFlightsDeepLink(c.outIt, outDate, c.retIt, retDate)
        const { url: searchUrl } = buildGoogleFlightsSearchUrl(
          [c.outIt.segments[0]?.dep ?? ''],
          [c.outIt.segments[c.outIt.segments.length - 1]?.arr ?? ''],
          outDate,
          retDate,
        )
        combos.push({
          outIt: c.outIt,
          retIt: c.retIt,
          outPrice: c.outIt.price ?? 0,
          retPrice: c.retIt.price ?? 0,
          cacheTotal,
          gfUrl: deepLink ?? searchUrl,
          comboKey: vKeyFromPair(routeKey, c.outIt, c.retIt),
        })
      }
      return combos.sort((a, b) => a.cacheTotal - b.cacheTotal)
    }

    const ob = outDateMap?.get(outDate)
    const rb = retDateMap?.get(retDate)
    if (!ob || !rb) return []
    for (const outIt of ob.allItineraries) {
      for (const retIt of rb.allItineraries) {
        const cacheTotal = effectiveCombinedPrice(outIt, retIt, overrideMap, routeKey)
        if (cacheTotal <= 0) continue
        const deepLink = buildGoogleFlightsDeepLink(outIt, outDate, retIt, retDate)
        const { url: searchUrl } = buildGoogleFlightsSearchUrl(
          [outIt.segments[0]?.dep ?? ''],
          [outIt.segments[outIt.segments.length - 1]?.arr ?? ''],
          outDate,
          retDate,
        )
        combos.push({
          outIt,
          retIt,
          outPrice: outIt.price ?? 0,
          retPrice: retIt.price ?? 0,
          cacheTotal,
          gfUrl: deepLink ?? searchUrl,
          comboKey: vKeyFromPair(routeKey, outIt, retIt),
        })
      }
    }
    return combos.sort((a, b) => a.cacheTotal - b.cacheTotal)
  }, [hoverCell, outDateMap, retDateMap, routeKey, roundTripCombos, overrideMap])

  const popoverVerificationMatches = useMemo((): VerificationComboMatch[] => {
    if (!hoverCell) return []
    const rows = verifiedRowsForCell(overrideMap, routeKey, hoverCell.outDate, hoverCell.retDate)
    const map = verifications ?? new Map()
    return rows.map(row => bestComboForVerification(row, hoveredCombos, routeKey, map))
  }, [hoverCell, overrideMap, routeKey, hoveredCombos, verifications])

  const pinnedComboKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const m of popoverVerificationMatches) {
      if (m.combo) keys.add(m.combo.comboKey)
    }
    return keys
  }, [popoverVerificationMatches])

  const filteredHoveredCombos = useMemo(() => {
    const filtered = hoveredCombos.filter(c =>
      comboMatchesFilter(c, popComboFilter) || pinnedComboKeys.has(c.comboKey),
    )
    return filtered.sort((a, b) => {
      const aPin = pinnedComboKeys.has(a.comboKey) ? 1 : 0
      const bPin = pinnedComboKeys.has(b.comboKey) ? 1 : 0
      if (bPin !== aPin) return bPin - aPin
      const aV = lookupVerificationRow(verifications ?? new Map(), routeKey, a.outIt, a.retIt) ? 1 : 0
      const bV = lookupVerificationRow(verifications ?? new Map(), routeKey, b.outIt, b.retIt) ? 1 : 0
      if (bV !== aV) return bV - aV
      return a.cacheTotal - b.cacheTotal
    })
  }, [hoveredCombos, popComboFilter, verifications, routeKey, pinnedComboKeys])

  useEffect(() => {
    if (!hoverCell || pinnedComboKeys.size === 0) return
    const firstKey = [...pinnedComboKeys][0]
    const id = `pw-pop-combo-${firstKey.replace(/[^\w-]/g, '_')}`
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [hoverCell?.outDate, hoverCell?.retDate, pinnedComboKeys])

  const relinkAttemptedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    relinkAttemptedRef.current.clear()
  }, [routeKey])

  // Re-key orphan verifications onto the matched cache combo (no manual Update).
  useEffect(() => {
    if (!onUpsertVerification || !onRemoveVerification) return

    const vmap = verifications ?? new Map()
    const tasks: Array<Promise<void>> = []

    for (const row of vmap.values()) {
      if (row.routeKey !== routeKey || !row.outDate || !row.retDate) continue

      const attemptKey = `${row.outDate}|${row.retDate}|${row.outDepTime}|${row.retDepTime}|${row.verifiedPrice}`
      if (relinkAttemptedRef.current.has(attemptKey)) continue

      const ob = outDateMap?.get(row.outDate)
      const rb = retDateMap?.get(row.retDate)
      if (!ob || !rb) continue

      const combos: Combo[] = []
      for (const outIt of ob.allItineraries) {
        for (const retIt of rb.allItineraries) {
          const cacheTotal = cacheCombinedPrice(outIt, retIt)
          if (cacheTotal <= 0) continue
          combos.push({
            outIt,
            retIt,
            outPrice: outIt.price ?? 0,
            retPrice: retIt.price ?? 0,
            cacheTotal,
            gfUrl: '',
            comboKey: vKeyFromPair(routeKey, outIt, retIt),
          })
        }
      }

      const match = bestComboForVerification(row, combos, routeKey, vmap)
      relinkAttemptedRef.current.add(attemptKey)

      if (match.exact || !match.combo || match.score < AUTO_RELINK_MIN_SCORE) continue

      const newOutKey = legVerificationKey(match.combo.outIt)
      const newRetKey = legVerificationKey(match.combo.retIt)
      if (row.outDepTime === newOutKey && row.retDepTime === newRetKey) continue

      tasks.push((async () => {
        await onRemoveVerification(routeKey, row.outDepTime, row.retDepTime)
        await onUpsertVerification({
          routeKey,
          outDate: row.outDate,
          retDate: row.retDate,
          outDepTime: newOutKey,
          retDepTime: newRetKey,
          verifiedPrice: row.verifiedPrice,
          cachedPrice: match.combo!.cacheTotal,
          currency: row.currency || currency,
          paxDesc: row.paxDesc,
          note: row.note,
        })
      })())
    }

    if (tasks.length > 0) void Promise.all(tasks)
  }, [
    verifications,
    routeKey,
    outDateMap,
    retDateMap,
    currency,
    onUpsertVerification,
    onRemoveVerification,
  ])

  // Click handlers
  // getBoundingClientRect must be captured synchronously — React nullifies e.currentTarget
  // after the handler returns (synthetic event pooling), so the setState updater can't access it.
  const handleCellClick = useCallback((outDate: string, retDate: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setHoverCell(prev => {
      if (prev?.outDate === outDate && prev?.retDate === retDate) return null
      return { outDate, retDate, rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom } }
    })
  }, [])

  // Close popover / route menu on click outside / Escape
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (hoverCell && popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setHoverCell(null)
      }
      if (routeMenuOpen && routePickerRef.current && !routePickerRef.current.contains(e.target as Node)) {
        setRouteMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHoverCell(null)
        setRouteMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocClick); window.removeEventListener('keydown', onKey) }
  }, [hoverCell, routeMenuOpen])

  // Save verification for a specific combo (called from per-row verify button)
  const handleSaveComboVerification = useCallback((
    outIt: NormalizedItinerary,
    retIt: NormalizedItinerary,
    outDate: string,
    retDate: string,
    priceStr: string,
    cachedTotal: number,
  ) => {
    if (!onUpsertVerification) return
    const p = Number(priceStr)
    if (!Number.isFinite(p) || p <= 0) return
    void onUpsertVerification({
      routeKey,
      outDate,
      retDate,
      outDepTime: legVerificationKey(outIt),
      retDepTime: legVerificationKey(retIt),
      verifiedPrice: p,
      cachedPrice: cachedTotal > 0 ? cachedTotal : null,
      currency,
      paxDesc,
      note: '',
    })
  }, [routeKey, currency, paxDesc, onUpsertVerification])

  function normDepTime(date: string, depTime: string): string {
    const t = depTime.trim()
    if (!t) return ''
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(t)) return t
    // Accept bare "HH:mm" by prefixing date
    if (/^\d{2}:\d{2}$/.test(t)) return `${date} ${t}`
    return t
  }

  function flightKey(it: NormalizedItinerary): string {
    return it.segments.map(s => s.flightNumber).filter(Boolean).join('+').toUpperCase()
  }

  function resolveLegDepTime(
    bucket: { allItineraries: NormalizedItinerary[]; bestItinerary: NormalizedItinerary } | undefined,
    date: string,
    wantedFlights: string | undefined,
  ): string {
    if (!bucket) return ''
    const want = (wantedFlights ?? '').trim().toUpperCase().replace(/\s+/g, '')
    if (want) {
      const match = bucket.allItineraries.find(it => flightKey(it).replace(/\s+/g, '') === want)
      const dt = match?.segments[0]?.depTime ?? ''
      return normDepTime(date, dt)
    }
    const dt = bucket.bestItinerary?.segments[0]?.depTime ?? ''
    return normDepTime(date, dt)
  }

  // Import JSON from other Claude chat
  const handleImport = useCallback(async () => {
    setImportMsg('')
    // Resolve missing dep-times against the current snapshot so imports match exact itineraries.
    // Accept optional fields `outFlights` / `retFlights` as a "+"-joined flight-number string.
    let resolvedJson = importJson
    try {
      const parsed = JSON.parse(importJson) as Array<Record<string, unknown>>
      if (Array.isArray(parsed)) {
        const resolved = parsed.map((r) => {
          const outDate = String((r.out ?? r.outDate ?? '')).trim()
          const retDate = String((r.ret ?? r.retDate ?? '')).trim()
          const rk = String((r.routeKey ?? routeKey)).trim()
          const outFlights = typeof r.outFlights === 'string' ? r.outFlights : undefined
          const retFlights = typeof r.retFlights === 'string' ? r.retFlights : undefined
          const outDepTime = normDepTime(outDate, String(r.outDepTime ?? ''))
          const retDepTime = normDepTime(retDate, String(r.retDepTime ?? ''))

          // If dep-times missing, try to resolve from current buckets for this route/date.
          const outMap = outResult.perRouteByDate.get(rk)
          const retMap = retResult.perRouteByDate.get(reverseRouteKey(rk))
          const outBucket = outDate ? outMap?.get(outDate) : undefined
          const retBucket = retDate ? retMap?.get(retDate) : undefined

          const resolvedOutDep = outDepTime || (outDate ? resolveLegDepTime(outBucket, outDate, outFlights) : '')
          const resolvedRetDep = retDepTime || (retDate ? resolveLegDepTime(retBucket, retDate, retFlights) : '')

          return {
            ...r,
            routeKey: rk,
            out: outDate || r.out,
            ret: retDate || r.ret,
            outDepTime: legKeyFromParts(
              resolvedOutDep,
              outFlights,
              typeof r.outArrTime === 'string' ? r.outArrTime : undefined,
            ),
            retDepTime: legKeyFromParts(
              resolvedRetDep,
              retFlights,
              typeof r.retArrTime === 'string' ? r.retArrTime : undefined,
            ),
            pax: typeof r.pax === 'string' && r.pax.trim() ? r.pax : paxDesc,
          }
        })
        resolvedJson = JSON.stringify(resolved)
      }
    } catch {
      // fall through to existing error handling below
    }

    if (!onImportVerifications) {
      // Fallback: parse locally and call upsert one by one
      try {
        const result = importVerificationsFromJson({ run: () => {}, exec: () => [], prepare: () => ({ bind: () => {}, step: () => false, getAsObject: () => ({}), free: () => {} }) } as never, resolvedJson, routeKey, currency)
        setImportMsg(`✓ Imported ${result.count} row${result.count === 1 ? '' : 's'}.`)
      } catch (e) {
        setImportMsg(`Error: ${e instanceof Error ? e.message : 'Invalid JSON'}`)
      }
      return
    }
    const result = await onImportVerifications(resolvedJson, routeKey, currency)
    if (result.count > 0) {
      setImportMsg(`✓ Imported ${result.count} verification${result.count === 1 ? '' : 's'}.`)
      setImportJson('')
    } else {
      setImportMsg(result.errors.length > 0 ? `Errors: ${result.errors.slice(0, 3).join('; ')}` : 'No valid rows found.')
    }
  }, [importJson, routeKey, currency, paxDesc, outResult, retResult, onImportVerifications])

  // Popover position
  const popoverStyle = useMemo((): React.CSSProperties => {
    if (!hoverCell) return { display: 'none' }
    const { rect } = hoverCell
    const viewH = window.innerHeight
    const popH = Math.min(viewH * 0.75, 560)
    const popW = Math.min(920, window.innerWidth - 16)
    const spaceBelow = viewH - rect.bottom
    const top = spaceBelow >= popH || spaceBelow >= viewH / 2 ? rect.bottom + 6 : rect.top - popH - 6
    const left = Math.min(rect.left, window.innerWidth - popW - 8)
    return { position: 'fixed', top, left: Math.max(8, left), zIndex: 9999 }
  }, [hoverCell])

  const routeStatsByKey = useMemo(() => {
    const map = new Map<string, RouteHeatmapStats>()
    for (const rk of outResult.routeKeyOrder) {
      map.set(rk, computeRouteHeatmapStats(rk, outResult, retResult, overrideMap, roundTripCombos))
    }
    return map
  }, [outResult, retResult, overrideMap, roundTripCombos])

  const selectedRouteStats = routeStatsByKey.get(routeKey)

  const allRoutesGlobalMin = useMemo(() => {
    let g = Infinity
    for (const stats of routeStatsByKey.values()) {
      if (stats.minPrice != null && stats.minPrice < g) g = stats.minPrice
    }
    return g === Infinity ? 0 : g
  }, [routeStatsByKey])

  const effectiveGlobalCheapest =
    globalCheapestOverride != null && globalCheapestOverride > 0
      ? globalCheapestOverride
      : allRoutesGlobalMin

  const routeComboMin = selectedRouteStats?.minPrice ?? 0
  const localCheapestBaseline = routeComboMin > 0 ? routeComboMin : (minP > 0 ? minP : 0)

  const gridLowestNote = useMemo(() => {
    if (routeComboMin <= 0 || minP <= 0) return null
    if (Math.round(minP) >= Math.round(routeComboMin)) return null
    return `A grid cell shows ${formatPriceAmount(minP, currency)} from cached leg prices without a priced itinerary combo. Highlight thresholds use ${formatPriceAmount(routeComboMin, currency)}.`
  }, [routeComboMin, minP, currency])

  const selectedRouteStatsDisplay = useMemo(() => {
    if (!routeKey) return undefined
    return computeRouteHeatmapStats(
      routeKey,
      outResult,
      retResult,
      overrideMap,
      roundTripCombos,
      localCheapestBaseline,
      effectiveGlobalCheapest,
    )
  }, [routeKey, outResult, retResult, overrideMap, roundTripCombos, localCheapestBaseline, effectiveGlobalCheapest])

  const routeDropdownStatsByKey = useMemo(() => {
    const map = new Map<string, { totalCombos: number; within5pctGlobal: number; within20pctGlobal: number }>()
    for (const rk of outResult.routeKeyOrder) {
      const base = routeStatsByKey.get(rk)
      if (!base) continue
      const stats = computeRouteHeatmapStats(
        rk,
        outResult,
        retResult,
        overrideMap,
        roundTripCombos,
        base.minPrice,
        effectiveGlobalCheapest,
      )
      map.set(rk, {
        totalCombos: stats.totalCombos,
        within5pctGlobal: stats.within5pctGlobal,
        within20pctGlobal: stats.within20pctGlobal,
      })
    }
    return map
  }, [outResult, retResult, overrideMap, routeStatsByKey, effectiveGlobalCheapest, roundTripCombos])

  const bookableRouteKeys = useMemo(() => {
    return [...outResult.routeKeyOrder]
      .filter((rk) => (routeDropdownStatsByKey.get(rk)?.totalCombos ?? 0) > 0)
      .sort((a, b) => {
        const ta = routeDropdownStatsByKey.get(a)?.totalCombos ?? 0
        const tb = routeDropdownStatsByKey.get(b)?.totalCombos ?? 0
        return tb - ta
      })
  }, [outResult.routeKeyOrder, routeDropdownStatsByKey])

  const sortedRouteKeysForDropdown = bookableRouteKeys

  useEffect(() => {
    if (bookableRouteKeys.length === 0) return
    if (bookableRouteKeys.includes(selectedRouteKey)) return
    setSelectedRouteKey(bookableRouteKeys[0])
  }, [bookableRouteKeys, selectedRouteKey])

  const summaryOnlyRouteCount = outResult.routeKeyOrder.length - bookableRouteKeys.length

  function pctOfTotal(count: number, total: number): string {
    if (total <= 0) return '0%'
    return `${Math.round((count / total) * 100)}%`
  }

  return (
    <details className="search-section pw-heatmap-panel" open>
      <summary className="search-section-summary">Date heatmap</summary>
      <div className="search-section-body pw-heatmap-body">

        <div className="pw-heatmap-controls-row">
          <div className="field pw-heatmap-route-field">
            <span className="label">Route</span>
            {sortedRouteKeysForDropdown.length === 0 ? (
              <div className="pw-heatmap-route-static">
                {routeKey ? (
                  <RouteLabelCell
                    routeKey={routeKey}
                    namesByIata={namesByIata}
                    airlinesMeta={airlinesMeta}
                    airlineDirectory={airlineDirectory}
                    compact
                  />
                ) : (
                  <span className="muted small">Select outbound above…</span>
                )}
                <p className="muted small pw-heatmap-route-static-hint">
                  No return itineraries loaded yet — summary prices only.
                  Use <strong>Refresh filtered returns</strong> in the search panel to fetch bookable outbound/return combinations.
                </p>
              </div>
            ) : (
            <div
              className={`combo pw-heatmap-route-picker${routeMenuOpen ? ' pw-heatmap-route-picker--open' : ''}`}
              ref={routePickerRef}
            >
              <button
                type="button"
                className="input pw-heatmap-route-trigger"
                aria-haspopup="listbox"
                aria-expanded={routeMenuOpen}
                onClick={() => setRouteMenuOpen(o => !o)}
              >
                {routeKey ? (
                  <RouteLabelCell
                    routeKey={routeKey}
                    namesByIata={namesByIata}
                    airlinesMeta={airlinesMeta}
                    airlineDirectory={airlineDirectory}
                    compact
                  />
                ) : (
                  <span className="muted small">Select route…</span>
                )}
                <span className="pw-heatmap-route-chevron" aria-hidden>{routeMenuOpen ? '▴' : '▾'}</span>
              </button>
              {routeMenuOpen && (
                <ul className="dropdown pw-heatmap-route-menu" role="listbox">
                  {summaryOnlyRouteCount > 0 && (
                    <li className="pw-heatmap-route-menu-note muted small" role="presentation">
                      {summaryOnlyRouteCount} route{summaryOnlyRouteCount === 1 ? '' : 's'} with scan-only prices hidden — deepen to compare itineraries.
                    </li>
                  )}
                  {sortedRouteKeysForDropdown.map(rk => {
                    const menuStats = routeDropdownStatsByKey.get(rk)!
                    const isSelected = rk === routeKey
                    return (
                      <li key={rk} role="option" aria-selected={isSelected}>
                        <button
                          type="button"
                          className={`dropdown-item pw-heatmap-route-option${isSelected ? ' pw-heatmap-route-option--selected' : ''}`}
                          onClick={() => {
                            setSelectedRouteKey(rk)
                            setRouteMenuOpen(false)
                          }}
                        >
                          <RouteLabelCell
                            routeKey={rk}
                            namesByIata={namesByIata}
                            airlinesMeta={airlinesMeta}
                            airlineDirectory={airlineDirectory}
                            compact
                          />
                          <span className="pw-heatmap-route-option-meta">
                            {menuStats.totalCombos.toLocaleString()} itineraries
                            <span className="pw-heatmap-route-option-meta-sep"> · </span>
                            ≤5% of global lowest: {menuStats.within5pctGlobal.toLocaleString()}
                            <span className="pw-heatmap-route-option-meta-sep"> · </span>
                            ≤20% of global lowest: {menuStats.within20pctGlobal.toLocaleString()}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            )}
          </div>
          {selectedRouteStatsDisplay && selectedRouteStatsDisplay.totalCombos > 0 ? (
            <HeatmapHighlightPanel
              stats={selectedRouteStatsDisplay}
              currency={currency}
              localLowest={localCheapestBaseline}
              globalLowest={effectiveGlobalCheapest}
              allRoutesAutoLowest={allRoutesGlobalMin}
              savedGlobalLowest={globalCheapestOverride}
              onGlobalLowestChange={n => setGlobalCheapestOverride(n)}
              onGlobalLowestReset={() => setGlobalCheapestOverride(null)}
              show2pctLocal={show2pctLocal}
              setShow2pctLocal={setShow2pctLocal}
              show5pctLocal={show5pctLocal}
              setShow5pctLocal={setShow5pctLocal}
              show2pctGlobal={show2pctGlobal}
              setShow2pctGlobal={setShow2pctGlobal}
              show5pctGlobal={show5pctGlobal}
              setShow5pctGlobal={setShow5pctGlobal}
              show10pctGlobal={show10pctGlobal}
              setShow10pctGlobal={setShow10pctGlobal}
              show15pctGlobal={show15pctGlobal}
              setShow15pctGlobal={setShow15pctGlobal}
              show20pctGlobal={show20pctGlobal}
              setShow20pctGlobal={setShow20pctGlobal}
              showVerified={showVerified}
              setShowVerified={setShowVerified}
              verifiedCellCount={verifiedCellCount}
              verifiedCellsList={verifiedCellsList}
              onFocusVerifiedCell={focusVerifiedCell}
              gridLowestNote={gridLowestNote}
              importOpen={importOpen}
              onToggleImport={() => { setImportOpen(o => !o); setImportMsg('') }}
            />
          ) : (
            <div className="pw-heatmap-highlight-panel pw-heatmap-highlight-panel--empty">
              <span className="pw-heatmap-panel-title">Highlight</span>
              <p className="muted small">
                {routeKey
                  ? 'Itinerary highlighting appears after you deepen this route (bookable outbound/return combinations).'
                  : 'Select outbound above, then deepen a return date to enable route comparison.'}
              </p>
            </div>
          )}
          {selectedRouteStats && selectedRouteStats.totalCombos > 0 && selectedRouteStatsDisplay && (
            <div className="pw-heatmap-layover-panel">
              <div className="pw-heatmap-layover-summary">
                <span className="pw-heatmap-layover-heading">≤5% of global lowest</span>
                <ul className="pw-heatmap-layover-list">
                  <li>
                    <span className="pw-heatmap-layover-bucket">Itineraries</span>
                    <span className="pw-heatmap-layover-count">
                      {selectedRouteStatsDisplay.within5pctGlobal.toLocaleString()}
                      <span className="pw-heatmap-layover-pct">
                        ({pctOfTotal(selectedRouteStatsDisplay.within5pctGlobal, selectedRouteStats.totalCombos)})
                      </span>
                    </span>
                  </li>
                </ul>
              </div>
              <div className="pw-heatmap-layover-columns">
              <div className="pw-heatmap-layover-block">
                <span className="pw-heatmap-layover-heading">Outbound layover</span>
                <ul className="pw-heatmap-layover-list">
                  {(['short', 'medium', 'long'] as const).map(bucket => (
                    <li key={bucket}>
                      <span className="pw-heatmap-layover-bucket">{LAYOVER_BUCKET_LABELS[bucket]}</span>
                      <span className="pw-heatmap-layover-count">
                        {selectedRouteStats.outboundLayover[bucket]}
                        <span className="pw-heatmap-layover-pct">
                          ({pctOfTotal(selectedRouteStats.outboundLayover[bucket], selectedRouteStats.totalCombos)})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pw-heatmap-layover-block">
                <span className="pw-heatmap-layover-heading">Return layover</span>
                <ul className="pw-heatmap-layover-list">
                  {(['short', 'medium', 'long'] as const).map(bucket => (
                    <li key={bucket}>
                      <span className="pw-heatmap-layover-bucket">{LAYOVER_BUCKET_LABELS[bucket]}</span>
                      <span className="pw-heatmap-layover-count">
                        {selectedRouteStats.returnLayover[bucket]}
                        <span className="pw-heatmap-layover-pct">
                          ({pctOfTotal(selectedRouteStats.returnLayover[bucket], selectedRouteStats.totalCombos)})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              </div>
            </div>
          )}
        </div>

        {/* JSON import panel */}
        {importOpen && (
          <div className="pw-heatmap-import-panel">
            <p className="muted small">
              Paste JSON from your other Claude chat. Applies to the currently selected route.<br />
              Format: <code className="mono">{'[{"out":"2026-07-12","ret":"2026-09-06","outDepTime":"…","outFlights":"EY2+EY262","outArrTime":"2026-07-15 08:10","retFlights":"…","retArrTime":"…","price":3777}]'}</code>
              <span className="muted small"> Use <code className="mono">verifications-vision-import.json</code> from the Travel folder after running <code className="mono">vision-match-travel.py</code>.</span>
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

        {!routeKey ? (
          <p className="muted small">No data available.</p>
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
                      const cellQuality: HeatmapCellQuality =
                        price == null
                          ? 'empty'
                          : resolvePairCellQuality(
                              routeKey,
                              outDate,
                              retDate,
                              outResult,
                              retResult,
                              overrideMap,
                              roundTripCombos,
                              roundTripPairMeta,
                              dateBounds,
                              roundTripDeepenStates,
                            )
                      const cellVerifyRows = verifiedRowsForCell(overrideMap, routeKey, outDate, retDate)
                      const isVerified = cellVerifyRows.length > 0
                      const cellVerifiedMin =
                        minVerifiedPriceForCell(outDate, retDate)
                        ?? minVerifiedFromRows(cellVerifyRows)
                      const isCheapest = cellKey === cheapestKey
                      const isActive = hoverCell?.outDate === outDate && hoverCell?.retDate === retDate
                      const isFocusedVerify = focusedVerifyCell === cellKey
                      const serpPrice = serpCells.get(cellKey) ?? null
                      const serpDelta = cellVerifiedMin != null
                        ? verificationSerpDelta(cellVerifiedMin, serpPrice)
                        : null

                      if (price == null) {
                        return (
                          <div
                            key={outDate}
                            className={[
                              'pw-heatmap-cell',
                              'pw-heatmap-empty',
                              heatmapQualityCellClass('empty', qualityFilter),
                            ].filter(Boolean).join(' ')}
                          >
                            <HeatmapQualityBadge quality="empty" />
                            <span>—</span>
                          </div>
                        )
                      }
                      const tier = cellHighlightClass(
                        price,
                        localCheapestBaseline,
                        effectiveGlobalCheapest,
                        highlightFlags,
                        showVerified,
                        isVerified,
                      )
                      const savedChangesTitle = cellVerifyRows.length > 0
                        ? cellVerifyRows.map(row => {
                            const from = row.cachedPrice != null && row.cachedPrice > 0
                              ? row.cachedPrice
                              : serpPrice
                            const fromStr = from != null && from > 0
                              ? formatPriceAmount(from, currency)
                              : '?'
                            return `${describeVerificationLegs(row)}: ${fromStr} → ${formatPriceAmount(row.verifiedPrice, currency)}`
                          }).join('\n')
                        : undefined
                      const varianceTitle = cellVerifiedMin != null && serpPrice != null && serpDelta != null
                        ? `Lowest verified on this cell ${formatPriceAmount(cellVerifiedMin, currency)} · SERP ${formatPriceAmount(serpPrice, currency)} (${serpDelta >= 0 ? '+' : ''}${serpDelta})`
                        : undefined
                      const pm = roundTripPairMeta?.get(cellKey)
                      const qualityTitle = HEATMAP_QUALITY_DEFS[cellQuality].title
                      const cellTitle = [savedChangesTitle, varianceTitle, qualityTitle]
                        .filter(Boolean)
                        .join('\n') || undefined
                      return (
                        <div
                          key={outDate}
                          className={[
                            'pw-heatmap-cell',
                            isCheapest ? 'pw-heatmap-cheapest' : '',
                            isActive ? 'pw-heatmap-cell-hover' : '',
                            isFocusedVerify ? 'pw-heatmap-cell--focus-verify' : '',
                            serpDelta != null ? 'pw-heatmap-cell--serp-drift' : '',
                            heatmapQualityCellClass(cellQuality, qualityFilter),
                            tier,
                          ].filter(Boolean).join(' ')}
                          data-heatmap-cell={cellKey}
                          style={showVerified && isVerified
                            ? undefined
                            : { background: heatColor(price, minP, maxP) }}
                          onClick={e => handleCellClick(outDate, retDate, e)}
                          title={cellTitle}
                        >
                          {isCheapest && <span className="pw-heatmap-star">✦</span>}
                          <HeatmapQualityBadge quality={cellQuality} className="pw-hq-badge--cell" />
                          {cellVerifiedMin != null && (
                            <span
                              className={`pw-heatmap-verified-badge${serpDelta != null ? ' pw-heatmap-verified-badge--drift' : ''}`}
                              title={varianceTitle ?? `Verified from ${formatPriceAmount(cellVerifiedMin, currency)}`}
                            >
                              ✓
                            </span>
                          )}
                          <span className="pw-heatmap-cell-price">{formatPriceAmount(price, currency)}</span>
                          {pm && (
                            <span className="pw-heatmap-expansion-badge" title="SerpApi expansion level">
                              {expansionBadgeLabel(pm)}
                            </span>
                          )}
                          {serpDelta != null && serpPrice != null && (
                            <span className="pw-heatmap-variance" aria-label={varianceTitle}>
                              <span className="pw-heatmap-variance-serp">{formatPriceAmount(serpPrice, currency)}</span>
                              <span className={`pw-heatmap-variance-delta${serpDelta < 0 ? ' pw-heatmap-variance-delta--down' : ' pw-heatmap-variance-delta--up'}`}>
                                {serpDelta >= 0 ? '+' : ''}{serpDelta}
                              </span>
                            </span>
                          )}
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
        {hoverCell && (() => {
          const pairMeta = roundTripPairMeta?.get(roundTripPairCellKey(hoverCell.outDate, hoverCell.retDate))
          if (hoveredCombos.length === 0) return null
          const verifiedComboCount = hoveredCombos.filter(c =>
            lookupVerificationRow(verifications ?? new Map(), routeKey, c.outIt, c.retIt),
          ).length
          const popCellKey = `${hoverCell.outDate}|${hoverCell.retDate}`
          const cellSerpPrice = serpCells.get(popCellKey) ?? null
          return (
          <div ref={popoverRef} className="pw-heatmap-popover" style={popoverStyle}>
            <div className="pw-heatmap-pop-header">
              <span className="pw-heatmap-pop-dates">
                Out: {shortDate(hoverCell.outDate)} · Ret: {shortDate(hoverCell.retDate)}
              </span>
              <span className="pw-heatmap-pop-hint">Click outside or Esc to close</span>
            </div>
            <p className="pw-heatmap-pop-intro muted small">
              {hoveredCombos.length} itinerary combination{hoveredCombos.length === 1 ? '' : 's'}.
              {' '}Verified price is saved only for the card you choose (matched by flight numbers and times).
              {verifiedComboCount > 0 && (
                <> · {verifiedComboCount} verified on this date pair.</>
              )}
            </p>

            {popoverVerificationMatches.length > 0 && (
              <div className="pw-heatmap-pop-saved-prices">
                <span className="pw-heatmap-pop-saved-heading">Saved price changes on this cell</span>
                <ul className="pw-heatmap-pop-saved-list">
                  {popoverVerificationMatches.map(match => {
                    const { row, combo, exact } = match
                    const serpRef = row.cachedPrice != null && row.cachedPrice > 0
                      ? row.cachedPrice
                      : combo?.cacheTotal ?? cellSerpPrice
                    const delta = serpRef != null && serpRef > 0
                      ? Math.round(row.verifiedPrice - serpRef)
                      : null
                    const searchTok = legKeySearchToken(row.outDepTime) || legKeySearchToken(row.retDepTime)
                    return (
                      <li
                        key={vKey(routeKey, row.outDepTime, row.retDepTime)}
                        className={`pw-heatmap-pop-saved-item${combo ? '' : ' pw-heatmap-pop-saved-item--orphan'}`}
                      >
                        <span className="pw-heatmap-pop-saved-flights small">
                          {describeVerificationLegs(row)}
                        </span>
                        <span className="pw-heatmap-pop-saved-change">
                          {serpRef != null && serpRef > 0 ? (
                            <>
                              <span className="pw-heatmap-pop-saved-was">{formatPriceAmount(serpRef, currency)}</span>
                              <span className="pw-heatmap-pop-saved-arrow" aria-hidden>→</span>
                            </>
                          ) : null}
                          <strong className="pw-heatmap-pop-saved-now">
                            {formatPriceAmount(row.verifiedPrice, currency)}
                          </strong>
                          {delta != null && delta !== 0 && (
                            <span className={`pw-heatmap-variance-delta${delta < 0 ? ' pw-heatmap-variance-delta--down' : ' pw-heatmap-variance-delta--up'}`}>
                              {delta >= 0 ? '+' : ''}{delta}
                            </span>
                          )}
                        </span>
                        {combo ? (
                          <span className={`pw-heatmap-pop-saved-match${exact ? ' pw-heatmap-pop-saved-match--exact' : ''}`}>
                            {exact
                              ? '✓ Linked to highlighted card below'
                              : `→ Best match: SERP ${formatPriceAmount(combo.cacheTotal, currency)} · ${itinSummary(combo.outIt).flights} / ${itinSummary(combo.retIt).flights} (linking…)`}
                          </span>
                        ) : (
                          <span className="pw-heatmap-pop-saved-orphan-warn">
                            Not linked to any card — SerpApi keys changed. Find your flights and tap Save again.
                          </span>
                        )}
                        {searchTok && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-tiny pw-heatmap-pop-saved-find"
                            onClick={e => {
                              e.stopPropagation()
                              setPopComboFilter(searchTok.replace(/^([A-Z]{2})/, '$1 '))
                            }}
                          >
                            Find in list
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="muted small pw-heatmap-pop-saved-hint">
                  Heatmap cell shows the lowest verified price on this date pair
                  {cellSerpPrice != null ? ` (SERP combo min ${formatPriceAmount(cellSerpPrice, currency)})` : ''}.
                  Orphan saves are linked automatically when a cache combo matches.
                </p>
              </div>
            )}

            <div className="pw-heatmap-pop-toolbar">
              <label className="pw-heatmap-pop-search">
                <span className="pw-heatmap-pop-search-icon" aria-hidden>⌕</span>
                <input
                  type="search"
                  className="input pw-heatmap-pop-search-input"
                  placeholder="Flight #, time, or layover (e.g. EY346, 22:20, AUH 19h)"
                  value={popComboFilter}
                  onChange={e => setPopComboFilter(e.target.value)}
                  onClick={e => e.stopPropagation()}
                />
                {popComboFilter.trim() && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-tiny pw-heatmap-pop-search-clear"
                    onClick={() => setPopComboFilter('')}
                    aria-label="Clear search"
                  >×</button>
                )}
              </label>
              <span className="pw-heatmap-pop-search-count muted small">
                {filteredHoveredCombos.length} of {hoveredCombos.length} shown
              </span>
            </div>

            <div className="pw-heatmap-pop-grid">
            {filteredHoveredCombos.length === 0 ? (
              <p className="pw-heatmap-pop-empty muted small">No itineraries match your search.</p>
            ) : filteredHoveredCombos.map((combo) => {
              const out = itinSummary(combo.outIt); const ret = itinSummary(combo.retIt)
              const outLegKey = legVerificationKey(combo.outIt)
              const retLegKey = legVerificationKey(combo.retIt)
              const existing = lookupVerificationRow(verifications ?? new Map(), routeKey, combo.outIt, combo.retIt)
              const storageKey = existing
                ? vKey(routeKey, existing.outDepTime, existing.retDepTime)
                : combo.comboKey
              return (
                <div
                  key={storageKey}
                  id={pinnedComboKeys.has(combo.comboKey) ? `pw-pop-combo-${combo.comboKey.replace(/[^\w-]/g, '_')}` : undefined}
                  className={`pw-heatmap-pop-combo${existing ? ' pw-heatmap-pop-combo--verified' : ''}`}
                >
                  {/* GF link — clicking navigates to Google Flights */}
                  <a href={combo.gfUrl} target="_blank" rel="noopener noreferrer" className="pw-heatmap-pop-combo-link">
                    <div className="pw-heatmap-pop-total">
                      {existing ? (
                        <div className="pw-heatmap-pop-price-change">
                          <span className="pw-heatmap-pop-price-change-label">SERP → Verified</span>
                          <span className="pw-heatmap-pop-price-change-values">
                            <span className="pw-heatmap-pop-price-was">
                              {formatPriceAmount(
                                existing.cachedPrice != null && existing.cachedPrice > 0
                                  ? existing.cachedPrice
                                  : combo.cacheTotal,
                                currency,
                              )}
                            </span>
                            <span className="pw-heatmap-pop-price-arrow" aria-hidden>→</span>
                            <strong className="pw-heatmap-pop-price-now">
                              {formatPriceAmount(existing.verifiedPrice, currency)}
                            </strong>
                            {(() => {
                              const from = existing.cachedPrice != null && existing.cachedPrice > 0
                                ? existing.cachedPrice
                                : combo.cacheTotal
                              const d = Math.round(existing.verifiedPrice - from)
                              if (d === 0) return null
                              return (
                                <span className={`pw-heatmap-variance-delta${d < 0 ? ' pw-heatmap-variance-delta--down' : ' pw-heatmap-variance-delta--up'}`}>
                                  {d >= 0 ? '+' : ''}{d}
                                </span>
                              )
                            })()}
                          </span>
                          {existing.paxDesc && (
                            <span className="pw-heatmap-pop-price-pax muted small">{existing.paxDesc}</span>
                          )}
                        </div>
                      ) : (
                        <span className="pw-heatmap-pop-price-serp">
                          SERP {formatPriceAmount(combo.cacheTotal, currency)}
                        </span>
                      )}
                      <span className="pw-heatmap-pop-gf-icon">↗</span>
                    </div>
                    <div className="pw-heatmap-pop-legs">
                      <div className="pw-heatmap-pop-leg">
                        <span className="pw-heatmap-pop-leg-label out">Out</span>
                        <span className="pw-heatmap-pop-dur">{outLegKey ? legKeyDepTime(outLegKey).slice(11) : ''} {out.duration}</span>
                        {out.layovers && <span className="pw-heatmap-pop-layover">{out.layovers}</span>}
                        {out.flights && <span className="pw-heatmap-pop-flights">{out.flights}</span>}
                        <span className="pw-heatmap-pop-price">{formatPriceAmount(combo.outPrice, currency)}</span>
                      </div>
                      <div className="pw-heatmap-pop-leg">
                        <span className="pw-heatmap-pop-leg-label ret">Ret</span>
                        <span className="pw-heatmap-pop-dur">{retLegKey ? legKeyDepTime(retLegKey).slice(11) : ''} {ret.duration}</span>
                        {ret.layovers && <span className="pw-heatmap-pop-layover">{ret.layovers}</span>}
                        {ret.flights && <span className="pw-heatmap-pop-flights">{ret.flights}</span>}
                        <span className="pw-heatmap-pop-price">{formatPriceAmount(combo.retPrice, currency)}</span>
                      </div>
                    </div>
                  </a>
                  {/* Per-combo verify — stops click propagation so GF link isn't triggered */}
                  {onUpsertVerification && (
                    <div className="pw-heatmap-pop-combo-verify" onClick={e => e.stopPropagation()}>
                      <input
                        type="number"
                        className="input pw-heatmap-pop-verify-mini"
                        placeholder={existing ? String(existing.verifiedPrice) : 'Verified $'}
                        value={comboVerifyInputs[storageKey] ?? ''}
                        onChange={e => setComboVerifyInputs(prev => ({ ...prev, [storageKey]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-tiny"
                        onClick={() => handleSaveComboVerification(combo.outIt, combo.retIt, hoverCell.outDate, hoverCell.retDate, comboVerifyInputs[storageKey] ?? '', combo.cacheTotal)}
                      >
                        {existing ? 'Update' : '✓ Save'}
                      </button>
                      {existing && onRemoveVerification && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-tiny"
                          onClick={() => void onRemoveVerification(routeKey, outLegKey, retLegKey)}
                        >×</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          </div>
          )
        })()}

      </div>
    </details>
  )
}
