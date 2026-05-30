import { useState } from 'react'
import type { FilterPreset, FilterSnapshot } from '../lib/filterPresetTypes'

const STORAGE_KEY = 'fid-filter-presets-v1'

function load(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as FilterPreset[]) : []
  } catch {
    return []
  }
}

function save(presets: FilterPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // Quota errors etc. — silently skip
  }
}

export function useFilterPresets() {
  const [presets, setPresets] = useState<FilterPreset[]>(load)

  function persist(next: FilterPreset[]) {
    save(next)
    setPresets(next)
  }

  function savePreset(name: string, filters: FilterSnapshot) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    persist([...presets, { id, name, isDefault: false, filters }])
  }

  function updatePreset(id: string, filters: FilterSnapshot) {
    persist(presets.map((p) => (p.id === id ? { ...p, filters } : p)))
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
