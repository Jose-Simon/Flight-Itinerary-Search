import { Fragment, useMemo, useState } from 'react'
import type { NormalizedItinerary } from '../lib/types'
import type { MapSoloFocus } from './ResultsRouteMap'
import { ResultsList, type ResultsListProps } from './ResultsList'
import {
  formatSegmentTimeline,
  formatDepartureDate,
  formatTimesChain,
  tripStartDisplayAnchor,
  calendarDayOffsetFromTripStart,
  depMinOfDayInZone,
} from '../lib/formatFlightTimes'
import {
  buildGoogleFlightsDeepLink,
  buildGoogleFlightsSearchUrl,
  itineraryDetailsText,
} from '../lib/googleFlightsLink'
import { itineraryScheduleKey } from '../lib/filters'
import { segmentAirlineLogoFromEnriched } from '../lib/airlineDisplay'
import { enrichAirlineFromMeta, type AirlinesMeta } from '../lib/airlineMetaLookup'

// ── Types ────────────────────────────────────────────────────────────────────
type ViewMode = 'cards' | 'list' | 'gantt'
type RvSortKey = 'fare' | 'duration' | 'flightDuration' | 'layover' | 'depart' | 'arrive'

export type ResultsViewSwitcherProps = ResultsListProps & {
  /** Unique key for localStorage persistence (e.g. 'out' or 'ret'). */
  persistKey: string
}

type LogoEntry = { code: string; logoUrl: string | null; name: string }

// ── localStorage helpers ──────────────────────────────────────────────────────
function lsGet(k: string, d: string): string {
  try { return localStorage.getItem(k) ?? d } catch { return d }
}
function lsSet(k: string, v: string): void {
  try { localStorage.setItem(k, v) } catch {}
}

// ── Colour scale helpers ──────────────────────────────────────────────────────
/**
 * Maps a normalised score (0 = best, 1 = worst) to an HSL colour for dark theme.
 * 0   → green  hsl(145, 75%, 60%)
 * 0.5 → yellow hsl(48,  75%, 60%)
 * 1   → red    hsl(4,   75%, 60%)
 */
function scoreColor(score: number): string {
  const s = Math.max(0, Math.min(1, score))
  const hue = s < 0.5
    ? 145 - (145 - 48) * (s / 0.5)
    : 48  - (48  - 4)  * ((s - 0.5) / 0.5)
  return `hsl(${Math.round(hue)}, 75%, 60%)`
}

/**
 * Returns the percentile rank (0–1) of `val` in a pre-sorted ascending array.
 * Ties use the midpoint rank so all equal values get the same colour.
 * Returns null when the array has fewer than 2 entries.
 */
function percentileScore(val: number, sorted: number[]): number | null {
  const n = sorted.length
  if (n <= 1) return null
  // Lower bound: first index where sorted[i] >= val
  let lo = 0, hi = n
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < val) lo = mid + 1; else hi = mid }
  const first = lo
  // Upper bound: last index where sorted[i] <= val
  lo = 0; hi = n
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= val) lo = mid + 1; else hi = mid }
  const last = lo - 1
  return ((first + last) / 2) / (n - 1)
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtMin(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}m`
}

function fmtPrice(amount: number | undefined, currency: string): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0,
    }).format(amount)
  } catch { return `${amount}` }
}

// ── Derived meta per itinerary ────────────────────────────────────────────────
type ItinMeta = {
  depTimeStr: string
  arrTimeStr: string
  arrDayPlus: number
  depMinOfDay: number
  /** Arrival time as minutes from departure midnight (dep + total dur), for Arrive sort */
  arrSortMin: number
  totalLayMin: number
  flightMin: number
  stops: number
  layHub: string
  layDur: string
  /** Full route with all airports e.g. "JFK → DOH → TRV" */
  routeStr: string
  /** Origin → Destination only */
  dir: string
  carriers: string[]
}

function deriveItinMeta(
  it: NormalizedItinerary,
  tzByIata: Map<string, string>,
  displayTimezone: string,
): ItinMeta {
  const segs = it.segments
  const lays = it.layovers
  const firstSeg = segs[0]
  const lastSeg = segs[segs.length - 1]

  let depTimeStr = '—', arrTimeStr = '—', arrDayPlus = 0, depMinOfDay = 0

  if (firstSeg) {
    depTimeStr = formatSegmentTimeline(firstSeg, tzByIata, displayTimezone).dep.time
  }
  if (lastSeg) {
    const tl = formatSegmentTimeline(lastSeg, tzByIata, displayTimezone)
    arrTimeStr = tl.arr.time
    const anchor = tripStartDisplayAnchor(firstSeg, tzByIata, displayTimezone)
    arrDayPlus = calendarDayOffsetFromTripStart(lastSeg.arrTime, lastSeg.arr, anchor, tzByIata, displayTimezone)
  }

  if (firstSeg) {
    depMinOfDay = depMinOfDayInZone(firstSeg, tzByIata, displayTimezone)
  }

  const nonTechLays = lays.filter((l) => !l.isTechnical)
  const totalLayMin = lays.reduce((s, l) => s + l.durationMinutes, 0)
  const flightMin = segs.reduce((s, seg) => s + seg.durationMinutes, 0)
  const stops = nonTechLays.length
  const layHubs = nonTechLays.map((l) => l.airport)
  const layHub = layHubs.length > 0 ? layHubs.join(', ') : '—'
  const layDur = totalLayMin > 0 ? fmtMin(totalLayMin) : '—'
  const origin = firstSeg?.dep ?? '—'
  const dest = lastSeg?.arr ?? '—'
  const dir = segs.length > 0 ? `${origin} → ${dest}` : '—'

  // Full route: JFK → DOH → TRV (all airports in order)
  const airports: string[] = segs.length > 0 ? [segs[0].dep, ...segs.map((s) => s.arr)] : []
  const routeStr = airports.join(' → ') || dir

  const carriers = [...new Set(
    segs.map((s) => s.airline?.trim().toUpperCase()).filter((c): c is string => Boolean(c)),
  )]

  const arrSortMin = depMinOfDay + it.totalDurationMinutes

  return { depTimeStr, arrTimeStr, arrDayPlus, depMinOfDay, arrSortMin, totalLayMin, flightMin, stops, layHub, layDur, routeStr, dir, carriers }
}

// ── Airline logo helpers ──────────────────────────────────────────────────────
function getItinLogos(
  it: NormalizedItinerary,
  airlinesMeta: AirlinesMeta,
  airlineDirectory: Record<string, string>,
): LogoEntry[] {
  const seen = new Set<string>()
  const result: LogoEntry[] = []
  for (const seg of it.segments) {
    const code = seg.airline?.trim().toUpperCase()
    if (!code || seen.has(code)) continue
    seen.add(code)
    const enriched = enrichAirlineFromMeta(code, airlinesMeta, airlineDirectory)
    result.push({ code, logoUrl: segmentAirlineLogoFromEnriched(seg, enriched), name: enriched?.displayName ?? code })
  }
  return result
}

function AirlineLogos({ logos }: { logos: LogoEntry[] }) {
  // Always render 3 fixed-width slots so columns don't shift
  const slots: (LogoEntry | null)[] = [...logos.slice(0, 3)]
  while (slots.length < 3) slots.push(null)
  return (
    <div className="rv-logos">
      {slots.map((entry, i) =>
        entry === null
          ? <span key={`empty-${i}`} className="rv-logo-slot rv-logo-slot--empty" />
          : entry.logoUrl
            ? <img key={entry.code} src={entry.logoUrl} alt={entry.name} title={entry.name} className="rv-logo-img" />
            : <span key={entry.code} className="rv-logo-slot rv-logo-code" title={entry.name}>{entry.code}</span>
      )}
    </div>
  )
}

// ── Sort helpers ──────────────────────────────────────────────────────────────
function getSortVal(it: NormalizedItinerary, m: ItinMeta, key: RvSortKey): number {
  switch (key) {
    case 'fare': return it.price ?? 999999
    case 'duration': return it.totalDurationMinutes
    case 'flightDuration': return m.flightMin
    case 'layover': return m.totalLayMin
    case 'depart': return m.depMinOfDay
    case 'arrive': return m.arrSortMin
    default: return it.totalDurationMinutes
  }
}

function sortItemsWithMeta(
  items: NormalizedItinerary[],
  metas: Map<NormalizedItinerary, ItinMeta>,
  key: RvSortKey,
  dir: 1 | -1,
): NormalizedItinerary[] {
  return [...items].sort((a, b) =>
    (getSortVal(a, metas.get(a)!, key) - getSortVal(b, metas.get(b)!, key)) * dir
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

/** Labeled proportional bar showing segments + layovers with route/duration text. */
function LabeledSegBar({ it }: { it: NormalizedItinerary }) {
  const chunks: { kind: 'seg' | 'lay'; minutes: number; top: string; bot: string }[] = []
  for (let i = 0; i < it.segments.length; i++) {
    const seg = it.segments[i]
    chunks.push({ kind: 'seg', minutes: Math.max(1, seg.durationMinutes), top: `${seg.dep}–${seg.arr}`, bot: fmtMin(seg.durationMinutes) })
    const lay = it.layovers[i]
    if (lay) chunks.push({ kind: 'lay', minutes: Math.max(1, lay.durationMinutes), top: lay.airport, bot: fmtMin(lay.durationMinutes) })
  }
  return (
    <div className="rv-segbar">
      {chunks.map((c, i) => (
        <div key={i} className={`rv-segbar-chunk rv-segbar-chunk--${c.kind}`} style={{ flex: c.minutes }}>
          <span className="rv-segbar-top">{c.top}</span>
          <span className="rv-segbar-bot">{c.bot}</span>
        </div>
      ))}
    </div>
  )
}

function StopBadge({ n }: { n: number }) {
  return (
    <span className={`rv-stopbadge ${n === 0 ? 'nonstop' : ''}`}>
      {n === 0 ? 'Nonstop' : `${n} stop${n > 1 ? 's' : ''}`}
    </span>
  )
}

function SortButtons({ sortKey, sortDir, onSort }: { sortKey: RvSortKey; sortDir: 1 | -1; onSort: (k: RvSortKey) => void }) {
  const defs: [RvSortKey, string][] = [
    ['fare', 'Price'],
    ['duration', 'Duration'],
    ['flightDuration', 'Flight'],
    ['layover', 'Layover'],
    ['depart', 'Depart'],
    ['arrive', 'Arrive'],
  ]
  return (
    <div className="rv-sortbtns">
      <span className="rv-sortlab">Sort</span>
      {defs.map(([k, label]) => (
        <button key={k} type="button" className={`rv-sortbtn ${sortKey === k ? 'on' : ''}`} onClick={() => onSort(k)}>
          {label}
          {sortKey === k && <span className="rv-caret">{sortDir === 1 ? ' ↑' : ' ↓'}</span>}
        </button>
      ))}
    </div>
  )
}

function ViewToggle({ view, onView }: { view: ViewMode; onView: (v: ViewMode) => void }) {
  const defs: [ViewMode, string][] = [['cards', 'Cards'], ['list', 'List'], ['gantt', 'Timeline']]
  return (
    <div className="rv-viewtoggle">
      {defs.map(([k, label]) => (
        <button key={k} type="button" className={`rv-vtbtn ${view === k ? 'on' : ''}`} onClick={() => onView(k)}>
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Shared action-bar types ───────────────────────────────────────────────────
type SaveControls = {
  leg: 'outbound' | 'return'
  savedKeys: Set<string>
  onSave: (it: NormalizedItinerary) => void
  onRemove: (scheduleKey: string) => void
}
type MapFocusCtx = {
  active: MapSoloFocus | null
  onSet: (next: MapSoloFocus | null) => void
}

// ── Itinerary actions ─────────────────────────────────────────────────────────
function ItinActions({
  it, itKey, gfOrigins, gfDestinations, linkDate, returnDate, cabinClass,
  linkOverride, saveControls, mapFocus, resultLeg,
}: {
  it: NormalizedItinerary
  itKey: string
  gfOrigins: string[]
  gfDestinations: string[]
  linkDate: string
  returnDate: string | null
  cabinClass: number
  linkOverride?: { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }
  saveControls?: SaveControls
  mapFocus?: MapFocusCtx
  resultLeg?: 'outbound' | 'return'
}) {
  const [recentlySaved, setRecentlySaved] = useState(false)
  const o = linkOverride ?? { gfOrigins, gfDestinations, linkDate, returnDate }
  const actualDate = it.segments[0]?.depTime?.slice(0, 10) || o.linkDate
  const deepUrl = buildGoogleFlightsDeepLink(it, actualDate, null, null, 1, 0, true, cabinClass)
  const { url: searchUrl } = buildGoogleFlightsSearchUrl(o.gfOrigins, o.gfDestinations, actualDate, o.returnDate)
  const copy = () => void navigator.clipboard.writeText(itineraryDetailsText(it, 'Itinerary', actualDate))
  const mapFocused = mapFocus?.active?.waypointKey === it.waypointKey && mapFocus?.active?.leg === resultLeg
  const isSaved = saveControls?.savedKeys.has(itKey) ?? false
  return (
    <div className="rv-actions">
      {mapFocus && resultLeg && (
        <button
          type="button"
          className="itin-action"
          onClick={() => mapFocus.onSet(mapFocused ? null : { waypointKey: it.waypointKey, leg: resultLeg })}
        >
          {mapFocused ? 'On map' : 'Map'}
        </button>
      )}
      <a className="itin-action" href={deepUrl ?? searchUrl} target="_blank" rel="noreferrer">
        Google Flights{deepUrl ? ' ✓' : ''}
      </a>
      <button type="button" className="itin-action" onClick={copy}>Copy details</button>
      {saveControls && (
        isSaved ? (
          <>
            {recentlySaved && <span className="itin-save-confirm">✓ Saved</span>}
            <button type="button" className="itin-action" onClick={() => saveControls.onRemove(itKey)}>Remove</button>
          </>
        ) : (
          <button
            type="button"
            className="itin-action"
            onClick={() => {
              saveControls.onSave(it)
              setRecentlySaved(true)
              setTimeout(() => setRecentlySaved(false), 2500)
            }}
          >
            Save
          </button>
        )
      )}
    </div>
  )
}

// ── Itinerary timeline (for preview pane) ─────────────────────────────────────
function ItinTimeline({ it, tzByIata, displayTimezone, namesByIata }: {
  it: NormalizedItinerary; tzByIata: Map<string, string>; displayTimezone: string; namesByIata: Map<string, string>
}) {
  const tripAnchor = tripStartDisplayAnchor(it.segments[0], tzByIata, displayTimezone)
  return (
    <ul className="rv-tl">
      {it.segments.map((s, i) => {
        const tl = formatSegmentTimeline(s, tzByIata, displayTimezone)
        const lay = it.layovers[i]
        const depPlus = calendarDayOffsetFromTripStart(s.depTime, s.dep, tripAnchor, tzByIata, displayTimezone)
        const arrPlus = calendarDayOffsetFromTripStart(s.arrTime, s.arr, tripAnchor, tzByIata, displayTimezone)
        const depName = namesByIata.get(s.dep) ? `${namesByIata.get(s.dep)} (${s.dep})` : s.dep
        const arrName = namesByIata.get(s.arr) ? `${namesByIata.get(s.arr)} (${s.arr})` : s.arr
        return (
          <Fragment key={i}>
            <li className="rv-tl-airline">
              <span className="rv-tl-code">{s.airline ?? '—'}</span>
              <span className="rv-tl-meta">{[s.flightNumber, s.airplane].filter(Boolean).join(' · ')}</span>
            </li>
            <li className="rv-tl-stop">
              <span className="rv-tl-time">{tl.dep.time}{depPlus > 0 && <sup>+{depPlus}</sup>}</span>
              <span className="rv-tl-dot" aria-hidden />
              <span className="rv-tl-place">{depName}</span>
            </li>
            <li className="rv-tl-leg">
              <span className="rv-tl-time rv-tl-time--empty" />
              <span className="rv-tl-rail" aria-hidden />
              <span className="rv-tl-dur">In flight · {fmtMin(s.durationMinutes)}</span>
            </li>
            <li className="rv-tl-stop">
              <span className="rv-tl-time">{tl.arr.time}{arrPlus > 0 && <sup>+{arrPlus}</sup>}</span>
              <span className="rv-tl-dot" aria-hidden />
              <span className="rv-tl-place">{arrName}</span>
            </li>
            {lay && (
              <li className="rv-tl-layover">
                <span className="rv-tl-time rv-tl-time--empty" />
                <span className="rv-tl-layover-dot" aria-hidden />
                <span className="rv-tl-layover-text">
                  Layover · {lay.name ? `${lay.name} (${lay.airport})` : lay.airport} · {fmtMin(lay.durationMinutes)}
                </span>
              </li>
            )}
          </Fragment>
        )
      })}
    </ul>
  )
}

// ── Preview pane (shared by List + Timeline) ──────────────────────────────────
type PreviewPaneProps = {
  it: NormalizedItinerary | null
  metas: Map<NormalizedItinerary, ItinMeta>
  tzByIata: Map<string, string>
  displayTimezone: string
  namesByIata: Map<string, string>
  priceCurrency: string
  gfOrigins: string[]
  gfDestinations: string[]
  linkDate: string
  returnDate: string | null
  cabinClass: number
  saveControls?: SaveControls
  gfLinkByScheduleKey?: Map<string, { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }>
  mapFocus?: MapFocusCtx
  resultLeg?: 'outbound' | 'return'
  emptyHint?: string
}

function ItinPreviewPane({
  it, metas, tzByIata, displayTimezone, namesByIata, priceCurrency,
  gfOrigins, gfDestinations, linkDate, returnDate, cabinClass,
  saveControls, gfLinkByScheduleKey, mapFocus, resultLeg,
  emptyHint = 'Click a row to preview',
}: PreviewPaneProps) {
  if (!it) {
    return (
      <div className="rv-preview">
        <div className="rv-prev-empty">{emptyHint}</div>
      </div>
    )
  }
  const m = metas.get(it)!
  const itKey = itineraryScheduleKey(it)
  const depDate = formatDepartureDate(it.segments[0], tzByIata, displayTimezone)
  const chain = formatTimesChain(it, tzByIata, displayTimezone)
  return (
    <div className="rv-preview">
      {/* Hero metrics row */}
      <div className="rv-prev-metrics">
        <div className="rv-prev-metric-block">
          <div className="rv-prev-metric-val">{fmtMin(it.totalDurationMinutes)}</div>
          <div className="rv-prev-metric-cap">total trip time</div>
        </div>
        <div className="rv-prev-metric-block">
          <div className="rv-prev-metric-val">{fmtMin(m.flightMin)}</div>
          <div className="rv-prev-metric-cap">flight duration</div>
        </div>
        {it.price != null && (
          <div className="rv-prev-metric-block">
            <div className="rv-prev-metric-val rv-prev-metric-price">{fmtPrice(it.price, priceCurrency)}</div>
            <div className="rv-prev-metric-cap">fare</div>
          </div>
        )}
      </div>

      {/* Route + date */}
      <div className="rv-prev-route-row">
        <span className="rv-prev-route">{m.routeStr}</span>
        {depDate && <span className="rv-prev-date">{depDate}</span>}
      </div>
      <div className="rv-prev-meta">
        {it.segments.length} segment{it.segments.length !== 1 ? 's' : ''}
        {it.layovers.length > 0
          ? ` · ${it.layovers.length} layover${it.layovers.length !== 1 ? 's' : ''}`
          : ''}
        {m.stops > 0 ? ` · ${m.layDur} layover time` : ''}
      </div>

      {/* Times chain */}
      {chain.length > 0 && (
        <div className="rv-prev-chain">
          {chain.map((stop, idx) => (
            <Fragment key={`${stop.iata}-${idx}`}>
              {idx > 0 && <span className="rv-prev-chain-arrow">→</span>}
              <span className="rv-prev-chain-stop">
                <span className="rv-prev-chain-iata">{stop.iata}</span>
                <span className="rv-prev-chain-time">{stop.time}</span>
                {stop.dayPlus > 0 && <sup className="rv-prev-chain-day">+{stop.dayPlus}</sup>}
              </span>
            </Fragment>
          ))}
        </div>
      )}

      {/* Labeled segment bar */}
      <LabeledSegBar it={it} />

      {/* Timeline */}
      <ItinTimeline it={it} tzByIata={tzByIata} displayTimezone={displayTimezone} namesByIata={namesByIata} />

      {/* Actions */}
      <div className="rv-prev-foot">
        <ItinActions
          it={it}
          itKey={itKey}
          gfOrigins={gfOrigins}
          gfDestinations={gfDestinations}
          linkDate={linkDate}
          returnDate={returnDate}
          cabinClass={cabinClass}
          linkOverride={gfLinkByScheduleKey?.get(itKey)}
          saveControls={saveControls}
          mapFocus={mapFocus}
          resultLeg={resultLeg}
        />
      </div>
    </div>
  )
}

// ============ VIEW: LIST (dense table with labeled bars) =====================
function ListView({
  items, metas, sortKey, sortDir, onSort,
  tzByIata, displayTimezone, namesByIata, priceCurrency,
  gfOrigins, gfDestinations, linkDate, returnDate, cabinClass,
  airlinesMeta, airlineDirectory,
  saveControls, gfLinkByScheduleKey, mapFocus, resultLeg,
}: {
  items: NormalizedItinerary[]
  metas: Map<NormalizedItinerary, ItinMeta>
  sortKey: RvSortKey
  sortDir: 1 | -1
  onSort: (k: RvSortKey) => void
  tzByIata: Map<string, string>
  displayTimezone: string
  namesByIata: Map<string, string>
  priceCurrency: string
  gfOrigins: string[]
  gfDestinations: string[]
  linkDate: string
  returnDate: string | null
  cabinClass: number
  airlinesMeta: AirlinesMeta
  airlineDirectory: Record<string, string>
  saveControls?: SaveControls
  gfLinkByScheduleKey?: Map<string, { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }>
  mapFocus?: MapFocusCtx
  resultLeg?: 'outbound' | 'return'
}) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [lockId, setLockId] = useState<string | null>(null)

  const previewIt = useMemo(() => {
    const id = lockId ?? hoverId
    return id ? (items.find((it) => itineraryScheduleKey(it) === id) ?? null) : null
  }, [lockId, hoverId, items])

  // Sorted arrays for percentile-based colour scale (price, total duration, flying duration, layover)
  const colourRanges = useMemo(() => {
    const asc = (a: number, b: number) => a - b
    const prices   = items.map((it) => it.price).filter((p): p is number => p != null).sort(asc)
    const totals   = items.map((it) => it.totalDurationMinutes).sort(asc)
    const flights  = items.map((it) => metas.get(it)!.flightMin).sort(asc)
    const layovers = items.map((it) => metas.get(it)!.totalLayMin).filter((l) => l > 0).sort(asc)
    return {
      price:   prices.length   >= 2 ? prices   : null,
      total:   totals.length   >= 2 ? totals   : null,
      flight:  flights.length  >= 2 ? flights  : null,
      layover: layovers.length >= 2 ? layovers : null,
    }
  }, [items, metas])

  const Th = ({ k, label, align }: { k?: RvSortKey; label: string; align?: 'r' | 'c' }) => (
    <th
      className={[align ?? '', k ? 'sortable' : '', k && sortKey === k ? 'on' : ''].filter(Boolean).join(' ')}
      onClick={k ? () => onSort(k) : undefined}
    >
      {label}
      {k && sortKey === k && <span className="rv-caret">{sortDir === 1 ? ' ↑' : ' ↓'}</span>}
    </th>
  )

  return (
    <div className="rv-tablewrap panel">
      {items.length === 0 && <p className="muted rv-empty">No itineraries match your filters.</p>}
      {items.length > 0 && (
        <div className="rv-table-layout">
          <div className="rv-tablescroll">
            <table className="rv-table">
              <colgroup>
                <col className="rv-col-logo" />
                <col className="rv-col-route" />
                <col className="rv-col-fare" />
                <col className="rv-col-dep" />
                <col className="rv-col-arr" />
                <col className="rv-col-stops" />
                <col className="rv-col-lay" />
                <col className="rv-col-fly" />
                <col className="rv-col-tot" />
                <col className="rv-col-bar" />
              </colgroup>
              <thead>
                <tr>
                  <th>Airline</th>
                  <th>Route</th>
                  <Th k="fare" label="Price" align="r" />
                  <Th k="depart" label="Depart" align="r" />
                  <Th k="arrive" label="Arrive" align="r" />
                  <th className="c">Stops</th>
                  <Th k="layover" label="Layover" align="r" />
                  <Th k="flightDuration" label="Flying" align="r" />
                  <Th k="duration" label="Total" align="r" />
                  <th className="rv-col-bar">Flight path</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const m = metas.get(it)!
                  const key = itineraryScheduleKey(it)
                  const active = lockId === key
                  const highlighted = (lockId ?? hoverId) === key
                  const logos = getItinLogos(it, airlinesMeta, airlineDirectory)
                  return (
                    <tr
                      key={key}
                      className={[highlighted ? 'highlighted' : '', active ? 'active' : ''].filter(Boolean).join(' ')}
                      onMouseEnter={() => setHoverId(key)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => setLockId(lockId === key ? null : key)}
                    >
                      {(() => {
                        const priceScore   = it.price != null && colourRanges.price   ? percentileScore(it.price,                    colourRanges.price)   : null
                        const totalScore   = colourRanges.total   ? percentileScore(it.totalDurationMinutes, colourRanges.total)   : null
                        const flightScore  = colourRanges.flight  ? percentileScore(m.flightMin,             colourRanges.flight)  : null
                        const layScore     = m.totalLayMin > 0 && colourRanges.layover ? percentileScore(m.totalLayMin, colourRanges.layover) : null
                        return (
                          <>
                            <td><AirlineLogos logos={logos} /></td>
                            <td className="rv-td-route">{m.routeStr}</td>
                            <td className="r rv-td-fare" style={priceScore != null ? { color: scoreColor(priceScore) } : undefined}>
                              {fmtPrice(it.price, priceCurrency)}
                            </td>
                            <td className="r rv-mono">{m.depTimeStr}</td>
                            <td className="r rv-mono">
                              {m.arrTimeStr}{m.arrDayPlus > 0 && <sup className="rv-dayplus">+{m.arrDayPlus}</sup>}
                            </td>
                            <td className="c"><StopBadge n={m.stops} /></td>
                            <td className="r">
                              {m.totalLayMin > 0 ? (
                                <span
                                  className={`rv-lay-pill rv-lay-pill--${m.totalLayMin < 60 ? 'short' : m.totalLayMin > 480 ? 'long' : 'normal'}`}
                                  style={layScore != null ? { color: scoreColor(layScore), borderColor: scoreColor(layScore) + '55' } : undefined}
                                >
                                  {m.layDur}
                                </span>
                              ) : <span className="rv-mono">—</span>}
                            </td>
                            <td className="r rv-mono" style={flightScore  != null ? { color: scoreColor(flightScore)  } : undefined}>{fmtMin(m.flightMin)}</td>
                            <td className="r rv-mono" style={totalScore   != null ? { color: scoreColor(totalScore)   } : undefined}>{fmtMin(it.totalDurationMinutes)}</td>
                            <td className="rv-col-bar"><LabeledSegBar it={it} /></td>
                          </>
                        )
                      })()}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ItinPreviewPane
            it={previewIt}
            metas={metas}
            tzByIata={tzByIata}
            displayTimezone={displayTimezone}
            namesByIata={namesByIata}
            priceCurrency={priceCurrency}
            gfOrigins={gfOrigins}
            gfDestinations={gfDestinations}
            linkDate={linkDate}
            returnDate={returnDate}
            cabinClass={cabinClass}
            saveControls={saveControls}
            gfLinkByScheduleKey={gfLinkByScheduleKey}
            mapFocus={mapFocus}
            resultLeg={resultLeg}
          />
        </div>
      )}
    </div>
  )
}

// ============ VIEW: TIMELINE / GANTT =========================================
type GanttXAxis = 'time' | 'duration'

function TimelineGanttView({
  items, metas, priceCurrency,
  tzByIata, displayTimezone, namesByIata,
  gfOrigins, gfDestinations, linkDate, returnDate, cabinClass,
  airlinesMeta, airlineDirectory,
  saveControls, gfLinkByScheduleKey, mapFocus, resultLeg,
}: {
  items: NormalizedItinerary[]
  metas: Map<NormalizedItinerary, ItinMeta>
  priceCurrency: string
  tzByIata: Map<string, string>
  displayTimezone: string
  namesByIata: Map<string, string>
  gfOrigins: string[]
  gfDestinations: string[]
  linkDate: string
  returnDate: string | null
  cabinClass: number
  airlinesMeta: AirlinesMeta
  airlineDirectory: Record<string, string>
  saveControls?: SaveControls
  gfLinkByScheduleKey?: Map<string, { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }>
  mapFocus?: MapFocusCtx
  resultLeg?: 'outbound' | 'return'
}) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [lockId, setLockId] = useState<string | null>(null)
  const [xAxis, setXAxis] = useState<GanttXAxis>('time')

  const previewIt = useMemo(() => {
    const id = lockId ?? hoverId
    return id ? (items.find((it) => itineraryScheduleKey(it) === id) ?? null) : null
  }, [lockId, hoverId, items])

  // Compute axis values for both modes
  const { ticks, pct, barPos } = useMemo(() => {
    if (items.length === 0) {
      return { ticks: [] as number[], pct: (_h: number) => 0, barPos: (_it: NormalizedItinerary) => ({ x0: 0, w: 0 }) }
    }

    if (xAxis === 'duration') {
      const maxH = Math.max(...items.map((it) => it.totalDurationMinutes / 60))
      const axisEnd = Math.ceil((maxH + 0.5) / 3) * 3
      const ticks: number[] = []
      for (let h = 0; h <= axisEnd; h += 3) ticks.push(h)
      const pct = (h: number) => (h / axisEnd) * 100
      const barPos = (it: NormalizedItinerary) => ({ x0: 0, w: pct(it.totalDurationMinutes / 60) })
      return { ticks, pct, barPos }
    } else {
      const starts = items.map((it) => (metas.get(it)?.depMinOfDay ?? 0) / 60)
      const ends = items.map((it) => (metas.get(it)?.depMinOfDay ?? 0) / 60 + it.totalDurationMinutes / 60)
      const axisStart = Math.floor(Math.min(...starts) - 0.5)
      const axisEnd = Math.ceil(Math.max(...ends) + 0.5)
      const span = axisEnd - axisStart
      const ticks: number[] = []
      for (let h = Math.ceil(axisStart / 3) * 3; h <= axisEnd; h += 3) ticks.push(h)
      const pct = (h: number) => ((h - axisStart) / span) * 100
      const barPos = (it: NormalizedItinerary) => {
        const m = metas.get(it)!
        return { x0: pct(m.depMinOfDay / 60), w: (it.totalDurationMinutes / 60 / span) * 100 }
      }
      return { ticks, pct, barPos }
    }
  }, [items, metas, xAxis])

  const fmtTick = (h: number): string => {
    if (xAxis === 'duration') return `${h}h`
    const d = ((h % 24) + 24) % 24
    return `${(d % 12) || 12}${d < 12 ? 'a' : 'p'}`
  }

  return (
    <div className="rv-gantt-outer">
      <div className="rv-gantt panel">
        {items.length === 0 && <p className="muted rv-empty">No itineraries match your filters.</p>}
        {items.length > 0 && (
          <>
            {/* Axis header */}
            <div className="rv-gantt-axis">
              <div className="rv-gantt-metacol rv-gantt-metacol--head">Airline · Fare · Route</div>
              <div className="rv-gantt-track">
                {ticks.map((h) => (
                  <span key={h} className={`rv-gantt-tick ${xAxis === 'time' && h % 24 === 0 ? 'midnight' : ''}`} style={{ left: `${pct(h)}%` }}>
                    {fmtTick(h)}
                  </span>
                ))}
              </div>
              <div className="rv-gx-toggle">
                <button type="button" className={`rv-gx-btn ${xAxis === 'time' ? 'on' : ''}`} onClick={() => setXAxis('time')}>Time</button>
                <button type="button" className={`rv-gx-btn ${xAxis === 'duration' ? 'on' : ''}`} onClick={() => setXAxis('duration')}>Duration</button>
              </div>
            </div>

            {/* Rows */}
            {items.map((it) => {
              const m = metas.get(it)!
              const key = itineraryScheduleKey(it)
              const { x0, w } = barPos(it)
              const active = lockId === key
              const highlighted = (lockId ?? hoverId) === key
              const logos = getItinLogos(it, airlinesMeta, airlineDirectory)

              const chunks: { kind: 'seg' | 'lay'; minutes: number; top: string; bot: string }[] = []
              for (let i = 0; i < it.segments.length; i++) {
                const seg = it.segments[i]
                chunks.push({ kind: 'seg', minutes: Math.max(1, seg.durationMinutes), top: `${seg.dep}–${seg.arr}`, bot: fmtMin(seg.durationMinutes) })
                const lay = it.layovers[i]
                if (lay) chunks.push({ kind: 'lay', minutes: Math.max(1, lay.durationMinutes), top: lay.airport, bot: fmtMin(lay.durationMinutes) })
              }

              return (
                <div
                  key={key}
                  className={`rv-grow ${highlighted ? 'hovered' : ''} ${active ? 'locked' : ''}`}
                  onMouseEnter={() => setHoverId(key)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={() => setLockId(lockId === key ? null : key)}
                >
                  <div className="rv-gantt-metacol">
                    <AirlineLogos logos={logos} />
                    <div className="rv-gantt-metacol-text">
                      <span className="rv-gantt-fare">{fmtPrice(it.price, priceCurrency)}</span>
                      <span className="rv-gantt-route">{m.routeStr}</span>
                    </div>
                  </div>
                  <div className="rv-gantt-lane">
                    {ticks.map((h) => (
                      <span key={h} className={`rv-gantt-gl ${xAxis === 'time' && h % 24 === 0 ? 'midnight' : ''}`} style={{ left: `${pct(h)}%` }} />
                    ))}
                    <div className="rv-gantt-bar" style={{ left: `${x0}%`, width: `${w}%` }}>
                      {chunks.map((c, i) => (
                        <div
                          key={i}
                          className={`rv-gantt-chunk rv-gantt-chunk--${c.kind}`}
                          style={{ flex: c.minutes }}
                          title={`${c.top} · ${c.bot}`}
                        >
                          <span className="rv-gantt-chunktop">{c.top}</span>
                          <span className="rv-gantt-chunkbot">{c.bot}</span>
                        </div>
                      ))}
                    </div>
                    <span className="rv-gantt-endlab" style={{ left: `calc(${x0 + w}% + 6px)` }}>
                      {fmtMin(it.totalDurationMinutes)}
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Legend */}
            <div className="rv-gantt-legend">
              <span><i className="rv-legend-sw rv-legend-sw--seg" /> Flight</span>
              <span><i className="rv-legend-sw rv-legend-sw--lay" /> Layover</span>
              <span className="rv-legend-mut">
                {xAxis === 'time' ? 'X-axis: departure time of day' : 'X-axis: total trip duration · all bars start at 0'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Preview pane */}
      <ItinPreviewPane
        it={previewIt}
        metas={metas}
        tzByIata={tzByIata}
        displayTimezone={displayTimezone}
        namesByIata={namesByIata}
        priceCurrency={priceCurrency}
        gfOrigins={gfOrigins}
        gfDestinations={gfDestinations}
        linkDate={linkDate}
        returnDate={returnDate}
        cabinClass={cabinClass}
        saveControls={saveControls}
        gfLinkByScheduleKey={gfLinkByScheduleKey}
        mapFocus={mapFocus}
        resultLeg={resultLeg}
        emptyHint="Click a row to preview"
      />
    </div>
  )
}

// ============ MAIN: ResultsViewSwitcher ======================================
export function ResultsViewSwitcher({
  persistKey, title, items, sort, onSortChange,
  gfOrigins, gfDestinations, linkDate, returnDate, tripType,
  cabinClass = 1, tzByIata, displayTimezone, airlineDirectory, airlinesMeta,
  namesByIata, layoverLongMinHours, layoverShortMaxHours, priceCurrency,
  paginationResetKey, saveControls, gfLinkByScheduleKey, resultLeg, mapFocus,
}: ResultsViewSwitcherProps) {
  const [view, setView] = useState<ViewMode>(
    () => {
      const v = lsGet(`rv-view-${persistKey}`, 'cards')
      // Migrate old 'table'/'list' values to new view names
      if (v === 'table') return 'list'
      return (v === 'cards' || v === 'list' || v === 'gantt') ? v as ViewMode : 'cards'
    }
  )
  const [rvSortKey, setRvSortKey] = useState<RvSortKey>(
    () => lsGet(`rv-sort-${persistKey}`, 'duration') as RvSortKey,
  )
  const [rvSortDir, setRvSortDir] = useState<1 | -1>(
    () => (lsGet(`rv-sortdir-${persistKey}`, '1') === '-1' ? -1 : 1),
  )

  const handleView = (v: ViewMode) => { setView(v); lsSet(`rv-view-${persistKey}`, v) }

  const handleSort = (k: RvSortKey) => {
    if (k === rvSortKey) {
      const next = rvSortDir === 1 ? -1 : (1 as 1 | -1)
      setRvSortDir(next)
      lsSet(`rv-sortdir-${persistKey}`, String(next))
    } else {
      setRvSortKey(k); setRvSortDir(1)
      lsSet(`rv-sort-${persistKey}`, k)
      lsSet(`rv-sortdir-${persistKey}`, '1')
    }
  }

  const metas = useMemo(() => {
    const m = new Map<NormalizedItinerary, ItinMeta>()
    for (const it of items) m.set(it, deriveItinMeta(it, tzByIata, displayTimezone))
    return m
  }, [items, tzByIata, displayTimezone])

  const sortedItems = useMemo(
    () => sortItemsWithMeta(items, metas, rvSortKey, rvSortDir),
    [items, metas, rvSortKey, rvSortDir],
  )

  const total = items.length

  return (
    <div className="rv-root">
      {/* Section header */}
      <div className="rv-header">
        <div className="rv-header-left">
          <h2 className="rv-title">{title}</h2>
          {total > 0 && <span className="rv-count muted small">{total} itinerar{total === 1 ? 'y' : 'ies'}</span>}
        </div>
        <SortButtons sortKey={rvSortKey} sortDir={rvSortDir} onSort={handleSort} />
        <span className="rv-header-sep" aria-hidden />
        <ViewToggle view={view} onView={handleView} />
      </div>

      {/* Views */}
      {view === 'cards' && (
        <ResultsList
          title={title} items={sortedItems} sort={sort} onSortChange={onSortChange}
          gfOrigins={gfOrigins} gfDestinations={gfDestinations} linkDate={linkDate}
          returnDate={returnDate} tripType={tripType} cabinClass={cabinClass}
          tzByIata={tzByIata} displayTimezone={displayTimezone}
          airlineDirectory={airlineDirectory} airlinesMeta={airlinesMeta}
          namesByIata={namesByIata} layoverLongMinHours={layoverLongMinHours}
          layoverShortMaxHours={layoverShortMaxHours} priceCurrency={priceCurrency}
          paginationResetKey={paginationResetKey} saveControls={saveControls}
          gfLinkByScheduleKey={gfLinkByScheduleKey} resultLeg={resultLeg}
          mapFocus={mapFocus} hideHeader
        />
      )}

      {view === 'list' && (
        <ListView
          items={sortedItems} metas={metas} sortKey={rvSortKey} sortDir={rvSortDir} onSort={handleSort}
          tzByIata={tzByIata} displayTimezone={displayTimezone} namesByIata={namesByIata}
          priceCurrency={priceCurrency} gfOrigins={gfOrigins} gfDestinations={gfDestinations}
          linkDate={linkDate} returnDate={returnDate} cabinClass={cabinClass}
          airlinesMeta={airlinesMeta} airlineDirectory={airlineDirectory}
          saveControls={saveControls} gfLinkByScheduleKey={gfLinkByScheduleKey}
          mapFocus={mapFocus} resultLeg={resultLeg}
        />
      )}

      {view === 'gantt' && (
        <TimelineGanttView
          items={sortedItems} metas={metas} priceCurrency={priceCurrency}
          tzByIata={tzByIata} displayTimezone={displayTimezone} namesByIata={namesByIata}
          gfOrigins={gfOrigins} gfDestinations={gfDestinations} linkDate={linkDate}
          returnDate={returnDate} cabinClass={cabinClass}
          airlinesMeta={airlinesMeta} airlineDirectory={airlineDirectory}
          saveControls={saveControls} gfLinkByScheduleKey={gfLinkByScheduleKey}
          mapFocus={mapFocus} resultLeg={resultLeg}
        />
      )}
    </div>
  )
}
