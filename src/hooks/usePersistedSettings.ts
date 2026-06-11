import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'flight-itinerary-discovery-settings-v1'

export type PersistedSettings = {
  apiKey: string
  mockMode: boolean
  gl: string
  hl: string
  currency: string
  deepSearch: boolean
  /** Expand round-trip outbound candidate pool near global min (percent). */
  rtExpandWithinPctEnabled: boolean
  rtExpandWithinPct: number
  showHidden: boolean
  /** Layover longer than this (hours) is highlighted as “long” on result cards. */
  layoverLongMinHours: number
  /** Layover shorter than this (hours) is highlighted as “short” on result cards. */
  layoverShortMaxHours: number
  /** Number of adult passengers (≥1). Affects SerpApi results and GF deep links. */
  adults: number
  /** Number of child passengers (0–8). SerpApi accepts a count; GF encodes per-child. */
  children: number
  /** Planned SerpApi calls per clock hour for price-window runs (hour 2+ return tranche). */
  pwHourlySerpCalls: number
}

const defaultSettings: PersistedSettings = {
  apiKey: '',
  mockMode: true,
  gl: 'us',
  hl: 'en',
  currency: 'USD',
  deepSearch: true,
  rtExpandWithinPctEnabled: false,
  rtExpandWithinPct: 20,
  showHidden: true,
  layoverLongMinHours: 8,
  layoverShortMaxHours: 1,
  adults: 1,
  children: 2,
  pwHourlySerpCalls: 180,
}

/** Canonical pax descriptor for cache keys and display, e.g. “1A”, “1A2C”, “2A1C”. */
export function paxDesc(adults: number, children: number): string {
  return `${adults}A${children > 0 ? `${children}C` : ''}`
}

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultSettings }
    const p = JSON.parse(raw) as Partial<PersistedSettings> & {
      regionCountries?: unknown
      perDateLimit?: unknown
    }
    const { regionCountries: _unusedRegionCountries, perDateLimit: _legacyPerDate, ...rest } = p
    void _unusedRegionCountries
    void _legacyPerDate
    const merged = { ...defaultSettings, ...rest }
    const pw = Number(merged.pwHourlySerpCalls)
    merged.pwHourlySerpCalls =
      Number.isFinite(pw) && pw > 0 ? Math.min(500, Math.round(pw)) : defaultSettings.pwHourlySerpCalls
    return merged
  } catch {
    return { ...defaultSettings }
  }
}

function save(s: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function usePersistedSettings() {
  const [settings, setSettings] = useState<PersistedSettings>(() => load())

  useEffect(() => {
    save(settings)
  }, [settings])

  const update = useCallback((patch: Partial<PersistedSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  return { settings, update }
}
