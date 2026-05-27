import { useMemo, useState } from 'react'
import { REGION_IDS_IN_UI_ORDER, REGION_LABELS, type RegionId } from '../data/regions'
import countryToAirports from '../data/countryToAirports.json'
import { connectionLayoverHubs } from '../lib/filters'
import { hubIataSetForRegion, resolveHubToRegionId } from '../lib/layoverHubRegion'
import { OTHER_HUBS_REGION_ID, unmappedLayoverHubStats } from '../lib/unmappedLayoverHubs'
import type { NormalizedItinerary } from '../lib/types'
import type { AirportRow } from '../lib/airportTypes'

const ALL_REGIONS = REGION_IDS_IN_UI_ORDER

function layoverAirportsInPool(raw: NormalizedItinerary[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of raw) {
    for (const iata of connectionLayoverHubs(it)) {
      m.set(iata, (m.get(iata) ?? 0) + 1)
    }
  }
  return m
}

function countItinsWithLayoverInSet(raw: NormalizedItinerary[], iataSet: Set<string>): number {
  let n = 0
  for (const it of raw) {
    const hit = connectionLayoverHubs(it).some((code) => iataSet.has(code))
    if (hit) n++
  }
  return n
}

type Props = {
  hasSearched: boolean
  rawItineraries: NormalizedItinerary[]
  airportsByIata: Map<string, AirportRow>
  regionCountries: Record<RegionId, string[]>
  /** Optional IATA → region (Settings); overrides directory country for layover buckets. */
  airportUiRegions: Record<string, RegionId>
  regionEnabled: Record<RegionId, boolean>
  onRegionEnabled: (id: RegionId, enabled: boolean) => void
  airportOff: Set<string>
  onAirportOff: (iata: string, off: boolean) => void
  onSelectAll: () => void
  /** Disable geographic layover filter (does not change checkbox state). */
  onAllowAllHubs: () => void
}

export function LayoverRegionsPanel({
  hasSearched,
  rawItineraries,
  airportsByIata,
  regionCountries,
  airportUiRegions,
  regionEnabled,
  onRegionEnabled,
  airportOff,
  onAirportOff,
  onSelectAll,
  onAllowAllHubs,
}: Props) {
  const [expanded, setExpanded] = useState<Set<RegionId>>(() => new Set())
  const [listFilter, setListFilter] = useState('')

  const layoverCounts = useMemo(() => layoverAirportsInPool(rawItineraries), [rawItineraries])

  const unmappedStats = useMemo(
    () => unmappedLayoverHubStats(rawItineraries, airportsByIata, regionCountries, airportUiRegions),
    [rawItineraries, airportsByIata, regionCountries, airportUiRegions],
  )

  const poolCountByRegion = useMemo(() => {
    const m = new Map<RegionId, number>()
    for (const rid of ALL_REGIONS) {
      const regionIatas =
        rid === OTHER_HUBS_REGION_ID
          ? unmappedStats.hubSet
          : hubIataSetForRegion(
              rid,
              regionCountries,
              countryToAirports as Record<string, string[]>,
              airportUiRegions,
            )
      m.set(rid, countItinsWithLayoverInSet(rawItineraries, regionIatas))
    }
    return m
  }, [rawItineraries, regionCountries, airportUiRegions, unmappedStats])

  const visibleRegionIds = useMemo(
    () => ALL_REGIONS.filter((rid) => (poolCountByRegion.get(rid) ?? 0) > 0),
    [poolCountByRegion],
  )

  const airportsByRegion = useMemo(() => {
    const m = new Map<RegionId, { iata: string; count: number }[]>()
    for (const rid of ALL_REGIONS) m.set(rid, [])
    for (const [iata, cnt] of layoverCounts) {
      const rid = resolveHubToRegionId(iata, airportsByIata, regionCountries, airportUiRegions)
      m.get(rid)!.push({ iata, count: cnt })
    }
    m.set(OTHER_HUBS_REGION_ID, unmappedStats.iataCounts)
    for (const rid of ALL_REGIONS) {
      if (rid === OTHER_HUBS_REGION_ID) continue
      m.get(rid)!.sort((a, b) => b.count - a.count || a.iata.localeCompare(b.iata))
    }
    return m
  }, [layoverCounts, airportsByIata, regionCountries, airportUiRegions, unmappedStats])

  const filteredVisibleRegionIds = useMemo(() => {
    const t = listFilter.trim().toLowerCase()
    if (!t) return visibleRegionIds
    return visibleRegionIds.filter((rid) => {
      if (REGION_LABELS[rid].toLowerCase().includes(t)) return true
      const apList = airportsByRegion.get(rid) ?? []
      return apList.some(({ iata }) => {
        const apRow = airportsByIata.get(iata)
        const name = (apRow?.city ?? apRow?.name ?? iata).toLowerCase()
        return iata.toLowerCase().includes(t) || name.includes(t)
      })
    })
  }, [visibleRegionIds, listFilter, airportsByRegion, airportsByIata])

  const toggleExpand = (id: RegionId) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  if (!hasSearched) {
    return (
      <div className="layover-regions-panel sidebar-filter-sep">
        <div className="layover-regions-head">
          <div className="layover-regions-title">Layover regions / airports</div>
        </div>
        <p className="muted small airline-filter-idle">Run a search to filter by layover regions that appear in your pool.</p>
      </div>
    )
  }

  if (rawItineraries.length === 0) {
    return (
      <div className="layover-regions-panel sidebar-filter-sep">
        <div className="layover-regions-head">
          <div className="layover-regions-title">Layover regions / airports</div>
        </div>
        <p className="muted small airline-filter-idle">No layover regions in the current result set.</p>
      </div>
    )
  }

  if (visibleRegionIds.length === 0) {
    return (
      <div className="layover-regions-panel sidebar-filter-sep">
        <div className="layover-regions-head">
          <div className="layover-regions-title">Layover regions / airports</div>
        </div>
        <p className="muted small airline-filter-idle">No connection layovers in the current pool (only direct or empty segments).</p>
      </div>
    )
  }

  return (
    <div className="layover-regions-panel sidebar-filter-sep">
      <div className="layover-regions-head">
        <div className="layover-regions-title">Layover regions / airports</div>
        <div className="layover-regions-actions">
          <button
            type="button"
            className="btn-link"
            onClick={onSelectAll}
            title="Enable all regions and clear per-airport exclusions"
          >
            All
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={onAllowAllHubs}
            title="Turn off layover geography filter (allow any hub)"
          >
            None
          </button>
        </div>
      </div>
      <div className="airline-filter-toolbar layover-regions-filter-toolbar">
        <input
          className="input input-tiny airline-filter-filter-input"
          placeholder="Filter list…"
          value={listFilter}
          onChange={(e) => setListFilter(e.target.value)}
          aria-label="Filter layover regions and airports"
        />
      </div>
      {filteredVisibleRegionIds.length === 0 ? (
        <p className="muted small airline-filter-idle">No regions or airports match the filter.</p>
      ) : (
      <ul className="layover-regions-list">
        {filteredVisibleRegionIds.map((rid) => {
          const poolCount = poolCountByRegion.get(rid) ?? 0
          const on = regionEnabled[rid] !== false
          const isOpen = expanded.has(rid)
          const apList = airportsByRegion.get(rid) ?? []

          return (
            <li key={rid} className="layover-region-item">
              <div className="layover-region-row">
                <button
                  type="button"
                  className={`layover-region-chevron${isOpen ? ' layover-region-chevron--open' : ''}`}
                  aria-expanded={isOpen}
                  onClick={() => toggleExpand(rid)}
                  disabled={apList.length === 0}
                >
                  ▸
                </button>
                <label className="check layover-region-check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => onRegionEnabled(rid, e.target.checked)}
                  />
                  <span>{REGION_LABELS[rid]}</span>
                </label>
                <span
                  className="muted small layover-region-count"
                  title="Pool itineraries with ≥1 layover in this region. Overlaps other rows; not how many results you will see."
                >
                  {poolCount}
                </span>
              </div>
              {isOpen && apList.length > 0 ? (
                <ul className="layover-airport-list">
                  {apList.map(({ iata, count: apPool }) => {
                    const apRow = airportsByIata.get(iata)
                    const name = apRow?.city ?? apRow?.name ?? iata
                    const cc = apRow?.countryIso?.trim().toUpperCase()
                    const apOn = on && !airportOff.has(iata)
                    const ovr = airportUiRegions[iata.trim().toUpperCase()]
                    return (
                      <li key={iata} className="layover-airport-item">
                        <label className="check layover-airport-check">
                          <input
                            type="checkbox"
                            checked={apOn}
                            disabled={!on}
                            onChange={(e) => onAirportOff(iata, !e.target.checked)}
                          />
                          <span>
                            <strong>{iata}</strong> {name}{' '}
                            {cc ? (
                              <span className="mono muted small" title="ISO 3166-1 alpha-2 (directory)">
                                ({cc})
                              </span>
                            ) : null}
                            {ovr ? (
                              <span className="muted small" title="Settings override (not country-based)">
                                {' '}
                                → {REGION_LABELS[ovr]}
                              </span>
                            ) : null}
                          </span>
                        </label>
                        <span className="muted small layover-airport-count">{apPool}</span>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
      )}
    </div>
  )
}
