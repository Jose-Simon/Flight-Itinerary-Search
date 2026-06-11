/** Passenger counts for SerpApi / cache / display. Extend with infant fields later. */
export type PaxCounts = {
  adults: number
  children: number
}

export const DEFAULT_PAX_COUNTS: PaxCounts = { adults: 1, children: 2 }

/** Canonical cache key fragment, e.g. `1A+2C`. Omits zero counts. */
export function formatPaxDesc(counts: PaxCounts): string {
  const c = clampPaxCounts(counts)
  const parts: string[] = []
  if (c.adults > 0) parts.push(`${c.adults}A`)
  if (c.children > 0) parts.push(`${c.children}C`)
  return parts.join('+') || '1A'
}

export function parsePaxDesc(desc: string): PaxCounts {
  const adults = Number(desc.match(/(\d+)A/i)?.[1] ?? 1)
  const children = Number(desc.match(/(\d+)C/i)?.[1] ?? 0)
  return clampPaxCounts({ adults, children })
}

export function clampPaxCounts(counts: PaxCounts): PaxCounts {
  return {
    adults: Math.max(1, Math.min(9, Math.floor(Number.isFinite(counts.adults) ? counts.adults : 1))),
    children: Math.max(0, Math.min(9, Math.floor(Number.isFinite(counts.children) ? counts.children : 0))),
  }
}

/** Human-readable summary for the search bar, e.g. `1 adult · 2 children · Economy`. */
export function formatPaxSummary(counts: PaxCounts): string {
  const c = clampPaxCounts(counts)
  const parts: string[] = []
  parts.push(`${c.adults} adult${c.adults === 1 ? '' : 's'}`)
  if (c.children > 0) parts.push(`${c.children} child${c.children === 1 ? '' : 'ren'}`)
  parts.push('Economy')
  return parts.join(' · ')
}
