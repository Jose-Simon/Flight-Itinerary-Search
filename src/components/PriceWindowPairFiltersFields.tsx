import {
  DEFAULT_PRICE_WINDOW_PAIR_FILTERS,
  type PriceWindowPairFilters,
} from '../lib/priceWindowPairFilters'

type Props = {
  filters: PriceWindowPairFilters
  onChange: (next: PriceWindowPairFilters) => void
  /** Shown under controls when filters shrink the grid. */
  statsLine?: string | null
  compact?: boolean
}

export function PriceWindowPairFiltersFields({ filters, onChange, statsLine, compact = false }: Props) {
  const patch = (p: Partial<PriceWindowPairFilters>) => onChange({ ...filters, ...p })

  return (
    <div className={`pw-pair-filters${compact ? ' pw-pair-filters--compact' : ''}`}>
      <label className="check pw-pair-filter-row">
        <input
          type="checkbox"
          checked={filters.tripLengthEnabled}
          onChange={(e) => patch({ tripLengthEnabled: e.target.checked })}
        />
        <span className="pw-pair-filter-label">
          Trip length
          {filters.tripLengthEnabled && (
            <span className="pw-pair-filter-inline-inputs">
              <input
                className="input input-tiny"
                type="number"
                min={1}
                max={90}
                value={filters.tripLengthMin}
                onChange={(e) => patch({ tripLengthMin: Number(e.target.value) })}
                aria-label="Minimum trip days"
              />
              <span className="muted tiny">–</span>
              <input
                className="input input-tiny"
                type="number"
                min={1}
                max={90}
                value={filters.tripLengthMax}
                onChange={(e) => patch({ tripLengthMax: Number(e.target.value) })}
                aria-label="Maximum trip days"
              />
              <span className="muted tiny">days between outbound and return</span>
            </span>
          )}
        </span>
      </label>

      <label className="check pw-pair-filter-row">
        <input
          type="checkbox"
          checked={filters.sparseEnabled}
          onChange={(e) => patch({ sparseEnabled: e.target.checked })}
        />
        <span className="pw-pair-filter-label">
          Sparse grid
          {filters.sparseEnabled && (
            <span className="pw-pair-filter-inline-inputs">
              <span className="muted tiny">every</span>
              <input
                className="input input-tiny"
                type="number"
                min={1}
                max={7}
                value={filters.outboundStride}
                onChange={(e) => patch({ outboundStride: Number(e.target.value) })}
                aria-label="Outbound day stride"
              />
              <span className="muted tiny">out ×</span>
              <input
                className="input input-tiny"
                type="number"
                min={1}
                max={7}
                value={filters.returnStride}
                onChange={(e) => patch({ returnStride: Number(e.target.value) })}
                aria-label="Return day stride"
              />
              <span className="muted tiny">return days (endpoints kept)</span>
            </span>
          )}
        </span>
      </label>

      <label className="check pw-pair-filter-row">
        <input
          type="checkbox"
          checked={filters.maxPairsEnabled}
          onChange={(e) => patch({ maxPairsEnabled: e.target.checked })}
        />
        <span className="pw-pair-filter-label">
          Max date pairs
          {filters.maxPairsEnabled && (
            <span className="pw-pair-filter-inline-inputs">
              <input
                className="input input-tiny"
                type="number"
                min={1}
                max={500}
                value={filters.maxPairs}
                onChange={(e) => patch({ maxPairs: Number(e.target.value) })}
                aria-label="Maximum date pairs"
              />
              <span className="muted tiny">evenly sampled across grid</span>
            </span>
          )}
        </span>
      </label>

      {statsLine && <p className="muted tiny pw-pair-filter-stats">{statsLine}</p>}

      {!compact && (
        <button
          type="button"
          className="btn btn-ghost btn-tiny pw-pair-filter-reset"
          onClick={() => onChange({ ...DEFAULT_PRICE_WINDOW_PAIR_FILTERS })}
        >
          Reset pair filters
        </button>
      )}
    </div>
  )
}
