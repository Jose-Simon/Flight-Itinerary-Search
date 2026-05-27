import type { SavedSearchRow } from '../db/savedSearchTypes'
import { savedSearchDetailLinesFromPayload } from '../lib/savedSearchLabels'

type Props = {
  rows: SavedSearchRow[]
  onApply: (row: SavedSearchRow) => void
  onDelete: (id: number) => void
  onOpenSearchTab: () => void
}

function fmtWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return ''
  }
}

export function SavedSearchesPanel({ rows, onApply, onDelete, onOpenSearchTab }: Props) {
  return (
    <div className="saved-searches-page">
      <p className="muted small saved-searches-intro">
        Saved searches store the full search form and related settings. Apply one to load it on the Search tab, then run{' '}
        <strong>Search</strong> to fetch results. Use <strong>Save as default</strong> on Search to load that snapshot when
        you open the app.
      </p>
      {rows.length === 0 ? (
        <p className="muted">No saved searches yet. On the Search tab, use Save search or Save as default below the panel.</p>
      ) : (
        <ul className="saved-searches-list">
          {rows.map((row) => {
            const detailLines = savedSearchDetailLinesFromPayload(row.payload)
            return (
              <li key={row.id} className="saved-searches-card">
                <div className="saved-searches-card-head">
                  <div className="saved-searches-card-main">
                    <div className="saved-searches-name">{row.name}</div>
                    <div className="saved-searches-details" aria-label="Saved search parameters">
                      {detailLines.map((line, i) => (
                        <div key={`${row.id}-${i}`} className="saved-searches-detail-line">
                          {line}
                        </div>
                      ))}
                    </div>
                    <div className="saved-searches-saved-at muted tiny">Saved {fmtWhen(row.createdAt)}</div>
                  </div>
                  <div className="saved-searches-actions">
                    <button type="button" className="btn btn-secondary btn-tiny" onClick={() => onApply(row)}>
                      Apply
                    </button>
                    <button type="button" className="btn btn-ghost btn-tiny" onClick={() => onDelete(row.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="saved-searches-footer">
        <button type="button" className="btn btn-secondary" onClick={onOpenSearchTab}>
          Back to Search
        </button>
      </p>
    </div>
  )
}
