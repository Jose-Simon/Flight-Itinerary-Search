export type HashParts = {
  direction: 'outbound' | 'return'
  origins: string[]
  destinations: string[]
  centerDate: string
  flexDays: number
  maxSegments: number
  mockMode: boolean
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
  return parts.join('|')
}
