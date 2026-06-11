import {
  HEATMAP_QUALITY_DEFS,
  HEATMAP_QUALITY_ORDER,
  qualityBucketCountTitle,
  type HeatmapCellQuality,
  type HeatmapQualityTotals,
} from '../lib/heatmapCellQuality'

export function HeatmapQualityBadge({
  quality,
  className = '',
}: {
  quality: HeatmapCellQuality
  className?: string
}) {
  const def = HEATMAP_QUALITY_DEFS[quality]
  return (
    <span
      className={`pw-hq-badge pw-hq-badge--${quality}${className ? ` ${className}` : ''}`}
      title={def.title}
      aria-label={def.label}
    >
      {def.icon}
    </span>
  )
}

type Props = {
  activeFilter: ReadonlySet<HeatmapCellQuality>
  onToggle: (quality: HeatmapCellQuality) => void
  onClear: () => void
  /** Per-status cell + itinerary totals (all routes, out×ret grid). */
  qualityTotals?: HeatmapQualityTotals
  className?: string
}

export function HeatmapQualityFilterBar({
  activeFilter,
  onToggle,
  onClear,
  qualityTotals,
  className = '',
}: Props) {
  const filtering = activeFilter.size > 0
  return (
    <div className={`pw-hq-filter-bar${className ? ` ${className}` : ''}`}>
      <span className="pw-hq-filter-title">Cell status</span>
      <ul className="pw-hq-filter-list" aria-label="Filter cells by data quality">
        {HEATMAP_QUALITY_ORDER.map((q) => {
          const def = HEATMAP_QUALITY_DEFS[q]
          const on = activeFilter.has(q)
          const bucket = qualityTotals?.[q]
          const countTitle = bucket ? qualityBucketCountTitle(bucket, q) : def.title
          return (
            <li key={q}>
              <button
                type="button"
                className={`pw-hq-filter-btn${on ? ' pw-hq-filter-btn--on' : ''}`}
                onClick={() => onToggle(q)}
                title={
                  countTitle +
                  (filtering && on ? ' · click to hide' : filtering ? ' · click to show only' : '')
                }
                aria-pressed={on}
              >
                <HeatmapQualityBadge quality={q} />
                <span>{def.label}</span>
                {bucket != null && (
                  <span className="pw-hq-filter-counts">
                    <span className="pw-hq-filter-count" aria-label={`${bucket.cells} cells`}>
                      {bucket.cells}
                    </span>
                    {bucket.itineraries > 0 && (
                      <span className="pw-hq-filter-cells muted" title={`${bucket.itineraries} itineraries`}>
                        ({bucket.itineraries})
                      </span>
                    )}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {filtering && (
        <button type="button" className="btn btn-ghost btn-tiny pw-hq-filter-clear" onClick={onClear}>
          Show all
        </button>
      )}
      {filtering && (
        <span className="pw-hq-filter-hint muted small">Other cells are dimmed</span>
      )}
    </div>
  )
}

export function heatmapQualityCellClass(
  quality: HeatmapCellQuality,
  activeFilter: ReadonlySet<HeatmapCellQuality> | null | undefined,
): string {
  const visible =
    !activeFilter || activeFilter.size === 0 || activeFilter.has(quality)
  return visible ? '' : ' pw-hq-cell--dimmed'
}
