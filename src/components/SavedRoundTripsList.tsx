import type { SavedResultRow } from '../db/savedResultTypes'
import type { SavedResultPayloadV2 } from '../db/savedResultTypes'
import { formatPriceAmount } from '../lib/formatPrice'
import { buildGoogleFlightsDeepLink, buildGoogleFlightsSearchUrl, itineraryDetailsText } from '../lib/googleFlightsLink'
import { ItineraryCard } from './ItineraryCard'
import type { AirlinesMeta } from '../lib/airlineMetaLookup'

type Props = {
  items: SavedResultRow[]
  currency: string
  onRemove: (scheduleKey: string) => void
  tzByIata: Map<string, string>
  displayTimezone: string
  airlineDirectory: Record<string, string>
  airlinesMeta: AirlinesMeta
  namesByIata: Map<string, string>
  layoverLongMinHours: number
  layoverShortMaxHours: number
}

function shortDateWithDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function SavedRoundTripsList({
  items,
  currency,
  onRemove,
  tzByIata,
  displayTimezone,
  airlineDirectory,
  airlinesMeta,
  namesByIata,
  layoverLongMinHours,
  layoverShortMaxHours,
}: Props) {
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

          const sharedCardProps = {
            tzByIata,
            displayTimezone,
            airlineDirectory,
            airlinesMeta,
            namesByIata,
            layoverLongMinHours,
            layoverShortMaxHours,
            priceCurrency: currency,
          }

          return (
            <li key={row.id} className="srt-card">
              <div className="srt-legs">
                <div className="srt-leg">
                  <span className="srt-leg-label">Outbound · {shortDateWithDay(p.outboundDate)}</span>
                  <ItineraryCard
                    {...sharedCardProps}
                    it={p.outboundItinerary}
                    gfOrigins={p.gfOrigins}
                    gfDestinations={p.gfDestinations}
                    linkDate={p.outboundDate}
                    returnDate={p.returnDate}
                  />
                </div>
                <div className="srt-leg srt-leg--return">
                  <span className="srt-leg-label">Return · {shortDateWithDay(p.returnDate)}</span>
                  <ItineraryCard
                    {...sharedCardProps}
                    it={p.returnItinerary}
                    gfOrigins={p.gfDestinations}
                    gfDestinations={p.gfOrigins}
                    linkDate={p.returnDate}
                    returnDate={null}
                  />
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
                  title={deepUrl ? 'Pre-selected exact flights (round trip)' : reliable ? undefined : 'Approximate — multi-origin/destination'}
                >
                  Google Flights{deepUrl ? ' ✓' : (!reliable ? ' (~)' : '')} (round trip)
                </a>
                <button type="button" className="itin-action" onClick={() => void copyDetails()}>
                  Copy both legs
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
