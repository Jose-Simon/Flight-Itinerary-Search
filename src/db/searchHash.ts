export type HashParts = {
  direction: 'outbound' | 'return' | 'roundTrip'
  origins: string[]
  destinations: string[]
  centerDate: string
  flexDays: number
  maxSegments: number
  mockMode: boolean
  /** Required when direction is roundTrip (price-window date pair). */
  returnDate?: string
}

/** Cache row identity: route/date hash plus passenger mix (stored in `search_run.pax_desc`). */
export type SearchCacheParts = HashParts & {
  paxDesc: string
}

/** Stable cache key for API-equivalent searches. */
export function computeSearchParamsHash(p: HashParts): string {
  const norm = (xs: string[]) => [...xs].map((x) => x.trim().toUpperCase()).filter(Boolean).sort().join(',')
  const parts = [
    `d:${p.direction}`,
    `o:${norm(p.origins)}`,
    `a:${norm(p.destinations)}`,
    `cd:${p.centerDate}`,
    `f:${p.flexDays}`,
    `m:${p.maxSegments}`,
    `mock:${p.mockMode ? 1 : 0}`,
  ]
  if (p.direction === 'roundTrip' && p.returnDate) {
    parts.push(`rd:${p.returnDate}`)
  }
  return parts.join('|')
}
