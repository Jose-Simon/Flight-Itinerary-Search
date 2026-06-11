import { useState } from 'react'
import { REGION_IDS_IN_UI_ORDER, type RegionId } from '../data/regions'
import { DEFAULT_PAX_COUNTS } from '../lib/paxDesc'
import type {
  ConfigPreset,
  ConfigSnapshot,
  FilterPreset,
  DatePreset,
  FilterSnapshot,
  DateSnapshot,
} from '../lib/filterPresetTypes'
import type { DedupeMode } from '../lib/filters'
import {
  normalizePriceWindowPairFilters,
} from '../lib/priceWindowPairFilters'

const STORAGE_KEY = 'fid-config-presets-v1'
const OLD_FILTER_KEY = 'fid-filter-presets-v1'
const OLD_DATE_KEY = 'fid-date-presets-v1'

export function defaultFilterSnapshot(): FilterSnapshot {
  const layoverRegionOn = {} as Record<RegionId, boolean>
  for (const id of REGION_IDS_IN_UI_ORDER) layoverRegionOn[id] = true
  return {
    airlineExcludedCodes: [],
    outStopsMin: '', outStopsMax: '',
    retStopsMin: '', retStopsMax: '',
    outHours: { minLeg: '', maxLeg: '', minTotal: '', maxTotal: '', minFlight: '', maxFlight: '', minLayover: '', maxLayover: '' },
    retHours: { minLeg: '', maxLeg: '', minTotal: '', maxTotal: '', minFlight: '', maxFlight: '', minLayover: '', maxLayover: '' },
    outPrice: { min: '', max: '' },
    retPrice: { min: '', max: '' },
    outTimeRange: { takeoffMin: '', takeoffMax: '', landingMin: '', landingMax: '' },
    retTimeRange: { takeoffMin: '', takeoffMax: '', landingMin: '', landingMax: '' },
    outLegDurationMatch: 'any',
    retLegDurationMatch: 'any',
    timeBucketsOut: [],
    timeBucketsRet: [],
    layoverRegionOn,
    layoverAirportOff: [],
    layoverGeoFilterActive: false,
    excludeTechnical: false,
    showOpenJaw: true,
    dedupeMode: 'route' as DedupeMode,
    returnCustomFilters: false,
    aircraftSelectedCodes: [],
    aircraftMatchMode: 'any',
    sortOut: 'duration',
    sortReturn: 'duration',
  }
}

export function defaultDateSnapshot(): DateSnapshot {
  return {
    origins: [],
    destinations: [],
    tripType: 'oneway',
    outboundDate: '',
    outboundEnd: '',
    returnDate: '',
    returnEnd: '',
    adultCount: DEFAULT_PAX_COUNTS.adults,
    childrenCount: DEFAULT_PAX_COUNTS.children,
    cabinClass: 1,
  }
}

type LegacyConfigShape = Partial<ConfigSnapshot> & {
  filters?: Partial<FilterSnapshot>
  minStops?: unknown
  maxStops?: unknown
  priceMin?: unknown
  priceMax?: unknown
}

const HOUR_FIELD_KEYS = [
  'minLeg', 'maxLeg', 'minTotal', 'maxTotal', 'minFlight', 'maxFlight', 'minLayover', 'maxLayover',
] as const satisfies readonly (keyof FilterSnapshot['outHours'])[]

/** Flat legacy keys (old saves) → nested filter snapshot fields. */
function hoistLegacyFilterFields(raw: LegacyConfigShape): Partial<FilterSnapshot> {
  const out: Partial<FilterSnapshot> = { ...raw }
  if (raw.outStopsMin == null && raw.minStops != null) {
    out.outStopsMin = strField(raw.minStops, '')
  }
  if (raw.outStopsMax == null && raw.maxStops != null) {
    out.outStopsMax = strField(raw.maxStops, '')
  }
  const outHours: Partial<FilterSnapshot['outHours']> = { ...(raw.outHours ?? {}) }
  for (const k of HOUR_FIELD_KEYS) {
    const flat = (raw as Record<string, unknown>)[k]
    if (flat != null && (outHours[k] == null || String(outHours[k]).trim() === '')) {
      outHours[k] = strField(flat, '')
    }
  }
  if (Object.keys(outHours).length > 0) out.outHours = outHours as FilterSnapshot['outHours']
  const outPrice: Partial<FilterSnapshot['outPrice']> = { ...(raw.outPrice ?? {}) }
  if (raw.priceMin != null && (outPrice.min == null || String(outPrice.min).trim() === '')) {
    outPrice.min = strField(raw.priceMin, '')
  }
  if (raw.priceMax != null && (outPrice.max == null || String(outPrice.max).trim() === '')) {
    outPrice.max = strField(raw.priceMax, '')
  }
  if (Object.keys(outPrice).length > 0) out.outPrice = outPrice as FilterSnapshot['outPrice']
  return out
}

function mergeHourFields(
  base: FilterSnapshot['outHours'],
  partial?: Partial<FilterSnapshot['outHours']> | null,
): FilterSnapshot['outHours'] {
  const merged = { ...base, ...(partial ?? {}) }
  const out = { ...base }
  for (const key of Object.keys(base) as (keyof FilterSnapshot['outHours'])[]) {
    const v = merged[key]
    out[key] = v != null && String(v).trim() !== '' ? String(v) : ''
  }
  return out
}

function mergePriceFields(
  base: FilterSnapshot['outPrice'],
  partial?: Partial<FilterSnapshot['outPrice']> | null,
): FilterSnapshot['outPrice'] {
  const merged = { ...base, ...(partial ?? {}) }
  return {
    min: merged.min != null && String(merged.min).trim() !== '' ? String(merged.min) : '',
    max: merged.max != null && String(merged.max).trim() !== '' ? String(merged.max) : '',
  }
}

function mergeTimeRangeFields(
  base: FilterSnapshot['outTimeRange'],
  partial?: Partial<FilterSnapshot['outTimeRange']> | null,
): FilterSnapshot['outTimeRange'] {
  const merged = { ...base, ...(partial ?? {}) }
  const out = { ...base }
  for (const key of Object.keys(base) as (keyof FilterSnapshot['outTimeRange'])[]) {
    const v = merged[key]
    out[key] = v != null && String(v).trim() !== '' ? String(v) : ''
  }
  return out
}

function strField(v: unknown, fallback: string): string {
  if (v == null) return fallback
  const s = String(v).trim()
  return s !== '' ? s : fallback
}

/**
 * Resolve deduplication mode, handling legacy boolean `uniqueRoutesOnly` field from old saves.
 * Precedence: explicit `dedupeMode` string → legacy `uniqueRoutesOnly` boolean → fallback default.
 */
function normalizeDedupeMode(raw: Record<string, unknown>, fallback: DedupeMode): DedupeMode {
  const v = (raw as Record<string, unknown>).dedupeMode
  if (v === 'off' || v === 'route' || v === 'schedule') return v
  // Legacy boolean field
  const legacy = (raw as Record<string, unknown>).uniqueRoutesOnly
  if (typeof legacy === 'boolean') return legacy ? 'route' : 'off'
  return fallback
}

/** Coerce partial / legacy preset JSON into a full filter snapshot. */
export function normalizeFilterSnapshot(raw?: Partial<FilterSnapshot> | null): FilterSnapshot {
  const d = defaultFilterSnapshot()
  if (!raw) return d
  const hoisted = hoistLegacyFilterFields(raw as LegacyConfigShape)
  const layoverRegionOn = { ...d.layoverRegionOn }
  if (hoisted.layoverRegionOn) {
    for (const id of REGION_IDS_IN_UI_ORDER) {
      if (hoisted.layoverRegionOn[id] != null) layoverRegionOn[id] = hoisted.layoverRegionOn[id]!
    }
  }
  return {
    airlineExcludedCodes: Array.isArray(hoisted.airlineExcludedCodes)
      ? hoisted.airlineExcludedCodes.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
      : d.airlineExcludedCodes,
    outStopsMin: strField(hoisted.outStopsMin, d.outStopsMin),
    outStopsMax: strField(hoisted.outStopsMax, d.outStopsMax),
    retStopsMin: strField(hoisted.retStopsMin, d.retStopsMin),
    retStopsMax: strField(hoisted.retStopsMax, d.retStopsMax),
    outHours: mergeHourFields(d.outHours, hoisted.outHours),
    retHours: mergeHourFields(d.retHours, hoisted.retHours),
    outPrice: mergePriceFields(d.outPrice, hoisted.outPrice),
    retPrice: mergePriceFields(d.retPrice, hoisted.retPrice),
    outTimeRange: mergeTimeRangeFields(d.outTimeRange, hoisted.outTimeRange),
    retTimeRange: mergeTimeRangeFields(d.retTimeRange, hoisted.retTimeRange),
    outLegDurationMatch: hoisted.outLegDurationMatch ?? d.outLegDurationMatch,
    retLegDurationMatch: hoisted.retLegDurationMatch ?? d.retLegDurationMatch,
    timeBucketsOut: Array.isArray(hoisted.timeBucketsOut) ? [...hoisted.timeBucketsOut] : d.timeBucketsOut,
    timeBucketsRet: Array.isArray(hoisted.timeBucketsRet) ? [...hoisted.timeBucketsRet] : d.timeBucketsRet,
    layoverRegionOn,
    layoverAirportOff: Array.isArray(hoisted.layoverAirportOff)
      ? hoisted.layoverAirportOff.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
      : d.layoverAirportOff,
    layoverGeoFilterActive: hoisted.layoverGeoFilterActive ?? d.layoverGeoFilterActive,
    excludeTechnical: hoisted.excludeTechnical ?? d.excludeTechnical,
    showOpenJaw: hoisted.showOpenJaw ?? d.showOpenJaw,
    dedupeMode: normalizeDedupeMode(hoisted, d.dedupeMode),
    returnCustomFilters: hoisted.returnCustomFilters ?? d.returnCustomFilters,
    aircraftSelectedCodes: Array.isArray(hoisted.aircraftSelectedCodes)
      ? [...hoisted.aircraftSelectedCodes]
      : d.aircraftSelectedCodes,
    aircraftMatchMode: hoisted.aircraftMatchMode ?? d.aircraftMatchMode,
    sortOut: hoisted.sortOut ?? d.sortOut,
    sortReturn: hoisted.sortReturn ?? d.sortReturn,
  }
}

/** Coerce partial / legacy config JSON (including nested `filters`) into a full snapshot. */
export function normalizeConfigSnapshot(raw?: LegacyConfigShape | null): ConfigSnapshot {
  const dates = defaultDateSnapshot()
  if (!raw) {
    return { ...normalizeFilterSnapshot(), ...dates }
  }
  const nested = raw.filters ? normalizeFilterSnapshot(raw.filters) : null
  const flat = normalizeFilterSnapshot(raw)
  const filters = nested
    ? {
        ...flat,
        ...nested,
        outHours: mergeHourFields(flat.outHours, nested.outHours),
        retHours: mergeHourFields(flat.retHours, nested.retHours),
        outPrice: mergePriceFields(flat.outPrice, nested.outPrice),
        retPrice: mergePriceFields(flat.retPrice, nested.retPrice),
        outTimeRange: mergeTimeRangeFields(flat.outTimeRange, nested.outTimeRange),
        retTimeRange: mergeTimeRangeFields(flat.retTimeRange, nested.retTimeRange),
      }
    : flat
  return {
    ...filters,
    origins: Array.isArray(raw.origins) ? raw.origins.map((c) => String(c).trim().toUpperCase()).filter(Boolean) : dates.origins,
    destinations: Array.isArray(raw.destinations)
      ? raw.destinations.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
      : dates.destinations,
    tripType: raw.tripType === 'round' ? 'round' : raw.tripType === 'oneway' ? 'oneway' : dates.tripType,
    outboundDate: raw.outboundDate ?? dates.outboundDate,
    outboundEnd: raw.outboundEnd ?? raw.outboundDate ?? dates.outboundEnd,
    returnDate: raw.returnDate ?? dates.returnDate,
    returnEnd: raw.returnEnd ?? raw.returnDate ?? dates.returnEnd,
    adultCount: raw.adultCount ?? dates.adultCount,
    childrenCount: raw.childrenCount ?? dates.childrenCount,
    cabinClass: raw.cabinClass ?? dates.cabinClass,
    displayTimezone: typeof raw.displayTimezone === 'string' ? raw.displayTimezone : '',
    pwPairFilters: raw.pwPairFilters
      ? normalizePriceWindowPairFilters(raw.pwPairFilters)
      : undefined,
  }
}

/** True when filter fields match factory defaults (preset likely missing filter data). */
export function filterSnapshotIsDefault(f: FilterSnapshot): boolean {
  const d = defaultFilterSnapshot()
  const n = normalizeFilterSnapshot(f)
  return JSON.stringify(n) === JSON.stringify(d)
}

function readOldFilterPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(OLD_FILTER_KEY)
    return raw ? (JSON.parse(raw) as FilterPreset[]) : []
  } catch {
    return []
  }
}

/** Merge filter data from legacy fid-filter-presets-v1 when config preset filters are empty. */
function repairConfigPresets(presets: ConfigPreset[]): ConfigPreset[] {
  const oldFilters = readOldFilterPresets()
  if (!oldFilters.length) {
    return presets.map((p) => ({ ...p, config: normalizeConfigSnapshot(p.config) }))
  }

  return presets.map((p) => {
    const normalized = normalizeConfigSnapshot(p.config)
    const match =
      oldFilters.find((fp) => fp.name.toLowerCase() === p.name.toLowerCase()) ??
      (p.isDefault ? oldFilters.find((fp) => fp.isDefault) : undefined)
    if (!match || !filterSnapshotIsDefault(normalized)) {
      return { ...p, config: normalized }
    }
    return {
      ...p,
      config: normalizeConfigSnapshot({
        ...normalized,
        ...match.filters,
      }),
    }
  })
}

/** Boot snapshot for first React render (default ★ preset). */
export function readBootConfigSnapshot(): ConfigSnapshot {
  return normalizeConfigSnapshot(readDefaultConfigPreset()?.config)
}

/** Read presets from storage (for initial app state before React effects run). */
export function readConfigPresets(): ConfigPreset[] {
  return load()
}

export function readDefaultConfigPreset(): ConfigPreset | null {
  return load().find((p) => p.isDefault) ?? null
}

/** One-time migration: merge old separate filter+date presets into unified config presets.
 *  Matches by name (case-insensitive). Removes old keys on success. */
function migrateFromOldKeys(): ConfigPreset[] {
  let filterPresets: FilterPreset[] = []
  let datePresets: DatePreset[] = []
  try {
    const raw = localStorage.getItem(OLD_FILTER_KEY)
    if (raw) filterPresets = JSON.parse(raw) as FilterPreset[]
  } catch { /* ignore */ }
  try {
    const raw = localStorage.getItem(OLD_DATE_KEY)
    if (raw) datePresets = JSON.parse(raw) as DatePreset[]
  } catch { /* ignore */ }

  if (filterPresets.length === 0 && datePresets.length === 0) return []

  const merged: ConfigPreset[] = []
  const usedDateIds = new Set<string>()

  for (const fp of filterPresets) {
    const matchDate = datePresets.find(
      (dp) => dp.name.toLowerCase() === fp.name.toLowerCase(),
    )
    if (matchDate) usedDateIds.add(matchDate.id)
    const dates = matchDate ? matchDate.dates : defaultDateSnapshot()
    merged.push({
      id: fp.id,
      name: fp.name,
      isDefault: fp.isDefault || (matchDate?.isDefault ?? false),
      config: {
        ...fp.filters,
        ...dates,
        origins: dates.origins ?? [],
        destinations: dates.destinations ?? [],
      },
    })
  }

  // Unmatched date-only presets
  for (const dp of datePresets) {
    if (usedDateIds.has(dp.id)) continue
    merged.push({
      id: dp.id,
      name: dp.name,
      isDefault: dp.isDefault,
      config: {
        ...defaultFilterSnapshot(),
        ...dp.dates,
        origins: dp.dates.origins ?? [],
        destinations: dp.dates.destinations ?? [],
      },
    })
  }

  // Clean up old keys so migration doesn't re-run
  try { localStorage.removeItem(OLD_FILTER_KEY) } catch { /* ignore */ }
  try { localStorage.removeItem(OLD_DATE_KEY) } catch { /* ignore */ }

  return merged
}

function load(): ConfigPreset[] {
  let presets: ConfigPreset[] = []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      presets = JSON.parse(raw) as ConfigPreset[]
    } else {
      presets = migrateFromOldKeys()
      if (presets.length > 0) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  const repaired = repairConfigPresets(presets)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const prev = raw ? JSON.parse(raw) : []
    if (JSON.stringify(prev) !== JSON.stringify(repaired)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(repaired))
    }
  } catch { /* ignore */ }
  return repaired
}

function save(presets: ConfigPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch { /* ignore */ }
}

export function useConfigPresets() {
  const [presets, setPresets] = useState<ConfigPreset[]>(load)

  function persist(next: ConfigPreset[]) {
    save(next)
    setPresets(next)
  }

  function savePreset(name: string, config: ConfigSnapshot) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    persist([...presets, { id, name, isDefault: false, config: normalizeConfigSnapshot(config) }])
  }

  function updatePreset(id: string, config: ConfigSnapshot) {
    persist(presets.map((p) => (p.id === id ? { ...p, config: normalizeConfigSnapshot(config) } : p)))
  }

  function renamePreset(id: string, name: string) {
    persist(presets.map((p) => (p.id === id ? { ...p, name } : p)))
  }

  function deletePreset(id: string) {
    persist(presets.filter((p) => p.id !== id))
  }

  function setDefault(id: string) {
    persist(presets.map((p) => ({ ...p, isDefault: p.id === id })))
  }

  function clearDefault() {
    persist(presets.map((p) => ({ ...p, isDefault: false })))
  }

  const defaultPreset = presets.find((p) => p.isDefault) ?? null

  return {
    presets,
    savePreset,
    updatePreset,
    renamePreset,
    deletePreset,
    setDefault,
    clearDefault,
    defaultPreset,
  }
}
