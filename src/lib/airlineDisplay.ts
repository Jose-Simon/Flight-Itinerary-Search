import type { NormalizedSegment } from './types'
import { enrichAirlineFromMeta, type AirlinesMeta, type EnrichedAirline } from './airlineMetaLookup'

function normalizeHttpsUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const withProto = t.startsWith('//') ? `https:${t}` : t
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

function isTrustedAirlineLogoHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === 'www.gstatic.com' ||
    h === 'gstatic.com' ||
    h.endsWith('.gstatic.com') ||
    h === 'www.google.com' ||
    h === 'google.com' ||
    h.endsWith('.google.com')
  )
}

export function isTrustedAirlineLogoUrl(url: string): boolean {
  const n = normalizeHttpsUrl(url)
  if (!n) return false
  try {
    return isTrustedAirlineLogoHost(new URL(n).hostname)
  } catch {
    return false
  }
}

/** Google Flights–style logo; `iataCode` must be exactly two IATA characters (letters/digits). */
export function airlineLogoUrl(iataCode: string | undefined): string | null {
  if (!iataCode) return null
  const c = iataCode.trim().toUpperCase()
  if (!/^[A-Z0-9]{2}$/.test(c)) return null
  return `https://www.gstatic.com/flights/airline_logos/70px/${c}.png`
}

function effectiveLogoIata(e: EnrichedAirline): string | null {
  if (e.iata && /^[A-Z0-9]{2}$/.test(e.iata)) return e.iata
  if (/^[A-Z0-9]{2}$/.test(e.filterKey)) return e.filterKey
  return null
}

/**
 * Prefer HTTPS logo URL from SerpApi when it points at Google static assets;
 * otherwise resolve IATA via OpenFlights meta (never use the first two letters of a full name).
 */
export function segmentAirlineLogoFromEnriched(
  segment: Pick<NormalizedSegment, 'airlineLogo'>,
  enriched: EnrichedAirline,
): string | null {
  const raw = segment.airlineLogo?.trim()
  if (raw) {
    const n = normalizeHttpsUrl(raw)
    if (n && isTrustedAirlineLogoUrl(n)) return n
  }
  return airlineLogoUrl(effectiveLogoIata(enriched) ?? undefined)
}

export function segmentAirlineLogoSrc(
  segment: Pick<NormalizedSegment, 'airline' | 'airlineLogo'>,
  meta: AirlinesMeta,
  nameFallback: Record<string, string>,
): string | null {
  const e = enrichAirlineFromMeta(segment.airline ?? '', meta, nameFallback)
  return segmentAirlineLogoFromEnriched(segment, e)
}

export function airlineDisplayName(
  code: string | undefined,
  directory: Record<string, string>,
): string {
  if (!code) return ''
  const u = code.trim().toUpperCase()
  const full = directory[u]
  if (full) return `${u} (${full})`
  return u
}
