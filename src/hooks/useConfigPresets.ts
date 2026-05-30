import { useState } from 'react'
import { REGION_IDS_IN_UI_ORDER, type RegionId } from '../data/regions'
import type {
  ConfigPreset,
  ConfigSnapshot,
  FilterPreset,
  DatePreset,
  FilterSnapshot,
  DateSnapshot,
} from '../lib/filterPresetTypes'

const STORAGE_KEY = 'fid-config-presets-v1'
const OLD_FILTER_KEY = 'fid-filter-presets-v1'
const OLD_DATE_KEY = 'fid-date-presets-v1'

function defaultFilterSnapshot(): FilterSnapshot {
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
    outLegDurationMatch: 'all',
    retLegDurationMatch: 'all',
    timeBucketsOut: [],
    timeBucketsRet: [],
    layoverRegionOn,
    layoverAirportOff: [],
    layoverGeoFilterActive: false,
    excludeTechnical: false,
    showOpenJaw: true,
    uniqueRoutesOnly: true,
    returnCustomFilters: false,
    aircraftSelectedCodes: [],
    aircraftMatchMode: 'any',
    sortOut: 'duration',
    sortReturn: 'duration',
  }
}

function defaultDateSnapshot(): DateSnapshot {
  return {
    tripType: 'oneway',
    outboundDate: '',
    outboundEnd: '',
    returnDate: '',
    returnEnd: '',
  }
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
    merged.push({
      id: fp.id,
      name: fp.name,
      isDefault: fp.isDefault || (matchDate?.isDefault ?? false),
      config: { ...fp.filters, ...(matchDate ? matchDate.dates : defaultDateSnapshot()) },
    })
  }

  // Unmatched date-only presets
  for (const dp of datePresets) {
    if (usedDateIds.has(dp.id)) continue
    merged.push({
      id: dp.id,
      name: dp.name,
      isDefault: dp.isDefault,
      config: { ...defaultFilterSnapshot(), ...dp.dates },
    })
  }

  // Clean up old keys so migration doesn't re-run
  try { localStorage.removeItem(OLD_FILTER_KEY) } catch { /* ignore */ }
  try { localStorage.removeItem(OLD_DATE_KEY) } catch { /* ignore */ }

  return merged
}

function load(): ConfigPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ConfigPreset[]
  } catch { /* ignore */ }
  // First load: attempt migration from old separate keys
  const migrated = migrateFromOldKeys()
  if (migrated.length > 0) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)) } catch { /* ignore */ }
  }
  return migrated
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
    persist([...presets, { id, name, isDefault: false, config }])
  }

  function updatePreset(id: string, config: ConfigSnapshot) {
    persist(presets.map((p) => (p.id === id ? { ...p, config } : p)))
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
