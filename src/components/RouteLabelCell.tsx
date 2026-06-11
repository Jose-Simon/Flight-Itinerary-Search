import { marketingCarrierLogoUrl } from '../lib/airlineDisplay'
import { enrichAirlineFromMeta, type AirlinesMeta } from '../lib/airlineMetaLookup'

const MAX_LOGO_SLOTS = 3

export type RouteLabelCellProps = {
  routeKey: string
  namesByIata: Map<string, string>
  airlinesMeta?: AirlinesMeta
  airlineDirectory?: Record<string, string>
  /** Smaller logos for heatmap route picker. */
  compact?: boolean
}

/** Route column cell: fixed 3-slot logo rail + airport path + marketing carrier name(s). */
export function RouteLabelCell({
  routeKey,
  namesByIata,
  airlinesMeta = {},
  airlineDirectory = {},
  compact = false,
}: RouteLabelCellProps) {
  const [waypoint, carriersRaw = ''] = routeKey.split('|')
  const airports = waypoint.split('-')
  const path = airports.join(' › ')
  const fullTitle = airports
    .map((iata) => {
      const name = namesByIata.get(iata)
      return name ? `${name} (${iata})` : iata
    })
    .join(' › ')

  const carrierTokens = carriersRaw ? carriersRaw.split(',').filter(Boolean).slice(0, MAX_LOGO_SLOTS) : []
  const filledCount = carrierTokens.length
  const slots = Array.from({ length: MAX_LOGO_SLOTS }, (_, i) => carrierTokens[i] ?? null)
  const carrierNames = carrierTokens
    .map((code) => enrichAirlineFromMeta(code, airlinesMeta, airlineDirectory).displayName.toUpperCase())
    .join(', ')

  const rootClass = compact ? 'pw-route-label pw-route-label--compact' : 'pw-route-label'
  const logosClass =
    `pw-route-logos pw-route-logos--filled-${filledCount}`

  return (
    <div className={rootClass} title={fullTitle}>
      <div className={logosClass} aria-hidden={filledCount === 0}>
        {slots.map((token, i) => (
          <div key={i} className="pw-route-logo-slot">
            {token ? (
              <RouteLogo token={token} airlinesMeta={airlinesMeta} airlineDirectory={airlineDirectory} />
            ) : null}
          </div>
        ))}
      </div>
      <div className="pw-route-text">
        <span className="pw-route-path">{path}</span>
        {carrierNames ? <span className="pw-route-carriers">{carrierNames}</span> : null}
      </div>
    </div>
  )
}

function RouteLogo({
  token,
  airlinesMeta,
  airlineDirectory,
}: {
  token: string
  airlinesMeta: AirlinesMeta
  airlineDirectory: Record<string, string>
}) {
  const src = marketingCarrierLogoUrl(token, airlinesMeta, airlineDirectory)
  if (!src) return <span className="pw-route-logo pw-route-logo--empty" aria-hidden />
  return (
    <img
      src={src}
      alt=""
      className="pw-route-logo"
      loading="lazy"
      onError={(e) => {
        const el = e.target as HTMLImageElement
        el.style.display = 'none'
        el.parentElement?.classList.add('pw-route-logo-slot--failed')
      }}
    />
  )
}
