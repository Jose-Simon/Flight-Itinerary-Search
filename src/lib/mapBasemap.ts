import type { TileLayerOptions } from 'leaflet'

/**
 * Basemap for route maps. Standard OSM raster tiles (`tile.openstreetmap.org`) mostly show
 * whatever is in `name=*`, which is often local script only (e.g. 北京, Hangul). Esri World
 * Street Map uses English / Latin exonyms for many international cities, which matches “read
 * cities in English” better. True bilingual labels (English + local on the same tile) need a
 * vector style; we keep a single raster layer for simplicity and zero API keys.
 *
 * @see https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer
 */
export const ENGLISH_FORWARD_BASEMAP_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'

export const englishForwardBasemapOptions: TileLayerOptions = {
  attribution:
    '&copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, ' +
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
    'and the GIS user community',
  maxZoom: 19,
  maxNativeZoom: 16,
}
