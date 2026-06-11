import type { NormalizedItinerary } from './types'

/** One SerpApi round-trip fare: fixed outbound + return dates and bundled price. */
export type RoundTripCombo = {
  outDate: string
  retDate: string
  routeKey: string
  outIt: NormalizedItinerary
  retIt: NormalizedItinerary
  roundTripPrice: number
}

export type StoredRoundTripComboV1 = {
  v: 1
  outDate: string
  retDate: string
  routeKey: string
  roundTripPrice: number
  out: NormalizedItinerary
  ret: NormalizedItinerary
}

export function comboToStored(c: RoundTripCombo): StoredRoundTripComboV1 {
  return {
    v: 1,
    outDate: c.outDate,
    retDate: c.retDate,
    routeKey: c.routeKey,
    roundTripPrice: c.roundTripPrice,
    out: c.outIt,
    ret: c.retIt,
  }
}

export function storedToCombo(s: StoredRoundTripComboV1): RoundTripCombo {
  return {
    outDate: s.outDate,
    retDate: s.retDate,
    routeKey: s.routeKey,
    outIt: s.out,
    retIt: s.ret,
    roundTripPrice: s.roundTripPrice,
  }
}

export function parseStoredCombo(raw: unknown): RoundTripCombo | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v === 1 && o.outDate && o.retDate && o.out && o.ret) {
    return storedToCombo(o as StoredRoundTripComboV1)
  }
  return null
}
