/**
 * Canonical `RegionId`: layover geography, airline filter buckets, `region_country` / `region_catalog`.
 * v2: fewer buckets — US & India separate; “North America” = Canada + Central America + Caribbean; Europe, Asia, etc.
 */

const CA_CAR = [
  'MX', 'BZ', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'CU', 'JM', 'HT', 'DO', 'BS', 'BB', 'AG', 'AI', 'AW', 'BM', 'KY',
  'LC', 'MS', 'GD', 'VC', 'KN', 'DM', 'TT', 'TC', 'VG', 'VI', 'BQ', 'CW', 'SX', 'BL', 'MF', 'GP', 'MQ', 'PR',
]

const EU_W = [
  'GB', 'IE', 'GG', 'JE', 'IM', 'AX', 'FR', 'DE', 'NL', 'BE', 'LU', 'CH', 'AT', 'IT', 'ES', 'PT', 'GR', 'MT', 'CY',
  'GI', 'IS', 'NO', 'SE', 'DK', 'FI', 'EE', 'LV', 'LT', 'AD', 'MC', 'SM', 'VA', 'LI',
]

const EU_E = ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'RS', 'BA', 'MK', 'AL', 'ME']

const RU = ['RU', 'BY', 'UA', 'MD', 'AZ', 'AM', 'GE']

const AS_SEA = ['TH', 'VN', 'MY', 'SG', 'ID', 'PH', 'MM', 'KH', 'LA', 'BN', 'TL']

const AS_CN = ['CN', 'HK', 'MO', 'TW']
const AS_JK = ['JP', 'KR']
const AS_CAS = ['KZ', 'UZ', 'TM', 'KG', 'TJ', 'AF']
const S_ASI = ['PK', 'BD', 'LK', 'NP', 'MV', 'BT']

function uniq(isos: string[]): string[] {
  return [...new Set(isos.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort()
}

export const REGION_IDS_IN_UI_ORDER = [
  'unitedStates',
  'northAmerica',
  'europe',
  'asia',
  'india',
  'middleEast',
  'africa',
  'southAmerica',
  'oceania',
  'otherHubs',
] as const

export type RegionId = (typeof REGION_IDS_IN_UI_ORDER)[number]

export const REGION_LABELS: Record<RegionId, string> = {
  unitedStates: 'United States',
  northAmerica: 'North America',
  europe: 'Europe',
  asia: 'Asia',
  india: 'India',
  middleEast: 'Middle East',
  africa: 'Africa',
  southAmerica: 'South America',
  oceania: 'Oceania',
  otherHubs: 'Other',
}

export const DEFAULT_REGION_COUNTRIES: Record<RegionId, string[]> = {
  unitedStates: ['US'],
  northAmerica: uniq(['CA', 'GL', ...CA_CAR]),
  europe: uniq([...EU_W, ...EU_E, ...RU]),
  asia: uniq([...S_ASI, ...AS_SEA, ...AS_CAS, ...AS_CN, ...AS_JK]),
  india: ['IN'],
  middleEast: [
    'AE', 'SA', 'QA', 'BH', 'KW', 'OM', 'YE', 'IQ', 'IR', 'JO', 'LB', 'SY', 'IL', 'PS', 'TR',
  ],
  africa: [
    'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ',
    'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE',
    'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'EH', 'ZM', 'ZW',
  ],
  southAmerica: ['BR', 'AR', 'CL', 'CO', 'PE', 'EC', 'UY', 'VE', 'BO', 'PY', 'GY', 'SR', 'GF'],
  oceania: ['AU', 'NZ', 'FJ', 'PG', 'SB', 'NC', 'PF', 'WS', 'TO', 'VU', 'GU', 'MP', 'AS', 'CK', 'NU'],
  otherHubs: [],
}

/** ISO → first matching layover region from {@link DEFAULT_REGION_COUNTRIES} (stable for airport UI). */
const ISO_COUNTRY_TO_REGION_ID = new Map<string, RegionId>()
for (const rid of REGION_IDS_IN_UI_ORDER) {
  if (rid === 'otherHubs') continue
  for (const iso of DEFAULT_REGION_COUNTRIES[rid]) {
    const u = iso.trim().toUpperCase()
    if (!ISO_COUNTRY_TO_REGION_ID.has(u)) ISO_COUNTRY_TO_REGION_ID.set(u, rid)
  }
}

export function regionIdForCountryIso(iso: string): RegionId | null {
  const u = iso?.trim().toUpperCase()
  if (!u) return null
  return ISO_COUNTRY_TO_REGION_ID.get(u) ?? null
}

/** Human region name for an ISO country (e.g. Middle East, Asia), or null if unmapped / Other. */
export function regionUiLabelForCountryIso(iso: string): string | null {
  const id = regionIdForCountryIso(iso)
  if (!id || id === 'otherHubs') return null
  return REGION_LABELS[id]
}

/**
 * Country + optional region for airport dropdowns, e.g. `India` or `Saudi Arabia, Middle East`.
 * Skips repeating the region when it matches the country name (e.g. India / India).
 */
export function airportCatalogLocationSuffix(country: string, countryIso: string): string {
  const c = country.trim()
  const region = regionUiLabelForCountryIso(countryIso)
  if (!c && !region) return ''
  if (!region || region.toLowerCase() === c.toLowerCase()) return c
  return `${c}, ${region}`
}

export function isRegionId(s: string): s is RegionId {
  return (REGION_IDS_IN_UI_ORDER as readonly string[]).includes(s)
}

export function cloneDefaultRegions(): Record<RegionId, string[]> {
  const o = {} as Record<RegionId, string[]>
  for (const k of REGION_IDS_IN_UI_ORDER) {
    o[k] = [...DEFAULT_REGION_COUNTRIES[k]]
  }
  return o
}

/**
 * User-edited `region_country` rows merged with app defaults. Defaults always win for inclusion: a country in the
 * built-in set for a region (e.g. `GB` → Europe) stays in that region even if missing from the user’s text areas,
 * so major hubs (LHR, etc.) are not shown under "Other" after partial edits.
 */
export function mergeRegionDefaults(user: Record<RegionId, string[]>): Record<RegionId, string[]> {
  const o = {} as Record<RegionId, string[]>
  for (const k of REGION_IDS_IN_UI_ORDER) {
    if (k === 'otherHubs') {
      o[k] = [...(user[k] ?? DEFAULT_REGION_COUNTRIES[k] ?? [])]
      continue
    }
    o[k] = uniq([...DEFAULT_REGION_COUNTRIES[k], ...(user[k] ?? [])])
  }
  return o
}
