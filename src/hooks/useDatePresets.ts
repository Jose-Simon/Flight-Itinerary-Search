import { useState } from 'react'
import type { DatePreset, DateSnapshot } from '../lib/filterPresetTypes'

const STORAGE_KEY = 'fid-date-presets-v1'

function load(): DatePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DatePreset[]) : []
  } catch {
    return []
  }
}

function save(presets: DatePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {}
}

export function useDatePresets() {
  const [presets, setPresets] = useState<DatePreset[]>(load)

  function persist(next: DatePreset[]) {
    save(next)
    setPresets(next)
  }

  function savePreset(name: string, dates: DateSnapshot) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    persist([...presets, { id, name, isDefault: false, dates }])
  }

  function updatePreset(id: string, dates: DateSnapshot) {
    persist(presets.map((p) => (p.id === id ? { ...p, dates } : p)))
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
