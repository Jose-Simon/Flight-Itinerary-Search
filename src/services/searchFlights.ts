import type { SerpGoogleFlightsResponse } from '../lib/serpapiTypes'
import { buildSerpFlightParams, type SerpSearchParams } from '../lib/serpParams'
import { mergePerDateUnique, processSerpResponse } from '../lib/pipeline'
import type { NormalizedItinerary } from '../lib/types'
import type { SortMode } from '../lib/filters'
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

function dateWindow(center: string, flex: number): string[] {
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
  meta: SearchDirectionMeta
  /** Full per-date SerpApi bodies. Present for API + mock runs (not when loading from SQLite only). */
  serpDebug: SerpSearchDebugBundle
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
      meta: { serpOptionRows, mergedItineraries: itineraries.length },
      serpDebug,
    }
  }

  const queries = await fetchGoogleFlightsByDates(dates, dep, arr, input, ctx.sort)

  let serpOptionRows = 0
  const perDate = queries.map((q) => {
    const resp = q.response
    if (resp.error || resp.search_metadata?.status === 'Error') {
      throw new Error(resp.error || 'SerpApi search error')
    }
    serpOptionRows += collectAllSerpOptions(resp).length
    return processSerpResponse(resp, { ...ctx, direction }, ctx.excludedAirports, ctx.sort)
  })

  const itineraries = mergePerDateUnique(perDate, input.perDateLimit, ctx.sort)
  return {
    itineraries,
    meta: { serpOptionRows, mergedItineraries: itineraries.length },
    serpDebug: { direction, queries },
  }
}
