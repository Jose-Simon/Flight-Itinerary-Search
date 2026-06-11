import { useEffect, useRef, type RefObject } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { NormalizedItinerary } from '../lib/types'
import type { CoordsMap } from '../lib/coords'
import type { AirportRow } from '../lib/airportTypes'
import { nearbyAirportsForAnchors } from '../lib/geoDistance'
import { ENGLISH_FORWARD_BASEMAP_URL, englishForwardBasemapOptions } from '../lib/mapBasemap'
import { connectionLayoverHubs } from '../lib/filters'

/** Subtle, single-style routes (darker + slightly wider when the path is “selected” on the map). */
const ROUTE_LINE = { color: 'rgba(95, 110, 135, 0.38)', weight: 1.25, opacity: 1 } as const
const ROUTE_LINE_SELECTED = { color: 'rgba(55, 70, 100, 0.72)', weight: 2, opacity: 1 } as const
const ROUTE_LINE_SOLO = { color: 'rgba(79, 158, 255, 0.95)', weight: 2.5, opacity: 1 } as const

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type MapSoloFocus = { leg: 'outbound' | 'return'; waypointKey: string }

type Props = {
  items: NormalizedItinerary[]
  /** Return-leg pool for the same filters (round trip); used when focusing a return itinerary. */
  itemsReturn?: NormalizedItinerary[]
  coordsByIata: CoordsMap
  airports: AirportRow[]
  origins: string[]
  destinations: string[]
  hubFilter: Set<string>
  routeFilter: Set<string> | null
  onHubToggle: (iata: string) => void
  onRouteSelect: (waypointKey: string | null) => void
  /** When set, the map shows only this airport sequence (from a result card “Map” action). */
  soloFocus?: MapSoloFocus | null
  /** Clears solo focus (e.g. click the highlighted route on the map). */
  onSoloFocusClear?: () => void
  /** Optional: outer wrapper ref (e.g. scroll into view when focusing a card route). */
  wrapRef?: RefObject<HTMLDivElement | null>
}

export function ResultsRouteMap({
  items,
  itemsReturn = [],
  coordsByIata,
  airports,
  origins,
  destinations,
  hubFilter,
  routeFilter,
  onHubToggle,
  onRouteSelect,
  soloFocus = null,
  onSoloFocusClear,
  wrapRef,
}: Props) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const hubRef = useRef(onHubToggle)
  const routeRef = useRef(onRouteSelect)
  const soloClearRef = useRef(onSoloFocusClear)
  hubRef.current = onHubToggle
  routeRef.current = onRouteSelect
  soloClearRef.current = onSoloFocusClear

  useEffect(() => {
    const el = mapEl.current
    if (!el) return

    if (!mapRef.current) {
      mapRef.current = L.map(el, { zoomControl: true, attributionControl: true })
      L.tileLayer(ENGLISH_FORWARD_BASEMAP_URL, englishForwardBasemapOptions).addTo(mapRef.current)
      layerRef.current = L.layerGroup().addTo(mapRef.current)
    }
    const map = mapRef.current
    const layer = layerRef.current!
    layer.clearLayers()

    // Build per-airport lookup and itinerary-count map (used for hover tooltips)
    const airportsByIata = new Map<string, AirportRow>()
    for (const a of airports) if (a.iata) airportsByIata.set(a.iata.trim().toUpperCase(), a)

    const itinCountByIata = new Map<string, number>()
    for (const it of [...items, ...itemsReturn]) {
      const touched = new Set<string>()
      for (const seg of it.segments) {
        touched.add(seg.dep.trim().toUpperCase())
        touched.add(seg.arr.trim().toUpperCase())
      }
      for (const iata of touched) itinCountByIata.set(iata, (itinCountByIata.get(iata) ?? 0) + 1)
    }

    const makeTooltip = (codeU: string): string | null => {
      const a = airportsByIata.get(codeU)
      const count = itinCountByIata.get(codeU)
      const place = [a?.city, a?.country].filter(Boolean).join(', ')
      if (!place && !count) return null
      return (
        `<div class="rm-tt">` +
        (place ? `<span class="rm-tt-place">${escapeHtml(place)}</span>` : '') +
        (count ? `<span class="rm-tt-count">${count} itinerar${count === 1 ? 'y' : 'ies'}</span>` : '') +
        `</div>`
      )
    }

    const hasPool = items.length > 0 || itemsReturn.length > 0

    if (!hasPool) {
      const odUpper = new Set<string>()
      for (const c of origins) odUpper.add(c.trim().toUpperCase())
      for (const c of destinations) odUpper.add(c.trim().toUpperCase())
      const anchorIatas = [origins[0], destinations[0]].filter(Boolean).map((c) => c.trim().toUpperCase())
      const nearby = nearbyAirportsForAnchors(airports, anchorIatas, { excludeIatas: odUpper })

      const boundsPts: L.LatLngExpression[] = []

      const addPreviewMarker = (code: string, variant: 'od' | 'nearby') => {
        const p = coordsByIata.get(code.trim().toUpperCase())
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return
        boundsPts.push([p.lat, p.lon])
        const codeU = code.trim().toUpperCase()
        const markClass =
          variant === 'nearby'
            ? 'route-map-hublabel route-map-hublabel--preview'
            : 'route-map-hublabel'
        const labelH = 20
        const labelW = Math.max(26, 6 + codeU.length * 8)
        const icon = L.divIcon({
          className: 'route-map-hublabel-marker',
          html: `<div class="${markClass}" style="width:${labelW}px;height:${labelH}px"><span class="route-map-hublabel-text">${escapeHtml(codeU)}</span></div>`,
          iconSize: [labelW, labelH],
          iconAnchor: [labelW / 2, labelH / 2],
        })
        const mk = L.marker([p.lat, p.lon], { icon, zIndexOffset: variant === 'nearby' ? 400 : 500 })
        mk.addTo(layer)
        const tt = makeTooltip(codeU)
        if (tt) mk.bindTooltip(tt, { permanent: false, direction: 'top', className: 'rm-tt-wrap', offset: [0, -12] })
      }

      for (const c of origins) addPreviewMarker(c, 'od')
      for (const c of destinations) addPreviewMarker(c, 'od')
      for (const { row } of nearby) addPreviewMarker(row.iata, 'nearby')

      if (boundsPts.length) {
        map.fitBounds(L.latLngBounds(boundsPts), { padding: [28, 28], maxZoom: 6 })
      } else {
        map.setView([20, 0], 2)
      }
      const t = window.setTimeout(() => map.invalidateSize(), 120)
      return () => window.clearTimeout(t)
    }

    if (soloFocus) {
      const pool = soloFocus.leg === 'outbound' ? items : itemsReturn
      const soloIt = pool.find((it) => it.waypointKey === soloFocus.waypointKey)
      const codes = soloFocus.waypointKey.split('-').filter(Boolean)
      const pts: L.LatLngExpression[] = []
      const boundsPts: L.LatLngExpression[] = []
      for (const c of codes) {
        const cu = c.trim().toUpperCase()
        const p = coordsByIata.get(cu) ?? coordsByIata.get(c)
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
          pts.push([p.lat, p.lon])
          boundsPts.push([p.lat, p.lon])
        }
      }
      if (pts.length >= 2) {
        const line = ROUTE_LINE_SOLO
        const onSoloLineClick = (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          soloClearRef.current?.()
        }
        L.polyline(pts, {
          color: line.color,
          weight: line.weight,
          opacity: line.opacity,
          lineJoin: 'round',
          lineCap: 'round',
          interactive: false,
        }).addTo(layer)
        L.polyline(pts, {
          color: '#000',
          weight: 16,
          opacity: 0,
          lineJoin: 'round',
          lineCap: 'round',
        })
          .on('click', onSoloLineClick)
          .addTo(layer)
      }

      const hubSet = new Set<string>(codes.map((c) => c.trim().toUpperCase()))
      if (soloIt) {
        for (const code of connectionLayoverHubs(soloIt)) hubSet.add(code.trim().toUpperCase())
      }

      for (const code of hubSet) {
        const p = coordsByIata.get(code.trim().toUpperCase())
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
        boundsPts.push([p.lat, p.lon])
        const codeU = code.trim().toUpperCase()
        const hubOn = hubFilter.has(codeU)
        const markClass = `route-map-hublabel${hubOn ? ' route-map-hublabel--on' : ''}`
        const labelH = 20
        const labelW = Math.max(26, 6 + codeU.length * 8)
        const icon = L.divIcon({
          className: 'route-map-hublabel-marker',
          html: `<div class="${markClass}" style="width:${labelW}px;height:${labelH}px"><span class="route-map-hublabel-text">${escapeHtml(codeU)}</span></div>`,
          iconSize: [labelW, labelH],
          iconAnchor: [labelW / 2, labelH / 2],
        })
        const mk = L.marker([p.lat, p.lon], { icon, zIndexOffset: hubOn ? 750 : 500 })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e)
            hubRef.current(code)
          })
          .addTo(layer)
        const tt = makeTooltip(codeU)
        if (tt) mk.bindTooltip(tt, { permanent: false, direction: 'top', className: 'rm-tt-wrap', offset: [0, -12] })
      }

      if (boundsPts.length) {
        map.fitBounds(L.latLngBounds(boundsPts), { padding: [36, 36], maxZoom: 8 })
      }

      const t = window.setTimeout(() => map.invalidateSize(), 120)
      return () => window.clearTimeout(t)
    }

    const uniquePaths = new Map<string, NormalizedItinerary>()
    for (const it of items) {
      if (!uniquePaths.has(it.waypointKey)) uniquePaths.set(it.waypointKey, it)
      if (uniquePaths.size >= 40) break
    }

    const boundsPts: L.LatLngExpression[] = []

    for (const [wkey, it] of uniquePaths) {
      const codes = it.waypointKey.split('-').filter(Boolean)
      const pts: L.LatLngExpression[] = []
      for (const c of codes) {
        const p = coordsByIata.get(c)
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
          pts.push([p.lat, p.lon])
          boundsPts.push([p.lat, p.lon])
        }
      }
      if (pts.length < 2) continue
      const selected = routeFilter != null && routeFilter.has(wkey)
      const line = selected ? ROUTE_LINE_SELECTED : ROUTE_LINE
      const onRouteClick = (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        const fn = routeRef.current
        if (routeFilter != null && routeFilter.has(wkey)) fn(null)
        else fn(wkey)
      }
      L.polyline(pts, {
        color: line.color,
        weight: line.weight,
        opacity: line.opacity,
        lineJoin: 'round',
        lineCap: 'round',
        interactive: false,
      }).addTo(layer)
      L.polyline(pts, {
        color: '#000',
        weight: 16,
        opacity: 0,
        lineJoin: 'round',
        lineCap: 'round',
      })
        .on('click', onRouteClick)
        .addTo(layer)
    }

    const hubSet = new Set<string>([...origins, ...destinations])
    for (const it of items) {
      for (const code of connectionLayoverHubs(it)) hubSet.add(code)
    }

    const hubSetUpper = new Set([...hubSet].map((c) => c.trim().toUpperCase()))

    for (const code of hubSet) {
      const p = coordsByIata.get(code.trim().toUpperCase())
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
      boundsPts.push([p.lat, p.lon])
      const codeU = code.trim().toUpperCase()
      const hubOn = hubFilter.has(codeU)
      const markClass = `route-map-hublabel${hubOn ? ' route-map-hublabel--on' : ''}`
      /** Leaflet sizes the icon box from `iconSize` — a 1×1px box forced one letter per line. */
      const labelH = 20
      const labelW = Math.max(26, 6 + codeU.length * 8)
      const icon = L.divIcon({
        className: 'route-map-hublabel-marker',
        html: `<div class="${markClass}" style="width:${labelW}px;height:${labelH}px"><span class="route-map-hublabel-text">${escapeHtml(codeU)}</span></div>`,
        iconSize: [labelW, labelH],
        iconAnchor: [labelW / 2, labelH / 2],
      })
      const mk = L.marker([p.lat, p.lon], { icon, zIndexOffset: hubOn ? 750 : 500 })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          hubRef.current(code)
        })
        .addTo(layer)
      const tt = makeTooltip(codeU)
      if (tt) mk.bindTooltip(tt, { permanent: false, direction: 'top', className: 'rm-tt-wrap', offset: [0, -12] })
    }

    const odUpperForNearby = new Set<string>()
    for (const c of origins) odUpperForNearby.add(c.trim().toUpperCase())
    for (const c of destinations) odUpperForNearby.add(c.trim().toUpperCase())
    const anchorIatasForNearby = [origins[0], destinations[0]]
      .filter(Boolean)
      .map((c) => c.trim().toUpperCase())
    if (anchorIatasForNearby.length > 0) {
      const nearbyRows = nearbyAirportsForAnchors(airports, anchorIatasForNearby, {
        excludeIatas: odUpperForNearby,
      })
      for (const { row } of nearbyRows) {
        const codeU = row.iata.trim().toUpperCase()
        if (hubSetUpper.has(codeU)) continue
        const p = coordsByIata.get(codeU)
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
        boundsPts.push([p.lat, p.lon])
        const markClass = 'route-map-hublabel route-map-hublabel--preview'
        const labelH = 20
        const labelW = Math.max(26, 6 + codeU.length * 8)
        const icon = L.divIcon({
          className: 'route-map-hublabel-marker',
          html: `<div class="${markClass}" style="width:${labelW}px;height:${labelH}px"><span class="route-map-hublabel-text">${escapeHtml(codeU)}</span></div>`,
          iconSize: [labelW, labelH],
          iconAnchor: [labelW / 2, labelH / 2],
        })
        const mk = L.marker([p.lat, p.lon], { icon, zIndexOffset: 400 }).addTo(layer)
        const tt = makeTooltip(codeU)
        if (tt) mk.bindTooltip(tt, { permanent: false, direction: 'top', className: 'rm-tt-wrap', offset: [0, -12] })
      }
    }

    if (boundsPts.length) {
      map.fitBounds(L.latLngBounds(boundsPts), { padding: [28, 28], maxZoom: 6 })
    }

    const t = window.setTimeout(() => map.invalidateSize(), 120)
    return () => window.clearTimeout(t)
  }, [
    items,
    itemsReturn,
    coordsByIata,
    airports,
    origins,
    destinations,
    hubFilter,
    routeFilter,
    soloFocus,
    onSoloFocusClear,
  ])

  const previewOnly = items.length === 0 && itemsReturn.length === 0

  return (
    <div className="results-route-map-wrap" ref={wrapRef}>
      <div className="results-route-map" ref={mapEl} />
      <p className="muted small results-route-map-hint">
        {previewOnly ? (
          <>
            Preview: selected airports and a few nearby options · After you search, click a route line to filter by that
            sequence · Click hub codes to filter layovers · Drag to pan · Scroll to zoom
          </>
        ) : soloFocus ? (
          <>
            Showing this itinerary only · Click the route line on the map to clear · Or click <strong>Map</strong> again
            on the same card
          </>
        ) : (
          <>
            Click a route line to list only that airport sequence (click again to clear) · Click an airport code to keep
            itineraries that use that airport on the path (click again to clear that pin) · Dim chips are nearby
            suggestions (same as the dropdown) · Drag to pan · Scroll to zoom
          </>
        )}
      </p>
    </div>
  )
}
