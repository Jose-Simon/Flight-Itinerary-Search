import type { NormalizedItinerary } from '../lib/types'
import type { LegroomMatchMode, AmenityMatchMode } from '../lib/filters'

const LEGROOM_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Any', value: null },
  { label: '29+ in', value: 29 },
  { label: '30+ in', value: 30 },
  { label: '31+ in', value: 31 },
  { label: '32+ in', value: 32 },
  { label: '33+ in', value: 33 },
]

type Props = {
  items: NormalizedItinerary[]
  amenityOptions: string[]
  excludeOftenDelayed: boolean
  onExcludeOftenDelayed: (v: boolean) => void
  minLegroomIn: number | null
  onMinLegroom: (v: number | null) => void
  legroomMatchMode: LegroomMatchMode
  onLegroomMatchMode: (m: LegroomMatchMode) => void
  selectedAmenities: string[]
  onToggleAmenity: (a: string, on: boolean) => void
  amenityMatchMode: AmenityMatchMode
  onAmenityMatchMode: (m: AmenityMatchMode) => void
}

function MatchModeToggle({
  mode,
  onChange,
  label,
}: {
  mode: 'any' | 'every'
  onChange: (m: 'any' | 'every') => void
  label?: string
}) {
  return (
    <div className="fq-match-toggle">
      {label && <span className="fq-match-label">{label}</span>}
      <button
        type="button"
        className={`fq-match-btn ${mode === 'any' ? 'on' : ''}`}
        onClick={() => onChange('any')}
        title="Pass if ANY segment satisfies this filter"
      >
        Any
      </button>
      <button
        type="button"
        className={`fq-match-btn ${mode === 'every' ? 'on' : ''}`}
        onClick={() => onChange('every')}
        title="Pass only if EVERY segment satisfies this filter"
      >
        Every
      </button>
    </div>
  )
}

export function FlightQualityFilterBlock({
  items,
  amenityOptions,
  excludeOftenDelayed,
  onExcludeOftenDelayed,
  minLegroomIn,
  onMinLegroom,
  legroomMatchMode,
  onLegroomMatchMode,
  selectedAmenities,
  onToggleAmenity,
  amenityMatchMode,
  onAmenityMatchMode,
}: Props) {
  const delayedCount = items.filter((it) => it.segments.some((s) => s.oftenDelayed)).length
  const selectedSet = new Set(selectedAmenities)

  return (
    <div className="fq-block">

      {/* ── Legroom ── */}
      <div className="fq-section">
        <div className="fq-section-header">
          <span className="fq-label">Legroom (seat pitch)</span>
          <MatchModeToggle mode={legroomMatchMode} onChange={onLegroomMatchMode} />
        </div>
        <div className="fq-legroom-chips">
          {LEGROOM_OPTIONS.map((opt) => (
            <button
              key={opt.value ?? 'any'}
              type="button"
              className={`fq-chip ${minLegroomIn === opt.value ? 'on' : ''}`}
              onClick={() => onMinLegroom(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="fq-hint muted small">
          {legroomMatchMode === 'every'
            ? 'All legs must meet the minimum.'
            : 'At least one leg must meet the minimum.'}
        </p>
      </div>

      {/* ── Amenities ── */}
      {amenityOptions.length > 0 && (
        <div className="fq-section">
          <div className="fq-section-header">
            <span className="fq-label">Amenities</span>
            <MatchModeToggle mode={amenityMatchMode} onChange={onAmenityMatchMode} />
          </div>
          <ul className="fq-amenity-list">
            {amenityOptions.map((a) => (
              <li key={a}>
                <label className="fq-amenity-row">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(a)}
                    onChange={(e) => onToggleAmenity(a, e.target.checked)}
                  />
                  <span className="fq-amenity-name">{a}</span>
                </label>
              </li>
            ))}
          </ul>
          {selectedAmenities.length > 0 && (
            <p className="fq-hint muted small">
              {amenityMatchMode === 'any'
                ? 'At least one leg must have any selected amenity.'
                : 'Every leg must have at least one selected amenity.'}
            </p>
          )}
        </div>
      )}

      {/* ── Often Delayed ── */}
      <div className="fq-section">
        <div className="fq-section-header">
          <span className="fq-label">Delay risk</span>
        </div>
        <label className={`fq-delay-toggle${delayedCount === 0 ? ' fq-delay-toggle--inactive' : ''}`}>
          <input
            type="checkbox"
            checked={excludeOftenDelayed}
            onChange={(e) => onExcludeOftenDelayed(e.target.checked)}
            disabled={delayedCount === 0}
          />
          <span>
            Exclude often-delayed flights
            {delayedCount > 0
              ? <span className="fq-delay-count muted"> ({delayedCount} affected)</span>
              : <span className="fq-delay-count muted"> (none flagged in results)</span>
            }
          </span>
        </label>
        <p className="fq-hint muted small">
          Hides itineraries where any leg is flagged by Google as frequently delayed 30+ min.
        </p>
      </div>

    </div>
  )
}
