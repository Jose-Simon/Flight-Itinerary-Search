import type { NormalizedItinerary } from '../lib/types'

const LEGROOM_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Any', value: null },
  { label: '29+ in', value: 29 },
  { label: '30+ in', value: 30 },
  { label: '31+ in', value: 31 },
  { label: '32+ in', value: 32 },
  { label: '33+ in', value: 33 },
]

type Props = {
  /** Itineraries in the current result pool (used to count how many are affected). */
  items: NormalizedItinerary[]
  excludeOftenDelayed: boolean
  onExcludeOftenDelayed: (v: boolean) => void
  minLegroomIn: number | null
  onMinLegroom: (v: number | null) => void
}

export function FlightQualityFilterBlock({
  items,
  excludeOftenDelayed,
  onExcludeOftenDelayed,
  minLegroomIn,
  onMinLegroom,
}: Props) {
  // Count how many itineraries have at least one often-delayed segment
  const delayedCount = items.filter((it) => it.segments.some((s) => s.oftenDelayed)).length

  return (
    <div className="fq-block">
      <div className="fq-section">
        <div className="fq-label">Legroom (min seat pitch)</div>
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
      </div>

      {delayedCount > 0 && (
        <div className="fq-section">
          <label className="fq-delay-toggle">
            <input
              type="checkbox"
              checked={excludeOftenDelayed}
              onChange={(e) => onExcludeOftenDelayed(e.target.checked)}
            />
            <span>
              Exclude often-delayed flights
              <span className="fq-delay-count muted"> ({delayedCount} affected)</span>
            </span>
          </label>
          <p className="fq-delay-hint muted small">
            Hides itineraries where any leg is flagged by Google as frequently delayed 30+ min.
          </p>
        </div>
      )}
    </div>
  )
}
