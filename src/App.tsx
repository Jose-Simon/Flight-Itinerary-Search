import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import countryToAirports from './data/countryToAirports.json'
import airlineDirectory from './data/airlinesByIata.json'
import airlinesMetaJson from './data/airlinesMeta.json'
import { mergeRegionDefaults, REGION_IDS_IN_UI_ORDER, type RegionId } from './data/regions'
import { AirportMultiSelect } from './components/AirportMultiSelect'
import { AirlineFilterPanel, type AirlinesMeta } from './components/AirlineFilterPanel'
import { DurationHistogramFilters } from './components/DurationHistogramFilters'
import { PriceHistogramFilter } from './components/PriceHistogramFilter'
import { LayoverRegionsPanel } from './components/LayoverRegionsPanel'
import { ResultsList } from './components/ResultsList'
import { ResultsRouteMap, type MapSoloFocus } from './components/ResultsRouteMap'
import { SearchSectionSummary } from './components/SearchSectionSummary'
import { SettingsModal } from './components/SettingsModal'
import { StopsFilterBlock } from './components/StopsFilterBlock'
import { AircraftFilterBlock } from './components/AircraftFilterBlock'
import { FilterChip } from './components/FilterChip'
import { TakeoffLandingHistogramFilters } from './components/TakeoffLandingHistogramFilters'
import { SearchSummaryBar } from './components/SearchSummaryBar'
import { SavedSearchesPanel } from './components/SavedSearchesPanel'
import { usePersistedSettings } from './hooks/usePersistedSettings'
import { useFlightDb } from './hooks/useFlightDb'
import type { AirportRow } from './lib/airportTypes'
import {
  filterStateFromInputs,
  type LegDurationMatchMode,
  passesAirlineResultFilter,
  passesItineraryFilters,
  passesAircraftFilter,
  type AircraftMatchMode,
  dedupeDisplayByWaypoint,
  sortItineraries,
  itineraryScheduleKey,
  type HourFieldStrings,
  type PriceFieldStrings,
  type FilterState,
  type SortMode,
} from './lib/filters'
import { itineraryInsightStats } from './lib/resultStats'
import { itineraryCountsByAirline } from './lib/resultInsights'
import type { NormalizedItinerary } from './lib/types'
import {
  searchDirection,
  searchPriceWindow,
  dateRange as pwDateRange,
  dateWindow,
  type SearchFlightInput,
  type SerpSearchDebugBundle,
  type PriceWindowSearchInput,
  type PriceWindowPerDateEntry,
} from './services/searchFlights'
import { mergePerDateUnique } from './lib/pipeline'
import { buildPriceWindowResult, reverseRouteKey, type PriceWindowResult } from './lib/routeGrouping'
import { PriceWindowPanel } from './components/PriceWindowPanel'
import { buildSerpDownloadPayload, downloadJson } from './lib/serpDebugExport'
import { passesTimeBucketFilter, type TimeOfDayBucket } from './lib/timeBuckets'
import {
  parseTakeoffLandingBounds,
  passesLandingTimeRange,
  passesTakeoffTimeRange,
  type TimeRangeFieldStrings,
} from './lib/timeRangeFilter'
import type { CoordsMap } from './lib/coords'
import { hubIataSetForRegion } from './lib/layoverHubRegion'
import { inferAircraftManufacturer } from './lib/aircraftManufacturer'
import { savedSearchTitleFromPayload } from './lib/savedSearchLabels'
import { OTHER_HUBS_REGION_ID, unmappedLayoverHubStats } from './lib/unmappedLayoverHubs'
import type { SearchHistoryRow, SearchHistorySnapshotV1 } from './db/searchHistoryTypes'
import type { SavedResultPayloadV1, SavedResultPayloadV2 } from './db/savedResultTypes'
import { SavedRoundTripsList } from './components/SavedRoundTripsList'
import type { SavedSearchPayloadV1 } from './db/savedSearchTypes'
import { ConfigPresetsBar } from './components/ConfigPresetsBar'
import { SerpApiUsageChip } from './components/SerpApiUsageChip'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useConfigPresets } from './hooks/useConfigPresets'
import { useSerpApiUsage } from './hooks/useSerpApiUsage'
import type { FilterSnapshot, DateSnapshot, ConfigSnapshot } from './lib/filterPresetTypes'

function emptyToNull(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Convert a [startDate, endDate] range into centerDate + flexDays for the SearchFlightInput API. */
function dateRangeToCenterFlex(start: string, end: string): { centerDate: string; flexDays: number } {
  const startMs = new Date(start + 'T12:00:00Z').getTime()
  const endMs = new Date(end + 'T12:00:00Z').getTime()
  const diffDays = Math.max(0, Math.round((endMs - startMs) / 86400000))
  const flex = Math.min(14, Math.ceil(diffDays / 2))
  const centerDate = flex > 0 ? addDaysIso(start, flex) : start
  return { centerDate, flexDays: flex }
}

const TIME_BUCKET_DEFS: { id: TimeOfDayBucket; label: string; hint: string }[] = [
  { id: 'morning', label: 'Morning', hint: '5–11 am' },
  { id: 'afternoon', label: 'Afternoon', hint: '12–4 pm' },
  { id: 'evening', label: 'Evening', hint: '5–9 pm' },
  { id: 'overnight', label: 'Overnight', hint: '10 pm–4 am' },
]

const EMPTY_HOURS: HourFieldStrings = {
  minLeg: '',
  maxLeg: '',
  minTotal: '',
  maxTotal: '',
  minFlight: '',
  maxFlight: '',
  minLayover: '',
  maxLayover: '',
}

const EMPTY_PRICE: PriceFieldStrings = { min: '', max: '' }

const EMPTY_TIME_RANGE: TimeRangeFieldStrings = {
  takeoffMin: '',
  takeoffMax: '',
  landingMin: '',
  landingMax: '',
}

/** Keep every schedule-distinct itinerary from each SerpApi response when merging the flex window. */
const MERGE_PER_DATE_LIMIT = Number.POSITIVE_INFINITY

/** SerpApi / Google Flights “max segments” (API only; client filters use Stops min/max). */
const API_MAX_SEGMENTS = 6

const PIPELINE_EXCLUDED_NONE = new Set<string>()

/** Display TZ: empty string = each segment in its airport local zone (see formatFlightTimes). */
const DISPLAY_TZ_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'America/New_York', label: 'US (ET)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
]

export default function App() {
  const { settings, update } = usePersistedSettings()
  const {
    ready: dbReady,
    error: dbError,
    regionCountries,
    airlineUiRegions,
    updateRegionText,
    replaceAirlineMappings,
    airportUiRegions,
    replaceAirportMappings,
    resetRegions,
    cacheTtlHours,
    updateCacheTtl,
    persistSearch,
    loadCached,
    resetEntireDb,
    saveSerpApiSearchCapture,
    getSerpCaptureRows,
    getSerpCaptureStoredRecord,
    removeSerpCapture,
    searchHistory,
    recordSearchHistory,
    savedResults,
    saveSavedResult,
    removeSavedResult,
    savedSearches,
    addSavedSearch,
    removeSavedSearch,
    loadDefaultSavedSearchPayload,
    saveDefaultSavedSearch,
  } = useFlightDb()

  const [mainTab, setMainTab] = useState<'search' | 'savedSearches' | 'savedResults'>('search')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [airports, setAirports] = useState<AirportRow[] | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [airlineExcludedCodes, setAirlineExcludedCodes] = useState(() => new Set<string>())

  useEffect(() => {
    void import('./data/airports.json').then((m) => {
      setAirports(m.default as AirportRow[])
    })
  }, [])

  const [origins, setOrigins] = useState<string[]>(['PHL', 'EWR', 'JFK', 'LGA'])
  const [destinations, setDestinations] = useState<string[]>(['MAA', 'TRV', 'IXM', 'BLR', 'COK'])
  const [tripType, setTripType] = useState<'oneway' | 'round'>('oneway')
  const [outboundDate, setOutboundDate] = useState('2026-07-09')
  const [outboundEnd, setOutboundEnd] = useState('2026-07-09')
  const [returnDate, setReturnDate] = useState('2026-07-19')
  const [returnEnd, setReturnEnd] = useState('2026-07-19')
  const [outHours, setOutHours] = useState<HourFieldStrings>({ ...EMPTY_HOURS })
  const [retHours, setRetHours] = useState<HourFieldStrings>({ ...EMPTY_HOURS })
  const [outPrice, setOutPrice] = useState<PriceFieldStrings>({ ...EMPTY_PRICE })
  const [retPrice, setRetPrice] = useState<PriceFieldStrings>({ ...EMPTY_PRICE })
  const [outTimeRange, setOutTimeRange] = useState<TimeRangeFieldStrings>({ ...EMPTY_TIME_RANGE })
  const [retTimeRange, setRetTimeRange] = useState<TimeRangeFieldStrings>({ ...EMPTY_TIME_RANGE })
  const [outLegDurationMatch, setOutLegDurationMatch] = useState<LegDurationMatchMode>('all')
  const [retLegDurationMatch, setRetLegDurationMatch] = useState<LegDurationMatchMode>('all')
  const [outStopsMin, setOutStopsMin] = useState('')
  const [outStopsMax, setOutStopsMax] = useState('')
  const [retStopsMin, setRetStopsMin] = useState('')
  const [retStopsMax, setRetStopsMax] = useState('')
  const [returnCustomFilters, setReturnCustomFilters] = useState(false)
  const [layoverRegionOn, setLayoverRegionOn] = useState<Record<RegionId, boolean>>(() => {
    const o = {} as Record<RegionId, boolean>
    for (const k of REGION_IDS_IN_UI_ORDER) o[k] = true
    return o
  })
  const [layoverAirportOff, setLayoverAirportOff] = useState<Set<string>>(() => new Set())
  /**
   * When false, layover geography is not applied (all hubs allowed). Turning on any region/airport
   * control sets this true so partial “include” lists cannot zero out the whole grid by mistake.
   */
  const [layoverGeoFilterActive, setLayoverGeoFilterActive] = useState(false)
  const [mapHubFilter, setMapHubFilter] = useState<Set<string>>(() => new Set())
  const [mapRouteFilter, setMapRouteFilter] = useState<Set<string> | null>(null)
  /** Result card “Map” → highlight one itinerary on the top map (no inline map). */
  const [mapSoloFocus, setMapSoloFocus] = useState<MapSoloFocus | null>(null)
  const routeMapWrapRef = useRef<HTMLDivElement>(null)
  const defaultSearchAppliedRef = useRef(false)
  const [excludeTechnical, setExcludeTechnical] = useState(false)
  const [showOpenJaw, setShowOpenJaw] = useState(true)
  const [sortOut, setSortOut] = useState<SortMode>('duration')
  const [sortReturn, setSortReturn] = useState<SortMode>('duration')
  /** API = live SerpApi (+ save to SQLite). DB = load cached snapshot only (same hash as API runs). */
  const [searchSource, setSearchSource] = useState<'api' | 'db'>('api')
  const [timeBucketsOut, setTimeBucketsOut] = useState<Set<TimeOfDayBucket>>(new Set())
  const [timeBucketsRet, setTimeBucketsRet] = useState<Set<TimeOfDayBucket>>(new Set())
  const [displayTimezone, setDisplayTimezone] = useState('')

  const [searchGoal, setSearchGoal] = useState<'discovery' | 'priceWindow'>('discovery')
  const [pwOutResult, setPwOutResult] = useState<PriceWindowResult | null>(null)
  const [pwRetResult, setPwRetResult] = useState<PriceWindowResult | null>(null)
  const [pwOutboundSel, setPwOutboundSel] = useState<{ routeKey: string; date: string; pickedIdx?: number; selectedItinerary?: NormalizedItinerary } | null>(null)
  const [pwReturnSel, setPwReturnSel] = useState<{ routeKey: string; date: string; pickedIdx?: number; selectedItinerary?: NormalizedItinerary } | null>(null)
  const [pwRawOutPerDate, setPwRawOutPerDate] = useState<PriceWindowPerDateEntry[]>([])
  const [pwRawRetPerDate, setPwRawRetPerDate] = useState<PriceWindowPerDateEntry[]>([])

  const [loading, setLoading] = useState(false)
  const [searchRefreshKey, setSearchRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rawOut, setRawOut] = useState<NormalizedItinerary[]>([])
  const [rawReturn, setRawReturn] = useState<NormalizedItinerary[]>([])
  const [cacheHint, setCacheHint] = useState<string | null>(null)
  const [uniqueRoutesOnly, setUniqueRoutesOnly] = useState(true)
  const [searchPanelOpen, setSearchPanelOpen] = useState(true)
  const [aircraftSelectedCodes, setAircraftSelectedCodes] = useState<string[]>([])
  const [aircraftMatchMode, setAircraftMatchMode] = useState<AircraftMatchMode>('any')
  /** Last live/mock SerpApi responses (per flex date) for debugging — not set when loading from SQLite only. */
  const [serpCapture, setSerpCapture] = useState<{
    outbound: SerpSearchDebugBundle | null
    return: SerpSearchDebugBundle | null
  }>({ outbound: null, return: null })

  // ── SerpApi usage ────────────────────────────────────────────────────────────
  const { state: serpUsageState, refresh: refreshSerpUsage } = useSerpApiUsage(
    settings.apiKey,
    searchRefreshKey,
  )

  // ── Config presets (filters + dates unified) ────────────────────────────────
  const configPresets = useConfigPresets()

  const currentFilterSnapshot = useMemo((): FilterSnapshot => ({
    airlineExcludedCodes: [...airlineExcludedCodes],
    outStopsMin,
    outStopsMax,
    retStopsMin,
    retStopsMax,
    outHours,
    retHours,
    outPrice,
    retPrice,
    outTimeRange,
    retTimeRange,
    outLegDurationMatch,
    retLegDurationMatch,
    timeBucketsOut: [...timeBucketsOut],
    timeBucketsRet: [...timeBucketsRet],
    layoverRegionOn,
    layoverAirportOff: [...layoverAirportOff],
    layoverGeoFilterActive,
    excludeTechnical,
    showOpenJaw,
    uniqueRoutesOnly,
    returnCustomFilters,
    aircraftSelectedCodes,
    aircraftMatchMode,
    sortOut,
    sortReturn,
  }), [
    airlineExcludedCodes, outStopsMin, outStopsMax, retStopsMin, retStopsMax,
    outHours, retHours, outPrice, retPrice, outTimeRange, retTimeRange,
    outLegDurationMatch, retLegDurationMatch, timeBucketsOut, timeBucketsRet,
    layoverRegionOn, layoverAirportOff, layoverGeoFilterActive,
    excludeTechnical, showOpenJaw, uniqueRoutesOnly, returnCustomFilters,
    aircraftSelectedCodes, aircraftMatchMode, sortOut, sortReturn,
  ])

  const currentDateSnapshot = useMemo((): DateSnapshot => ({
    tripType,
    outboundDate,
    outboundEnd,
    returnDate,
    returnEnd,
  }), [tripType, outboundDate, outboundEnd, returnDate, returnEnd])

  const currentConfigSnapshot = useMemo((): ConfigSnapshot => ({
    ...currentFilterSnapshot,
    ...currentDateSnapshot,
  }), [currentFilterSnapshot, currentDateSnapshot])

  /** Apply the filter portion of a config snapshot. */
  const applyFilterPreset = useCallback((f: FilterSnapshot) => {
    setAirlineExcludedCodes(new Set(f.airlineExcludedCodes))
    setOutStopsMin(f.outStopsMin)
    setOutStopsMax(f.outStopsMax)
    setRetStopsMin(f.retStopsMin)
    setRetStopsMax(f.retStopsMax)
    setOutHours({ ...f.outHours })
    setRetHours({ ...f.retHours })
    setOutPrice({ ...f.outPrice })
    setRetPrice({ ...f.retPrice })
    setOutTimeRange({ ...f.outTimeRange })
    setRetTimeRange({ ...f.retTimeRange })
    setOutLegDurationMatch(f.outLegDurationMatch)
    setRetLegDurationMatch(f.retLegDurationMatch)
    setTimeBucketsOut(new Set(f.timeBucketsOut))
    setTimeBucketsRet(new Set(f.timeBucketsRet))
    setLayoverRegionOn({ ...f.layoverRegionOn })
    setLayoverAirportOff(new Set(f.layoverAirportOff))
    setLayoverGeoFilterActive(f.layoverGeoFilterActive)
    setExcludeTechnical(f.excludeTechnical)
    setShowOpenJaw(f.showOpenJaw)
    setUniqueRoutesOnly(f.uniqueRoutesOnly)
    setReturnCustomFilters(f.returnCustomFilters)
    setAircraftSelectedCodes(f.aircraftSelectedCodes)
    setAircraftMatchMode(f.aircraftMatchMode)
    setSortOut(f.sortOut)
    setSortReturn(f.sortReturn)
  }, [])

  /** Apply the date portion of a config snapshot. */
  const applyDatePreset = useCallback((d: DateSnapshot) => {
    setTripType(d.tripType)
    setOutboundDate(d.outboundDate)
    setOutboundEnd((d.outboundEnd as string | undefined) ?? d.outboundDate)
    setReturnDate(d.returnDate)
    setReturnEnd((d.returnEnd as string | undefined) ?? d.returnDate)
  }, [])

  /** Apply both filter + date portions of a unified config preset. */
  const applyConfigPreset = useCallback((c: ConfigSnapshot) => {
    applyFilterPreset(c)
    applyDatePreset(c)
  }, [applyFilterPreset, applyDatePreset])

  // Apply default config preset once on mount
  const defaultAppliedRef = useRef(false)
  useEffect(() => {
    if (defaultAppliedRef.current) return
    defaultAppliedRef.current = true
    if (configPresets.defaultPreset) {
      applyConfigPreset(configPresets.defaultPreset.config)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tzByIata = useMemo(() => {
    const m = new Map<string, string>()
    if (!airports) return m
    for (const a of airports) {
      if (a.iata && a.tz) m.set(a.iata, a.tz)
    }
    return m
  }, [airports])

  const coordsByIata = useMemo((): CoordsMap => {
    const m = new Map<string, { lat: number; lon: number }>()
    if (!airports) return m
    for (const a of airports) {
      if (a.iata && a.lat != null && a.lon != null) {
        m.set(a.iata, { lat: a.lat, lon: a.lon })
      }
    }
    return m
  }, [airports])

  const airlinesDict = airlineDirectory as Record<string, string>

  const namesByIata = useMemo(() => {
    const m = new Map<string, string>()
    if (!airports) return m
    for (const a of airports) {
      if (a.iata) m.set(a.iata, a.name || a.city || a.iata)
    }
    return m
  }, [airports])

  const airportsByIata = useMemo(() => {
    const m = new Map<string, AirportRow>()
    if (!airports) return m
    for (const a of airports) {
      if (a.iata) m.set(a.iata, a)
    }
    return m
  }, [airports])

  const regionCountriesForLayover = useMemo(
    () => mergeRegionDefaults(regionCountries),
    [regionCountries],
  )

  const allowedLayoverAirports = useMemo(() => {
    if (!layoverGeoFilterActive) return null
    const ids = REGION_IDS_IN_UI_ORDER
    const allOn = ids.every((id) => layoverRegionOn[id] !== false)
    if (allOn && layoverAirportOff.size === 0) return null
    const allowed = new Set<string>()
    for (const rid of ids) {
      if (!layoverRegionOn[rid]) continue
      if (rid === OTHER_HUBS_REGION_ID) {
        const { hubSet } = unmappedLayoverHubStats(
          rawOut,
          airportsByIata,
          regionCountriesForLayover,
          airportUiRegions,
        )
        for (const iata of hubSet) {
          if (!layoverAirportOff.has(iata)) allowed.add(iata)
        }
        continue
      }
      const airs = hubIataSetForRegion(
        rid,
        regionCountriesForLayover,
        countryToAirports as Record<string, string[]>,
        airportUiRegions,
      )
      for (const iata of airs) {
        if (layoverAirportOff.has(iata)) continue
        allowed.add(iata)
      }
    }
    return allowed
  }, [
    layoverGeoFilterActive,
    layoverRegionOn,
    layoverAirportOff,
    regionCountriesForLayover,
    airportUiRegions,
    rawOut,
    airportsByIata,
  ])

  const primaryDestination = destinations[0]
  const multipleDestinations = destinations.length > 1

  const filterFlags = useMemo(
    () => ({
      excludeTechnicalStops: excludeTechnical,
      showOpenJaw: tripType === 'round' ? showOpenJaw : true,
      allowedLayoverAirports,
      requiredLayoverHubs: mapHubFilter,
      routeWaypointFilter: mapRouteFilter,
    }),
    [excludeTechnical, showOpenJaw, tripType, allowedLayoverAirports, mapHubFilter, mapRouteFilter],
  )

  const aircraftFilterSet = useMemo(() => new Set(aircraftSelectedCodes), [aircraftSelectedCodes])

  /** Distinct aircraft types with how many itineraries (out + return) use that type on ≥1 leg. */
  const aircraftOptionsWithCounts = useMemo(() => {
    const counts = new Map<string, number>()
    const countItin = (it: NormalizedItinerary) => {
      const types = new Set<string>()
      for (const seg of it.segments) {
        const a = seg.airplane?.trim()
        if (a) types.add(a)
      }
      for (const a of types) {
        counts.set(a, (counts.get(a) ?? 0) + 1)
      }
    }
    for (const it of rawOut) countItin(it)
    for (const it of rawReturn) countItin(it)
    return [...counts.entries()]
      .map(([aircraft, routeCount]) => ({ aircraft, routeCount }))
      .sort((a, b) => b.routeCount - a.routeCount || a.aircraft.localeCompare(b.aircraft))
  }, [rawOut, rawReturn])

  /** Itineraries (out + return) with ≥1 segment on an aircraft of this manufacturer. */
  const aircraftManufacturerPoolCounts = useMemo(() => {
    const countItin = (it: NormalizedItinerary, mfr: string) => {
      for (const seg of it.segments) {
        const a = seg.airplane?.trim()
        if (a && inferAircraftManufacturer(a) === mfr) return true
      }
      return false
    }
    const mfrs = new Set<string>()
    for (const { aircraft } of aircraftOptionsWithCounts) {
      mfrs.add(inferAircraftManufacturer(aircraft))
    }
    const counts: Record<string, number> = {}
    for (const mfr of mfrs) {
      let n = 0
      for (const it of rawOut) if (countItin(it, mfr)) n++
      for (const it of rawReturn) if (countItin(it, mfr)) n++
      counts[mfr] = n
    }
    return counts
  }, [rawOut, rawReturn, aircraftOptionsWithCounts])

  const airlinesFromResults = useMemo(() => {
    const set = new Set<string>()
    for (const it of rawOut) {
      for (const s of it.segments) {
        const c = s.airline?.trim().toUpperCase()
        if (c) set.add(c)
      }
    }
    for (const it of rawReturn) {
      for (const s of it.segments) {
        const c = s.airline?.trim().toUpperCase()
        if (c) set.add(c)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rawOut, rawReturn])

  const effRetHours = returnCustomFilters && tripType === 'round' ? retHours : outHours
  const effRetPrice = returnCustomFilters && tripType === 'round' ? retPrice : outPrice
  const effRetTimeRange = returnCustomFilters && tripType === 'round' ? retTimeRange : outTimeRange
  const effBucketsRet =
    returnCustomFilters && tripType === 'round' ? timeBucketsRet : timeBucketsOut

  const outStopsFields = useMemo(
    () => ({ minStops: outStopsMin, maxStops: outStopsMax }),
    [outStopsMin, outStopsMax],
  )
  const effRetStopsFields = useMemo(
    () =>
      returnCustomFilters && tripType === 'round'
        ? { minStops: retStopsMin, maxStops: retStopsMax }
        : outStopsFields,
    [returnCustomFilters, tripType, retStopsMin, retStopsMax, outStopsFields],
  )

  const filterOut: FilterState = useMemo(
    () =>
      filterStateFromInputs(
        sortOut,
        outHours,
        outStopsFields,
        {
          ...filterFlags,
          legDurationMatch: outLegDurationMatch,
        },
        outPrice,
      ),
    [sortOut, outHours, outStopsFields, filterFlags, outLegDurationMatch, outPrice],
  )

  const filterFlagsNoMap = useMemo(
    () => ({
      excludeTechnicalStops: filterFlags.excludeTechnicalStops,
      showOpenJaw: filterFlags.showOpenJaw,
      allowedLayoverAirports: filterFlags.allowedLayoverAirports,
      requiredLayoverHubs: new Set<string>(),
      routeWaypointFilter: null,
    }),
    [filterFlags],
  )

  const filterOutNoMap: FilterState = useMemo(
    () =>
      filterStateFromInputs(
        sortOut,
        outHours,
        outStopsFields,
        {
          ...filterFlagsNoMap,
          legDurationMatch: outLegDurationMatch,
        },
        outPrice,
      ),
    [sortOut, outHours, outStopsFields, filterFlagsNoMap, outLegDurationMatch, outPrice],
  )

  const filterRetNoMap: FilterState = useMemo(() => {
    const legDurationMatch =
      returnCustomFilters && tripType === 'round' ? retLegDurationMatch : outLegDurationMatch
    return filterStateFromInputs(
      sortReturn,
      effRetHours,
      effRetStopsFields,
      {
        ...filterFlagsNoMap,
        legDurationMatch,
      },
      effRetPrice,
    )
  }, [
    sortReturn,
    effRetHours,
    effRetStopsFields,
    filterFlagsNoMap,
    returnCustomFilters,
    tripType,
    retLegDurationMatch,
    outLegDurationMatch,
    effRetPrice,
  ])

  const outTakeoffLandingBounds = useMemo(() => parseTakeoffLandingBounds(outTimeRange), [outTimeRange])
  const retTakeoffLandingBounds = useMemo(
    () => parseTakeoffLandingBounds(effRetTimeRange),
    [effRetTimeRange],
  )

  const routeMapItems = useMemo(() => {
    let list = rawOut.filter((it) => passesItineraryFilters(it, filterOutNoMap))
    list = list.filter((it) => passesAirlineResultFilter(it, airlineExcludedCodes))
    list = list.filter((it) => passesAircraftFilter(it, aircraftFilterSet, aircraftMatchMode))
    list = list.filter((it) => passesTimeBucketFilter(it, timeBucketsOut, tzByIata))
    list = list.filter((it) =>
      passesTakeoffTimeRange(
        it,
        outTakeoffLandingBounds.takeoffMin,
        outTakeoffLandingBounds.takeoffMax,
        tzByIata,
      ),
    )
    list = list.filter((it) =>
      passesLandingTimeRange(
        it,
        outTakeoffLandingBounds.landingMin,
        outTakeoffLandingBounds.landingMax,
        tzByIata,
      ),
    )
    list = sortItineraries(list, sortOut)
    if (uniqueRoutesOnly) list = dedupeDisplayByWaypoint(list, sortOut)
    return list
  }, [
    rawOut,
    filterOutNoMap,
    sortOut,
    timeBucketsOut,
    tzByIata,
    airlineExcludedCodes,
    uniqueRoutesOnly,
    aircraftFilterSet,
    aircraftMatchMode,
    outTakeoffLandingBounds,
  ])

  const routeMapItemsReturn = useMemo(() => {
    let list = rawReturn.filter((it) => passesItineraryFilters(it, filterRetNoMap))
    list = list.filter((it) => passesAirlineResultFilter(it, airlineExcludedCodes))
    list = list.filter((it) => passesAircraftFilter(it, aircraftFilterSet, aircraftMatchMode))
    list = list.filter((it) => passesTimeBucketFilter(it, effBucketsRet, tzByIata))
    list = list.filter((it) =>
      passesTakeoffTimeRange(
        it,
        retTakeoffLandingBounds.takeoffMin,
        retTakeoffLandingBounds.takeoffMax,
        tzByIata,
      ),
    )
    list = list.filter((it) =>
      passesLandingTimeRange(
        it,
        retTakeoffLandingBounds.landingMin,
        retTakeoffLandingBounds.landingMax,
        tzByIata,
      ),
    )
    list = sortItineraries(list, sortReturn)
    if (uniqueRoutesOnly) list = dedupeDisplayByWaypoint(list, sortReturn)
    return list
  }, [
    rawReturn,
    filterRetNoMap,
    sortReturn,
    effBucketsRet,
    tzByIata,
    airlineExcludedCodes,
    uniqueRoutesOnly,
    aircraftFilterSet,
    aircraftMatchMode,
    retTakeoffLandingBounds,
  ])

  const odIataExclude = useMemo(() => {
    const s = new Set<string>()
    for (const c of origins) s.add(c.trim().toUpperCase())
    for (const c of destinations) s.add(c.trim().toUpperCase())
    return s
  }, [origins, destinations])

  const showRouteMap =
    origins.length > 0 || destinations.length > 0 || (hasSearched && rawOut.length > 0)

  const filterRet: FilterState = useMemo(() => {
    const legDurationMatch =
      returnCustomFilters && tripType === 'round' ? retLegDurationMatch : outLegDurationMatch
    return filterStateFromInputs(
      sortReturn,
      effRetHours,
      effRetStopsFields,
      {
        ...filterFlags,
        legDurationMatch,
      },
      effRetPrice,
    )
  }, [
    sortReturn,
    effRetHours,
    effRetStopsFields,
    filterFlags,
    returnCustomFilters,
    tripType,
    retLegDurationMatch,
    outLegDurationMatch,
    effRetPrice,
  ])

  const displayOut = useMemo(() => {
    let list = rawOut.filter((it) => passesItineraryFilters(it, filterOut))
    list = list.filter((it) => passesAirlineResultFilter(it, airlineExcludedCodes))
    list = list.filter((it) => passesAircraftFilter(it, aircraftFilterSet, aircraftMatchMode))
    list = list.filter((it) => passesTimeBucketFilter(it, timeBucketsOut, tzByIata))
    list = list.filter((it) =>
      passesTakeoffTimeRange(
        it,
        outTakeoffLandingBounds.takeoffMin,
        outTakeoffLandingBounds.takeoffMax,
        tzByIata,
      ),
    )
    list = list.filter((it) =>
      passesLandingTimeRange(
        it,
        outTakeoffLandingBounds.landingMin,
        outTakeoffLandingBounds.landingMax,
        tzByIata,
      ),
    )
    list = sortItineraries(list, sortOut)
    if (uniqueRoutesOnly) list = dedupeDisplayByWaypoint(list, sortOut)
    return list
  }, [
    rawOut,
    filterOut,
    sortOut,
    timeBucketsOut,
    tzByIata,
    airlineExcludedCodes,
    uniqueRoutesOnly,
    aircraftFilterSet,
    aircraftMatchMode,
    outTakeoffLandingBounds,
  ])

  const displayReturn = useMemo(() => {
    let list = rawReturn.filter((it) => passesItineraryFilters(it, filterRet))
    list = list.filter((it) => passesAirlineResultFilter(it, airlineExcludedCodes))
    list = list.filter((it) => passesAircraftFilter(it, aircraftFilterSet, aircraftMatchMode))
    list = list.filter((it) => passesTimeBucketFilter(it, effBucketsRet, tzByIata))
    list = list.filter((it) =>
      passesTakeoffTimeRange(
        it,
        retTakeoffLandingBounds.takeoffMin,
        retTakeoffLandingBounds.takeoffMax,
        tzByIata,
      ),
    )
    list = list.filter((it) =>
      passesLandingTimeRange(
        it,
        retTakeoffLandingBounds.landingMin,
        retTakeoffLandingBounds.landingMax,
        tzByIata,
      ),
    )
    list = sortItineraries(list, sortReturn)
    if (uniqueRoutesOnly) list = dedupeDisplayByWaypoint(list, sortReturn)
    return list
  }, [
    rawReturn,
    filterRet,
    sortReturn,
    effBucketsRet,
    tzByIata,
    airlineExcludedCodes,
    uniqueRoutesOnly,
    aircraftFilterSet,
    aircraftMatchMode,
    retTakeoffLandingBounds,
  ])

  // Price window: rebuild heatmap from filtered raw itineraries so left-panel filters apply
  const pwOutResultFiltered = useMemo(() => {
    if (!pwRawOutPerDate.length) return null
    const filtered = pwRawOutPerDate.map(({ date, itineraries }) => ({
      date,
      itineraries: itineraries.filter(
        (it) =>
          passesItineraryFilters(it, filterOut) &&
          passesAirlineResultFilter(it, airlineExcludedCodes) &&
          passesAircraftFilter(it, aircraftFilterSet, aircraftMatchMode) &&
          passesTimeBucketFilter(it, timeBucketsOut, tzByIata) &&
          passesTakeoffTimeRange(
            it,
            outTakeoffLandingBounds.takeoffMin,
            outTakeoffLandingBounds.takeoffMax,
            tzByIata,
          ) &&
          passesLandingTimeRange(
            it,
            outTakeoffLandingBounds.landingMin,
            outTakeoffLandingBounds.landingMax,
            tzByIata,
          ),
      ),
    }))
    return buildPriceWindowResult(filtered)
  }, [
    pwRawOutPerDate,
    filterOut,
    airlineExcludedCodes,
    aircraftFilterSet,
    aircraftMatchMode,
    timeBucketsOut,
    tzByIata,
    outTakeoffLandingBounds,
  ])

  const pwRetResultFiltered = useMemo(() => {
    if (!pwRawRetPerDate.length) return null
    const filtered = pwRawRetPerDate.map(({ date, itineraries }) => ({
      date,
      itineraries: itineraries.filter(
        (it) =>
          passesItineraryFilters(it, filterRet) &&
          passesAirlineResultFilter(it, airlineExcludedCodes) &&
          passesAircraftFilter(it, aircraftFilterSet, aircraftMatchMode) &&
          passesTimeBucketFilter(it, effBucketsRet, tzByIata) &&
          passesTakeoffTimeRange(
            it,
            retTakeoffLandingBounds.takeoffMin,
            retTakeoffLandingBounds.takeoffMax,
            tzByIata,
          ) &&
          passesLandingTimeRange(
            it,
            retTakeoffLandingBounds.landingMin,
            retTakeoffLandingBounds.landingMax,
            tzByIata,
          ),
      ),
    }))
    return buildPriceWindowResult(filtered)
  }, [
    pwRawRetPerDate,
    filterRet,
    airlineExcludedCodes,
    aircraftFilterSet,
    aircraftMatchMode,
    effBucketsRet,
    tzByIata,
    retTakeoffLandingBounds,
  ])

  // Resolve the user's explicitly selected return cell into an itinerary + date,
  // so outbound panels can build a precise round-trip Google Flights link.
  const pwReturnSelResolved = useMemo(() => {
    if (!pwReturnSel || !pwRetResultFiltered) return null
    // Use explicitly picked itinerary from the panel, or fall back to bucket's cheapest
    if (pwReturnSel.selectedItinerary) {
      return { it: pwReturnSel.selectedItinerary, date: pwReturnSel.date }
    }
    const bucket = pwRetResultFiltered.perRouteByDate.get(pwReturnSel.routeKey)?.get(pwReturnSel.date)
    return bucket ? { it: bucket.bestItinerary, date: pwReturnSel.date } : null
  }, [pwReturnSel, pwRetResultFiltered])

  const outboundInsightStats = useMemo(() => itineraryInsightStats(displayOut), [displayOut])

  const savedRoundTrips = useMemo(
    () => savedResults.filter((r) => r.leg === 'roundtrip'),
    [savedResults],
  )
  const savedOutboundItins = useMemo(
    () => savedResults.filter((r) => r.leg === 'outbound').map((r) => (r.payload as SavedResultPayloadV1).itinerary),
    [savedResults],
  )
  const savedReturnItins = useMemo(
    () => savedResults.filter((r) => r.leg === 'return').map((r) => (r.payload as SavedResultPayloadV1).itinerary),
    [savedResults],
  )
  const savedOutboundGfMap = useMemo(() => {
    const m = new Map<
      string,
      { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }
    >()
    for (const r of savedResults) {
      if (r.leg !== 'outbound') continue
      const p = r.payload as SavedResultPayloadV1
      m.set(r.scheduleKey, {
        gfOrigins: p.gfOrigins,
        gfDestinations: p.gfDestinations,
        linkDate: p.linkDate,
        returnDate: p.returnDate,
      })
    }
    return m
  }, [savedResults])
  const savedReturnGfMap = useMemo(() => {
    const m = new Map<
      string,
      { gfOrigins: string[]; gfDestinations: string[]; linkDate: string; returnDate: string | null }
    >()
    for (const r of savedResults) {
      if (r.leg !== 'return') continue
      const p = r.payload as SavedResultPayloadV1
      m.set(r.scheduleKey, {
        gfOrigins: p.gfOrigins,
        gfDestinations: p.gfDestinations,
        linkDate: p.linkDate,
        returnDate: p.returnDate,
      })
    }
    return m
  }, [savedResults])
  const savedKeysOutbound = useMemo(
    () => new Set(savedResults.filter((r) => r.leg === 'outbound').map((r) => r.scheduleKey)),
    [savedResults],
  )
  const savedKeysReturn = useMemo(
    () => new Set(savedResults.filter((r) => r.leg === 'return').map((r) => r.scheduleKey)),
    [savedResults],
  )
  const savedOutboundTripType = useMemo(
    () =>
      savedResults.some((r) => r.leg === 'outbound' && (r.payload as SavedResultPayloadV1).tripType === 'round') ? 'round' : 'oneway',
    [savedResults],
  )
  const savedOutPaginationKey = useMemo(
    () => savedResults.filter((r) => r.leg === 'outbound').map((r) => r.scheduleKey).join('\u001e'),
    [savedResults],
  )
  const savedRetPaginationKey = useMemo(
    () => savedResults.filter((r) => r.leg === 'return').map((r) => r.scheduleKey).join('\u001e'),
    [savedResults],
  )

  const airlineItinCountsOut = useMemo(() => itineraryCountsByAirline(displayOut), [displayOut])
  const airlineItinCountsRet = useMemo(() => itineraryCountsByAirline(displayReturn), [displayReturn])

  const outPaginationKey = useMemo(() => displayOut.map(itineraryScheduleKey).join('\u001e'), [displayOut])
  const retPaginationKey = useMemo(() => displayReturn.map(itineraryScheduleKey).join('\u001e'), [displayReturn])

  const hashExtras = useMemo(
    () => ({
      deepSearch: settings.deepSearch,
      showHidden: settings.showHidden,
      gl: settings.gl,
      hl: settings.hl,
      currency: settings.currency,
    }),
    [settings.deepSearch, settings.showHidden, settings.gl, settings.hl, settings.currency],
  )

  const runSearch = useCallback(async () => {
    setError(null)
    setCacheHint(null)

    if (searchSource === 'api' && !settings.mockMode && !settings.apiKey.trim()) {
      setError('Add your SerpApi key in Settings or enable mock mode.')
      return
    }
    if (!origins.length || !destinations.length) {
      setError('Select at least one origin and one destination airport.')
      return
    }

    setHasSearched(true)
    setLoading(true)
    setAirlineExcludedCodes(new Set())
    setMapHubFilter(new Set())
    setMapRouteFilter(null)
    setMapSoloFocus(null)
    setSerpCapture({ outbound: null, return: null })
    setAircraftSelectedCodes([])
    setOutPrice({ ...EMPTY_PRICE })
    setRetPrice({ ...EMPTY_PRICE })
    setOutTimeRange({ ...EMPTY_TIME_RANGE })
    setRetTimeRange({ ...EMPTY_TIME_RANGE })

    const { centerDate: outCenter, flexDays: outFlex } = dateRangeToCenterFlex(outboundDate, outboundEnd)
    const { centerDate: retCenter, flexDays: retFlex } = dateRangeToCenterFlex(returnDate, returnEnd)

    const baseInput: Omit<SearchFlightInput, 'centerDate' | 'maxSegments'> = {
      origins,
      destinations,
      flexDays: outFlex,
      perDateLimit: MERGE_PER_DATE_LIMIT,
      mockMode: settings.mockMode,
      apiKey: settings.apiKey,
      maxTotalHours: emptyToNull(outHours.maxTotal),
      showHidden: settings.showHidden,
      deepSearch: settings.deepSearch,
      gl: settings.gl,
      hl: settings.hl,
      currency: settings.currency,
    }

    let serpDebugOutbound: SerpSearchDebugBundle | null = null
    let serpDebugReturn: SerpSearchDebugBundle | null = null

    try {
      const outParts = {
        direction: 'outbound' as const,
        origins,
        destinations,
        centerDate: outCenter,
        flexDays: outFlex,
        maxSegments: API_MAX_SEGMENTS,
        mockMode: settings.mockMode,
        ...hashExtras,
      }

      let out: NormalizedItinerary[] | null = null

      if (searchSource === 'db') {
        if (settings.mockMode) {
          setRawOut([])
          setRawReturn([])
          setError('Mock mode has no SQLite cache. Use Search API or disable mock mode in Settings.')
          return
        }
        out = await loadCached(outParts)
        if (!out?.length) {
          // Fallback: try per-date cache rows (written by Price Window searches)
          const window = dateWindow(outParts.centerDate, outParts.flexDays)
          const perDateFallback: NormalizedItinerary[][] = []
          for (const date of window) {
            const cached = await loadCached({ ...outParts, centerDate: date, flexDays: 0 })
            if (cached?.length) perDateFallback.push(cached)
          }
          if (perDateFallback.length > 0) {
            out = mergePerDateUnique(perDateFallback, MERGE_PER_DATE_LIMIT, sortOut)
            setCacheHint('Outbound loaded from price window per-date cache.')
          }
        }
        if (!out?.length) {
          setRawOut([])
          setRawReturn([])
          setError(
            'No cached snapshot for this search. Run Search API once with the same origins, destinations, dates, flex ± days, max segments, and Settings (gl / hl / currency / deep search / show hidden).',
          )
          return
        }
      } else {
        const outRes = await searchDirection(
          { ...baseInput, centerDate: outCenter, maxSegments: API_MAX_SEGMENTS },
          'outbound',
          {
            primaryDestination,
            multipleDestinations,
            roundTrip: tripType === 'round',
            excludedAirports: PIPELINE_EXCLUDED_NONE,
            sort: sortOut,
          },
        )
        out = outRes.itineraries
        serpDebugOutbound = outRes.serpDebug
        setSerpCapture({ outbound: outRes.serpDebug, return: null })
        if (!settings.mockMode) {
          // Persist merged discovery row (discovery DB-load key)
          void persistSearch(outParts, outRes.itineraries, tzByIata)
          // Also persist per-date rows so Price Window DB-load can read them
          for (const { date, itineraries } of outRes.perDate) {
            void persistSearch({ ...outParts, centerDate: date, flexDays: 0 }, itineraries, tzByIata)
          }
        }
      }
      setRawOut(out)

      let returnList: NormalizedItinerary[] = []

      if (tripType !== 'round') {
        setRawReturn([])
      } else {
        const retParts = {
          direction: 'return' as const,
          origins: destinations,
          destinations: origins,
          centerDate: retCenter,
          flexDays: retFlex,
          maxSegments: API_MAX_SEGMENTS,
          mockMode: settings.mockMode,
          ...hashExtras,
        }
        let ret: NormalizedItinerary[] | null = null
        if (searchSource === 'db') {
          ret = await loadCached(retParts)
          if (!ret?.length) {
            // Fallback: try per-date cache rows (written by Price Window searches)
            const window = dateWindow(retParts.centerDate, retParts.flexDays)
            const perDateFallback: NormalizedItinerary[][] = []
            for (const date of window) {
              const cached = await loadCached({ ...retParts, centerDate: date, flexDays: 0 })
              if (cached?.length) perDateFallback.push(cached)
            }
            if (perDateFallback.length > 0) {
              ret = mergePerDateUnique(perDateFallback, MERGE_PER_DATE_LIMIT, sortReturn)
              setCacheHint((prev) =>
                prev ? `${prev} Return loaded from price window per-date cache.` : 'Return loaded from price window per-date cache.',
              )
            }
          }
          if (!ret?.length) {
            setError(
              'No cached return snapshot for this search. Run Search API once for the same return route and dates.',
            )
            setRawReturn([])
            return
          }
        } else {
          const retRes = await searchDirection(
            {
              ...baseInput,
              origins: destinations,
              destinations: origins,
              centerDate: retCenter,
              flexDays: retFlex,
              maxSegments: API_MAX_SEGMENTS,
              maxTotalHours: emptyToNull(effRetHours.maxTotal),
            },
            'return',
            {
              primaryDestination,
              multipleDestinations,
              roundTrip: true,
              excludedAirports: PIPELINE_EXCLUDED_NONE,
              sort: sortReturn,
            },
          )
          ret = retRes.itineraries
          serpDebugReturn = retRes.serpDebug
          setSerpCapture((prev) => ({ ...prev, return: retRes.serpDebug }))
          if (!settings.mockMode) {
            // Persist merged discovery row (discovery DB-load key)
            void persistSearch(retParts, retRes.itineraries, tzByIata)
            // Also persist per-date rows so Price Window DB-load can read them
            for (const { date, itineraries } of retRes.perDate) {
              void persistSearch({ ...retParts, centerDate: date, flexDays: 0 }, itineraries, tzByIata)
            }
          }
        }
        returnList = ret ?? []
        setRawReturn(returnList)
      }

      const outCount = out?.length ?? 0
      const retCount = returnList.length
      if (outCount > 0 || retCount > 0) {
        const snapshot: SearchHistorySnapshotV1 = {
          v: 1,
          origins: [...origins],
          destinations: [...destinations],
          tripType,
          searchGoal: 'discovery',
          outboundDate,
          outboundEnd,
          returnDate,
          returnEnd,
          searchSource,
          mockMode: settings.mockMode,
          deepSearch: settings.deepSearch,
          showHidden: settings.showHidden,
          gl: settings.gl,
          hl: settings.hl,
          currency: settings.currency,
        }
        void recordSearchHistory(snapshot, outCount, retCount)
      }

      if (searchSource === 'api' && serpDebugOutbound) {
        const payload = buildSerpDownloadPayload({ outbound: serpDebugOutbound, return: serpDebugReturn })
        void saveSerpApiSearchCapture(
          {
            mockMode: settings.mockMode,
            origins,
            destinations,
            outboundDate,
            outboundEnd,
            returnDate: tripType === 'round' ? returnDate : null,
            returnEnd: tripType === 'round' ? returnEnd : null,
            deepSearch: settings.deepSearch,
            showHidden: settings.showHidden,
            gl: settings.gl,
            hl: settings.hl,
            currency: settings.currency,
          },
          payload,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
      if (!settings.mockMode) setSearchRefreshKey((k) => k + 1)
    }
  }, [
    settings,
    origins,
    destinations,
    tripType,
    outboundDate,
    outboundEnd,
    returnDate,
    returnEnd,
    primaryDestination,
    multipleDestinations,
    sortOut,
    sortReturn,
    searchSource,
    loadCached,
    persistSearch,
    saveSerpApiSearchCapture,
    tzByIata,
    hashExtras,
    outHours,
    effRetHours,
    recordSearchHistory,
  ])

  const runPriceWindowSearch = useCallback(async () => {
    setError(null)
    setCacheHint(null)

    if (searchSource === 'api' && !settings.mockMode && !settings.apiKey.trim()) {
      setError('Add your SerpApi key in Settings or enable mock mode.')
      return
    }
    if (!origins.length || !destinations.length) {
      setError('Select at least one origin and one destination airport.')
      return
    }
    if (outboundDate > outboundEnd) {
      setError('Outbound window: start date must be before end date.')
      return
    }
    if (tripType === 'round' && returnDate > returnEnd) {
      setError('Return window: start date must be before end date.')
      return
    }
    if (searchSource === 'db' && settings.mockMode) {
      setError('Mock mode has no SQLite cache. Use Search API or disable mock mode in Settings.')
      return
    }

    setHasSearched(true)
    setLoading(true)
    setSerpCapture({ outbound: null, return: null })
    setPwOutResult(null)
    setPwRetResult(null)
    setPwOutboundSel(null)
    setPwReturnSel(null)
    setPwRawOutPerDate([])
    setPwRawRetPerDate([])
    setRawOut([])
    setRawReturn([])

    /** Build HashParts for a single price-window date (flexDays=0). */
    function pwHashParts(dir: 'outbound' | 'return', origs: string[], dests: string[], date: string) {
      return {
        direction: dir,
        origins: origs,
        destinations: dests,
        centerDate: date,
        flexDays: 0,
        maxSegments: API_MAX_SEGMENTS,
        mockMode: settings.mockMode,
        ...hashExtras,
      } as const
    }

    try {
      // ── Database mode: load each date from SQLite cache ──────────────────
      if (searchSource === 'db') {
        const outDates = pwDateRange(outboundDate, outboundEnd)
        const outPerDate: PriceWindowPerDateEntry[] = []
        for (const date of outDates) {
          const cached = await loadCached(pwHashParts('outbound', origins, destinations, date))
          outPerDate.push({ date, itineraries: cached ?? [] })
        }
        if (!outPerDate.some((d) => d.itineraries.length > 0)) {
          setError('No cached price window data for outbound. Run Search API once with the same route and date window.')
          return
        }
        setPwRawOutPerDate(outPerDate)
        setPwOutResult(buildPriceWindowResult(outPerDate))
        setRawOut(outPerDate.flatMap((d) => d.itineraries))
        setCacheHint('Price window loaded from cache.')

        if (tripType === 'round') {
          const retDates = pwDateRange(returnDate, returnEnd)
          const retPerDate: PriceWindowPerDateEntry[] = []
          for (const date of retDates) {
            const cached = await loadCached(pwHashParts('return', destinations, origins, date))
            retPerDate.push({ date, itineraries: cached ?? [] })
          }
          if (!retPerDate.some((d) => d.itineraries.length > 0)) {
            setError('No cached price window data for return leg.')
            return
          }
          setPwRawRetPerDate(retPerDate)
          setPwRetResult(buildPriceWindowResult(retPerDate))
          setRawReturn(retPerDate.flatMap((d) => d.itineraries))
        }
        return
      }

      // ── API mode ──────────────────────────────────────────────────────────
      const baseInput: PriceWindowSearchInput = {
        origins,
        destinations,
        startDate: outboundDate,
        endDate: outboundEnd,
        maxSegments: API_MAX_SEGMENTS,
        mockMode: settings.mockMode,
        apiKey: settings.apiKey,
        maxTotalHours: emptyToNull(outHours.maxTotal),
        showHidden: settings.showHidden,
        deepSearch: settings.deepSearch,
        gl: settings.gl,
        hl: settings.hl,
        currency: settings.currency,
      }

      const outRes = await searchPriceWindow(baseInput, 'outbound', {
        primaryDestination,
        multipleDestinations,
        roundTrip: tripType === 'round',
        excludedAirports: PIPELINE_EXCLUDED_NONE,
      })
      setPwRawOutPerDate(outRes.perDate)
      setPwOutResult(buildPriceWindowResult(outRes.perDate))
      setRawOut(outRes.perDate.flatMap((d) => d.itineraries))
      setSerpCapture({ outbound: outRes.serpDebug, return: null })

      if (!settings.mockMode) {
        for (const { date, itineraries } of outRes.perDate) {
          void persistSearch(pwHashParts('outbound', origins, destinations, date), itineraries, tzByIata)
        }
      }

      let pwRetCount = 0
      if (tripType === 'round') {
        const retInput: PriceWindowSearchInput = {
          origins: destinations,
          destinations: origins,
          startDate: returnDate,
          endDate: returnEnd,
          maxSegments: API_MAX_SEGMENTS,
          mockMode: settings.mockMode,
          apiKey: settings.apiKey,
          maxTotalHours: emptyToNull(effRetHours.maxTotal),
          showHidden: settings.showHidden,
          deepSearch: settings.deepSearch,
          gl: settings.gl,
          hl: settings.hl,
          currency: settings.currency,
        }
        const retRes = await searchPriceWindow(retInput, 'return', {
          primaryDestination,
          multipleDestinations,
          roundTrip: true,
          excludedAirports: PIPELINE_EXCLUDED_NONE,
        })
        setPwRawRetPerDate(retRes.perDate)
        setPwRetResult(buildPriceWindowResult(retRes.perDate))
        setRawReturn(retRes.perDate.flatMap((d) => d.itineraries))
        setSerpCapture((prev) => ({ ...prev, return: retRes.serpDebug }))
        pwRetCount = retRes.perDate.reduce((s, d) => s + d.itineraries.length, 0)

        if (!settings.mockMode) {
          for (const { date, itineraries } of retRes.perDate) {
            void persistSearch(pwHashParts('return', destinations, origins, date), itineraries, tzByIata)
          }
        }
      }

      const pwOutCount = outRes.perDate.reduce((s, d) => s + d.itineraries.length, 0)
      if (pwOutCount > 0 || pwRetCount > 0) {
        const snapshot: SearchHistorySnapshotV1 = {
          v: 1,
          origins: [...origins],
          destinations: [...destinations],
          tripType,
          searchGoal: 'priceWindow',
          outboundDate,
          outboundEnd,
          returnDate,
          returnEnd,
          searchSource,
          mockMode: settings.mockMode,
          deepSearch: settings.deepSearch,
          showHidden: settings.showHidden,
          gl: settings.gl,
          hl: settings.hl,
          currency: settings.currency,
        }
        void recordSearchHistory(snapshot, pwOutCount, pwRetCount)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
      if (!settings.mockMode) setSearchRefreshKey((k) => k + 1)
    }
  }, [
    settings,
    origins,
    destinations,
    tripType,
    outboundDate,
    outboundEnd,
    returnDate,
    returnEnd,
    primaryDestination,
    multipleDestinations,
    outHours,
    effRetHours,
    searchSource,
    persistSearch,
    loadCached,
    tzByIata,
    hashExtras,
    recordSearchHistory,
  ])

  const applySearchHistory = useCallback(
    async (row: SearchHistoryRow) => {
      const s = row.snapshot
      setOrigins(s.origins)
      setDestinations(s.destinations)
      setTripType(s.tripType)
      const goal = s.searchGoal ?? 'discovery'
      setSearchGoal(goal)
      // For old price-window history entries that stored separate pw* fields,
      // migrate them into the shared outbound/return date fields.
      const outStart = goal === 'priceWindow' && s.pwOutStart ? s.pwOutStart : s.outboundDate
      const outEnd = goal === 'priceWindow' && s.pwOutEnd ? s.pwOutEnd : (s.outboundEnd ?? addDaysIso(s.outboundDate, s.flexDays ?? 0))
      const retStart = goal === 'priceWindow' && s.pwRetStart ? s.pwRetStart : s.returnDate
      const retEnd = goal === 'priceWindow' && s.pwRetEnd ? s.pwRetEnd : (s.returnEnd ?? addDaysIso(s.returnDate, s.flexDays ?? 0))
      setOutboundDate(outStart)
      setOutboundEnd(outEnd)
      setReturnDate(retStart)
      setReturnEnd(retEnd)
      setSearchSource(s.searchSource)
      update({
        mockMode: s.mockMode,
        deepSearch: s.deepSearch,
        showHidden: s.showHidden,
        gl: s.gl,
        hl: s.hl,
        currency: s.currency,
      })
      setAircraftSelectedCodes([])
      setAircraftMatchMode('any')
      setOutPrice({ ...EMPTY_PRICE })
      setRetPrice({ ...EMPTY_PRICE })
      setOutTimeRange({ ...EMPTY_TIME_RANGE })
      setRetTimeRange({ ...EMPTY_TIME_RANGE })
      setAirlineExcludedCodes(new Set())
      setMapHubFilter(new Set())
      setMapRouteFilter(null)
      setMapSoloFocus(null)
      setPwOutResult(null)
      setPwRetResult(null)
      setPwOutboundSel(null)
      setPwReturnSel(null)
      setPwRawOutPerDate([])
      setPwRawRetPerDate([])
      setError(null)
      setCacheHint(null)
      setSerpCapture({ outbound: null, return: null })

      if (goal === 'priceWindow') {
        setRawOut([])
        setRawReturn([])
        setHasSearched(false)
        setCacheHint('Price window search loaded. Click Search to run it again.')
        return
      }

      setHasSearched(true)

      const sOutEnd = s.outboundEnd ?? addDaysIso(s.outboundDate, s.flexDays ?? 0)
      const sRetEnd = s.returnEnd ?? addDaysIso(s.returnDate, s.flexDays ?? 0)
      const { centerDate: sOutCenter, flexDays: sOutFlex } = dateRangeToCenterFlex(s.outboundDate, sOutEnd)
      const { centerDate: sRetCenter, flexDays: sRetFlex } = dateRangeToCenterFlex(s.returnDate, sRetEnd)
      const hashRow = {
        deepSearch: s.deepSearch,
        showHidden: s.showHidden,
        gl: s.gl,
        hl: s.hl,
        currency: s.currency,
      }
      const outParts = {
        direction: 'outbound' as const,
        origins: s.origins,
        destinations: s.destinations,
        centerDate: sOutCenter,
        flexDays: sOutFlex,
        maxSegments: API_MAX_SEGMENTS,
        mockMode: s.mockMode,
        ...hashRow,
      }

      if (s.searchSource === 'db' && s.mockMode) {
        setError('Mock mode has no SQLite cache. Disable mock mode in Settings or choose Search API.')
        setRawOut([])
        setRawReturn([])
        return
      }

      const loadedOut = await loadCached(outParts)
      if (!loadedOut?.length) {
        setError(
          'No cached snapshot for this history entry. Run Search API once with the same route, dates, flex, and Settings.',
        )
        setRawOut([])
        setRawReturn([])
        return
      }
      setRawOut(loadedOut)
      setCacheHint('Restored from search history (SQLite cache).')

      if (s.tripType !== 'round') {
        setRawReturn([])
        return
      }
      const retParts = {
        direction: 'return' as const,
        origins: s.destinations,
        destinations: s.origins,
        centerDate: sRetCenter,
        flexDays: sRetFlex,
        maxSegments: API_MAX_SEGMENTS,
        mockMode: s.mockMode,
        ...hashRow,
      }
      const loadedRet = await loadCached(retParts)
      if (!loadedRet?.length) {
        setError('Return leg not in cache for this history entry. Run a full round-trip Search API search again.')
        setRawReturn([])
        return
      }
      setRawReturn(loadedRet)
    },
    [loadCached, update],
  )

  const applySavedSearchPayload = useCallback((p: SavedSearchPayloadV1) => {
    if (p.v !== 1) return
    setOrigins([...p.origins])
    setDestinations([...p.destinations])
    setTripType(p.tripType)
    setOutboundDate(p.outboundDate)
    setOutboundEnd(p.outboundEnd ?? addDaysIso(p.outboundDate, p.flexDays ?? 0))
    setReturnDate(p.returnDate)
    setReturnEnd(p.returnEnd ?? addDaysIso(p.returnDate, p.flexDays ?? 0))
    setReturnCustomFilters(p.returnCustomFilters)
    setOutHours({ ...p.outHours })
    setRetHours({ ...p.retHours })
    setOutPrice({ ...p.outPrice })
    setRetPrice({ ...p.retPrice })
    setOutTimeRange({ ...p.outTimeRange })
    setRetTimeRange({ ...p.retTimeRange })
    setOutLegDurationMatch(p.outLegDurationMatch)
    setRetLegDurationMatch(p.retLegDurationMatch)
    setOutStopsMin(p.outStopsMin)
    setOutStopsMax(p.outStopsMax)
    setRetStopsMin(p.retStopsMin)
    setRetStopsMax(p.retStopsMax)
    setLayoverRegionOn(() => {
      const o = {} as Record<RegionId, boolean>
      for (const k of REGION_IDS_IN_UI_ORDER) {
        o[k] = p.layoverRegionOn[k] ?? true
      }
      return o
    })
    setLayoverAirportOff(new Set(p.layoverAirportOff.map((c) => c.trim().toUpperCase())))
    setLayoverGeoFilterActive(p.layoverGeoFilterActive)
    setExcludeTechnical(p.excludeTechnical)
    setShowOpenJaw(p.showOpenJaw)
    setSortOut(p.sortOut)
    setSortReturn(p.sortReturn)
    setSearchSource(p.searchSource)
    setTimeBucketsOut(new Set(p.timeBucketsOut))
    setTimeBucketsRet(new Set(p.timeBucketsRet))
    setDisplayTimezone(p.displayTimezone)
    setUniqueRoutesOnly(p.uniqueRoutesOnly)
    setAircraftSelectedCodes([...p.aircraftSelectedCodes].sort((a, b) => a.localeCompare(b)))
    setAircraftMatchMode(p.aircraftMatchMode)
    setAirlineExcludedCodes(new Set(p.airlineExcludedCodes.map((c) => c.trim().toUpperCase())))
    update({
      mockMode: p.settingsSearch.mockMode,
      gl: p.settingsSearch.gl,
      hl: p.settingsSearch.hl,
      currency: p.settingsSearch.currency,
      deepSearch: p.settingsSearch.deepSearch,
      showHidden: p.settingsSearch.showHidden,
      layoverLongMinHours: p.settingsSearch.layoverLongMinHours,
      layoverShortMaxHours: p.settingsSearch.layoverShortMaxHours,
    })
    setMapHubFilter(new Set())
    setMapRouteFilter(null)
    setMapSoloFocus(null)
    setRawOut([])
    setRawReturn([])
    setHasSearched(false)
    setError(null)
    setSerpCapture({ outbound: null, return: null })
  }, [update])

  function buildCurrentSavedSearchPayload(): SavedSearchPayloadV1 {
    return {
      v: 1,
      origins: [...origins],
      destinations: [...destinations],
      tripType,
      outboundDate,
      outboundEnd,
      returnDate,
      returnEnd,
      returnCustomFilters,
      outHours: { ...outHours },
      retHours: { ...retHours },
      outPrice: { ...outPrice },
      retPrice: { ...retPrice },
      outTimeRange: { ...outTimeRange },
      retTimeRange: { ...retTimeRange },
      outLegDurationMatch,
      retLegDurationMatch,
      outStopsMin,
      outStopsMax,
      retStopsMin,
      retStopsMax,
      layoverRegionOn: { ...layoverRegionOn },
      layoverAirportOff: [...layoverAirportOff].sort(),
      layoverGeoFilterActive,
      excludeTechnical,
      showOpenJaw,
      sortOut,
      sortReturn,
      searchSource,
      timeBucketsOut: [...timeBucketsOut],
      timeBucketsRet: [...timeBucketsRet],
      displayTimezone,
      uniqueRoutesOnly,
      aircraftSelectedCodes: [...aircraftSelectedCodes],
      aircraftMatchMode,
      airlineExcludedCodes: [...airlineExcludedCodes].sort((a, b) => a.localeCompare(b)),
      settingsSearch: {
        mockMode: settings.mockMode,
        gl: settings.gl,
        hl: settings.hl,
        currency: settings.currency,
        deepSearch: settings.deepSearch,
        showHidden: settings.showHidden,
        layoverLongMinHours: settings.layoverLongMinHours,
        layoverShortMaxHours: settings.layoverShortMaxHours,
      },
    }
  }

  const handleSaveSearch = () => {
    const payload = buildCurrentSavedSearchPayload()
    void addSavedSearch(savedSearchTitleFromPayload(payload), payload)
    setCacheHint('Search saved. Open the Saved searches tab to apply or delete it.')
  }

  const handleSaveAsDefault = () => {
    void saveDefaultSavedSearch(buildCurrentSavedSearchPayload())
    setCacheHint('Default search saved. It will load automatically when you open the app.')
  }

  useEffect(() => {
    if (!dbReady) return
    let cancelled = false
    void loadDefaultSavedSearchPayload().then((p) => {
      if (cancelled || !p || defaultSearchAppliedRef.current) return
      defaultSearchAppliedRef.current = true
      applySavedSearchPayload(p)
      setCacheHint('Loaded your default search form.')
    })
    return () => {
      cancelled = true
    }
  }, [dbReady, loadDefaultSavedSearchPayload, applySavedSearchPayload])

  const saveOutboundCard = useCallback(
    (it: NormalizedItinerary) => {
      const payload: SavedResultPayloadV1 = {
        v: 1,
        itinerary: it,
        gfOrigins: [...origins],
        gfDestinations: [...destinations],
        linkDate: outboundDate,
        returnDate: tripType === 'round' ? returnDate : null,
        tripType,
      }
      void saveSavedResult('outbound', itineraryScheduleKey(it), payload)
    },
    [origins, destinations, outboundDate, returnDate, tripType, saveSavedResult],
  )

  const saveReturnCard = useCallback(
    (it: NormalizedItinerary) => {
      const payload: SavedResultPayloadV1 = {
        v: 1,
        itinerary: it,
        gfOrigins: [...destinations],
        gfDestinations: [...origins],
        linkDate: returnDate,
        returnDate: null,
        tripType: 'round',
      }
      void saveSavedResult('return', itineraryScheduleKey(it), payload)
    },
    [origins, destinations, returnDate, saveSavedResult],
  )

  /** Save outbound (+ optional return) picked from the Price Window to Saved Results. */
  const savePriceWindowSelection = useCallback(
    (
      outIt: NormalizedItinerary,
      outDate: string,
      retIt: NormalizedItinerary | null,
      retDate: string | null,
    ) => {
      if (retIt && retDate) {
        // Round-trip: save both legs together as a single V2 row
        const payload: SavedResultPayloadV2 = {
          v: 2,
          outboundItinerary: outIt,
          returnItinerary: retIt,
          gfOrigins: [...origins],
          gfDestinations: [...destinations],
          outboundDate: outDate,
          returnDate: retDate,
        }
        const schedKey = `${itineraryScheduleKey(outIt)}+${itineraryScheduleKey(retIt)}`
        void saveSavedResult('roundtrip', schedKey, payload)
      } else {
        // One-way: save outbound leg only as V1
        const payload: SavedResultPayloadV1 = {
          v: 1,
          itinerary: outIt,
          gfOrigins: [...origins],
          gfDestinations: [...destinations],
          linkDate: outDate,
          returnDate: null,
          tripType: 'oneway',
        }
        void saveSavedResult('outbound', itineraryScheduleKey(outIt), payload)
      }
    },
    [origins, destinations, saveSavedResult],
  )

  const onToggleResultAirline = useCallback((code: string, allowed: boolean) => {
    const c = code.toUpperCase()
    setAirlineExcludedCodes((prev) => {
      const n = new Set(prev)
      if (allowed) n.delete(c)
      else n.add(c)
      return n
    })
  }, [])

  const onSetAllResultAirlines = useCallback(
    (allowed: boolean) => {
      setAirlineExcludedCodes((prev) => {
        const n = new Set(prev)
        for (const code of airlinesFromResults) {
          const c = code.toUpperCase()
          if (allowed) n.delete(c)
          else n.add(c)
        }
        return n
      })
    },
    [airlinesFromResults],
  )

  const onRegionSetAllAirlines = useCallback((_region: RegionId, codesInRegion: string[], allowed: boolean) => {
    setAirlineExcludedCodes((prev) => {
      const n = new Set(prev)
      for (const code of codesInRegion) {
        const c = code.toUpperCase()
        if (allowed) n.delete(c)
        else n.add(c)
      }
      return n
    })
  }, [])

  const onLayoverRegionEnabled = useCallback((id: RegionId, enabled: boolean) => {
    setLayoverGeoFilterActive(true)
    setLayoverRegionOn((prev) => ({ ...prev, [id]: enabled }))
  }, [])

  const onLayoverAirportOff = useCallback((iata: string, off: boolean) => {
    setLayoverGeoFilterActive(true)
    setLayoverAirportOff((prev) => {
      const n = new Set(prev)
      if (off) n.add(iata)
      else n.delete(iata)
      return n
    })
  }, [])

  const onLayoverSelectAll = useCallback(() => {
    setLayoverGeoFilterActive(true)
    setLayoverRegionOn((prev) => {
      const o = { ...prev }
      for (const k of REGION_IDS_IN_UI_ORDER) o[k] = true
      return o
    })
    setLayoverAirportOff(new Set())
  }, [])

  /** Turn off geographic layover filtering (same effect as Serp “no hub whitelist”). */
  const onAllowAllLayoverHubs = useCallback(() => {
    setLayoverGeoFilterActive(false)
  }, [])

  const onMapHubToggle = useCallback((code: string) => {
    const u = code.trim().toUpperCase()
    setMapHubFilter((prev) => {
      const n = new Set(prev)
      if (n.has(u)) n.delete(u)
      else n.add(u)
      return n
    })
  }, [])

  const onMapRouteSelect = useCallback((waypointKey: string | null) => {
    setMapSoloFocus(null)
    setMapRouteFilter(waypointKey ? new Set([waypointKey]) : null)
  }, [])

  useEffect(() => {
    if (!mapSoloFocus) return
    routeMapWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [mapSoloFocus])

  const toggleBucket = (which: 'out' | 'ret', b: TimeOfDayBucket) => {
    const setFn = which === 'out' ? setTimeBucketsOut : setTimeBucketsRet
    setFn((prev) => {
      const n = new Set(prev)
      if (n.has(b)) n.delete(b)
      else n.add(b)
      return n
    })
  }

  const setHour = (which: 'out' | 'ret', key: keyof HourFieldStrings, value: string) => {
    if (which === 'out') {
      setOutHours((h) => ({ ...h, [key]: value }))
    } else {
      setRetHours((h) => ({ ...h, [key]: value }))
    }
  }

  if (!airports || !dbReady) {
    return (
      <div className="app">
        <p className="muted">{dbError ?? 'Loading airport directory and local database…'}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="top hero-bar">
        <div className="hero-bar-title-nav">
          <h1>Flight itinerary discovery</h1>
          <nav className="main-tabs" aria-label="Primary navigation">
            <button
              type="button"
              className={`main-tab${mainTab === 'search' ? ' main-tab--active' : ''}`}
              onClick={() => setMainTab('search')}
            >
              Search
            </button>
            <button
              type="button"
              className={`main-tab${mainTab === 'savedSearches' ? ' main-tab--active' : ''}`}
              onClick={() => setMainTab('savedSearches')}
            >
              Saved searches
              {savedSearches.length > 0 ? (
                <span className="main-tab-count" aria-hidden>
                  {savedSearches.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`main-tab${mainTab === 'savedResults' ? ' main-tab--active' : ''}`}
              onClick={() => setMainTab('savedResults')}
            >
              Saved results
              {savedResults.length > 0 ? (
                <span className="main-tab-count" aria-hidden>
                  {savedResults.length}
                </span>
              ) : null}
            </button>
          </nav>
        </div>
        <SerpApiUsageChip
          apiKey={settings.apiKey}
          status={serpUsageState.status}
          data={serpUsageState.status === 'ok' ? serpUsageState.data : undefined}
          fetchedAt={serpUsageState.status === 'ok' ? serpUsageState.fetchedAt : undefined}
          errorMessage={serpUsageState.status === 'error' ? serpUsageState.message : undefined}
          onRefresh={() => void refreshSerpUsage()}
        />
        <button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      <main className="main-with-summary">
        {mainTab === 'search' ? (
          <>
        <SearchSummaryBar
          origins={origins}
          destinations={destinations}
          tripType={tripType}
          outboundDate={outboundDate}
          returnDate={returnDate}
          passengerSummary="1 adult · Economy"
          hasSearched={hasSearched}
          outboundStats={outboundInsightStats}
          currency={settings.currency}
          searchPanelOpen={searchPanelOpen}
          onToggleSearchPanel={() => setSearchPanelOpen((o) => !o)}
          history={searchHistory}
          onApplyHistory={(row) => void applySearchHistory(row)}
          loading={loading}
        />

        <div className={`layout${!searchPanelOpen ? ' layout--panel-hidden' : ''}`}>
          {!searchPanelOpen && (
            <button
              type="button"
              className="btn btn-secondary btn-tiny search-panel-show-btn"
              onClick={() => setSearchPanelOpen(true)}
              title="Show search panel"
            >
              ☰ Search
            </button>
          )}
          <div className={searchPanelOpen ? 'search-panel-animated' : 'search-panel-animated search-panel-collapsed'}>
        <section className="panel search-panel panel-compact">
          <div className="search-panel-header">
            <h2 className="h2">Search</h2>
            <button
              type="button"
              className="btn btn-ghost btn-tiny search-panel-hide-btn"
              onClick={() => setSearchPanelOpen(false)}
              title="Hide search panel"
            >
              ✕ Hide
            </button>
          </div>

          {/* ── Top action bar: always visible, no scrolling needed ── */}
          <div className="search-top-bar">
            <fieldset className="field-tight fieldset-inline search-top-bar-source">
              <legend className="label">Goal</legend>
              <label className="check check-inline">
                <input
                  type="radio"
                  name="searchGoal"
                  checked={searchGoal === 'discovery'}
                  onChange={() => setSearchGoal('discovery')}
                />
                Discovery
              </label>
              <label className="check check-inline">
                <input
                  type="radio"
                  name="searchGoal"
                  checked={searchGoal === 'priceWindow'}
                  onChange={() => setSearchGoal('priceWindow')}
                />
                Price window
              </label>
            </fieldset>
            <fieldset className="field-tight fieldset-inline search-top-bar-source">
              <legend className="label">Source</legend>
              <label className="check check-inline">
                <input
                  type="radio"
                  name="searchSrcTop"
                  checked={searchSource === 'api'}
                  onChange={() => setSearchSource('api')}
                />
                API
              </label>
              <label className="check check-inline">
                <input
                  type="radio"
                  name="searchSrcTop"
                  checked={searchSource === 'db'}
                  onChange={() => setSearchSource('db')}
                />
                Database
              </label>
            </fieldset>
            <button
              type="button"
              className="btn btn-primary btn-search"
              disabled={loading}
              onClick={() => searchGoal === 'priceWindow' ? void runPriceWindowSearch() : void runSearch()}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
            {settings.mockMode && <span className="muted tiny">Mock</span>}
            {cacheHint && <span className="muted tiny search-top-bar-hint">{cacheHint}</span>}
            {error && <span className="error-inline">{error}</span>}
          </div>

          {/* ── Config presets (filters + dates unified) ── */}
          <ConfigPresetsBar
            presets={configPresets.presets}
            currentConfig={currentConfigSnapshot}
            onApply={applyConfigPreset}
            onSave={configPresets.savePreset}
            onUpdate={configPresets.updatePreset}
            onRename={configPresets.renamePreset}
            onDelete={configPresets.deletePreset}
            onSetDefault={configPresets.setDefault}
            onClearDefault={configPresets.clearDefault}
          />

          <details className="search-section" open>
            <summary className="search-section-summary">Route and dates</summary>
            <div className="search-section-body">
              <div className="field-tight">
                <AirportMultiSelect
                  label="Origins"
                  airports={airports}
                  selected={origins}
                  onChange={setOrigins}
                  nearbyAnchorIatas={origins.length ? [origins[0]] : []}
                  excludeFromNearby={odIataExclude}
                />
              </div>
              <div className="field-tight">
                <AirportMultiSelect
                  label="Destinations"
                  airports={airports}
                  selected={destinations}
                  onChange={setDestinations}
                  nearbyAnchorIatas={destinations.length ? [destinations[0]] : []}
                  excludeFromNearby={odIataExclude}
                />
              </div>

              <div className="field-tight">
                <span className="label">Trip type</span>
                <div className="filter-chip-row" role="radiogroup" aria-label="Trip type">
                  <FilterChip
                    radio
                    selected={tripType === 'oneway'}
                    onClick={() => setTripType('oneway')}
                  >
                    One way
                  </FilterChip>
                  <FilterChip
                    radio
                    selected={tripType === 'round'}
                    onClick={() => setTripType('round')}
                  >
                    Round trip
                  </FilterChip>
                </div>
              </div>

              <div className="grid-2 tight-gap">
                <label className="field-tight">
                  <span className="label">Outbound from</span>
                  <input className="input" type="date" value={outboundDate} onChange={(e) => setOutboundDate(e.target.value)} />
                </label>
                <label className="field-tight">
                  <span className="label">Outbound to</span>
                  <input className="input" type="date" value={outboundEnd} onChange={(e) => setOutboundEnd(e.target.value)} />
                </label>
              </div>
              {tripType === 'round' && (
                <div className="grid-2 tight-gap">
                  <label className="field-tight">
                    <span className="label">Return from</span>
                    <input className="input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
                  </label>
                  <label className="field-tight">
                    <span className="label">Return to</span>
                    <input className="input" type="date" value={returnEnd} onChange={(e) => setReturnEnd(e.target.value)} />
                  </label>
                </div>
              )}

              {tripType === 'round' && (
                <label className="check check-inline field-tight">
                  <input
                    type="checkbox"
                    checked={returnCustomFilters}
                    onChange={(e) => setReturnCustomFilters(e.target.checked)}
                  />
                  Different filters for return
                </label>
              )}
            </div>
          </details>

          <details className="search-section" open>
            <SearchSectionSummary
              onReset={() => {
                setOutStopsMin('')
                setOutStopsMax('')
                setRetStopsMin('')
                setRetStopsMax('')
                setOutHours({ ...EMPTY_HOURS })
                setRetHours({ ...EMPTY_HOURS })
                setOutLegDurationMatch('all')
                setRetLegDurationMatch('all')
              }}
              resetLabel="Reset stops and durations"
            >
              Stops and durations
            </SearchSectionSummary>
            <div className="search-section-body">
              <div className="filter-section">
                <div className="filter-section-title">Outbound</div>
                <StopsFilterBlock
                  distributionSource={rawOut}
                  stopsMin={outStopsMin}
                  stopsMax={outStopsMax}
                  onStopsMin={setOutStopsMin}
                  onStopsMax={setOutStopsMax}
                />
                <div className="duration-hist-block">
                  <DurationHistogramFilters
                    noOuterBlock
                    distributionSource={rawOut}
                    hours={outHours}
                    onHour={(key, v) => setHour('out', key, v)}
                    legDurationMatch={outLegDurationMatch}
                    onLegDurationMatch={setOutLegDurationMatch}
                    legMatchRadioGroup="outbound-leg-duration"
                    hideLegMatchRadios
                    legMatchExtra={
                      <div className="field-tight filter-chip-field">
                        <span className="label">Leg duration</span>
                        <div className="filter-chip-row" role="radiogroup" aria-label="Apply leg min and max to">
                          <FilterChip
                            radio
                            selected={outLegDurationMatch === 'any'}
                            onClick={() => setOutLegDurationMatch('any')}
                            aria-label="At least one leg"
                          >
                            Any
                          </FilterChip>
                          <FilterChip
                            radio
                            selected={outLegDurationMatch === 'all'}
                            onClick={() => setOutLegDurationMatch('all')}
                            aria-label="Every leg"
                          >
                            Every
                          </FilterChip>
                        </div>
                      </div>
                    }
                  />
                </div>
              </div>

              {tripType === 'round' && returnCustomFilters && (
                <div className="filter-section filter-section-return">
                  <div className="filter-section-title">Return</div>
                  <StopsFilterBlock
                    distributionSource={rawReturn}
                    stopsMin={retStopsMin}
                    stopsMax={retStopsMax}
                    onStopsMin={setRetStopsMin}
                    onStopsMax={setRetStopsMax}
                  />
                  <div className="duration-hist-block">
                    <DurationHistogramFilters
                      noOuterBlock
                      distributionSource={rawReturn}
                      hours={retHours}
                      onHour={(key, v) => setHour('ret', key, v)}
                      legDurationMatch={retLegDurationMatch}
                      onLegDurationMatch={setRetLegDurationMatch}
                      legMatchRadioGroup="return-leg-duration"
                      hideLegMatchRadios
                      legMatchExtra={
                        <div className="field-tight filter-chip-field">
                          <span className="label">Leg duration</span>
                          <div className="filter-chip-row" role="radiogroup" aria-label="Apply leg min and max to (return)">
                            <FilterChip
                              radio
                              selected={retLegDurationMatch === 'any'}
                              onClick={() => setRetLegDurationMatch('any')}
                              aria-label="At least one leg"
                            >
                              Any
                            </FilterChip>
                            <FilterChip
                              radio
                              selected={retLegDurationMatch === 'all'}
                              onClick={() => setRetLegDurationMatch('all')}
                              aria-label="Every leg"
                            >
                              Every
                            </FilterChip>
                          </div>
                        </div>
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </details>

          <details className="search-section" open>
            <SearchSectionSummary
              onReset={() => {
                setOutPrice({ ...EMPTY_PRICE })
                setRetPrice({ ...EMPTY_PRICE })
              }}
              resetLabel="Reset price filters"
            >
              Price
            </SearchSectionSummary>
            <div className="search-section-body">
              <div className="filter-section">
                <div className="filter-section-title">Outbound</div>
                <div className="duration-hist-block">
                  <PriceHistogramFilter
                    distributionSource={rawOut}
                    minStr={outPrice.min}
                    maxStr={outPrice.max}
                    onMin={(v) => setOutPrice((p) => ({ ...p, min: v }))}
                    onMax={(v) => setOutPrice((p) => ({ ...p, max: v }))}
                    currencyCode={settings.currency}
                  />
                </div>
              </div>
              {tripType === 'round' && returnCustomFilters && (
                <div className="filter-section filter-section-return">
                  <div className="filter-section-title">Return</div>
                  <div className="duration-hist-block">
                    <PriceHistogramFilter
                      distributionSource={rawReturn}
                      minStr={retPrice.min}
                      maxStr={retPrice.max}
                      onMin={(v) => setRetPrice((p) => ({ ...p, min: v }))}
                      onMax={(v) => setRetPrice((p) => ({ ...p, max: v }))}
                      currencyCode={settings.currency}
                    />
                  </div>
                </div>
              )}
            </div>
          </details>

          <details className="search-section" open>
            <SearchSectionSummary
              onReset={() => {
                setTimeBucketsOut(new Set())
                setTimeBucketsRet(new Set())
                setOutTimeRange({ ...EMPTY_TIME_RANGE })
                setRetTimeRange({ ...EMPTY_TIME_RANGE })
                setDisplayTimezone('')
              }}
              resetLabel="Reset time and timezone filters"
            >
              Time and timezone
            </SearchSectionSummary>
            <div className="search-section-body">
              <div className="filter-section">
                <div className="filter-section-title">Outbound</div>
                <div className="filter-section-title sub">First departure (local)</div>
                <div className="filter-chip-row" role="group" aria-label="First departure time buckets">
                  {TIME_BUCKET_DEFS.map(({ id, label, hint }) => (
                    <FilterChip
                      key={id}
                      selected={timeBucketsOut.has(id)}
                      onClick={() => toggleBucket('out', id)}
                      title={hint}
                      aria-label={`${label}, ${hint}`}
                    >
                      {label}
                    </FilterChip>
                  ))}
                </div>
                <div className="duration-hist-block">
                  <TakeoffLandingHistogramFilters
                    distributionSource={rawOut}
                    tzByIata={tzByIata}
                    takeoffMin={outTimeRange.takeoffMin}
                    takeoffMax={outTimeRange.takeoffMax}
                    landingMin={outTimeRange.landingMin}
                    landingMax={outTimeRange.landingMax}
                    onTakeoffMin={(v) => setOutTimeRange((p) => ({ ...p, takeoffMin: v }))}
                    onTakeoffMax={(v) => setOutTimeRange((p) => ({ ...p, takeoffMax: v }))}
                    onLandingMin={(v) => setOutTimeRange((p) => ({ ...p, landingMin: v }))}
                    onLandingMax={(v) => setOutTimeRange((p) => ({ ...p, landingMax: v }))}
                  />
                </div>
              </div>

              {tripType === 'round' && returnCustomFilters && (
                <div className="filter-section filter-section-return">
                  <div className="filter-section-title">Return</div>
                  <div className="filter-section-title sub">First departure (return, local)</div>
                  <div className="filter-chip-row" role="group" aria-label="First departure time buckets (return)">
                    {TIME_BUCKET_DEFS.map(({ id, label, hint }) => (
                      <FilterChip
                        key={id}
                        selected={timeBucketsRet.has(id)}
                        onClick={() => toggleBucket('ret', id)}
                        title={hint}
                        aria-label={`${label}, ${hint}`}
                      >
                        {label}
                      </FilterChip>
                    ))}
                  </div>
                  <div className="duration-hist-block">
                    <TakeoffLandingHistogramFilters
                      distributionSource={rawReturn}
                      tzByIata={tzByIata}
                      takeoffMin={retTimeRange.takeoffMin}
                      takeoffMax={retTimeRange.takeoffMax}
                      landingMin={retTimeRange.landingMin}
                      landingMax={retTimeRange.landingMax}
                      onTakeoffMin={(v) => setRetTimeRange((p) => ({ ...p, takeoffMin: v }))}
                      onTakeoffMax={(v) => setRetTimeRange((p) => ({ ...p, takeoffMax: v }))}
                      onLandingMin={(v) => setRetTimeRange((p) => ({ ...p, landingMin: v }))}
                      onLandingMax={(v) => setRetTimeRange((p) => ({ ...p, landingMax: v }))}
                    />
                  </div>
                </div>
              )}

              <label className="field-tight">
                <span className="label">Display timezone</span>
                <select
                  className="select"
                  value={DISPLAY_TZ_OPTIONS.some((o) => o.value === displayTimezone) ? displayTimezone : ''}
                  onChange={(e) => setDisplayTimezone(e.target.value)}
                >
                  {DISPLAY_TZ_OPTIONS.map((o) => (
                    <option key={o.value || 'default'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>

          <details className="search-section" open>
            <SearchSectionSummary
              onReset={() => {
                setAirlineExcludedCodes(new Set())
                setAircraftSelectedCodes([])
                setAircraftMatchMode('any')
                setLayoverGeoFilterActive(false)
                setLayoverRegionOn(() => {
                  const o = {} as Record<RegionId, boolean>
                  for (const k of REGION_IDS_IN_UI_ORDER) o[k] = true
                  return o
                })
                setLayoverAirportOff(new Set())
                setExcludeTechnical(false)
                setShowOpenJaw(true)
                setUniqueRoutesOnly(true)
              }}
              resetLabel="Reset airlines, aircraft, and layover filters"
            >
              Airlines and regions
            </SearchSectionSummary>
            <div className="search-section-body">
          <AirlineFilterPanel
            hasSearched={hasSearched}
            airlinesInResults={airlinesFromResults}
            excludedCodes={airlineExcludedCodes}
            onToggleAirline={onToggleResultAirline}
            onSetAllInResults={onSetAllResultAirlines}
            onRegionSetAll={onRegionSetAllAirlines}
            meta={airlinesMetaJson as AirlinesMeta}
            nameFallback={airlinesDict}
            itineraryCountsOut={airlineItinCountsOut}
            itineraryCountsRet={tripType === 'round' ? airlineItinCountsRet : undefined}
            tripType={tripType}
            persistedAirlineUiRegions={airlineUiRegions}
          />

          <AircraftFilterBlock
            options={aircraftOptionsWithCounts}
            selected={aircraftSelectedCodes}
            onToggle={(code, on) => {
              setAircraftSelectedCodes((prev) => {
                const n = new Set(prev)
                if (on) n.add(code)
                else n.delete(code)
                return [...n].sort((a, b) => a.localeCompare(b))
              })
            }}
            onBulkToggle={(codes, on) => {
              setAircraftSelectedCodes((prev) => {
                const n = new Set(prev)
                for (const c of codes) {
                  if (on) n.add(c)
                  else n.delete(c)
                }
                return [...n].sort((a, b) => a.localeCompare(b))
              })
            }}
            matchMode={aircraftMatchMode}
            onMatchMode={setAircraftMatchMode}
            manufacturerPoolCounts={aircraftManufacturerPoolCounts}
            onSelectAllInPool={() =>
              setAircraftSelectedCodes(
                [...new Set(aircraftOptionsWithCounts.map((o) => o.aircraft))].sort((a, b) =>
                  a.localeCompare(b),
                ),
              )
            }
            onClearAircraftSelection={() => setAircraftSelectedCodes([])}
          />

          <LayoverRegionsPanel
            hasSearched={hasSearched}
            rawItineraries={rawOut}
            airportsByIata={airportsByIata}
            regionCountries={regionCountriesForLayover}
            airportUiRegions={airportUiRegions}
            regionEnabled={layoverRegionOn}
            onRegionEnabled={onLayoverRegionEnabled}
            airportOff={layoverAirportOff}
            onAirportOff={onLayoverAirportOff}
            onSelectAll={onLayoverSelectAll}
            onAllowAllHubs={onAllowAllLayoverHubs}
          />

          <div className="sidebar-filter-misc-options">
            <label className="check check-inline">
              <input type="checkbox" checked={excludeTechnical} onChange={(e) => setExcludeTechnical(e.target.checked)} />
              No technical stops
            </label>
            {tripType === 'round' ? (
              <label className="check check-inline">
                <input type="checkbox" checked={showOpenJaw} onChange={(e) => setShowOpenJaw(e.target.checked)} />
                Show open-jaw
              </label>
            ) : null}
            <label className="check check-inline field-tight">
              <input
                type="checkbox"
                checked={uniqueRoutesOnly}
                onChange={(e) => setUniqueRoutesOnly(e.target.checked)}
              />
              One row per airport route
            </label>
          </div>
            </div>
          </details>

          {(serpCapture.outbound || serpCapture.return) && (
            <div className="row2 serp-capture-actions">
              <button
                type="button"
                className="btn btn-secondary btn-tiny"
                onClick={() => {
                  const payload = buildSerpDownloadPayload({
                    outbound: serpCapture.outbound,
                    return: serpCapture.return,
                  })
                  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
                  downloadJson(`serpapi-capture-${stamp}.json`, payload)
                }}
              >
                Download SerpApi capture
              </button>
            </div>
          )}
        </section>
          <div className="search-panel-save-actions">
            <button type="button" className="btn btn-secondary btn-tiny" onClick={handleSaveSearch}>
              Save search
            </button>
            <button type="button" className="btn btn-ghost btn-tiny" onClick={handleSaveAsDefault}>
              Save as default
            </button>
          </div>
          </div>

        <ErrorBoundary inline label="Results render error">
        <div className="results-stack">
          {searchGoal === 'priceWindow' && (pwOutResultFiltered || pwRetResultFiltered) ? (
            <div className="pw-panels-stack">
              {/* Total round-trip panel — shows combined prices; clicking drives the Outbound+Return panels */}
              {tripType === 'round' && pwOutResultFiltered && pwRetResultFiltered && (
                <PriceWindowPanel
                  result={pwOutResultFiltered}
                  currency={settings.currency}
                  title="Total round-trip by date"
                  namesByIata={namesByIata}
                  returnResult={pwRetResultFiltered}
                  onRouteSelect={setPwOutboundSel}
                  controlledSelection={pwOutboundSel}
                  selectionOnly={true}
                  selectedReturnIt={pwReturnSelResolved?.it ?? null}
                  selectedReturnDate={pwReturnSelResolved?.date}
                  maxPrice={filterOut.maxPrice}
                  onSave={savePriceWindowSelection}
                  tzByIata={tzByIata}
                  displayTimezone={displayTimezone}
                  airlineDirectory={airlinesDict}
                  airlinesMeta={airlinesMetaJson as AirlinesMeta}
                  layoverLongMinHours={settings.layoverLongMinHours}
                  layoverShortMaxHours={settings.layoverShortMaxHours}
                />
              )}
              {/* Outbound panel — shows itinerary picker for the currently selected outbound cell */}
              {pwOutResultFiltered && (
                <PriceWindowPanel
                  result={pwOutResultFiltered}
                  currency={settings.currency}
                  title="Outbound by date"
                  namesByIata={namesByIata}
                  returnResult={null}
                  onRouteSelect={setPwOutboundSel}
                  controlledSelection={pwOutboundSel}
                  selectedReturnIt={pwReturnSelResolved?.it ?? null}
                  selectedReturnDate={pwReturnSelResolved?.date}
                  maxPrice={filterOut.maxPrice}
                  onSave={savePriceWindowSelection}
                />
              )}
              {/* Return panel — shows return prices filtered by selected outbound route */}
              {tripType === 'round' && pwRetResultFiltered && (
                <PriceWindowPanel
                  result={pwRetResultFiltered}
                  currency={settings.currency}
                  title="Return by date"
                  namesByIata={namesByIata}
                  filterToRouteKey={pwOutboundSel ? reverseRouteKey(pwOutboundSel.routeKey) : null}
                  onRouteSelect={setPwReturnSel}
                  controlledSelection={pwReturnSel}
                  maxPrice={filterRet.maxPrice}
                />
              )}
            </div>
          ) : searchGoal === 'discovery' && showRouteMap ? (
            <ResultsRouteMap
              items={routeMapItems}
              itemsReturn={routeMapItemsReturn}
              coordsByIata={coordsByIata}
              airports={airports}
              origins={origins}
              destinations={destinations}
              hubFilter={mapHubFilter}
              routeFilter={mapRouteFilter}
              onHubToggle={onMapHubToggle}
              onRouteSelect={onMapRouteSelect}
              soloFocus={mapSoloFocus}
              onSoloFocusClear={() => setMapSoloFocus(null)}
              wrapRef={routeMapWrapRef}
            />
          ) : null}
          {searchGoal === 'discovery' && (
            <>
              <ResultsList
                title="Outbound"
                items={displayOut}
                sort={sortOut}
                onSortChange={setSortOut}
                gfOrigins={origins}
                gfDestinations={destinations}
                linkDate={outboundDate}
                returnDate={tripType === 'round' ? returnDate : null}
                tripType={tripType}
                tzByIata={tzByIata}
                displayTimezone={displayTimezone}
                airlineDirectory={airlinesDict}
                airlinesMeta={airlinesMetaJson as AirlinesMeta}
                namesByIata={namesByIata}
                layoverLongMinHours={settings.layoverLongMinHours}
                layoverShortMaxHours={settings.layoverShortMaxHours}
                priceCurrency={settings.currency}
                paginationResetKey={outPaginationKey}
                saveControls={{
                  leg: 'outbound',
                  savedKeys: savedKeysOutbound,
                  onSave: saveOutboundCard,
                  onRemove: (sk) => void removeSavedResult('outbound', sk),
                }}
                resultLeg="outbound"
                mapFocus={{ active: mapSoloFocus, onSet: setMapSoloFocus }}
              />
              {tripType === 'round' && (
                <ResultsList
                  title="Return"
                  items={displayReturn}
                  sort={sortReturn}
                  onSortChange={setSortReturn}
                  gfOrigins={destinations}
                  gfDestinations={origins}
                  linkDate={returnDate}
                  returnDate={null}
                  tripType="round"
                  tzByIata={tzByIata}
                  displayTimezone={displayTimezone}
                  airlineDirectory={airlinesDict}
                  airlinesMeta={airlinesMetaJson as AirlinesMeta}
                  namesByIata={namesByIata}
                  layoverLongMinHours={settings.layoverLongMinHours}
                  layoverShortMaxHours={settings.layoverShortMaxHours}
                  priceCurrency={settings.currency}
                  paginationResetKey={retPaginationKey}
                  saveControls={{
                    leg: 'return',
                    savedKeys: savedKeysReturn,
                    onSave: saveReturnCard,
                    onRemove: (sk) => void removeSavedResult('return', sk),
                  }}
                  resultLeg="return"
                  mapFocus={{ active: mapSoloFocus, onSet: setMapSoloFocus }}
                />
              )}
            </>
          )}

        </div>
        </ErrorBoundary>
        </div>
          </>
        ) : mainTab === 'savedSearches' ? (
          <SavedSearchesPanel
            rows={savedSearches}
            onApply={(row) => {
              applySavedSearchPayload(row.payload)
              setMainTab('search')
              setSearchPanelOpen(true)
              setCacheHint('Applied saved search. Adjust if needed, then run Search.')
            }}
            onDelete={(id) => void removeSavedSearch(id)}
            onOpenSearchTab={() => setMainTab('search')}
          />
        ) : (
          <div className="saved-results-page">
            <SavedRoundTripsList
              items={savedRoundTrips}
              currency={settings.currency}
              onRemove={(sk) => void removeSavedResult('roundtrip', sk)}
              tzByIata={tzByIata}
              displayTimezone={displayTimezone}
              airlineDirectory={airlinesDict}
              airlinesMeta={airlinesMetaJson as AirlinesMeta}
              namesByIata={namesByIata}
              layoverLongMinHours={settings.layoverLongMinHours}
              layoverShortMaxHours={settings.layoverShortMaxHours}
            />
            <ResultsList
              title="Saved outbound"
              items={savedOutboundItins}
              sort={sortOut}
              onSortChange={setSortOut}
              gfOrigins={origins}
              gfDestinations={destinations}
              linkDate={outboundDate}
              returnDate={tripType === 'round' ? returnDate : null}
              tripType={savedOutboundTripType}
              tzByIata={tzByIata}
              displayTimezone={displayTimezone}
              airlineDirectory={airlinesDict}
              airlinesMeta={airlinesMetaJson as AirlinesMeta}
              namesByIata={namesByIata}
              layoverLongMinHours={settings.layoverLongMinHours}
              layoverShortMaxHours={settings.layoverShortMaxHours}
              priceCurrency={settings.currency}
              paginationResetKey={savedOutPaginationKey}
              gfLinkByScheduleKey={savedOutboundGfMap}
              saveControls={{
                leg: 'outbound',
                savedKeys: savedKeysOutbound,
                onSave: saveOutboundCard,
                onRemove: (sk) => void removeSavedResult('outbound', sk),
              }}
              resultLeg="outbound"
            />
            <ResultsList
              title="Saved return"
              items={savedReturnItins}
              sort={sortReturn}
              onSortChange={setSortReturn}
              gfOrigins={destinations}
              gfDestinations={origins}
              linkDate={returnDate}
              returnDate={null}
              tripType="round"
              tzByIata={tzByIata}
              displayTimezone={displayTimezone}
              airlineDirectory={airlinesDict}
              airlinesMeta={airlinesMetaJson as AirlinesMeta}
              namesByIata={namesByIata}
              layoverLongMinHours={settings.layoverLongMinHours}
              layoverShortMaxHours={settings.layoverShortMaxHours}
              priceCurrency={settings.currency}
              paginationResetKey={savedRetPaginationKey}
              gfLinkByScheduleKey={savedReturnGfMap}
              saveControls={{
                leg: 'return',
                savedKeys: savedKeysReturn,
                onSave: saveReturnCard,
                onRemove: (sk) => void removeSavedResult('return', sk),
              }}
              resultLeg="return"
            />
          </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={update}
        regionCountries={regionCountries}
        onRegionTextChange={(id, text) => void updateRegionText(id, text)}
        airlineUiRegions={airlineUiRegions}
        onReplaceAirlineMappings={replaceAirlineMappings}
        airportUiRegions={airportUiRegions}
        onReplaceAirportMappings={replaceAirportMappings}
        onResetRegions={() => void resetRegions()}
        cacheTtlHours={cacheTtlHours}
        onCacheTtlChange={(h) => void updateCacheTtl(h)}
        onResetSqlite={() => void resetEntireDb()}
        getSerpCaptureRows={getSerpCaptureRows}
        getSerpCaptureStoredRecord={getSerpCaptureStoredRecord}
        onDeleteSerpCapture={(id) => void removeSerpCapture(id)}
      />
    </div>
  )
}
