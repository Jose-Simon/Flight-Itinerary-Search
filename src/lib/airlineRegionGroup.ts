/** Map OpenFlights-style airline country names to canonical `RegionId` (same buckets as layover regions). */

import { REGION_IDS_IN_UI_ORDER, REGION_LABELS, type RegionId, isRegionId } from '../data/regions'

const COUNTRY_TO_REGION: Record<string, RegionId> = {
  'united states': 'unitedStates',
  usa: 'unitedStates',
  canada: 'northAmerica',
  mexico: 'northAmerica',
  greenland: 'northAmerica',
  bermuda: 'northAmerica',

  'costa rica': 'northAmerica',
  cuba: 'northAmerica',
  jamaica: 'northAmerica',
  panama: 'northAmerica',
  bahamas: 'northAmerica',
  'dominican republic': 'northAmerica',
  guatemala: 'northAmerica',
  honduras: 'northAmerica',
  'el salvador': 'northAmerica',
  nicaragua: 'northAmerica',
  belize: 'northAmerica',
  haiti: 'northAmerica',
  'trinidad and tobago': 'northAmerica',
  barbados: 'northAmerica',
  aruba: 'northAmerica',
  'cayman islands': 'northAmerica',
  'puerto rico': 'northAmerica',

  brazil: 'southAmerica',
  argentina: 'southAmerica',
  chile: 'southAmerica',
  colombia: 'southAmerica',
  peru: 'southAmerica',
  ecuador: 'southAmerica',
  uruguay: 'southAmerica',
  venezuela: 'southAmerica',
  bolivia: 'southAmerica',
  paraguay: 'southAmerica',
  guyana: 'southAmerica',
  suriname: 'southAmerica',

  'united kingdom': 'europe',
  france: 'europe',
  germany: 'europe',
  spain: 'europe',
  italy: 'europe',
  netherlands: 'europe',
  switzerland: 'europe',
  belgium: 'europe',
  austria: 'europe',
  sweden: 'europe',
  norway: 'europe',
  denmark: 'europe',
  finland: 'europe',
  ireland: 'europe',
  portugal: 'europe',
  greece: 'europe',
  iceland: 'europe',
  luxembourg: 'europe',
  malta: 'europe',
  cyprus: 'europe',
  estonia: 'europe',
  latvia: 'europe',
  lithuania: 'europe',
  andorra: 'europe',
  monaco: 'europe',
  'san marino': 'europe',
  'vatican city': 'europe',
  liechtenstein: 'europe',

  poland: 'europe',
  'czech republic': 'europe',
  hungary: 'europe',
  romania: 'europe',
  bulgaria: 'europe',
  croatia: 'europe',
  serbia: 'europe',
  slovenia: 'europe',
  slovakia: 'europe',
  'bosnia and herzegovina': 'europe',
  montenegro: 'europe',
  albania: 'europe',
  'north macedonia': 'europe',

  russia: 'europe',
  'russian federation': 'europe',
  belarus: 'europe',
  ukraine: 'europe',
  moldova: 'europe',
  azerbaijan: 'europe',
  armenia: 'europe',
  georgia: 'europe',

  kazakhstan: 'asia',
  uzbekistan: 'asia',
  turkmenistan: 'asia',
  kyrgyzstan: 'asia',
  tajikistan: 'asia',
  afghanistan: 'asia',

  'saudi arabia': 'middleEast',
  turkey: 'middleEast',
  'united arab emirates': 'middleEast',
  qatar: 'middleEast',
  kuwait: 'middleEast',
  bahrain: 'middleEast',
  oman: 'middleEast',
  israel: 'middleEast',
  jordan: 'middleEast',
  lebanon: 'middleEast',
  iraq: 'middleEast',
  iran: 'middleEast',
  yemen: 'middleEast',
  syria: 'middleEast',

  egypt: 'africa',
  'south africa': 'africa',
  kenya: 'africa',
  nigeria: 'africa',
  ethiopia: 'africa',
  morocco: 'africa',
  tunisia: 'africa',
  algeria: 'africa',
  ghana: 'africa',
  tanzania: 'africa',
  uganda: 'africa',
  zimbabwe: 'africa',
  botswana: 'africa',
  namibia: 'africa',
  mozambique: 'africa',
  angola: 'africa',
  sudan: 'africa',
  senegal: 'africa',
  cameroon: 'africa',
  'ivory coast': 'africa',
  mauritius: 'africa',
  rwanda: 'africa',
  libya: 'africa',

  india: 'india',
  pakistan: 'asia',
  bangladesh: 'asia',
  'sri lanka': 'asia',
  nepal: 'asia',
  maldives: 'asia',
  bhutan: 'asia',

  china: 'asia',
  japan: 'asia',
  'south korea': 'asia',
  korea: 'asia',
  'north korea': 'asia',
  taiwan: 'asia',
  mongolia: 'asia',
  'hong kong': 'asia',
  macau: 'asia',

  thailand: 'asia',
  singapore: 'asia',
  malaysia: 'asia',
  indonesia: 'asia',
  philippines: 'asia',
  vietnam: 'asia',
  'myanmar (burma)': 'asia',
  myanmar: 'asia',
  cambodia: 'asia',
  laos: 'asia',
  brunei: 'asia',
  'east timor': 'asia',

  australia: 'oceania',
  'new zealand': 'oceania',
  fiji: 'oceania',
  'papua new guinea': 'oceania',
}

/** Normalize OpenFlights / messy strings before `COUNTRY_TO_REGION` lookup. */
const COUNTRY_ALIASES: Record<string, string> = {
  'the netherlands': 'netherlands',
  holland: 'netherlands',
  'united states of america': 'united states',
  'u.s.a.': 'united states',
  'u.s.': 'united states',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  britain: 'united kingdom',
  england: 'united kingdom',
  scotland: 'united kingdom',
  wales: 'united kingdom',
  'northern ireland': 'united kingdom',
  uae: 'united arab emirates',
  'u.a.e.': 'united arab emirates',
  czechia: 'czech republic',
  turkiye: 'turkey',
  türkiye: 'turkey',
  'korea, republic of': 'south korea',
  'republic of korea': 'south korea',
  'viet nam': 'vietnam',
  "côte d'ivoire": 'ivory coast',
  "cote d'ivoire": 'ivory coast',
}

export function airlineCountryToRegion(country: string): RegionId {
  let k = country.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!k || k === 'unknown' || k === '\\n') return 'otherHubs'
  k = COUNTRY_ALIASES[k] ?? k
  return COUNTRY_TO_REGION[k] ?? 'otherHubs'
}

const AIRLINE_IATA_REGION_OVERRIDE: Record<string, RegionId> = {
  AI: 'india',
  '6E': 'india',
  /** Akasa Air — OpenFlights mislabels QP as “Air Kenya (Priv)”. */
  QP: 'india',
  /** Flyadeal (Saudi); OpenFlights `F3` is a different carrier — keep Middle East when API sends IATA F3. */
  F3: 'middleEast',
  SV: 'middleEast',
  CX: 'asia',
  AZ: 'europe',
  KL: 'europe',
  LO: 'europe',
  /** Discover Airlines (Eurowings Discover); OpenFlights lists 4Y as “Airbus France”. */
  '4Y': 'europe',
  /** Kenya Airways — Africa. */
  KQ: 'africa',
}

export function airlineRegionForAirline(
  iataCode: string,
  country: string,
  persistedOverrides?: Record<string, RegionId> | null,
): RegionId {
  const code = iataCode.trim().toUpperCase()
  const fromDb = persistedOverrides?.[code]
  if (fromDb) return fromDb
  const o = AIRLINE_IATA_REGION_OVERRIDE[code]
  if (o) return o
  return airlineCountryToRegion(country)
}

/** @deprecated Use `airlineRegionForAirline` */
export const airlineUiRegionForAirline = airlineRegionForAirline

/** UI sort order for airline buckets (matches layover panel). */
export const AIRLINE_REGION_BUCKET_ORDER: readonly RegionId[] = REGION_IDS_IN_UI_ORDER

export function compareRegions(a: RegionId, b: RegionId): number {
  const ia = REGION_IDS_IN_UI_ORDER.indexOf(a)
  const ib = REGION_IDS_IN_UI_ORDER.indexOf(b)
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
}

/** Human-readable title for filter UI. */
export function regionTitle(id: RegionId): string {
  return REGION_LABELS[id]
}

/** v1 `RegionId` (or long-hand labels) → current `RegionId`. */
const LEGACY_V1_REGION_ID: Record<string, RegionId> = {
  canada: 'northAmerica',
  centralAmericaCaribbean: 'northAmerica',
  europeWest: 'europe',
  easternEurope: 'europe',
  russiaCis: 'europe',
  china: 'asia',
  northeastAsia: 'asia',
  southeastAsia: 'asia',
  centralAsia: 'asia',
  southAsia: 'asia',
}

export const LEGACY_AIRLINE_REGION_LABEL_TO_ID: Record<string, RegionId> = {
  'north america': 'northAmerica',
  'united states': 'unitedStates',
  'central america & caribbean': 'northAmerica',
  'south america': 'southAmerica',
  europe: 'europe',
  'eastern europe': 'europe',
  'russia & cis': 'europe',
  russia: 'europe',
  'middle east': 'middleEast',
  india: 'india',
  asia: 'asia',
  africa: 'africa',
  'south asia': 'asia',
  'east asia': 'asia',
  'southeast asia': 'asia',
  'central asia': 'asia',
  'east asia (china / hong kong / taiwan)': 'asia',
  'japan & korea': 'asia',
  'oceania & pacific': 'oceania',
  other: 'otherHubs',
}

function normalizeV1OrLegacyId(raw: string): RegionId | null {
  const t = raw.trim()
  if (!t) return null
  if (isRegionId(t)) return t
  const m1 = LEGACY_V1_REGION_ID[t] ?? LEGACY_V1_REGION_ID[t.toLowerCase()] ?? null
  if (m1) return m1
  const m2 = LEGACY_AIRLINE_REGION_LABEL_TO_ID[t.toLowerCase()]
  return m2 ?? null
}

export function normalizeStoredAirlineRegion(raw: string): RegionId | null {
  return normalizeV1OrLegacyId(raw)
}

export function parseRegionIdFromSettingsToken(token: string): RegionId | null {
  const t = token.trim()
  if (!t) return null
  if (isRegionId(t)) return t
  const up = t.toUpperCase()
  if (up === 'US' || up === 'USA') return 'unitedStates'
  return normalizeV1OrLegacyId(t)
}
