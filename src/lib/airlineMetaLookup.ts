export type AirlinesMeta = Record<string, { name: string; country: string }>

export type EnrichedAirline = {
  /** Uppercased key from search results — must match segment `airline` for exclusions. */
  filterKey: string
  displayName: string
  /** IATA when known from OpenFlights (may differ from filterKey when API sent a full name). */
  iata: string | null
  country: string
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(airlines?|airways|aviation|limited|ltd\.?|inc\.?|plc)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

/**
 * SerpApi / Google Flights often returns a marketing name that is not a valid OpenFlights key.
 * Full display + country (do not trust `airlinesMeta.json` for these IATA codes when the name differs).
 */
const SERP_BRAND_AIRLINE: Record<string, { iata: string; displayName: string; country: string }> = {
  FLYADEAL: { iata: 'F3', displayName: 'Flyadeal', country: 'Saudi Arabia' },
  SAUDIA: { iata: 'SV', displayName: 'Saudia', country: 'Saudi Arabia' },
}

/**
 * Search results are often a marketing name, not 2-letter IATA. OpenFlights is keyed by IATA. Map
 * high-traffic strings to IATA so we can load country/region. (QP in OpenFlights is wrong for Akasa; region uses IATA
 * overrides in `airlineRegionGroup`.)
 */
const SERP_BRAND_NAME_TO_IATA: Record<string, string> = {
  AKASA: 'QP',
  'AKASA AIR': 'QP',
}

/** OpenFlights name/country fixes (regenerated `airlinesMeta.json` would otherwise overwrite raw data). */
const IATA_ENRICH_OVERRIDES: Record<string, { displayName?: string; country?: string }> = {
  /** Passenger airline Discover Airlines — OpenFlights uses “Airbus France”. */
  '4Y': { displayName: 'Discover Airlines', country: 'Germany' },
  /**
   * Akasa Air (India). OpenFlights still has IATA QP as “Air Kenya (Priv)” / Kenya — wrong carrier;
   * region override in `airlineRegionGroup` also keeps QP in the India bucket.
   */
  QP: { displayName: 'Akasa Air', country: 'India' },
}

function applyIataEnrichOverride(
  iata: string,
  displayName: string,
  country: string,
): { displayName: string; country: string } {
  const o = IATA_ENRICH_OVERRIDES[iata.toUpperCase()]
  if (!o) return { displayName, country }
  return {
    displayName: o.displayName ?? displayName,
    country: o.country ?? country,
  }
}

/**
 * SerpApi often returns a full airline name; OpenFlights meta is keyed by IATA.
 * Resolve to country for region grouping while keeping filterKey aligned with raw results.
 */
export function enrichAirlineFromMeta(
  rawFromSegment: string,
  meta: AirlinesMeta,
  nameFallback: Record<string, string>,
): EnrichedAirline {
  const raw = rawFromSegment.trim()
  const filterKey = raw.toUpperCase()
  const normKey = filterKey.replace(/\s+/g, ' ')

  const brandFixed = SERP_BRAND_AIRLINE[normKey]
  if (brandFixed) {
    return {
      filterKey,
      displayName: brandFixed.displayName,
      iata: brandFixed.iata,
      country: brandFixed.country,
    }
  }

  const brandIata = SERP_BRAND_NAME_TO_IATA[filterKey] ?? SERP_BRAND_NAME_TO_IATA[raw.toUpperCase().replace(/\s+/g, ' ')]
  if (brandIata && meta[brandIata]) {
    const m = meta[brandIata]
    const fixed = applyIataEnrichOverride(brandIata, m.name, m.country)
    return { filterKey, displayName: fixed.displayName, iata: brandIata, country: fixed.country }
  }

  const direct = meta[filterKey]
  if (direct) {
    const fixed = applyIataEnrichOverride(filterKey, direct.name, direct.country)
    return {
      filterKey,
      displayName: fixed.displayName,
      iata: filterKey,
      country: fixed.country,
    }
  }

  const lower = raw.toLowerCase()
  for (const [iata, m] of Object.entries(meta)) {
    if (m.name.trim().toLowerCase() === lower) {
      const fixed = applyIataEnrichOverride(iata, m.name, m.country)
      return { filterKey, displayName: fixed.displayName, iata, country: fixed.country }
    }
  }

  const nn = normName(raw)
  if (nn.length >= 3) {
    for (const [iata, m] of Object.entries(meta)) {
      const mn = normName(m.name)
      if (mn.length < nn.length) continue
      if (mn === nn) {
        const fixed = applyIataEnrichOverride(iata, m.name, m.country)
        return { filterKey, displayName: fixed.displayName, iata, country: fixed.country }
      }
      if (mn.startsWith(nn) && (mn.length === nn.length || mn[nn.length] === ' ')) {
        const fixed = applyIataEnrichOverride(iata, m.name, m.country)
        return { filterKey, displayName: fixed.displayName, iata, country: fixed.country }
      }
    }
  } else if (nn.length === 2) {
    for (const [iata, m] of Object.entries(meta)) {
      if (normName(m.name) === nn) {
        const fixed = applyIataEnrichOverride(iata, m.name, m.country)
        return { filterKey, displayName: fixed.displayName, iata, country: fixed.country }
      }
    }
  }

  return {
    filterKey,
    displayName: nameFallback[filterKey] ?? raw,
    iata: /^[A-Z0-9]{2}$/i.test(filterKey) ? filterKey : null,
    country: 'Unknown',
  }
}
