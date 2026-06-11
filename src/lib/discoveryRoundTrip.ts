import { itineraryScheduleKey } from './filters'
import type { RoundTripCombo } from './roundTripTypes'
import type { NormalizedItinerary } from './types'

/**
 * Build discovery outbound/return lists from true RT combos.
 * Each leg shows the bundled round-trip price (not out+ret one-way sums).
 */
export function discoveryListsFromCombos(combos: RoundTripCombo[]): {
  outbound: NormalizedItinerary[]
  return: NormalizedItinerary[]
} {
  const outMap = new Map<string, NormalizedItinerary>()
  const retMap = new Map<string, NormalizedItinerary>()

  for (const c of combos) {
    const outIt: NormalizedItinerary = { ...c.outIt, price: c.roundTripPrice }
    const retIt: NormalizedItinerary = { ...c.retIt, price: c.roundTripPrice }
    const outKey = itineraryScheduleKey(outIt)
    const retKey = itineraryScheduleKey(retIt)
    const prevOut = outMap.get(outKey)
    if (!prevOut || (outIt.price ?? Infinity) < (prevOut.price ?? Infinity)) {
      outMap.set(outKey, outIt)
    }
    const prevRet = retMap.get(retKey)
    if (!prevRet || (retIt.price ?? Infinity) < (prevRet.price ?? Infinity)) {
      retMap.set(retKey, retIt)
    }
  }

  return { outbound: [...outMap.values()], return: [...retMap.values()] }
}
