import { itineraryScheduleKey } from './filters'
import { passesRtOutboundLegFilter, type RtLegFilterOpts } from './rtFilterPool'
import type { RoundTripPairDeepenState } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'

export type RefreshRunStats = {
  /** Net-new return combo records across all touched pairs (any route). */
  newReturnCombos: number
  /** New ranked outbound entries found during pair scans for previously-empty pairs. */
  newOutboundItineraries: number
  /** New return combos whose outbound itinerary passes the active filter. */
  filteredNewReturn: number
  /** New filter-passing ranked outbound entries from pair scans. */
  filteredNewOutbound: number
  /** Filter-passing combos that existed before at a higher price now (price went down). */
  filteredPriceDown: number
  /** Filter-passing combos that existed before with the same price. */
  filteredPriceSame: number
  /** Filter-passing combos that existed before at a lower price now (price went up). */
  filteredPriceUp: number
  /** Date pairs that had at least one new or updated return combo. */
  pairsRefreshed: number
  /** Date pairs that required a fresh outbound pair scan (no prior deepen state). */
  pairsScanned: number
}

/** key → price before the refresh */
export type ComboSnapshot = Map<string, number>

export function makeComboKey(c: RoundTripCombo): string {
  return `${c.outDate}|${c.retDate}|${c.routeKey}|${itineraryScheduleKey(c.outIt)}|${itineraryScheduleKey(c.retIt)}`
}

/** Snapshot all existing combos keyed by identity → price. */
export function snapshotCombos(combos: RoundTripCombo[]): ComboSnapshot {
  const snap: ComboSnapshot = new Map()
  for (const c of combos) snap.set(makeComboKey(c), c.roundTripPrice)
  return snap
}

export function computeRefreshStats(
  beforeSnap: ComboSnapshot,
  beforeStates: RoundTripPairDeepenState[],
  afterStates: RoundTripPairDeepenState[],
  afterCombos: RoundTripCombo[],
  filterOpts: RtLegFilterOpts,
  pairsScanned: number,
): RefreshRunStats {
  // Map outDate|retDate → ranked count before refresh (0 for pairs that didn't exist)
  const beforeRankedByPair = new Map<string, number>()
  for (const s of beforeStates) {
    beforeRankedByPair.set(`${s.outDate}|${s.retDate}`, s.ranked.length)
  }

  // New outbound itineraries = ranked entries in pairs that were previously empty (pair scan result)
  let newOutboundItineraries = 0
  let filteredNewOutbound = 0
  for (const s of afterStates) {
    const wasEmpty = (beforeRankedByPair.get(`${s.outDate}|${s.retDate}`) ?? 0) === 0
    if (wasEmpty && s.ranked.length > 0) {
      newOutboundItineraries += s.ranked.length
      filteredNewOutbound += s.ranked.filter((r) =>
        passesRtOutboundLegFilter(r.it, filterOpts),
      ).length
    }
  }

  // Return combo stats: diff after vs before snapshot
  let newReturnCombos = 0
  let filteredNewReturn = 0
  let filteredPriceUp = 0
  let filteredPriceSame = 0
  let filteredPriceDown = 0
  const touchedPairs = new Set<string>()

  for (const c of afterCombos) {
    const key = makeComboKey(c)
    const beforePrice = beforeSnap.get(key)
    const filterPassing = passesRtOutboundLegFilter(c.outIt, filterOpts)

    if (beforePrice === undefined) {
      // Combo is new (not in snapshot)
      newReturnCombos++
      if (filterPassing) filteredNewReturn++
      touchedPairs.add(`${c.outDate}|${c.retDate}`)
    } else {
      // Combo existed before — track price deltas for filter-passing ones
      if (filterPassing) {
        if (c.roundTripPrice > beforePrice) filteredPriceUp++
        else if (c.roundTripPrice < beforePrice) filteredPriceDown++
        else filteredPriceSame++
        touchedPairs.add(`${c.outDate}|${c.retDate}`)
      }
    }
  }

  return {
    newReturnCombos,
    newOutboundItineraries,
    filteredNewReturn,
    filteredNewOutbound,
    filteredPriceUp,
    filteredPriceSame,
    filteredPriceDown,
    pairsRefreshed: touchedPairs.size,
    pairsScanned,
  }
}
