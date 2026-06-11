import type { SerpSearchDebugQuery } from './serpDebugExport'
import type { RoundTripPairDeepenState, RoundTripPairMeta } from './roundTripPairMeta'
import type { RoundTripCombo } from './roundTripTypes'

/** Full per date-pair RT state for SQLite cache (Phase 4). */
export type StoredRoundTripPairV1 = {
  v: 1
  outDate: string
  retDate: string
  pairMeta: RoundTripPairMeta
  ranked: { it: import('./types').NormalizedItinerary; token: string }[]
  fetchedCount: number
  combos: RoundTripCombo[]
  queries: SerpSearchDebugQuery[]
  initialMinByRoute: Record<string, number>
  globalInitialMin: number | null
  updatedAt: string
}

export function deepenStateToStored(
  state: RoundTripPairDeepenState,
  pairMeta: RoundTripPairMeta,
): StoredRoundTripPairV1 {
  return {
    v: 1,
    outDate: state.outDate,
    retDate: state.retDate,
    pairMeta,
    ranked: state.ranked,
    fetchedCount: state.fetchedCount,
    combos: state.combos,
    queries: state.queries,
    initialMinByRoute: state.initialMinByRoute,
    globalInitialMin: state.globalInitialMin,
    updatedAt: new Date().toISOString(),
  }
}

export function storedToDeepenState(s: StoredRoundTripPairV1): RoundTripPairDeepenState {
  return {
    outDate: s.outDate,
    retDate: s.retDate,
    ranked: s.ranked,
    fetchedCount: s.fetchedCount,
    combos: s.combos,
    queries: s.queries,
    initialMinByRoute: s.initialMinByRoute,
    globalInitialMin: s.globalInitialMin,
  }
}

export function parseStoredRoundTripPair(raw: unknown): StoredRoundTripPairV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as StoredRoundTripPairV1
  if (o.v !== 1 || !o.outDate || !o.retDate || !o.pairMeta) return null
  return o
}
