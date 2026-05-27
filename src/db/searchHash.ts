export type HashParts = {
  direction: 'outbound' | 'return'
  origins: string[]
  destinations: string[]
  centerDate: string
  flexDays: number
  maxSegments: number
  mockMode: boolean
  /** SerpApi-shaping options that change results */
  deepSearch: boolean
  showHidden: boolean
  gl: string
  hl: string
  currency: string
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
    `ds:${p.deepSearch ? 1 : 0}`,
    `sh:${p.showHidden ? 1 : 0}`,
    `gl:${p.gl}`,
    `hl:${p.hl}`,
    `cu:${p.currency}`,
  ]
  return parts.join('|')
}
