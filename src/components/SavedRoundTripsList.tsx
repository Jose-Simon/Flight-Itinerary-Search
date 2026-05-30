import type { SavedResultRow } from '../db/savedResultTypes'
import type { SavedResultPayloadV2 } from '../db/savedResultTypes'
import type { NormalizedItinerary, NormalizedSegment } from '../lib/types'
import { formatPriceAmount } from '../lib/formatPrice'
import { buildGoogleFlightsDeepLink, buildGoogleFlightsSearchUrl, itineraryDetailsText } from '../lib/googleFlightsLink'

type Props = {
  items: SavedResultRow[]
  currency: string
  onRemove: (scheduleKey: string) => void
}

function formatMins(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`
}

function shortDateWithDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function timeHM(raw: string | undefined): string {
  if (!raw) return '—'
  return raw.length >= 5 ? raw.slice(-5) : raw
}

function ItinLines({ it, currency }: { it: NormalizedItinerary; currency: string }) {
  return (
    <div className="srt-itin">
      {it.segments.map((seg: NormalizedSegment, i: number) => (
        <div key={i}>
          <div className="srt-seg">
            <span className="srt-airline">{seg.airline ?? ''}</span>
            {seg.flightNumber && <span className="srt-fn">{seg.flightNumber}</span>}
            <span className="srt-route">
              {seg.dep} {timeHM(seg.depTime)} → {seg.arr} {timeHM(seg.arrTime)}
            </span>
            <span className="srt-dur muted">{formatMins(seg.durationMinutes)}</span>
          </div>
          {it.layovers[i] && !it.layovers[i].isTechnical && (
            <div className="srt-layover muted small">
              ↳ {it.layovers[i].airport} · {formatMins(it.layovers[i].durationMinutes)} layover
            </div>
          )}
        </div>
      ))}
      <div className="srt-itin-footer">
        {formatMins(it.totalDurationMinutes)}
        {it.price != null ? ` · ${formatPriceAmount(it.price, currency)}` : ''}
      </div>
    </div>
  )
}

export function SavedRoundTripsList({ items, currency, onRemove }: Props) {
  if (items.length === 0) return null

  return (
    <section className="srt-section">
      <h2 className="srt-section-title">Saved round trips <span className="main-tab-count">{items.length}</span></h2>
      <ul className="srt-list">
        {items.map((row) => {
          const p = row.payload as SavedResultPayloadV2
          const outPrice = p.outboundItinerary.price
          const retPrice = p.returnItinerary.price
          const total = outPrice != null && retPrice != null ? outPrice + retPrice : null

          const deepUrl = buildGoogleFlightsDeepLink(
            p.outboundItinerary, p.outboundDate, p.returnItinerary, p.returnDate,
          )
          const { url: searchUrl, reliable } = buildGoogleFlightsSearchUrl(
            p.gfOrigins, p.gfDestinations, p.outboundDate, p.returnDate,
          )
          const url = deepUrl ?? searchUrl

          const copyDetails = async () => {
            const lines = [
              itineraryDetailsText(p.outboundItinerary, 'Outbound', p.outboundDate),
              '',
              itineraryDetailsText(p.returnItinerary, 'Return', p.returnDate),
            ]
            if (total != null) lines.push('', `Total: ${formatPriceAmount(total, currency)}`)
            await navigator.clipboard.writeText(lines.join('\n'))
          }

          return (
            <li key={row.id} className="srt-card">
              <div className="srt-legs">
                <div className="srt-leg">
                  <span className="srt-leg-label">Outbound · {shortDateWithDay(p.outboundDate)}</span>
                  <ItinLines it={p.outboundItinerary} currency={currency} />
                </div>
                <div className="srt-leg srt-leg--return">
                  <span className="srt-leg-label">Return · {shortDateWithDay(p.returnDate)}</span>
                  <ItinLines it={p.returnItinerary} currency={currency} />
                </div>
              </div>

              {total != null && (
                <div className="srt-total">
                  Round-trip total:{' '}
                  <strong className="srt-total-value">{formatPriceAmount(total, currency)}</strong>
                  <span className="srt-total-breakdown muted">
                    {' '}({formatPriceAmount(outPrice!, currency)} + {formatPriceAmount(retPrice!, currency)})
                  </span>
                </div>
              )}

              <div className="srt-actions">
                <a
                  className="itin-action"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={deepUrl ? 'Pre-selected exact flights' : reliable ? undefined : 'Approximate — multi-origin/destination'}
                >
                  Google Flights{deepUrl ? ' ✓' : (!reliable ? ' (~)' : '')}
                </a>
                <button type="button" className="itin-action" onClick={() => void copyDetails()}>
                  Copy details
                </button>
                <button
                  type="button"
                  className="itin-action itin-action--danger"
                  onClick={() => onRemove(row.scheduleKey)}
                  title="Remove from saved results"
                >
                  Remove
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
