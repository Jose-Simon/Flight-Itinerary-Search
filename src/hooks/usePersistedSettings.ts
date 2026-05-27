import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'flight-itinerary-discovery-settings-v1'

export type PersistedSettings = {
  apiKey: string
  mockMode: boolean
  gl: string
  hl: string
  currency: string
  deepSearch: boolean
  showHidden: boolean
  /** Layover longer than this (hours) is highlighted as “long” on result cards. */
  layoverLongMinHours: number
  /** Layover shorter than this (hours) is highlighted as “short” on result cards. */
  layoverShortMaxHours: number
}

const defaultSettings: PersistedSettings = {
  apiKey: '',
  mockMode: true,
  gl: 'us',
  hl: 'en',
  currency: 'USD',
  deepSearch: false,
  showHidden: true,
  layoverLongMinHours: 8,
  layoverShortMaxHours: 1,
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
    return {
      ...defaultSettings,
      ...rest,
    }
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
