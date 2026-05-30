import { useRef, useState } from 'react'
import type { ConfigPreset, ConfigSnapshot } from '../lib/filterPresetTypes'

type Props = {
  presets: ConfigPreset[]
  currentConfig: ConfigSnapshot
  onApply: (config: ConfigSnapshot) => void
  onSave: (name: string, config: ConfigSnapshot) => void
  onUpdate: (id: string, config: ConfigSnapshot) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
  onClearDefault: () => void
}

type SavingMode = null | 'confirm-replace' | 'new'

export function ConfigPresetsBar({
  presets,
  currentConfig,
  onApply,
  onSave,
  onUpdate,
  onRename,
  onDelete,
  onSetDefault,
  onClearDefault,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>('')
  const [savingMode, setSavingMode] = useState<SavingMode>(null)
  const [saveName, setSaveName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const selected = presets.find((p) => p.id === selectedId) ?? null

  function handleSelect(id: string) {
    setSelectedId(id)
    setSavingMode(null)
    const p = presets.find((pr) => pr.id === id)
    if (p) onApply(p.config)
  }

  function handleSaveClick() {
    setSaveName('')
    if (selected) {
      setSavingMode('confirm-replace')
    } else {
      setSavingMode('new')
      setTimeout(() => nameInputRef.current?.focus(), 0)
    }
  }

  function handleConfirmReplace() {
    if (!selected) return
    onUpdate(selected.id, currentConfig)
    setSavingMode(null)
  }

  function handleSaveAsNew() {
    setSavingMode('new')
    setTimeout(() => nameInputRef.current?.focus(), 0)
  }

  function handleCommitSave() {
    const name = saveName.trim()
    if (!name) return
    onSave(name, currentConfig)
    setSavingMode(null)
    setSaveName('')
  }

  function handleStartRename(p: ConfigPreset) {
    setRenaming(p.id)
    setRenameValue(p.name)
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  function handleCommitRename() {
    if (!renaming) return
    const name = renameValue.trim()
    if (name) onRename(renaming, name)
    setRenaming(null)
  }

  function handleToggleDefault(p: ConfigPreset) {
    if (p.isDefault) onClearDefault()
    else onSetDefault(p.id)
  }

  function handleDelete(id: string) {
    onDelete(id)
    if (selectedId === id) setSelectedId('')
    setSavingMode(null)
  }

  return (
    <div className="filter-presets-bar">
      <div className="filter-presets-row">
        <span className="filter-presets-label">Config</span>

        <select
          className="input input-tiny filter-presets-select"
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">— none —</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.isDefault ? '★ ' : ''}{p.name}
            </option>
          ))}
        </select>

        {selected && (
          <>
            <button
              type="button"
              className={`btn-icon filter-preset-icon-btn${selected.isDefault ? ' filter-preset-icon-btn--active' : ''}`}
              title={selected.isDefault ? 'Remove default' : 'Set as default (auto-applied on load)'}
              onClick={() => handleToggleDefault(selected)}
            >
              ★
            </button>
            {renaming === selected.id ? (
              <span className="filter-preset-rename-wrap">
                <input
                  ref={renameInputRef}
                  className="input input-tiny filter-preset-rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCommitRename()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={handleCommitRename}
                />
              </span>
            ) : (
              <button
                type="button"
                className="btn-icon filter-preset-icon-btn"
                title="Rename preset"
                onClick={() => handleStartRename(selected)}
              >
                ✎
              </button>
            )}
            <button
              type="button"
              className="btn-icon filter-preset-icon-btn filter-preset-icon-btn--danger"
              title="Delete preset"
              onClick={() => handleDelete(selected.id)}
            >
              ✕
            </button>
          </>
        )}

        {savingMode === null && (
          <button
            type="button"
            className="btn btn-secondary btn-tiny filter-presets-save-btn"
            onClick={handleSaveClick}
            title={
              selected
                ? `Save current config — will ask to replace "${selected.name}" or save as new`
                : 'Save current filters + dates as a new config preset'
            }
          >
            + Save current
          </button>
        )}

        {savingMode === 'confirm-replace' && selected && (
          <span className="filter-preset-save-wrap">
            <span className="muted tiny">Replace&nbsp;<strong>{selected.name}</strong>?</span>
            <button type="button" className="btn btn-primary btn-tiny" onClick={handleConfirmReplace}>
              Replace
            </button>
            <button type="button" className="btn btn-secondary btn-tiny" onClick={handleSaveAsNew}>
              Save as new
            </button>
            <button type="button" className="btn btn-ghost btn-tiny" onClick={() => setSavingMode(null)}>
              Cancel
            </button>
          </span>
        )}

        {savingMode === 'new' && (
          <span className="filter-preset-save-wrap">
            <input
              ref={nameInputRef}
              className="input input-tiny filter-preset-name-input"
              placeholder="Config name…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitSave()
                if (e.key === 'Escape') setSavingMode(null)
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-tiny"
              onClick={handleCommitSave}
              disabled={!saveName.trim()}
            >
              Save
            </button>
            <button type="button" className="btn btn-ghost btn-tiny" onClick={() => setSavingMode(null)}>
              Cancel
            </button>
          </span>
        )}
      </div>
    </div>
  )
}
