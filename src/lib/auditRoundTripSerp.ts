import { collectAllSerpOptions } from './normalizeFlight'
import type { SerpFlightOption, SerpGoogleFlightsResponse } from './serpapiTypes'
import type { SerpSearchDebugBundle, SerpSearchDebugQuery } from './serpDebugExport'
import type { SerpSearchParams } from './serpParams'

/** How complete an option is for heatmap vs detail (see Analysis/RT_SERP_AUDIT.md). */
export type RtOptionHeatmapClass =
  | 'A_summary_rt_price'
  | 'B_needs_token_for_return_variants'
  | 'C_incomplete'

export type RtOptionAuditRow = {
  index: number
  heatmapClass: RtOptionHeatmapClass
  price?: number
  type?: string
  hasDepartureToken: boolean
  segmentCount: number
  firstDep?: string
  lastArr?: string
  totalDurationMinutes?: number
}

export type RtResponseAudit = {
  queryKind: 'initial' | 'token_followup' | 'unknown'
  outboundDate?: string
  returnDate?: string
  hasDepartureTokenParam: boolean
  optionCount: number
  withPrice: number
  withDepartureToken: number
  withPriceAndToken: number
  withPriceNoToken: number
  withTokenNoPrice: number
  roundTripTyped: number
  minPricedOption?: number
  maxPricedOption?: number
  priceInsightsLowest?: number
  rows: RtOptionAuditRow[]
}

export type RtPairAudit = {
  outboundDate: string
  returnDate: string
  initial?: RtResponseAudit
  tokenFollowUps: RtResponseAudit[]
  /** Min price on initial outbound cards (no token calls). */
  initialMinPrice?: number
  /** Min price across all token follow-up return options. */
  tokenExpandedMinPrice?: number
  /** tokenExpandedMinPrice - initialMinPrice when both known. */
  priceGapAfterExpand?: number
  tokenFollowUpOptionCount: number
}

export type RoundTripSerpAuditReport = {
  auditedAt: string
  sourceLabel: string
  pairs: RtPairAudit[]
  totals: {
    initialQueries: number
    tokenQueries: number
    initialOptions: number
    tokenFollowUpOptions: number
    pairsWithTokenData: number
    pairsWhereExpandBeatInitial: number
  }
  notes: string[]
}

function isTokenRequest(params: SerpSearchParams): boolean {
  return params.departure_token != null && String(params.departure_token).length > 0
}

function classifyOption(opt: SerpFlightOption): RtOptionHeatmapClass {
  const hasPrice = opt.price != null && Number.isFinite(opt.price) && opt.price > 0
  const hasToken = Boolean(opt.departure_token?.trim())
  const type = (opt as { type?: string }).type?.toLowerCase() ?? ''
  const isRoundTrip = type.includes('round')

  if (!hasPrice || !(opt.flights?.length)) return 'C_incomplete'
  if (isRoundTrip && hasPrice) {
    return hasToken ? 'B_needs_token_for_return_variants' : 'A_summary_rt_price'
  }
  if (hasPrice && !hasToken) return 'A_summary_rt_price'
  if (hasToken) return 'B_needs_token_for_return_variants'
  return 'C_incomplete'
}

function auditOneResponse(
  resp: SerpGoogleFlightsResponse,
  meta: { queryKind: RtResponseAudit['queryKind']; outboundDate?: string; returnDate?: string; hasDepartureTokenParam: boolean },
): RtResponseAudit {
  const opts = collectAllSerpOptions(resp)
  const rows: RtOptionAuditRow[] = opts.map((opt, index) => {
    const flights = opt.flights ?? []
    const firstDep = flights[0]?.departure_airport?.id
    const lastArr = flights[flights.length - 1]?.arrival_airport?.id
    return {
      index,
      heatmapClass: classifyOption(opt),
      price: opt.price,
      type: (opt as { type?: string }).type,
      hasDepartureToken: Boolean(opt.departure_token),
      segmentCount: flights.length,
      firstDep,
      lastArr,
      totalDurationMinutes: opt.total_duration,
    }
  })

  let withPrice = 0
  let withDepartureToken = 0
  let withPriceAndToken = 0
  let withPriceNoToken = 0
  let withTokenNoPrice = 0
  let roundTripTyped = 0
  const prices: number[] = []

  for (const opt of opts) {
    const hasPrice = opt.price != null && Number.isFinite(opt.price)
    const hasToken = Boolean(opt.departure_token)
    if (hasPrice) {
      withPrice++
      prices.push(opt.price!)
    }
    if (hasToken) withDepartureToken++
    if (hasPrice && hasToken) withPriceAndToken++
    if (hasPrice && !hasToken) withPriceNoToken++
    if (!hasPrice && hasToken) withTokenNoPrice++
    const t = (opt as { type?: string }).type?.toLowerCase() ?? ''
    if (t.includes('round')) roundTripTyped++
  }

  const insights = (resp as { price_insights?: { lowest_price?: number } }).price_insights?.lowest_price

  return {
    queryKind: meta.queryKind,
    outboundDate: meta.outboundDate,
    returnDate: meta.returnDate,
    hasDepartureTokenParam: meta.hasDepartureTokenParam,
    optionCount: opts.length,
    withPrice,
    withDepartureToken,
    withPriceAndToken,
    withPriceNoToken,
    withTokenNoPrice,
    roundTripTyped,
    minPricedOption: prices.length ? Math.min(...prices) : undefined,
    maxPricedOption: prices.length ? Math.max(...prices) : undefined,
    priceInsightsLowest: insights,
    rows,
  }
}

function pairKey(out: string, ret: string): string {
  return `${out}|${ret}`
}

function auditQueries(queries: SerpSearchDebugQuery[]): RtPairAudit[] {
  const byPair = new Map<string, RtPairAudit>()

  const ensure = (out: string, ret: string): RtPairAudit => {
    const k = pairKey(out, ret)
    let p = byPair.get(k)
    if (!p) {
      p = {
        outboundDate: out,
        returnDate: ret,
        tokenFollowUps: [],
        tokenFollowUpOptionCount: 0,
      }
      byPair.set(k, p)
    }
    return p
  }

  for (const q of queries) {
    const out = q.outboundDate
    const ret = q.returnDate ?? ''
    if (!out || !ret) continue
    const pair = ensure(out, ret)
    const tokenReq = isTokenRequest(q.requestParams)
    const audit = auditOneResponse(q.response, {
      queryKind: tokenReq ? 'token_followup' : 'initial',
      outboundDate: out,
      returnDate: ret,
      hasDepartureTokenParam: tokenReq,
    })
    if (tokenReq) {
      pair.tokenFollowUps.push(audit)
      pair.tokenFollowUpOptionCount += audit.optionCount
    } else if (!pair.initial) {
      pair.initial = audit
    }
  }

  for (const pair of byPair.values()) {
    if (pair.initial?.minPricedOption != null) {
      pair.initialMinPrice = pair.initial.minPricedOption
    }
    const tokenPrices = pair.tokenFollowUps
      .map((t) => t.minPricedOption)
      .filter((p): p is number => p != null)
    if (tokenPrices.length) {
      pair.tokenExpandedMinPrice = Math.min(...tokenPrices)
    }
    if (pair.initialMinPrice != null && pair.tokenExpandedMinPrice != null) {
      pair.priceGapAfterExpand = pair.tokenExpandedMinPrice - pair.initialMinPrice
    }
  }

  return [...byPair.values()].sort((a, b) =>
    a.outboundDate.localeCompare(b.outboundDate) || a.returnDate.localeCompare(b.returnDate),
  )
}

export function auditRoundTripSerpResponse(
  resp: SerpGoogleFlightsResponse,
  opts?: { outboundDate?: string; returnDate?: string; queryKind?: RtResponseAudit['queryKind'] },
): RtResponseAudit {
  return auditOneResponse(resp, {
    queryKind: opts?.queryKind ?? 'initial',
    outboundDate: opts?.outboundDate,
    returnDate: opts?.returnDate,
    hasDepartureTokenParam: opts?.queryKind === 'token_followup',
  })
}

export function auditRoundTripDebugBundle(
  bundle: SerpSearchDebugBundle,
  sourceLabel = 'debug bundle',
): RoundTripSerpAuditReport {
  const pairs = auditQueries(bundle.queries)
  let initialQueries = 0
  let tokenQueries = 0
  let initialOptions = 0
  let tokenFollowUpOptions = 0
  let pairsWithTokenData = 0
  let pairsWhereExpandBeatInitial = 0

  for (const p of pairs) {
    if (p.initial) {
      initialQueries++
      initialOptions += p.initial.optionCount
    }
    tokenQueries += p.tokenFollowUps.length
    tokenFollowUpOptions += p.tokenFollowUpOptionCount
    if (p.tokenFollowUps.length) pairsWithTokenData++
    if (
      p.initialMinPrice != null &&
      p.tokenExpandedMinPrice != null &&
      p.tokenExpandedMinPrice < p.initialMinPrice - 0.01
    ) {
      pairsWhereExpandBeatInitial++
    }
  }

  const notes = [
    'Initial RT responses list outbound itineraries with a summary round-trip price; return segments appear after departure_token.',
    'Class A = priced without token (rare on RT). Class B = priced + token (typical). Class C = incomplete.',
    'Heatmap-only min price can use initialMinPrice; route detail and cheaper return variants need token follow-ups.',
  ]

  return {
    auditedAt: new Date().toISOString(),
    sourceLabel,
    pairs,
    totals: {
      initialQueries,
      tokenQueries,
      initialOptions,
      tokenFollowUpOptions,
      pairsWithTokenData,
      pairsWhereExpandBeatInitial,
    },
    notes,
  }
}

/** Format a concise text report for CLI or logs. */
export function formatRoundTripSerpAuditReport(report: RoundTripSerpAuditReport): string {
  const lines: string[] = [
    `Round-trip SerpApi audit — ${report.sourceLabel}`,
    `Audited: ${report.auditedAt}`,
    '',
    'Totals:',
    `  Initial queries: ${report.totals.initialQueries}`,
    `  Token follow-up queries: ${report.totals.tokenQueries}`,
    `  Initial option cards: ${report.totals.initialOptions}`,
    `  Token follow-up option cards: ${report.totals.tokenFollowUpOptions}`,
    `  Pairs where token expand beat initial min: ${report.totals.pairsWhereExpandBeatInitial}`,
    '',
  ]

  for (const p of report.pairs) {
    lines.push(`Pair ${p.outboundDate} → ${p.returnDate}:`)
    if (p.initial) {
      const i = p.initial
      lines.push(
        `  Initial: ${i.optionCount} options, ${i.withPrice} priced, ${i.withDepartureToken} with token,`
        + ` min=$${i.minPricedOption ?? '—'}, insights_lowest=$${i.priceInsightsLowest ?? '—'}`,
      )
      const a = i.rows.filter((r) => r.heatmapClass === 'A_summary_rt_price').length
      const b = i.rows.filter((r) => r.heatmapClass === 'B_needs_token_for_return_variants').length
      const c = i.rows.filter((r) => r.heatmapClass === 'C_incomplete').length
      lines.push(`  Classes: A=${a} B=${b} C=${c}`)
    }
    if (p.tokenFollowUps.length) {
      lines.push(
        `  Token follow-ups: ${p.tokenFollowUps.length} calls, ${p.tokenFollowUpOptionCount} return options,`
        + ` expanded min=$${p.tokenExpandedMinPrice ?? '—'}, gap vs initial=$${p.priceGapAfterExpand?.toFixed(0) ?? '—'}`,
      )
    }
    lines.push('')
  }

  lines.push('Notes:')
  for (const n of report.notes) lines.push(`  - ${n}`)
  return lines.join('\n')
}
