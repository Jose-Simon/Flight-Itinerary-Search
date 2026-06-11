import { Fragment } from 'react'
import type { NormalizedItinerary, NormalizedSegment } from '../lib/types'
import { buildGoogleFlightsDeepLink, buildGoogleFlightsSearchUrl, itineraryDetailsText } from '../lib/googleFlightsLink'
import { totalFlightMinutes } from '../lib/filters'
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

// ── Helpers ────────────────────────────────────────────────────────────────

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

function airportLine(iata: string, names: Map<string, string>): string {
  const n = names.get(iata)
  return n ? `${n} (${iata})` : iata
}

function amenityIcon(amenity: string): string {
  const a = amenity.toLowerCase()
  if (a.includes('wi-fi') || a.includes('wifi')) return '📶 '
  if (a.includes('power') || a.includes('usb') || a.includes('outlet')) return '⚡ '
  if (a.includes('video') || a.includes('tv') || a.includes('media') || a.includes('stream')) return '🎬 '
  if (a.includes('lie flat') || a.includes('suite')) return '🛏 '
  if (a.includes('seat')) return '💺 '
  return ''
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

// ── Sub-components ─────────────────────────────────────────────────────────

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
    | { kind: 'lay'; minutes: number; airport: string; tone: ReturnType<typeof layoverTone> }

  const chunks: Chunk[] = []
  for (let i = 0; i < it.segments.length; i++) {
    const seg = it.segments[i]
    chunks.push({ kind: 'seg', i, minutes: Math.max(1, seg.durationMinutes), seg })
    const lay = it.layovers[i]
    if (lay) {
      chunks.push({
        kind: 'lay',
        minutes: Math.max(1, lay.durationMinutes),
        airport: lay.airport,
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
                <span className="itin-bar-chunk-label">{seg.dep}–{seg.arr}</span>
                <span className="itin-bar-chunk-sub">{fmtBarMin(seg.durationMinutes)}</span>
              </div>
            )
          }
          const toneClass =
            c.tone === 'long' ? ' itin-bar-layover--long' : c.tone === 'short' ? ' itin-bar-layover--short' : ''
          return (
            <div
              key={`lay-${c.airport}-${idx}`}
              className={`itin-bar-chunk itin-bar-layover${toneClass}`}
              style={{ flex: `${grow} 1 0` }}
              title={`Layover ${c.airport} · ${fmtMin(c.minutes)}`}
            >
              <span className="itin-bar-chunk-label">{c.airport}</span>
              <span className="itin-bar-chunk-sub">{fmtBarMin(c.minutes)}</span>
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

// ── Public API ─────────────────────────────────────────────────────────────

export type ItineraryCardProps = {
  it: NormalizedItinerary
  tzByIata: Map<string, string>
  displayTimezone: string
  airlineDirectory: Record<string, string>
  airlinesMeta: AirlinesMeta
  namesByIata: Map<string, string>
  layoverLongMinHours: number
  layoverShortMaxHours: number
  priceCurrency: string
  /** Origins used for the Google Flights search link. */
  gfOrigins: string[]
  /** Destinations used for the Google Flights search link. */
  gfDestinations: string[]
  /** Departure date for this leg (ISO). */
  linkDate: string
  /** Return date passed to the GF search URL (null for one-way / return-leg). */
  returnDate?: string | null
  /** Per-itinerary link override (used by saved results where the stored origins/dates differ). */
  gfLinkOverride?: { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }
  showOpenJaw?: boolean
  /** Hide per-leg fare (e.g. round-trip bundle shown once above the cards). */
  hideFare?: boolean
  /** Extra action buttons rendered at the bottom of the card (e.g. Save / Remove). */
  actions?: React.ReactNode
  /** Cabin class for the Google Flights deep link: 1=Economy (default), 2=Premium Economy, 3=Business, 4=First */
  travelClass?: number
}

/**
 * Full itinerary detail card — the same rich card shown in the Discovery results
 * (duration bar, airline logos, stop timeline). Reusable across Saved Round Trips
 * and the Price Window selection summary.
 */
export function ItineraryCard({
  it,
  tzByIata,
  displayTimezone,
  airlineDirectory,
  airlinesMeta,
  namesByIata,
  layoverLongMinHours,
  layoverShortMaxHours,
  priceCurrency,
  gfOrigins,
  gfDestinations,
  linkDate,
  returnDate,
  gfLinkOverride,
  showOpenJaw = false,
  hideFare = false,
  actions,
  travelClass = 1,
}: ItineraryCardProps) {
  const tripStart = tripStartDisplayAnchor(it.segments[0], tzByIata, displayTimezone)
  const o = gfLinkOverride ?? { gfOrigins, gfDestinations, linkDate, returnDate: returnDate ?? null }
  // Use actual first-segment departure date (not the search range start).
  const actualDate = it.segments[0]?.depTime?.slice(0, 10) || o.linkDate
  // Always roundTrip=true (root.2=2): GF resolves single-leg TFS to the booking page
  // with root.2=2; root.2=1 (one-way) requires a tfu token and falls back to landing page.
  const deepUrl = buildGoogleFlightsDeepLink(it, actualDate, null, null, 1, 0, true, travelClass)
  const { url: searchUrl, reliable } = buildGoogleFlightsSearchUrl(
    o.gfOrigins, o.gfDestinations, actualDate, o.returnDate
  )
  const details = itineraryDetailsText(it, 'Itinerary', actualDate)
  const copy = async () => { await navigator.clipboard.writeText(details) }

  return (
    <div className="card card-flight itin-card">
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
          {!hideFare && it.price != null ? (
            <div className="itin-hero-duration-block">
              <div className="itin-hero-duration itin-hero-price-figure" title="Fare from search">
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
            {showOpenJaw ? (
              <div className="itin-card-head-badges">
                <span className="badge badge-oj">Open jaw</span>
              </div>
            ) : null}
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
              const depPlus = calendarDayOffsetFromTripStart(s.depTime, s.dep, tripStart, tzByIata, displayTimezone)
              const arrPlus = calendarDayOffsetFromTripStart(s.arrTime, s.arr, tripStart, tzByIata, displayTimezone)
              const layTone = lay ? layoverTone(lay.durationMinutes, layoverLongMinHours, layoverShortMaxHours) : null
              const layRowClass =
                layTone == null ? '' : layTone === 'normal' ? 'tl-layover' : `tl-layover tl-layover--${layTone}`

              return (
                <Fragment key={`seg-${i}`}>
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
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
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
                    <div className="tl-travel-meta">
                      <p className="tl-travel-meta-line">
                        In flight {fmtTravelHrs(s.durationMinutes)}
                        {tl.overnight ? <span className="tl-overnight"> · Overnight</span> : null}
                      </p>
                      <div className="tl-seg-badges">
                        {s.legroom != null && (
                          <span className="tl-badge tl-badge--legroom" title="Seat pitch">
                            ↕ {s.legroom} in
                          </span>
                        )}
                        {s.oftenDelayed && (
                          <span className="tl-badge tl-badge--delay" title="Often delayed by 30+ min">
                            ⚠ Often delayed
                          </span>
                        )}
                        {s.amenities?.map((a) => (
                          <span key={a} className="tl-badge tl-badge--amenity">{amenityIcon(a)}{a}</span>
                        ))}
                      </div>
                    </div>
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
            {actions}
          </div>
        </div>
      </div>
    </div>
  )
}
