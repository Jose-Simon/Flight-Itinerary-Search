import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { NormalizedItinerary, NormalizedLayover, NormalizedSegment } from '../lib/types'
import { buildGoogleFlightsDeepLink, buildGoogleFlightsSearchUrl, itineraryDetailsText } from '../lib/googleFlightsLink'
import { itineraryScheduleKey, totalFlightMinutes, type SortMode } from '../lib/filters'
import {
  calendarDayOffsetFromTripStart,
  formatDepartureDate,
  formatSegmentTimeline,
  formatTimesChain,
  tripStartDisplayAnchor,
} from '../lib/formatFlightTimes'
import { segmentAirlineLogoFromEnriched } from '../lib/airlineDisplay'
import { enrichAirlineFromMeta } from '../lib/airlineMetaLookup'
import type { AirlinesMeta } from '../lib/airlineMetaLookup'
import type { MapSoloFocus } from './ResultsRouteMap'

export type ResultsListProps = {
  title: string
  items: NormalizedItinerary[]
  sort: SortMode
  onSortChange: (s: SortMode) => void
  gfOrigins: string[]
  gfDestinations: string[]
  linkDate: string
  returnDate: string | null
  tripType?: 'oneway' | 'round'
  /** Cabin class for Google Flights deep links: 1=Economy (default), 2=Premium Economy, 3=Business, 4=First */
  cabinClass?: number
  tzByIata: Map<string, string>
  displayTimezone: string
  airlineDirectory: Record<string, string>
  airlinesMeta: AirlinesMeta
  namesByIata: Map<string, string>
  layoverLongMinHours: number
  layoverShortMaxHours: number
  /** ISO 4217 code from Settings; used to format `it.price`. */
  priceCurrency: string
  /** Change when the result set identity changes (e.g. schedule keys) to reset page. */
  paginationResetKey: string
  /** When set, each card shows Save / Remove for SQLite “Saved results”. */
  saveControls?: {
    leg: 'outbound' | 'return'
    savedKeys: Set<string>
    onSave: (it: NormalizedItinerary) => void
    onRemove: (scheduleKey: string) => void
  }
  /**
   * When set (e.g. Saved tab), Google Flights links use these values per schedule key
   * instead of the list-level gf* props.
   */
  gfLinkByScheduleKey?: Map<
    string,
    { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }
  >
  /** Which leg this list is (drives “Map” → top route map focus). */
  resultLeg: 'outbound' | 'return'
  /** When set, Map focuses the main results map instead of an inline map. */
  mapFocus?: {
    active: MapSoloFocus | null
    onSet: (next: MapSoloFocus | null) => void
  }
  /** When true, the panel header (title + sort) is suppressed — used by ResultsViewSwitcher. */
  hideHeader?: boolean
}

type Props = ResultsListProps

function fmtMin(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}m`
}

function fmtBarMin(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h <= 0) return `${mm}m`
  if (mm === 0) return `${h}h`
  return `${h}h ${mm}m`
}

function fmtTravelHrs(min: number): string {
  const h = Math.floor(min / 60)
  const mm = min % 60
  if (mm === 0) return `${h} hr`
  return `${h} hr ${mm} min`
}

function fmtPrice(amount: number, currency: string): string {
  const code = currency.trim() || 'USD'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${code} ${amount}`
  }
}

const INITIAL_VISIBLE = 30
const SCROLL_CHUNK = 30

function airportLine(iata: string, names: Map<string, string>): string {
  const n = names.get(iata)
  return n ? `${n} (${iata})` : iata
}

function layoverTone(
  durationMinutes: number,
  longH: number,
  shortH: number,
): 'long' | 'short' | 'normal' {
  if (durationMinutes > longH * 60) return 'long'
  if (durationMinutes < shortH * 60) return 'short'
  return 'normal'
}

function ItineraryDurationBar({
  it,
  longH,
  shortH,
}: {
  it: NormalizedItinerary
  longH: number
  shortH: number
}) {
  type Chunk =
    | { kind: 'seg'; i: number; minutes: number; seg: NormalizedSegment }
    | { kind: 'lay'; minutes: number; lay: NormalizedLayover; tone: ReturnType<typeof layoverTone> }

  const chunks: Chunk[] = []
  for (let i = 0; i < it.segments.length; i++) {
    const seg = it.segments[i]
    chunks.push({ kind: 'seg', i, minutes: Math.max(1, seg.durationMinutes), seg })
    const lay = it.layovers[i]
    if (lay) {
      chunks.push({
        kind: 'lay',
        minutes: Math.max(1, lay.durationMinutes),
        lay,
        tone: layoverTone(lay.durationMinutes, longH, shortH),
      })
    }
  }

  return (
    <div className="itin-duration-bar-wrap" aria-hidden>
      <div className="itin-duration-bar">
        {chunks.map((c, idx) => {
          const grow = Math.max(1, c.minutes)
          if (c.kind === 'seg') {
            const { seg } = c
            const mod = (c.i % 4) + 1
            return (
              <div
                key={`seg-${c.i}-${idx}`}
                className={`itin-bar-chunk itin-bar-seg itin-bar-seg--${mod}`}
                style={{ flex: `${grow} 1 0` }}
                title={`${seg.dep} → ${seg.arr} · ${fmtMin(seg.durationMinutes)}`}
              >
                <span className="itin-bar-chunk-label">
                  {seg.dep}–{seg.arr}
                </span>
                <span className="itin-bar-chunk-sub">{fmtBarMin(seg.durationMinutes)}</span>
              </div>
            )
          }
          const toneClass =
            c.tone === 'long' ? ' itin-bar-layover--long' : c.tone === 'short' ? ' itin-bar-layover--short' : ''
          return (
            <div
              key={`lay-${c.lay.airport}-${idx}`}
              className={`itin-bar-chunk itin-bar-layover${toneClass}`}
              style={{ flex: `${grow} 1 0` }}
              title={`Layover ${c.lay.airport} · ${fmtMin(c.lay.durationMinutes)}`}
            >
              <span className="itin-bar-chunk-label">{c.lay.airport}</span>
              <span className="itin-bar-chunk-sub">{fmtBarMin(c.lay.durationMinutes)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimeCol({ time, dayPlus }: { time: string; dayPlus: number }) {
  return (
    <div className="tl-time-col">
      <span className="tl-time">{time}</span>
      {dayPlus > 0 ? <span className="tl-day-plus">+{dayPlus}</span> : null}
    </div>
  )
}

export function ResultsList({
  title,
  items,
  sort,
  onSortChange,
  gfOrigins,
  gfDestinations,
  linkDate,
  returnDate,
  tripType = 'oneway',
  tzByIata,
  displayTimezone,
  airlineDirectory,
  airlinesMeta,
  namesByIata,
  layoverLongMinHours,
  layoverShortMaxHours,
  priceCurrency,
  paginationResetKey,
  saveControls,
  gfLinkByScheduleKey,
  resultLeg,
  mapFocus,
  cabinClass = 1,
  hideHeader = false,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  const [recentlySaved, setRecentlySaved] = useState<Set<string>>(new Set())
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const scrollSentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE)
  }, [paginationResetKey, sort])

  useEffect(() => {
    setVisibleCount((v) => Math.min(v, items.length))
  }, [items.length])

  const showOpenJawBadge = tripType === 'round'

  const slice = useMemo(() => {
    const n = Math.min(visibleCount, items.length)
    return items.slice(0, n)
  }, [items, visibleCount])

  useEffect(() => {
    const root = scrollRootRef.current
    const target = scrollSentinelRef.current
    if (!root || !target || visibleCount >= items.length) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + SCROLL_CHUNK, items.length))
        }
      },
      { root, rootMargin: '120px', threshold: 0 },
    )
    ob.observe(target)
    return () => ob.disconnect()
  }, [visibleCount, items.length])

  const total = items.length
  const shown = slice.length

  return (
    <section className="panel panel-results">
      {!hideHeader && (
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {total > 0 ? (
            <p className="muted small results-page-summary">
              Showing <strong>{shown}</strong> of <strong>{total}</strong>
              {shown < total ? (
                <>
                  {' '}
                  · scroll or use <strong>Show more</strong>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <label className="inline">
          Sort{' '}
          <select className="select" value={sort} onChange={(e) => onSortChange(e.target.value as SortMode)}>
            <option value="duration">Total duration</option>
            <option value="flight">Total flight duration</option>
            <option value="stops">Number of stops</option>
            <option value="layover">Layover duration</option>
            <option value="price">Price</option>
          </select>
        </label>
      </div>
      )}
      {total > 0 && shown < total ? (
        <div className="results-pagination-toolbar">
          <button
            type="button"
            className="btn btn-secondary btn-tiny"
            onClick={() => setVisibleCount((c) => Math.min(c + SCROLL_CHUNK, items.length))}
          >
            Show more ({SCROLL_CHUNK})
          </button>
          <span className="muted small">Loads the next batch into the scrollable list.</span>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="muted">No itineraries match your filters.</p>
      ) : (
        <div className="results-scroll" ref={scrollRootRef}>
        <ul className="card-list">
          {slice.map((it) => {
            const schedKey = itineraryScheduleKey(it)
            const mapFocused =
              mapFocus != null &&
              mapFocus.active?.waypointKey === it.waypointKey &&
              mapFocus.active?.leg === resultLeg
            const tripStart = tripStartDisplayAnchor(it.segments[0], tzByIata, displayTimezone)
            return (
              <li key={schedKey} className="card card-flight itin-card">
                <div className="itin-hero">
                  <div className="itin-hero-durations">
                    <div className="itin-hero-duration-block">
                      <div className="itin-hero-duration">{fmtMin(it.totalDurationMinutes)}</div>
                      <div className="itin-hero-duration-caption muted small">total trip time</div>
                    </div>
                    <div className="itin-hero-duration-block">
                      <div className="itin-hero-duration">{fmtMin(totalFlightMinutes(it))}</div>
                      <div className="itin-hero-duration-caption muted small">total flight duration</div>
                    </div>
                    {it.price != null ? (
                      <div className="itin-hero-duration-block">
                        <div
                          className="itin-hero-duration itin-hero-price-figure"
                          title="Fare from search (Settings currency)"
                        >
                          {fmtPrice(it.price, priceCurrency)}
                        </div>
                        <div className="itin-hero-duration-caption muted small">fare</div>
                      </div>
                    ) : null}
                  </div>
                  <div className="itin-hero-aside">
                    <div className="itin-card-head">
                      <div className="route">
                        {it.waypointKey.replace(/-/g, ' → ')}
                        {(() => {
                          const d = formatDepartureDate(it.segments[0], tzByIata, displayTimezone)
                          return d ? <span className="route-date">{d}</span> : null
                        })()}
                      </div>
                      <div className="itin-card-head-badges">
                        {showOpenJawBadge && it.openJaw ? <span className="badge badge-oj">One way</span> : null}
                      </div>
                    </div>
                    <p className="itin-hero-meta muted small">
                      {it.segments.length} segment{it.segments.length !== 1 ? 's' : ''}
                      {it.layovers.length > 0
                        ? ` · ${it.layovers.length} layover${it.layovers.length !== 1 ? 's' : ''}`
                        : ''}
                    </p>
                    {(() => {
                      const chain = formatTimesChain(it, tzByIata, displayTimezone)
                      if (!chain.length) return null
                      return (
                        <div className="itin-times-chain" aria-label="Flight times">
                          {chain.map((stop, idx) => (
                            <Fragment key={`${stop.iata}-${idx}`}>
                              {idx > 0 && <span className="itin-times-chain-arrow" aria-hidden>→</span>}
                              <span className="itin-times-chain-stop">
                                <span className="itin-times-chain-iata">{stop.iata}</span>
                                <span className="itin-times-chain-time">{stop.time}</span>
                                {stop.dayPlus > 0 && <sup className="itin-times-chain-day">+{stop.dayPlus}</sup>}
                              </span>
                            </Fragment>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>

                <ItineraryDurationBar it={it} longH={layoverLongMinHours} shortH={layoverShortMaxHours} />

                <div className="itin-body">
                  <div className="itin-col-main">
                    <ul className="itin-timeline">
                      {it.segments.map((s, i) => {
                        const tl = formatSegmentTimeline(s, tzByIata, displayTimezone)
                        const lay = it.layovers[i]
                        const enriched = enrichAirlineFromMeta(s.airline ?? '', airlinesMeta, airlineDirectory)
                        const segLogo = segmentAirlineLogoFromEnriched(s, enriched)
                        const segName = enriched.displayName
                        const depPlus = calendarDayOffsetFromTripStart(
                          s.depTime,
                          s.dep,
                          tripStart,
                          tzByIata,
                          displayTimezone,
                        )
                        const arrPlus = calendarDayOffsetFromTripStart(
                          s.arrTime,
                          s.arr,
                          tripStart,
                          tzByIata,
                          displayTimezone,
                        )
                        const layTone = lay
                          ? layoverTone(lay.durationMinutes, layoverLongMinHours, layoverShortMaxHours)
                          : null
                        const layRowClass =
                          layTone == null ? '' : layTone === 'normal' ? 'tl-layover' : `tl-layover tl-layover--${layTone}`
                        return (
                          <Fragment key={`${schedKey}-seg-${i}`}>
                            <li className="tl-seg-airline">
                              <div className="tl-time-col tl-time-col--empty" aria-hidden />
                              <span className="tl-seg-airline-rail" aria-hidden />
                              <div className="tl-seg-airline-main">
                                {segLogo ? (
                                  <img
                                    src={segLogo}
                                    alt=""
                                    className="tl-seg-airline-logo"
                                    loading="lazy"
                                    onError={(e) => {
                                      ;(e.target as HTMLImageElement).style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <span className="tl-seg-airline-logo-spacer" aria-hidden />
                                )}
                                <div className="tl-seg-airline-text">
                                  <span className="tl-seg-airline-name">{segName}</span>
                                  <span className="tl-seg-airline-meta muted small">
                                    {[s.flightNumber, s.airplane].filter(Boolean).join(' · ')}
                                  </span>
                                </div>
                              </div>
                            </li>
                            <li className="tl-stop">
                              <TimeCol time={tl.dep.time} dayPlus={depPlus} />
                              <span className="tl-dot" aria-hidden />
                              <div className="tl-body">
                                <div className="tl-place">{airportLine(s.dep, namesByIata)}</div>
                              </div>
                            </li>
                            <li className="tl-leg">
                              <div className="tl-time-col tl-time-col--empty" aria-hidden />
                              <div className="tl-rail-wrap">
                                <span className="tl-rail" aria-hidden />
                              </div>
                              <p className="tl-travel-meta">
                                In flight {fmtTravelHrs(s.durationMinutes)}
                                {tl.overnight ? <span className="tl-overnight"> · Overnight</span> : null}
                              </p>
                            </li>
                            <li className="tl-stop">
                              <TimeCol time={tl.arr.time} dayPlus={arrPlus} />
                              <span className="tl-dot" aria-hidden />
                              <div className="tl-body">
                                <div className="tl-place">{airportLine(s.arr, namesByIata)}</div>
                              </div>
                            </li>
                            {lay ? (
                              <li className={layRowClass}>
                                <div className="tl-time-col tl-time-col--empty" aria-hidden />
                                <span className="tl-layover-dot" aria-hidden />
                                <div className="tl-layover-body">
                                  <span className="tl-layover-title">Layover</span>
                                  <span className="tl-layover-detail">
                                    {lay.name ? `${lay.name} (${lay.airport})` : lay.airport} ·{' '}
                                    {fmtMin(lay.durationMinutes)}
                                  </span>
                                  {lay.isTechnical ? <span className="badge badge-tech">Technical?</span> : null}
                                  {lay.excludedRegionButAllowed ? (
                                    <span className="badge badge-warn">Excluded region (allowed)</span>
                                  ) : null}
                                </div>
                              </li>
                            ) : null}
                          </Fragment>
                        )
                      })}
                    </ul>

                    <div className="itin-actions-subtle">
                      {mapFocus ? (
                        <button
                          type="button"
                          className="itin-action"
                          onClick={() => {
                            mapFocus.onSet(
                              mapFocused
                                ? null
                                : { waypointKey: it.waypointKey, leg: resultLeg },
                            )
                          }}
                        >
                          {mapFocused ? 'On map' : 'Map'}
                        </button>
                      ) : null}
                      <ItineraryActions
                        it={it}
                        gfOrigins={gfOrigins}
                        gfDestinations={gfDestinations}
                        linkDate={linkDate}
                        returnDate={returnDate}
                        linkOverride={gfLinkByScheduleKey?.get(schedKey)}
                        cabinClass={cabinClass}
                      />
                      {saveControls ? (
                        saveControls.savedKeys.has(schedKey) ? (
                          <>
                            {recentlySaved.has(schedKey) && <span className="itin-save-confirm">✓ Saved</span>}
                            <button
                              type="button"
                              className="itin-action"
                              onClick={() => saveControls.onRemove(schedKey)}
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="itin-action"
                            onClick={() => {
                              saveControls.onSave(it)
                              setRecentlySaved((prev) => new Set([...prev, schedKey]))
                              setTimeout(
                                () => setRecentlySaved((prev) => { const n = new Set(prev); n.delete(schedKey); return n }),
                                2500,
                              )
                            }}
                          >
                            Save
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
        {shown < total ? <div className="results-scroll-sentinel" ref={scrollSentinelRef} aria-hidden /> : null}
        </div>
      )}
    </section>
  )
}

function ItineraryActions({
  it,
  gfOrigins,
  gfDestinations,
  linkDate,
  returnDate,
  linkOverride,
  cabinClass = 1,
}: {
  it: NormalizedItinerary
  gfOrigins: string[]
  gfDestinations: string[]
  linkDate: string
  returnDate: string | null
  linkOverride?:
    | { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }
    | undefined
  cabinClass?: number
}) {
  const o = linkOverride ?? { gfOrigins, gfDestinations, linkDate, returnDate }
  // Use the itinerary's actual first-segment departure date, not the search range start
  // (outboundDate may be a range start like "Aug 1" while the flight departs "Aug 10").
  const actualDate = it.segments[0]?.depTime?.slice(0, 10) || o.linkDate
  // Always pass roundTrip=true (root.2=2). GF requires root.2=2 to resolve a single-leg
  // TFS to the booking page without a tfu fare token — root.2=1 (one-way) falls back to
  // the generic landing page. GF still displays "One way" when only one leg is present.
  const deepUrl = buildGoogleFlightsDeepLink(it, actualDate, null, null, 1, 0, true, cabinClass)
  const { url: searchUrl, reliable } = buildGoogleFlightsSearchUrl(
    o.gfOrigins, o.gfDestinations, actualDate, o.returnDate
  )
  const details = itineraryDetailsText(it, 'Itinerary', actualDate)

  const copy = async () => {
    await navigator.clipboard.writeText(details)
  }

  return (
    <>
      {deepUrl ? (
        <a className="itin-action" href={deepUrl} target="_blank" rel="noreferrer" title="Pre-selected exact flights">
          Google Flights ✓
        </a>
      ) : reliable ? (
        <a className="itin-action" href={searchUrl} target="_blank" rel="noreferrer">
          Google Flights
        </a>
      ) : (
        <a className="itin-action" href={searchUrl} target="_blank" rel="noreferrer" title="Approximate search">
          Google Flights (~)
        </a>
      )}
      <button type="button" className="itin-action" onClick={() => void copy()}>
        Copy details
      </button>
    </>
  )
}
