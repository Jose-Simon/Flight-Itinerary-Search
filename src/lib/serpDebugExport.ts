import type { SerpFlightOption, SerpGoogleFlightsResponse } from './serpapiTypes'
import type { SerpSearchParams } from './serpParams'
import { collectAllSerpOptions } from './normalizeFlight'

export type SerpSearchDebugQuery = {
  outboundDate: string
  requestParams: SerpSearchParams
  /** Full SerpApi JSON body for this request (same as browser would see from the proxy). */
  response: SerpGoogleFlightsResponse
}

export type SerpSearchDebugBundle = {
  direction: 'outbound' | 'return'
  queries: SerpSearchDebugQuery[]
}

/** Connection hubs from segment arrivals (authoritative for geography). */
export function connectionHubsFromSerpOption(opt: SerpFlightOption): string[] {
  const flights = opt.flights ?? []
  const hubs: string[] = []
  for (let i = 0; i < flights.length - 1; i++) {
    const id = flights[i]?.arrival_airport?.id?.trim().toUpperCase()
    if (id) hubs.push(id)
  }
  return hubs
}

export function layoverIdsFromSerpOption(opt: SerpFlightOption): string[] {
  return (opt.layovers ?? [])
    .map((l) => l.id?.trim().toUpperCase())
    .filter((x): x is string => Boolean(x))
}

export type SerpOptionAnalysisRow = {
  date: string
  poolIndex: number
  price?: number
  totalDurationMinutes?: number
  flightPath: string
  hubsFromSegments: string[]
  layoverIdsFromApi: string[]
  layoverCountMismatch: boolean
}

export type SerpAnalysisSummary = {
  exportedAt: string
  notes: string
  totals: {
    queries: number
    rawOptionCards: number
    optionsWithLayoverCountMismatch: number
  }
  /** One row per option card (can be large). */
  options: SerpOptionAnalysisRow[]
}

export function buildSerpAnalysisSummary(bundle: SerpSearchDebugBundle): SerpAnalysisSummary {
  const options: SerpOptionAnalysisRow[] = []
  let rawOptionCards = 0
  let optionsWithLayoverCountMismatch = 0

  for (const q of bundle.queries) {
    const opts = collectAllSerpOptions(q.response)
    rawOptionCards += opts.length
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i]!
      const flights = o.flights ?? []
      const path = flights.map((f) => `${f.departure_airport?.id ?? '?'}→${f.arrival_airport?.id ?? '?'}`).join(' | ')
      const hubsFromSegments = connectionHubsFromSerpOption(o)
      const layoverIdsFromApi = layoverIdsFromSerpOption(o)
      const expectedLayoverRows = Math.max(0, flights.length - 1)
      const mismatch =
        layoverIdsFromApi.length !== expectedLayoverRows ||
        (expectedLayoverRows > 0 && layoverIdsFromApi.length === 0)
      if (mismatch) optionsWithLayoverCountMismatch++

      options.push({
        date: q.outboundDate,
        poolIndex: i,
        price: o.price,
        totalDurationMinutes: o.total_duration,
        flightPath: path,
        hubsFromSegments,
        layoverIdsFromApi,
        layoverCountMismatch: mismatch,
      })
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    notes:
      'hubsFromSegments = arrival airport of each leg except the final (matches app whitelist). layoverIdsFromApi = Serp layover[].id — often incomplete vs flights.',
    totals: {
      queries: bundle.queries.length,
      rawOptionCards,
      optionsWithLayoverCountMismatch,
    },
    options,
  }
}

/** Full download payload: raw responses + compact analysis (for offline debugging). */
export function buildSerpDownloadPayload(bundles: { outbound: SerpSearchDebugBundle | null; return: SerpSearchDebugBundle | null }) {
  return {
    exportedAt: new Date().toISOString(),
    outbound: bundles.outbound
      ? {
          direction: bundles.outbound.direction,
          queries: bundles.outbound.queries.map((q) => ({
            outboundDate: q.outboundDate,
            requestParams: q.requestParams,
            response: q.response,
          })),
          analysis: buildSerpAnalysisSummary(bundles.outbound),
        }
      : null,
    return: bundles.return
      ? {
          direction: bundles.return.direction,
          queries: bundles.return.queries.map((q) => ({
            outboundDate: q.outboundDate,
            requestParams: q.requestParams,
            response: q.response,
          })),
          analysis: buildSerpAnalysisSummary(bundles.return),
        }
      : null,
  }
}

export type SerpCaptureDownloadPayload = ReturnType<typeof buildSerpDownloadPayload>

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
