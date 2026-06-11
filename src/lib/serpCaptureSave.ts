import type { SerpCaptureDownloadPayload } from './serpDebugExport'
import { buildSerpDownloadPayload, type SerpSearchDebugBundle } from './serpDebugExport'

export type SerpCaptureSummaryFields = {
  searchGoal: 'discovery' | 'priceWindow'
  origins: string[]
  destinations: string[]
  outboundDate: string
  outboundEnd: string
  returnDate: string | null
  returnEnd: string | null
}

export function serpCaptureSummaryJson(fields: SerpCaptureSummaryFields): string {
  return JSON.stringify(fields)
}

/** Build download payload + summary for persisting Serp debug bundles to SQLite. */
export function buildSerpCapturePersistPayload(opts: {
  summary: SerpCaptureSummaryFields
  outbound: SerpSearchDebugBundle | null
  return: SerpSearchDebugBundle | null
  roundTrip?: SerpSearchDebugBundle | null
}): { summary: SerpCaptureSummaryFields; data: SerpCaptureDownloadPayload } {
  return {
    summary: opts.summary,
    data: buildSerpDownloadPayload({
      outbound: opts.outbound,
      return: opts.return,
      roundTrip: opts.roundTrip,
    }),
  }
}
