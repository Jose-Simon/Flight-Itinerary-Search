import type { RoundTripPairMeta } from './roundTripPairMeta'

export type PairPriorityInput = {
  outDate: string
  retDate: string
  globalInitialMin: number | null
  /** Min initial price across all routes on this pair. */
  cheapestInitialMin: number | null
  rankedCount: number
  fetchedCount: number
  tripLengthDays: number
}

function cheapestFromMeta(meta: RoundTripPairMeta): number | null {
  const prices = Object.values(meta.initialMinByRoute).filter((p) => p > 0)
  if (!prices.length) return meta.globalInitialMin
  return Math.min(...prices)
}

export function pairPriorityInputFromMeta(meta: RoundTripPairMeta): PairPriorityInput {
  const out = new Date(`${meta.outDate}T12:00:00Z`)
  const ret = new Date(`${meta.retDate}T12:00:00Z`)
  const tripLengthDays = Math.round((ret.getTime() - out.getTime()) / 86_400_000)
  return {
    outDate: meta.outDate,
    retDate: meta.retDate,
    globalInitialMin: meta.globalInitialMin,
    cheapestInitialMin: cheapestFromMeta(meta),
    rankedCount: meta.rankedCount,
    fetchedCount: meta.fetchedCount,
    tripLengthDays: Math.max(1, tripLengthDays),
  }
}

/** Higher score = deepen sooner in Balanced mode. */
export function scoreRoundTripPair(p: PairPriorityInput): number {
  let score = 0
  const price = p.cheapestInitialMin ?? p.globalInitialMin
  if (price != null && price > 0) {
    score += Math.max(0, 8000 - price)
  }
  if (p.rankedCount > p.fetchedCount) score += 40
  const outDow = new Date(`${p.outDate}T12:00:00Z`).getUTCDay()
  const retDow = new Date(`${p.retDate}T12:00:00Z`).getUTCDay()
  if (outDow === 0 || outDow === 6) score += 25
  if (retDow === 0 || retDow === 6) score += 15
  if (p.tripLengthDays >= 7 && p.tripLengthDays <= 21) score += 10
  return score
}

export function sortPairMetaByPriority(metaList: RoundTripPairMeta[]): RoundTripPairMeta[] {
  return [...metaList].sort((a, b) => {
    const sa = scoreRoundTripPair(pairPriorityInputFromMeta(a))
    const sb = scoreRoundTripPair(pairPriorityInputFromMeta(b))
    return sb - sa || a.outDate.localeCompare(b.outDate) || a.retDate.localeCompare(b.retDate)
  })
}
