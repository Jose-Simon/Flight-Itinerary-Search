import type { SortMode } from './filters'

/** Map max segment count to SerpApi `stops` (coarse upper bound). */
export function stopsParamForMaxSegments(maxSeg: number): string {
  if (maxSeg <= 1) return '1'
  if (maxSeg === 2) return '2'
  if (maxSeg === 3) return '3'
  return '0'
}

export type SerpSearchParams = Record<string, string | number | boolean>

/** SerpApi `sort_by`: 2 = price, 5 = duration (see google-flights-api docs). */
export function serpSortByForClientSort(sort: SortMode): number {
  return sort === 'price' ? 2 : 5
}

export function buildSerpFlightParams(opts: {
  departureId: string
  arrivalId: string
  outboundDate: string
  maxSegments: number
  maxTotalHours: number | null
  showHidden: boolean
  deepSearch: boolean
  gl: string
  hl: string
  currency: string
  sort: SortMode
}): SerpSearchParams {
  const p: SerpSearchParams = {
    type: 2,
    departure_id: opts.departureId,
    arrival_id: opts.arrivalId,
    outbound_date: opts.outboundDate,
    stops: stopsParamForMaxSegments(opts.maxSegments),
    show_hidden: opts.showHidden,
    deep_search: opts.deepSearch,
    gl: opts.gl,
    hl: opts.hl,
    currency: opts.currency,
    sort_by: serpSortByForClientSort(opts.sort),
  }
  if (opts.maxTotalHours != null) {
    p.max_duration = Math.round(opts.maxTotalHours * 60)
  }
  return p
}
