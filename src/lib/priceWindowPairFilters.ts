/** Pre-search filters that shrink the round-trip date-pair grid (fewer SerpApi calls). */

export type RoundTripDatePair = { outDate: string; retDate: string }

export type PriceWindowPairFilters = {
  tripLengthEnabled: boolean
  tripLengthMin: number
  tripLengthMax: number
  sparseEnabled: boolean
  /** Sample outbound window: 1 = every day, 2 = every other day, etc. */
  outboundStride: number
  returnStride: number
  maxPairsEnabled: boolean
  maxPairs: number
}

export type PairFilterStats = {
  rawPairs: number
  afterSparse: number
  afterTripLength: number
  finalPairs: number
}

export const PW_PAIR_FILTERS_STORAGE_KEY = 'flight-itinerary-discovery-pw-pair-filters'

export const DEFAULT_PRICE_WINDOW_PAIR_FILTERS: PriceWindowPairFilters = {
  tripLengthEnabled: false,
  tripLengthMin: 7,
  tripLengthMax: 21,
  sparseEnabled: false,
  outboundStride: 2,
  returnStride: 2,
  maxPairsEnabled: false,
  maxPairs: 80,
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  let cur = start
  while (cur <= end) {
    dates.push(cur)
    cur = addDays(cur, 1)
  }
  if (dates.length === 0) dates.push(start)
  return dates
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function normalizePriceWindowPairFilters(
  raw: Partial<PriceWindowPairFilters> | null | undefined,
): PriceWindowPairFilters {
  const d = DEFAULT_PRICE_WINDOW_PAIR_FILTERS
  return {
    tripLengthEnabled: raw?.tripLengthEnabled === true,
    tripLengthMin: clampInt(raw?.tripLengthMin ?? d.tripLengthMin, 1, 90),
    tripLengthMax: clampInt(raw?.tripLengthMax ?? d.tripLengthMax, 1, 90),
    sparseEnabled: raw?.sparseEnabled === true,
    outboundStride: clampInt(raw?.outboundStride ?? d.outboundStride, 1, 7),
    returnStride: clampInt(raw?.returnStride ?? d.returnStride, 1, 7),
    maxPairsEnabled: raw?.maxPairsEnabled === true,
    maxPairs: clampInt(raw?.maxPairs ?? d.maxPairs, 1, 500),
  }
}

export function loadPriceWindowPairFilters(): PriceWindowPairFilters {
  try {
    const raw = localStorage.getItem(PW_PAIR_FILTERS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PRICE_WINDOW_PAIR_FILTERS }
    return normalizePriceWindowPairFilters(JSON.parse(raw) as Partial<PriceWindowPairFilters>)
  } catch {
    return { ...DEFAULT_PRICE_WINDOW_PAIR_FILTERS }
  }
}

export function savePriceWindowPairFilters(filters: PriceWindowPairFilters): void {
  localStorage.setItem(PW_PAIR_FILTERS_STORAGE_KEY, JSON.stringify(normalizePriceWindowPairFilters(filters)))
}

/** Calendar days from outbound departure to return departure (minimum 1). */
export function roundTripLengthDays(outDate: string, retDate: string): number {
  const out = new Date(`${outDate}T12:00:00Z`).getTime()
  const ret = new Date(`${retDate}T12:00:00Z`).getTime()
  return Math.max(1, Math.round((ret - out) / 86_400_000))
}

/** Keep window endpoints plus every Nth day (stride 1 = all days). */
export function subsampleDateRange(dates: string[], stride: number): string[] {
  if (stride <= 1 || dates.length <= 2) return dates
  const picked = new Set<string>()
  for (let i = 0; i < dates.length; i++) {
    if (i === 0 || i === dates.length - 1 || i % stride === 0) {
      picked.add(dates[i]!)
    }
  }
  return dates.filter((d) => picked.has(d))
}

export function roundTripDatePairs(
  outStart: string,
  outEnd: string,
  retStart: string,
  retEnd: string,
): RoundTripDatePair[] {
  const pairs: RoundTripDatePair[] = []
  for (const outDate of dateRange(outStart, outEnd)) {
    for (const retDate of dateRange(retStart, retEnd)) {
      if (retDate > outDate) pairs.push({ outDate, retDate })
    }
  }
  return pairs
}

function evenlyCapPairs(pairs: RoundTripDatePair[], max: number): RoundTripDatePair[] {
  if (pairs.length <= max) return pairs
  const out: RoundTripDatePair[] = []
  const seen = new Set<string>()
  for (let i = 0; i < max; i++) {
    const idx = Math.min(pairs.length - 1, Math.round((i * (pairs.length - 1)) / Math.max(1, max - 1)))
    const p = pairs[idx]!
    const k = `${p.outDate}|${p.retDate}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push(p)
    }
  }
  return out.sort(
    (a, b) => a.outDate.localeCompare(b.outDate) || a.retDate.localeCompare(b.retDate),
  )
}

export function applyPriceWindowPairFilters(
  pairs: RoundTripDatePair[],
  filters: PriceWindowPairFilters | null | undefined,
): { pairs: RoundTripDatePair[]; stats: PairFilterStats } {
  const f = normalizePriceWindowPairFilters(filters ?? undefined)
  const rawPairs = pairs.length

  let working = pairs
  const afterSparse = working.length

  if (f.tripLengthEnabled) {
    const min = Math.min(f.tripLengthMin, f.tripLengthMax)
    const max = Math.max(f.tripLengthMin, f.tripLengthMax)
    working = working.filter((p) => {
      const len = roundTripLengthDays(p.outDate, p.retDate)
      return len >= min && len <= max
    })
  }
  const afterTripLength = working.length

  if (f.maxPairsEnabled && working.length > f.maxPairs) {
    working = evenlyCapPairs(working, f.maxPairs)
  }

  return {
    pairs: working,
    stats: {
      rawPairs,
      afterSparse,
      afterTripLength,
      finalPairs: working.length,
    },
  }
}

export function buildFilteredRoundTripDatePairs(
  outStart: string,
  outEnd: string,
  retStart: string,
  retEnd: string,
  filters: PriceWindowPairFilters | null | undefined,
): { pairs: RoundTripDatePair[]; stats: PairFilterStats } {
  const f = normalizePriceWindowPairFilters(filters ?? undefined)
  let outDates = dateRange(outStart, outEnd)
  let retDates = dateRange(retStart, retEnd)

  if (f.sparseEnabled) {
    outDates = subsampleDateRange(outDates, f.outboundStride)
    retDates = subsampleDateRange(retDates, f.returnStride)
  }

  const sparsePairs: RoundTripDatePair[] = []
  for (const outDate of outDates) {
    for (const retDate of retDates) {
      if (retDate > outDate) sparsePairs.push({ outDate, retDate })
    }
  }

  const rawPairs = roundTripDatePairs(outStart, outEnd, retStart, retEnd).length
  const { pairs, stats: inner } = applyPriceWindowPairFilters(sparsePairs, f)

  return {
    pairs,
    stats: {
      rawPairs,
      afterSparse: sparsePairs.length,
      afterTripLength: inner.afterTripLength,
      finalPairs: inner.finalPairs,
    },
  }
}

export function pairFiltersActive(filters: PriceWindowPairFilters | null | undefined): boolean {
  const f = normalizePriceWindowPairFilters(filters ?? undefined)
  return (
    f.tripLengthEnabled ||
    f.sparseEnabled ||
    f.maxPairsEnabled
  )
}

export function formatPairFilterStatsLine(
  stats: PairFilterStats,
  filters: PriceWindowPairFilters | null | undefined,
): string | null {
  if (!pairFiltersActive(filters) || stats.rawPairs === stats.finalPairs) return null
  const f = normalizePriceWindowPairFilters(filters ?? undefined)
  const parts: string[] = [`${stats.finalPairs} of ${stats.rawPairs} date pairs`]
  if (f.sparseEnabled) {
    parts.push(`sparse ${f.outboundStride}×${f.returnStride}`)
  }
  if (f.tripLengthEnabled) {
    const min = Math.min(f.tripLengthMin, f.tripLengthMax)
    const max = Math.max(f.tripLengthMin, f.tripLengthMax)
    parts.push(`trip ${min}–${max} days`)
  }
  if (f.maxPairsEnabled) parts.push(`cap ${f.maxPairs}`)
  return parts.join(' · ')
}

export function validatePairFiltersResult(stats: PairFilterStats): string | null {
  if (stats.rawPairs === 0) return 'No valid date pairs in the selected windows (return must be after outbound).'
  if (stats.finalPairs === 0) {
    return 'No date pairs match your filters. Widen trip length, increase sparse stride, or raise the pair cap.'
  }
  return null
}
