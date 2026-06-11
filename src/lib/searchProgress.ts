import type { RoundTripPairDeepenState } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import type { NormalizedItinerary } from './types'

const TARGET_AIRLINE_NAMES: Record<string, string> = {
  QR: 'Qatar Airways',
  EK: 'Emirates',
  EY: 'Etihad',
  AI: 'Air India',
  BA: 'British Airways',
}

function itineraryMatchesIncludedAirlines(it: NormalizedItinerary, codes: string[]): boolean {
  const targets = new Set(codes.map((c) => c.trim().toUpperCase()))
  for (const s of it.segments) {
    const raw = s.airline?.trim()
    if (!raw) continue
    const upper = raw.toUpperCase()
    if (targets.has(upper)) return true
    for (const code of codes) {
      const name = TARGET_AIRLINE_NAMES[code.toUpperCase()]
      if (name && upper === name.toUpperCase()) return true
    }
  }
  return false
}

/**
 * A human-readable "last event" message emitted while a round-trip price-window
 * search is running.  Shown as a rolling one-liner below the progress text so the
 * user can see exactly what was added or updated most recently.
 */
export type SearchActivityEvent =
  | {
      kind: 'pairScanned'
      outDate: string
      retDate: string
      /** Number of ranked outbound options that pass the active filter. */
      filterPassingCount: number
    }
  | {
      kind: 'returnAdded'
      combo: RoundTripCombo
      currency: string
    }
  | {
      kind: 'returnUpdated'
      combo: RoundTripCombo
      oldPrice: number
      currency: string
    }

/** Format an (outDate, retDate) pair as "Jul 6 → Aug 27". */
export function formatDatePairShort(outDate: string, retDate: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso + 'T12:00:00Z')
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return `${fmt(outDate)} → ${fmt(retDate)}`
}

/**
 * Extract a compact route label from a combo's outbound itinerary:
 * waypointKey "JFK-DOH-MAA" + airlines ["QR"] → "JFK→DOH→MAA (QR)"
 */
function formatActivityRoute(combo: RoundTripCombo): string {
  const waypoints = combo.outIt.waypointKey.replace(/-/g, '→')
  const airlines = combo.outIt.airlines.join('/')
  return airlines ? `${waypoints} (${airlines})` : waypoints
}

function fmtPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

/** Format a SearchActivityEvent into a compact single-line string for display. */
export function formatActivityEvent(event: SearchActivityEvent): string {
  switch (event.kind) {
    case 'pairScanned': {
      const pair = formatDatePairShort(event.outDate, event.retDate)
      return `Scanned ${pair} · ${event.filterPassingCount} outbound option${event.filterPassingCount === 1 ? '' : 's'} found`
    }
    case 'returnAdded': {
      const pair = formatDatePairShort(event.combo.outDate, event.combo.retDate)
      const route = formatActivityRoute(event.combo)
      const price = fmtPrice(event.combo.roundTripPrice, event.currency)
      return `${pair} · ${route} · ${price}`
    }
    case 'returnUpdated': {
      const pair = formatDatePairShort(event.combo.outDate, event.combo.retDate)
      const route = formatActivityRoute(event.combo)
      const oldPrice = fmtPrice(event.oldPrice, event.currency)
      const newPrice = fmtPrice(event.combo.roundTripPrice, event.currency)
      const arrow = event.combo.roundTripPrice < event.oldPrice ? '↓' : '↑'
      return `${pair} · ${route} · ${oldPrice} ${arrow} ${newPrice}`
    }
  }
}

export type SearchProgressPhase =
  | 'roundTrip'
  | 'pairScan'
  | 'returnFetch'
  | 'oneWayOutbound'
  | 'oneWayReturn'
  | 'outbound'
  | 'return'

export type SearchProgressState = {
  phase: SearchProgressPhase
  current: number
  total: number
  /** Active date pair when phase is roundTrip (YYYY-MM-DD → YYYY-MM-DD). */
  datePair?: string
  /** Return-option fetches for the current pair (departure_token follow-ups). */
  subCurrent?: number
  subTotal?: number
  /** Live SerpApi usage for the current hour (updated as calls complete). */
  hourUsed?: number
  hourLimit?: number
  sessionCalls?: number
  clickReserve?: number
  clickReserveRemaining?: number
  remainingForAutoDeepen?: number
  /**
   * When set (refresh runs only), `sessionCalls / estimatedTotalCalls` replaces
   * the phase-specific pair counter as the primary progress indicator.
   */
  estimatedTotalCalls?: number
  /** IATA codes sent as SerpApi `include_airlines` on every call (filtered-airlines scan). */
  includeAirlines?: string[]
  /** Absolute ranked[] index of the outbound row just token-fetched (airline scan). */
  fetchedRankedIndex?: number
  /** First ranked index of target-airline return fetches (after preserved non-target prefix). */
  targetFetchStartIndex?: number
  /**
   * Rolling count of raw flight options received from SerpApi calls so far.
   * Set during discovery `outbound` / `return` phases; absent for price-window phases.
   */
  itinerariesFound?: number
  /**
   * Rolling count of those options that carry a `departure_token`.
   * Non-zero only when the options come from a round-trip discovery outbound search.
   */
  withToken?: number
}

/** Parse `YYYY-MM-DD → YYYY-MM-DD` from progress `datePair`. */
function parseProgressDatePair(datePair: string): { outDate: string; retDate: string } | null {
  const m = datePair.match(/^(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})/)
  if (!m) return null
  return { outDate: m[1]!, retDate: m[2]! }
}

/**
 * Outbound route label for the token most recently fetched in return-fetch phase
 * (e.g. `JFK→DOH→MAA (QR)`). Shown inline on the progress line.
 */
export function formatReturnFetchTokenNote(
  p: SearchProgressState,
  states: RoundTripPairDeepenState[],
): string | null {
  if (p.phase !== 'returnFetch' || !p.datePair || p.subCurrent == null || p.subCurrent <= 0) {
    return null
  }
  const dates = parseProgressDatePair(p.datePair)
  if (!dates) return null
  const state = states.find((s) => s.outDate === dates.outDate && s.retDate === dates.retDate)
  if (!state?.ranked.length) return null

  const fetchStart = p.targetFetchStartIndex ?? state.targetFetchStartIndex ?? 0
  const fetchEnd = state.filteredRankedCount ?? state.ranked.length

  // Airline scan: use explicit ranked index from progress (never the preserved prefix).
  let idx: number
  if (p.includeAirlines?.length) {
    if (p.fetchedRankedIndex == null || p.fetchedRankedIndex < fetchStart) return null
    idx = p.fetchedRankedIndex
  } else {
    idx = Math.max(p.subCurrent ?? 0, state.fetchedCount) - 1
    if (idx < fetchStart || idx >= fetchEnd) return null
  }

  if (idx < 0 || idx >= fetchEnd) return null
  const outIt = state.ranked[idx]?.it
  if (!outIt) return null
  if (p.includeAirlines?.length && !itineraryMatchesIncludedAirlines(outIt, p.includeAirlines)) {
    return null
  }
  const waypoints = outIt.waypointKey.replace(/-/g, '→')
  const airlines = outIt.airlines.join('/')
  return airlines ? `${waypoints} (${airlines})` : waypoints
}

/** Compact suffix for live `include_airlines` visibility during filtered-airlines runs. */
export function formatIncludeAirlinesProgressSuffix(p: SearchProgressState): string {
  if (!p.includeAirlines?.length) return ''
  return ` · include_airlines: ${p.includeAirlines.join(',')}`
}

function formatHourSuffix(p: SearchProgressState): string {
  if (p.hourUsed == null || p.hourLimit == null) return ''
  const session =
    p.sessionCalls != null && p.sessionCalls > 0 ? ` (${p.sessionCalls} this search)` : ''
  let s = ` · SerpApi ${p.hourUsed}/${p.hourLimit}${session}`
  if (p.clickReserve != null && p.clickReserve > 0) {
    s += ` · ${p.clickReserveRemaining ?? p.clickReserve} for clicks`
    if (p.remainingForAutoDeepen != null) s += ` · ${p.remainingForAutoDeepen} auto-deepen left`
  }
  return s
}

export function formatSearchProgress(p: SearchProgressState): string {
  const hourSuffix = formatHourSuffix(p)
  const airlineSuffix = formatIncludeAirlinesProgressSuffix(p)
  switch (p.phase) {
    case 'roundTrip': {
      // Legacy phase — kept for compatibility; new code uses pairScan / returnFetch.
      let s = `Date pairs ${p.current}/${p.total}`
      if (p.datePair) s += ` (${p.datePair})`
      if (p.subTotal != null && p.subTotal > 0) {
        s += ` · return options ${p.subCurrent ?? 0}/${p.subTotal}`
      }
      return s + airlineSuffix + hourSuffix
    }
    case 'pairScan': {
      // Phase 1: scanning (outDate × retDate) pairs for outbound options.
      let s = `Scanning pair ${p.current}/${p.total}`
      if (p.datePair) s += ` (${p.datePair})`
      if (p.estimatedTotalCalls != null) s += ` · ${p.sessionCalls ?? 0}/${p.estimatedTotalCalls} calls`
      return s + airlineSuffix + hourSuffix
    }
    case 'returnFetch': {
      // Phase 2: fetching return itineraries for filter-passing outbound tokens.
      let s = `Fetching returns ${p.current}/${p.total}`
      if (p.datePair) s += ` · ${p.datePair}`
      if (p.subTotal != null && p.subTotal > 0) {
        s += ` · token ${p.subCurrent ?? 0}/${p.subTotal}`
      }
      if (p.estimatedTotalCalls != null) s += ` · ${p.sessionCalls ?? 0}/${p.estimatedTotalCalls} calls`
      return s + airlineSuffix + hourSuffix
    }
    case 'oneWayOutbound':
      return `Outbound dates ${p.current}/${p.total}${airlineSuffix}${hourSuffix}`
    case 'oneWayReturn':
      return `Return dates ${p.current}/${p.total}${airlineSuffix}${hourSuffix}`
    case 'outbound': {
      let s = `Outbound dates ${p.current}/${p.total}`
      if (p.itinerariesFound != null && p.itinerariesFound > 0)
        s += ` · ${p.itinerariesFound} options`
      if (p.withToken != null && p.withToken > 0)
        s += ` · ${p.withToken} with token`
      return s + airlineSuffix + hourSuffix
    }
    case 'return': {
      let s = `Return dates ${p.current}/${p.total}`
      if (p.itinerariesFound != null && p.itinerariesFound > 0)
        s += ` · ${p.itinerariesFound} options`
      if (p.withToken != null && p.withToken > 0)
        s += ` · ${p.withToken} with token`
      return s + airlineSuffix + hourSuffix
    }
    default:
      return `${p.current}/${p.total}${airlineSuffix}${hourSuffix}`
  }
}
