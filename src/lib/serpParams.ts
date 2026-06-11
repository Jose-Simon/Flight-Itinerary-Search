import type { SortMode } from './filters'

/** SerpApi `travel_class`: 1=Economy, 2=Premium Economy, 3=Business, 4=First */
export type CabinClass = 1 | 2 | 3 | 4

export const CABIN_CLASS_LABELS: Record<CabinClass, string> = {
  1: 'Economy',
  2: 'Premium Economy',
  3: 'Business',
  4: 'First',
}

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

/** Valid 2-char IATA codes for SerpApi `include_airlines`. */
export function sanitizeIncludeAirlinesIata(codes: string[] | undefined): string[] {
  if (!codes?.length) return []
  return [
    ...new Set(
      codes
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z][A-Z0-9]$/.test(c)),
    ),
  ]
}

function applyIncludeAirlines(p: SerpSearchParams, codes: string[] | undefined): void {
  const iata = sanitizeIncludeAirlinesIata(codes)
  if (iata.length) p.include_airlines = iata.join(',')
}

/** Human-readable `include_airlines` value sent to SerpApi (sorted IATA join). */
export function formatIncludeAirlinesParam(codes: string[] | undefined): string | null {
  const iata = sanitizeIncludeAirlinesIata(codes)
  return iata.length ? iata.join(',') : null
}

/**
 * Targeted-airline runs must send `include_airlines` on every call — fail fast if missing or wrong.
 */
export function assertIncludeAirlinesParam(
  params: SerpSearchParams,
  expected: string[] | undefined,
): void {
  const want = formatIncludeAirlinesParam(expected)
  if (!want) return
  const got = params.include_airlines
  if (typeof got !== 'string' || got !== want) {
    throw new Error(
      `SerpApi call must include include_airlines=${want} (got ${got == null ? 'none' : String(got)})`,
    )
  }
}

function serpBaseParams(opts: {
  departureId: string
  arrivalId: string
  maxSegments: number
  maxTotalHours: number | null
  showHidden: boolean
  deepSearch: boolean
  gl: string
  hl: string
  currency: string
  sort: SortMode
  adults: number
  children: number
  /** Cabin class: 1=Economy (default), 2=Premium Economy, 3=Business, 4=First */
  cabinClass?: number
  /** IATA airline codes to restrict results to (e.g. ['QR']). Maps to `include_airlines`. */
  includeAirlines?: string[]
}): SerpSearchParams {
  const p: SerpSearchParams = {
    departure_id: opts.departureId,
    arrival_id: opts.arrivalId,
    stops: stopsParamForMaxSegments(opts.maxSegments),
    show_hidden: opts.showHidden,
    deep_search: opts.deepSearch,
    gl: opts.gl,
    hl: opts.hl,
    currency: opts.currency,
    sort_by: serpSortByForClientSort(opts.sort),
    adults: Math.max(1, opts.adults),
  }
  if (opts.children > 0) p.children = opts.children
  if (opts.cabinClass != null && opts.cabinClass !== 1) p.travel_class = opts.cabinClass
  if (opts.maxTotalHours != null) {
    p.max_duration = Math.round(opts.maxTotalHours * 60)
  }
  applyIncludeAirlines(p, opts.includeAirlines)
  return p
}

/** SerpApi one-way search (`type: 2`). */
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
  adults: number
  children: number
  cabinClass?: number
  includeAirlines?: string[]
}): SerpSearchParams {
  return {
    ...serpBaseParams(opts),
    type: 2,
    outbound_date: opts.outboundDate,
  }
}

/** SerpApi round-trip search (`type: 1`) for a fixed outbound + return date pair. */
export function buildSerpRoundTripParams(opts: {
  departureId: string
  arrivalId: string
  outboundDate: string
  returnDate: string
  maxSegments: number
  maxTotalHours: number | null
  showHidden: boolean
  deepSearch: boolean
  gl: string
  hl: string
  currency: string
  sort: SortMode
  adults: number
  children: number
  cabinClass?: number
  includeAirlines?: string[]
}): SerpSearchParams {
  return {
    ...serpBaseParams(opts),
    type: 1,
    outbound_date: opts.outboundDate,
    return_date: opts.returnDate,
  }
}

/** Follow-up request after selecting an outbound card (returns return-leg options). */
export function buildSerpDepartureTokenParams(opts: {
  departureToken: string
  departureId: string
  arrivalId: string
  outboundDate: string
  returnDate: string
  gl: string
  hl: string
  currency: string
  adults: number
  children: number
  cabinClass?: number
  /** Same as pair-scan calls — passed on every targeted-airline token fetch. */
  includeAirlines?: string[]
}): SerpSearchParams {
  const p: SerpSearchParams = {
    type: 1,
    departure_id: opts.departureId,
    arrival_id: opts.arrivalId,
    outbound_date: opts.outboundDate,
    return_date: opts.returnDate,
    departure_token: opts.departureToken,
    gl: opts.gl,
    hl: opts.hl,
    currency: opts.currency,
    adults: Math.max(1, opts.adults),
  }
  if (opts.children > 0) p.children = opts.children
  if (opts.cabinClass != null && opts.cabinClass !== 1) p.travel_class = opts.cabinClass
  applyIncludeAirlines(p, opts.includeAirlines)
  return p
}
