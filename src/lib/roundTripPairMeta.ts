import { makeRouteGroupKey } from './routeGrouping'
import type { NormalizedItinerary } from './types'

/** Per date-pair expansion state for price-window heatmap (Phase 1). */
export type RoundTripExpansionLevel = 'initial' | 'partial' | 'expanded'

export type RoundTripPairMeta = {
  outDate: string
  retDate: string
  /** Lowest summary RT price on initial Serp response, per route key. */
  initialMinByRoute: Record<string, number>
  /** Min across all routes on initial response. */
  globalInitialMin: number | null
  /**
   * How many ranked outbounds pass the active outbound leg filter.
   * When set, `rankedCount` equals this value so that expansion logic is filter-aware.
   * Undefined for legacy states loaded before filter-first reorder was introduced.
   */
  filteredRankedCount?: number
  rankedCount: number
  fetchedCount: number
}

export function roundTripPairCellKey(outDate: string, retDate: string): string {
  return `${outDate}|${retDate}`
}

export function expansionLevel(meta: Pick<RoundTripPairMeta, 'rankedCount' | 'fetchedCount'>): RoundTripExpansionLevel {
  if (meta.rankedCount <= 0) return 'initial'
  if (meta.fetchedCount <= 0) return 'initial'
  if (meta.fetchedCount >= meta.rankedCount) return 'expanded'
  return 'partial'
}

export function expansionBadgeLabel(meta: Pick<RoundTripPairMeta, 'rankedCount' | 'fetchedCount' | 'filteredRankedCount'>): string {
  const level = expansionLevel(meta)
  if (level === 'initial') return meta.filteredRankedCount != null ? `Initial (${meta.filteredRankedCount} to fetch)` : 'Initial'
  if (level === 'expanded') return 'Expanded'
  const total = meta.filteredRankedCount ?? meta.rankedCount
  return `${meta.fetchedCount}/${total} options`
}

export function initialMinForRoute(meta: RoundTripPairMeta, routeKey: string): number | null {
  const p = meta.initialMinByRoute[routeKey]
  return p != null && p > 0 ? p : null
}

export function buildInitialMinByRoute(
  options: { it: NormalizedItinerary; token?: string }[],
): { initialMinByRoute: Record<string, number>; globalInitialMin: number | null } {
  const initialMinByRoute: Record<string, number> = {}
  let globalInitialMin = Infinity
  for (const { it } of options) {
    const p = it.price
    if (p == null || !Number.isFinite(p) || p <= 0) continue
    const rk = makeRouteGroupKey(it)
    initialMinByRoute[rk] = Math.min(initialMinByRoute[rk] ?? Infinity, p)
    globalInitialMin = Math.min(globalInitialMin, p)
  }
  return {
    initialMinByRoute,
    globalInitialMin: globalInitialMin < Infinity ? globalInitialMin : null,
  }
}

export function pairMetaFromInternal(state: {
  outDate: string
  retDate: string
  ranked: { it: NormalizedItinerary; token: string }[]
  fetchedCount: number
  initialMinByRoute: Record<string, number>
  globalInitialMin: number | null
  filteredRankedCount?: number
}): RoundTripPairMeta {
  return {
    outDate: state.outDate,
    retDate: state.retDate,
    initialMinByRoute: state.initialMinByRoute,
    globalInitialMin: state.globalInitialMin,
    // When filteredRankedCount is set, expose it as rankedCount so expansion logic
    // reflects filter-aware progress (fetchedCount/filteredRankedCount) rather than
    // raw ranked list length (fetchedCount/250).
    rankedCount: state.filteredRankedCount ?? state.ranked.length,
    filteredRankedCount: state.filteredRankedCount,
    fetchedCount: state.fetchedCount,
  }
}

/** Ranked outbounds + tokens for on-demand deepen (rehydrate PairSearchState). */
export type RoundTripPairDeepenState = {
  outDate: string
  retDate: string
  /**
   * Ranked outbound options, price-sorted. After filter-first reorder (applied during
   * initial scan when `rtLegFilterOpts` is set), filter-passing tokens come first
   * at positions 0..filteredRankedCount-1, followed by non-passing options.
   */
  ranked: { it: NormalizedItinerary; token: string }[]
  fetchedCount: number
  combos: import('./roundTripTypes').RoundTripCombo[]
  queries: import('./serpDebugExport').SerpSearchDebugQuery[]
  initialMinByRoute: Record<string, number>
  globalInitialMin: number | null
  /**
   * Count of ranked entries that pass the active outbound leg filter.
   * These occupy positions 0..filteredRankedCount-1 (filter-passing tokens first).
   * Undefined for legacy states loaded before filter-first reorder was introduced.
   */
  filteredRankedCount?: number
  /**
   * Airline-targeted scan: first ranked index where return token fetches begin
   * (preserved non-target prefix sits below this index).
   */
  targetFetchStartIndex?: number
}

export function pairMetaMapFromList(pairs: RoundTripPairMeta[]): Map<string, RoundTripPairMeta> {
  const m = new Map<string, RoundTripPairMeta>()
  for (const p of pairs) m.set(roundTripPairCellKey(p.outDate, p.retDate), p)
  return m
}

/** Union of route keys seen on any scanned date pair (for heatmap route picker). */
export function routeKeysFromPairMeta(pairs: RoundTripPairMeta[]): string[] {
  const minByRoute = new Map<string, number>()
  for (const p of pairs) {
    for (const [rk, price] of Object.entries(p.initialMinByRoute)) {
      if (price > 0) {
        minByRoute.set(rk, Math.min(minByRoute.get(rk) ?? Infinity, price))
      }
    }
  }
  return [...minByRoute.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([rk]) => rk)
}
