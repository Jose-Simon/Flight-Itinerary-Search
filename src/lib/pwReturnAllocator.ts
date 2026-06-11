import { makeRouteGroupKey } from './routeGrouping'
import { passesRtOutboundLegFilter, type RtLegFilterOpts } from './rtFilterPool'
import { roundTripPairCellKey, type RoundTripPairDeepenState, type RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'
import { splitReturnBudget } from './pwSearchTranche'

export type ReturnFetchJob = {
  outDate: string
  retDate: string
  rankedIndex: number
}

export type RouteOutboundCombo = {
  routeKey: string
  outDate: string
  minPrice: number
}

const TIER12_TOP_COMBOS = 5

function comboKey(routeKey: string, outDate: string): string {
  return `${routeKey}|${outDate}`
}

function jobKey(outDate: string, retDate: string, rankedIndex: number): string {
  return `${outDate}|${retDate}|${rankedIndex}`
}

/**
 * Find the first ranked index for `routeKey` that passes the outbound filter.
 * `maxIndex` bounds the search to the filter-passing prefix of the ranked list
 * (positions 0..filteredRankedCount-1 after filter-first reorder). Defaults to
 * searching the full ranked array for legacy states without filteredRankedCount.
 */
function rankedIndexForRoute(
  state: RoundTripPairDeepenState,
  routeKey: string,
  opts: RtLegFilterOpts,
  maxIndex?: number,
): number | null {
  const limit = maxIndex ?? state.ranked.length
  for (let i = 0; i < limit; i++) {
    const { it } = state.ranked[i]!
    if (makeRouteGroupKey(it) !== routeKey) continue
    if (!passesRtOutboundLegFilter(it, opts)) continue
    return i
  }
  return null
}

/**
 * True if a confirmed return combo exists for the specific (routeKey, outDate, retDate) pair.
 * Unlike the previous route-level check, this prevents tiers 2/3 from skipping a retDate
 * just because another retDate on the same route already has a return.
 */
function hasReturnForDatePair(
  combos: RoundTripCombo[],
  routeKey: string,
  outDate: string,
  retDate: string,
): boolean {
  return combos.some((c) => c.outDate === outDate && c.retDate === retDate && c.routeKey === routeKey)
}

/** Uses pairMeta route keys (not every ranked row) so job planning stays fast on large caches. */
function buildRouteCombos(
  states: RoundTripPairDeepenState[],
  pairMeta: RoundTripPairMeta[],
  opts: RtLegFilterOpts,
): RouteOutboundCombo[] {
  const byKey = new Map<string, RouteOutboundCombo>()
  const deepenByCell = new Map(
    states.map((s) => [roundTripPairCellKey(s.outDate, s.retDate), s]),
  )
  for (const meta of pairMeta) {
    const state = deepenByCell.get(roundTripPairCellKey(meta.outDate, meta.retDate))
    if (!state) continue
    // Bound search to filter-passing prefix so we never plan jobs beyond it.
    const maxIndex = state.filteredRankedCount
    for (const [routeKey, price] of Object.entries(meta.initialMinByRoute)) {
      if (price == null || !Number.isFinite(price) || price <= 0) continue
      if (rankedIndexForRoute(state, routeKey, opts, maxIndex) == null) continue
      const k = comboKey(routeKey, meta.outDate)
      const prev = byKey.get(k)
      if (!prev || price < prev.minPrice) {
        byKey.set(k, { routeKey, outDate: meta.outDate, minPrice: price })
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.minPrice - b.minPrice)
}

function returnDatesForRoute(
  states: RoundTripPairDeepenState[],
  pairMetaByCell: Map<string, RoundTripPairMeta>,
  routeKey: string,
  outDate: string,
  opts: RtLegFilterOpts,
): { retDate: string; minPrice: number }[] {
  const rows: { retDate: string; minPrice: number }[] = []
  for (const s of states) {
    if (s.outDate !== outDate) continue
    // Bound search to filter-passing prefix.
    const idx = rankedIndexForRoute(s, routeKey, opts, s.filteredRankedCount)
    if (idx == null) continue
    const meta = pairMetaByCell.get(roundTripPairCellKey(s.outDate, s.retDate))
    const p = meta?.initialMinByRoute[routeKey] ?? meta?.globalInitialMin ?? s.ranked[idx]!.it.price
    if (p == null || !Number.isFinite(p) || p <= 0) continue
    rows.push({ retDate: s.retDate, minPrice: p })
  }
  rows.sort((a, b) => a.minPrice - b.minPrice)
  return rows
}

function pickReturnDates(
  candidates: { retDate: string; minPrice: number }[],
  count: number,
  used: Set<string>,
  routeOutKey: string,
  random: boolean,
): string[] {
  const out: string[] = []
  const pool = candidates.filter((c) => !used.has(`${routeOutKey}|${c.retDate}`))
  const ordered = random
    ? [...pool].sort(() => Math.random() - 0.5)
    : pool
  for (const c of ordered) {
    if (out.length >= count) break
    used.add(`${routeOutKey}|${c.retDate}`)
    out.push(c.retDate)
  }
  return out
}

function appendJobsForTier(
  jobs: ReturnFetchJob[],
  seen: Set<string>,
  states: RoundTripPairDeepenState[],
  pairMetaByCell: Map<string, RoundTripPairMeta>,
  combos: RoundTripCombo[],
  combosList: RouteOutboundCombo[],
  opts: RtLegFilterOpts,
  maxCalls: number,
  datesPerCombo: number,
  emptyOnly: boolean,
  randomDates: boolean,
): number {
  let spent = 0
  let comboIdx = 0
  const usedDates = new Set<string>()

  while (spent < maxCalls && comboIdx < combosList.length) {
    const combo = combosList[comboIdx]!
    comboIdx++
    // emptyOnly gate is now checked per retDate below (hasReturnForDatePair) so we can
    // still schedule return fetches for uncovered dates on a route that has some combos.

    const retCandidates = returnDatesForRoute(
      states,
      pairMetaByCell,
      combo.routeKey,
      combo.outDate,
      opts,
    )
    const routeOutKey = comboKey(combo.routeKey, combo.outDate)
    const dates = pickReturnDates(
      retCandidates,
      datesPerCombo,
      usedDates,
      routeOutKey,
      randomDates,
    )

    for (const retDate of dates) {
      if (spent >= maxCalls) break
      // Per-date emptyOnly check: skip if this specific (route, outDate, retDate) already has a return.
      // This correctly handles routes that have partial coverage (some retDates done, others not).
      if (emptyOnly && hasReturnForDatePair(combos, combo.routeKey, combo.outDate, retDate)) continue
      const state = states.find((s) => s.outDate === combo.outDate && s.retDate === retDate)
      if (!state) continue
      const idx = rankedIndexForRoute(state, combo.routeKey, opts, state.filteredRankedCount)
      if (idx == null) continue
      const k = jobKey(combo.outDate, retDate, idx)
      if (seen.has(k)) continue
      seen.add(k)
      jobs.push({ outDate: combo.outDate, retDate, rankedIndex: idx })
      spent++
    }
  }
  return spent
}

/**
 * Build targeted departure_token fetch jobs (50-25-25 split of `budget`).
 * Filters apply to outbound route candidates; return dates need a token on that pair.
 *
 * With filter-first reorder applied before calling this function:
 * - `routeCombos` contains only filter-passing routes at small ranked indices (0, 1, 2…)
 * - `tier1PerCombo` is dynamic: if there are fewer filter-passing route combos than
 *   TIER12_TOP_COMBOS, the full tier1 budget is shared evenly across those few combos
 *   so no budget is wasted on the fixed divisor.
 */
export function buildReturnFetchJobs(
  states: RoundTripPairDeepenState[],
  pairMeta: RoundTripPairMeta[],
  combos: RoundTripCombo[],
  opts: RtLegFilterOpts,
  budget: number,
): ReturnFetchJob[] {
  if (budget <= 0 || states.length === 0) return []

  const { tier1Calls, tier2Calls, tier3Calls } = splitReturnBudget(budget)
  const pairMetaByCell = new Map(pairMeta.map((m) => [roundTripPairCellKey(m.outDate, m.retDate), m]))
  const routeCombos = buildRouteCombos(states, pairMeta, opts)
  const jobs: ReturnFetchJob[] = []
  const seen = new Set<string>()

  // Dynamic tier1PerCombo: when fewer route combos pass the filter than TIER12_TOP_COMBOS,
  // distribute the full tier1 budget across those combos (Infinity means no per-combo cap,
  // so each combo gets as many return dates as available). This prevents wasting tier1 budget
  // when filters are restrictive (e.g. Qatar-only = 2 combos vs the hard-coded 5).
  const tier1PerCombo =
    routeCombos.length > 0 && routeCombos.length <= TIER12_TOP_COMBOS
      ? Infinity
      : Math.max(1, Math.floor(tier1Calls / TIER12_TOP_COMBOS))
  appendJobsForTier(
    jobs,
    seen,
    states,
    pairMetaByCell,
    combos,
    routeCombos,
    opts,
    tier1Calls,
    tier1PerCombo === Infinity ? Number.MAX_SAFE_INTEGER : tier1PerCombo,
    false,
    false,
  )

  const tier2PerCombo = Math.max(1, Math.floor(tier2Calls / TIER12_TOP_COMBOS))
  appendJobsForTier(
    jobs,
    seen,
    states,
    pairMetaByCell,
    combos,
    routeCombos,
    opts,
    tier2Calls,
    tier2PerCombo,
    true,
    true,
  )

  const tier3PerCombo = 2
  appendJobsForTier(
    jobs,
    seen,
    states,
    pairMetaByCell,
    combos,
    routeCombos,
    opts,
    tier3Calls,
    tier3PerCombo,
    true,
    true,
  )

  return jobs.slice(0, budget)
}
