import type { SerpGoogleFlightsResponse } from '../lib/serpapiTypes'
import { buildSerpFlightParams, type SerpSearchParams } from '../lib/serpParams'
import { mergePerDateUnique, processSerpResponse } from '../lib/pipeline'
import type { NormalizedItinerary } from '../lib/types'
import { dedupeByScheduleKey, sortItineraries, type SortMode } from '../lib/filters'
import { collectAllSerpOptions } from '../lib/normalizeFlight'
import type { SerpSearchDebugBundle, SerpSearchDebugQuery } from '../lib/serpDebugExport'
import sampleOutbound from '../mocks/sampleSearch.json'
import sampleReturn from '../mocks/sampleReturn.json'

export type { SerpSearchDebugBundle, SerpSearchDebugQuery } from '../lib/serpDebugExport'

/** Pass `Infinity` to merge every distinct itinerary from each date’s response (no per-day cap). */
export type SearchFlightInput = {
  origins: string[]
  destinations: string[]
  /** YYYY-MM-DD center */
  centerDate: string
  flexDays: number
  maxSegments: number
  perDateLimit: number
  mockMode: boolean
  apiKey: string
  maxTotalHours: number | null
  showHidden: boolean
  deepSearch: boolean
  gl: string
  hl: string
  currency: string
}

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export function dateWindow(center: string, flex: number): string[] {
  const dates: string[] = []
  for (let d = -flex; d <= flex; d++) dates.push(addDays(center, d))
  return dates
}

/** SerpApi calls in small parallel chunks; preserves date order for debug export. */
async function fetchGoogleFlightsByDates(
  dates: string[],
  dep: string,
  arr: string,
  input: SearchFlightInput,
  sort: SortMode,
): Promise<SerpSearchDebugQuery[]> {
  const queries: SerpSearchDebugQuery[] = []
  for (let i = 0; i < dates.length; i += 3) {
    const chunk = dates.slice(i, i + 3)
    const part = await Promise.all(
      chunk.map(async (outboundDate) => {
        const requestParams = buildSerpFlightParams({
          departureId: dep,
          arrivalId: arr,
          outboundDate,
          maxSegments: input.maxSegments,
          maxTotalHours: input.maxTotalHours,
          showHidden: input.showHidden,
          deepSearch: input.deepSearch,
          gl: input.gl,
          hl: input.hl,
          currency: input.currency,
          sort,
        })
        const response = await fetchSerpGoogleFlights(input.apiKey, requestParams)
        return { outboundDate, requestParams, response }
      }),
    )
    queries.push(...part)
  }
  return queries
}

export async function fetchSerpGoogleFlights(
  apiKey: string,
  params: Record<string, string | number | boolean>,
): Promise<SerpGoogleFlightsResponse> {
  let r: Response
  try {
    r = await fetch('/api/google-flights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, params }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const looksNetwork =
      e instanceof TypeError ||
      (e instanceof Error && e.name === 'NetworkError') ||
      /network|failed to fetch/i.test(msg)
    if (looksNetwork) {
      throw new Error(
        'Could not reach the local API (/api/google-flights). In development run `npm run dev` so both Vite and the Express server (port 8787) are up. If you only run `vite`, or open the app without the proxy, Search will fail with a network error.',
      )
    }
    throw e
  }
  let body: unknown
  try {
    body = await r.json()
  } catch {
    throw new Error('Invalid response from server')
  }
  const obj = body as { error?: string }
  if (!r.ok) throw new Error(obj.error || `Request failed (${r.status})`)
  return body as SerpGoogleFlightsResponse
}

export type SearchDirectionMeta = {
  /** Sum of `best_flights.length + other_flights.length` across every date response (raw option cards). */
  serpOptionRows: number
  /** Rows after merging flex-window dates with per-day cap (schedule-level dedupe). */
  mergedItineraries: number
}

export type SearchDirectionResult = {
  itineraries: NormalizedItinerary[]
  /** Per-date breakdown — same underlying data as itineraries, keyed by date.
   *  Persist these with flexDays=0 so the Price Window DB-load can read them. */
  perDate: PriceWindowPerDateEntry[]
  meta: SearchDirectionMeta
  /** Full per-date SerpApi bodies. Present for API + mock runs (not when loading from SQLite only). */
  serpDebug: SerpSearchDebugBundle
}

export type PriceWindowSearchInput = {
  origins: string[]
  destinations: string[]
  startDate: string
  endDate: string
  maxSegments: number
  mockMode: boolean
  apiKey: string
  maxTotalHours: number | null
  showHidden: boolean
  deepSearch: boolean
  gl: string
  hl: string
  currency: string
}

export type PriceWindowPerDateEntry = {
  date: string
  itineraries: NormalizedItinerary[]
}

export type PriceWindowSearchResult = {
  perDate: PriceWindowPerDateEntry[]
  serpDebug: SerpSearchDebugBundle
}

export function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  let cur = start
  while (cur <= end) {
    dates.push(cur)
    cur = addDays(cur, 1)
  }
  if (dates.length === 0) dates.push(start)
  return dates
}

export async function searchPriceWindow(
  input: PriceWindowSearchInput,
  direction: 'outbound' | 'return',
  ctx: {
    primaryDestination?: string
    multipleDestinations?: boolean
    roundTrip: boolean
    excludedAirports: Set<string>
  },
): Promise<PriceWindowSearchResult> {
  const dep = input.origins.join(',')
  const arr = input.destinations.join(',')
  const dates = dateRange(input.startDate, input.endDate)

  const fetchInput: SearchFlightInput = {
    origins: input.origins,
    destinations: input.destinations,
    centerDate: input.startDate,
    flexDays: 0,
    perDateLimit: Infinity,
    mockMode: input.mockMode,
    apiKey: input.apiKey,
    maxTotalHours: input.maxTotalHours,
    showHidden: input.showHidden,
    deepSearch: input.deepSearch,
    gl: input.gl,
    hl: input.hl,
    currency: input.currency,
    maxSegments: input.maxSegments,
  }

  if (input.mockMode) {
    const resp = (direction === 'return' ? sampleReturn : sampleOutbound) as SerpGoogleFlightsResponse
    const itins = processSerpResponse(resp, { ...ctx, direction }, ctx.excludedAirports, 'price')
    const perDate: PriceWindowPerDateEntry[] = dates.map((date) => ({ date, itineraries: itins }))
    const serpDebug: SerpSearchDebugBundle = {
      direction,
      queries: [
        {
          outboundDate: input.startDate,
          requestParams: { note: 'mock-sample-json' } as SerpSearchParams,
          response: resp,
        },
      ],
    }
    return { perDate, serpDebug }
  }

  // Run price-sorted and duration-sorted queries in parallel.
  // Google returns different airline rankings for each sort mode, so the
  // union captures carriers that appear in one but not the other.
  // Price-sorted results come first in the dedup array so that when the same
  // flight appears in both, the priced version is always kept.
  // A final filter drops any itinerary that still lacks a price (rare SerpApi
  // edge-case when quota is low or the response is partial).
  const [priceQueries, durationQueries] = await Promise.all([
    fetchGoogleFlightsByDates(dates, dep, arr, fetchInput, 'price'),
    fetchGoogleFlightsByDates(dates, dep, arr, fetchInput, 'duration'),
  ])

  for (const q of [...priceQueries, ...durationQueries]) {
    if (q.response.error || q.response.search_metadata?.status === 'Error') {
      throw new Error(q.response.error || 'SerpApi search error')
    }
  }

  const perDate: PriceWindowPerDateEntry[] = dates.map((date, i) => {
    const fromPrice = processSerpResponse(
      priceQueries[i].response,
      { ...ctx, direction },
      ctx.excludedAirports,
      'price',
    )
    const fromDuration = processSerpResponse(
      durationQueries[i].response,
      { ...ctx, direction },
      ctx.excludedAirports,
      'price',
    )
    // Merge: price-sorted first → dedup keeps the priced version for shared flights.
    // Filter afterward to ensure no price-less entry reaches the price window.
    const merged = sortItineraries(
      dedupeByScheduleKey([...fromPrice, ...fromDuration])
        .filter((it) => it.price != null && Number.isFinite(it.price)),
      'price',
    )
    return { date, itineraries: merged }
  })

  return {
    perDate,
    serpDebug: { direction, queries: [...priceQueries, ...durationQueries] },
  }
}

export async function searchDirection(
  input: SearchFlightInput,
  direction: 'outbound' | 'return',
  ctx: {
    primaryDestination?: string
    multipleDestinations?: boolean
    roundTrip: boolean
    excludedAirports: Set<string>
    sort: SortMode
  },
): Promise<SearchDirectionResult> {
  const dep = input.origins.join(',')
  const arr = input.destinations.join(',')
  const dates = dateWindow(input.centerDate, input.flexDays)

  if (input.mockMode) {
    const resp = (direction === 'return' ? sampleReturn : sampleOutbound) as SerpGoogleFlightsResponse
    const serpOptionRows = collectAllSerpOptions(resp).length
    const one = processSerpResponse(resp, { ...ctx, direction }, ctx.excludedAirports, ctx.sort)
    const itineraries = mergePerDateUnique([one], input.perDateLimit, ctx.sort)
    // For mock, replicate same results across all dates in the window
    const perDate: PriceWindowPerDateEntry[] = dates.map((date) => ({ date, itineraries: one }))
    const serpDebug: SerpSearchDebugBundle = {
      direction,
      queries: [
        {
          outboundDate: input.centerDate,
          requestParams: { note: 'mock-sample-json' } as SerpSearchParams,
          response: resp,
        },
      ],
    }
    return {
      itineraries,
      perDate,
      meta: { serpOptionRows, mergedItineraries: itineraries.length },
      serpDebug,
    }
  }

  // Run price-sorted and duration-sorted queries in parallel — same approach as searchPriceWindow.
  // Google returns different airline rankings per sort mode; the union captures routes that appear
  // in only one. Price-sorted results come first in dedup so the priced version wins for shared flights.
  const [priceQueries, durationQueries] = await Promise.all([
    fetchGoogleFlightsByDates(dates, dep, arr, input, 'price'),
    fetchGoogleFlightsByDates(dates, dep, arr, input, 'duration'),
  ])

  let serpOptionRows = 0
  const perDate: PriceWindowPerDateEntry[] = dates.map((date, i) => {
    const pResp = priceQueries[i].response
    const dResp = durationQueries[i].response
    if (pResp.error || pResp.search_metadata?.status === 'Error') {
      throw new Error(pResp.error || 'SerpApi search error')
    }
    if (dResp.error || dResp.search_metadata?.status === 'Error') {
      throw new Error(dResp.error || 'SerpApi search error')
    }
    serpOptionRows += collectAllSerpOptions(pResp).length + collectAllSerpOptions(dResp).length
    const fromPrice = processSerpResponse(pResp, { ...ctx, direction }, ctx.excludedAirports, 'price')
    const fromDuration = processSerpResponse(dResp, { ...ctx, direction }, ctx.excludedAirports, 'price')
    // Union with price-first dedup so shared flights keep their price entry
    const merged = dedupeByScheduleKey([...fromPrice, ...fromDuration])
    return { date, itineraries: merged }
  })

  const itineraries = mergePerDateUnique(
    perDate.map((e) => e.itineraries),
    input.perDateLimit,
    ctx.sort,
  )
  return {
    itineraries,
    perDate,
    meta: { serpOptionRows, mergedItineraries: itineraries.length },
    serpDebug: { direction, queries: [...priceQueries, ...durationQueries] },
  }
}
