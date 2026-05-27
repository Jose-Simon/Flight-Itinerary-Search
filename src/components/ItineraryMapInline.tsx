import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { NormalizedItinerary } from '../lib/types'
import type { CoordsMap } from '../lib/coords'
import { ENGLISH_FORWARD_BASEMAP_URL, englishForwardBasemapOptions } from '../lib/mapBasemap'

const ICON_2X = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png'
const ICON = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png'
const SHADOW = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'

const DefaultIcon = L.icon({
  iconRetinaUrl: ICON_2X,
  iconUrl: ICON,
  shadowUrl: SHADOW,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

type Props = {
  itinerary: NormalizedItinerary
  coordsByIata: CoordsMap
}

export function ItineraryMapInline({ itinerary, coordsByIata }: Props) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    const el = mapEl.current
    if (!el) return

    const codes = itinerary.waypointKey.split('-').filter(Boolean)
    const markers: { code: string; ll: L.LatLngExpression }[] = []
    for (const c of codes) {
      const p = coordsByIata.get(c)
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        markers.push({ code: c, ll: [p.lat, p.lon] })
      }
    }
    if (markers.length === 0) return

    const pts = markers.map((m) => m.ll)

    if (!mapRef.current) {
      mapRef.current = L.map(el, { zoomControl: true, attributionControl: true })
      L.tileLayer(ENGLISH_FORWARD_BASEMAP_URL, englishForwardBasemapOptions).addTo(mapRef.current)
      layerRef.current = L.layerGroup().addTo(mapRef.current)
    }
    const map = mapRef.current
    const layer = layerRef.current!
    layer.clearLayers()

    for (const { code, ll } of markers) {
      L.marker(ll).bindPopup(code).addTo(layer)
    }
    if (pts.length > 1) {
      L.polyline(pts, { color: '#3d8bfd', weight: 3, opacity: 0.88 }).addTo(layer)
    }
    const b = L.latLngBounds(pts)
    map.fitBounds(b, { padding: [16, 16], maxZoom: 8 })
    const t = window.setTimeout(() => map.invalidateSize(), 120)

    return () => {
      window.clearTimeout(t)
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [itinerary.waypointKey, coordsByIata])

  const codes = itinerary.waypointKey.split('-').filter(Boolean)
  const hasCoords = codes.some((c) => coordsByIata.has(c))

  if (!hasCoords) {
    return <p className="muted small itin-map-fallback">No coordinates for these airports in the local database.</p>
  }

  return <div ref={mapEl} className="map-canvas-inline" role="img" aria-label="Route map" />
}
