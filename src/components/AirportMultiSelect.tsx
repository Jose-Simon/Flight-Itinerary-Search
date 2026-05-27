import { useEffect, useMemo, useRef, useState } from 'react'
import type { AirportRow } from '../lib/airportTypes'
import { nearbyAirportsForAnchors, NEARBY_AIRPORT_MAX } from '../lib/geoDistance'
import { airportCatalogLocationSuffix, regionUiLabelForCountryIso } from '../data/regions'

const BROWSE_CAP = 80

type Props = {
  label: string
  airports: AirportRow[]
  selected: string[]
  onChange: (codes: string[]) => void
  placeholder?: string
  /** First selected IATA in this field only (e.g. `[origins[0]]` or `[destinations[0]]`); drives “nearby” when query is empty. */
  nearbyAnchorIatas?: string[]
  /** Exclude these IATAs from the nearby block (e.g. union of all origins and destinations). */
  excludeFromNearby?: Set<string>
}

export function AirportMultiSelect({
  label,
  airports,
  selected,
  onChange,
  placeholder,
  nearbyAnchorIatas = [],
  excludeFromNearby,
}: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const comboRef = useRef<HTMLDivElement>(null)

  const selectedU = useMemo(() => new Set(selected.map((c) => c.trim().toUpperCase())), [selected])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const root = comboRef.current
      if (root && e.target instanceof Node && !root.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const nearbyBlock = useMemo(() => {
    const ex = new Set<string>(excludeFromNearby ?? [])
    for (const c of selected) ex.add(c.trim().toUpperCase())
    return nearbyAirportsForAnchors(airports, nearbyAnchorIatas, {
      maxCount: NEARBY_AIRPORT_MAX,
      excludeIatas: ex,
    })
  }, [airports, nearbyAnchorIatas, excludeFromNearby, selected])

  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase()
    if (!t) {
      const nearbyIatas = new Set(nearbyBlock.map((n) => n.row.iata.trim().toUpperCase()))
      const rest: AirportRow[] = []
      const restBudget = Math.max(0, BROWSE_CAP - nearbyBlock.length)
      for (const a of airports) {
        if (rest.length >= restBudget) break
        const u = a.iata.trim().toUpperCase()
        if (selectedU.has(u)) continue
        if (nearbyIatas.has(u)) continue
        rest.push(a)
      }
      return { mode: 'browse' as const, nearby: nearbyBlock, rest }
    }

    type Scored = { row: AirportRow; rank: number }
    const scored: Scored[] = []

    for (const a of airports) {
      const u = a.iata.trim().toUpperCase()
      if (selectedU.has(u)) continue

      const iata = a.iata.toUpperCase()
      const city = a.city.toUpperCase()
      const name = a.name.toUpperCase()
      const country = a.country.toUpperCase()
      const countryIso = a.countryIso.trim().toUpperCase()
      const regionName = regionUiLabelForCountryIso(a.countryIso)
      const regionUpper = regionName ? regionName.toUpperCase() : ''

      let rank = -1
      if (iata === t) rank = 0
      else if (iata.startsWith(t)) rank = 1
      else if (iata.includes(t)) rank = 2
      else if (
        city.startsWith(t) ||
        name.startsWith(t) ||
        country.startsWith(t) ||
        (regionUpper && regionUpper.startsWith(t)) ||
        country === t ||
        regionUpper === t
      )
        rank = 3
      else if (
        city.includes(t) ||
        name.includes(t) ||
        country.includes(t) ||
        (regionUpper && regionUpper.includes(t)) ||
        countryIso === t ||
        (t.length >= 2 && countryIso.startsWith(t))
      )
        rank = 4

      if (rank >= 0) scored.push({ row: a, rank })
    }

    scored.sort((x, y) => {
      if (x.rank !== y.rank) return x.rank - y.rank
      return x.row.iata.localeCompare(y.row.iata)
    })

    return { mode: 'search' as const, rows: scored.slice(0, BROWSE_CAP).map((s) => s.row) }
  }, [airports, q, nearbyBlock, selectedU])

  const add = (code: string) => {
    const c = code.toUpperCase()
    if (selected.includes(c)) return
    onChange([...selected, c])
    setQ('')
    setOpen(false)
  }

  const remove = (code: string) => {
    onChange(selected.filter((x) => x !== code))
  }

  const showNearbySep = filtered.mode === 'browse' && filtered.nearby.length > 0 && filtered.rest.length > 0

  const locationMeta = (a: AirportRow) => {
    const s = airportCatalogLocationSuffix(a.country, a.countryIso)
    return s ? (
      <>
        {' '}
        <span className="dropdown-item-meta">({s})</span>
      </>
    ) : null
  }

  return (
    <div className="field">
      <label className="label">{label}</label>
      <div className="chips">
        {selected.map((c) => (
          <button type="button" key={c} className="chip" onClick={() => remove(c)} title="Remove">
            {c} <span aria-hidden>×</span>
          </button>
        ))}
      </div>
      <div className="combo" ref={comboRef}>
        <input
          className="input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? 'Code, city, country, region…'}
          aria-autocomplete="list"
        />
        {open &&
          (filtered.mode === 'search' ? filtered.rows.length > 0 : filtered.nearby.length + filtered.rest.length > 0) && (
            <ul className="dropdown" role="listbox">
              {filtered.mode === 'browse' ? (
                <>
                  {filtered.nearby.map(({ row: a, distanceKm }) => (
                    <li key={a.iata}>
                      <button
                        type="button"
                        className="dropdown-item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => add(a.iata)}
                      >
                        <strong>{a.iata}</strong> {a.city} — {a.name}
                        {locationMeta(a)}{' '}
                        <span className="dropdown-item-distance">({Math.round(distanceKm)} km)</span>
                      </button>
                    </li>
                  ))}
                  {showNearbySep ? (
                    <li className="dropdown-sep" role="separator" aria-hidden>
                      <hr className="dropdown-sep-line" />
                    </li>
                  ) : null}
                  {filtered.rest.map((a) => (
                    <li key={a.iata}>
                      <button
                        type="button"
                        className="dropdown-item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => add(a.iata)}
                      >
                        <strong>{a.iata}</strong> {a.city} — {a.name}
                        {locationMeta(a)}
                      </button>
                    </li>
                  ))}
                </>
              ) : (
                filtered.rows.map((a) => (
                  <li key={a.iata}>
                    <button
                      type="button"
                      className="dropdown-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => add(a.iata)}
                    >
                      <strong>{a.iata}</strong> {a.city} — {a.name}
                      {locationMeta(a)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
      </div>
    </div>
  )
}
