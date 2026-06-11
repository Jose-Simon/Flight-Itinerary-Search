import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState, startTransition } from 'react'
import countryToAirports from './data/countryToAirports.json'
import airlineDirectory from './data/airlinesByIata.json'
import airlinesMetaJson from './data/airlinesMeta.json'
import { mergeRegionDefaults, REGION_IDS_IN_UI_ORDER, type RegionId } from './data/regions'
import { AirportMultiSelect } from './components/AirportMultiSelect'
import { AirlineFilterPanel, type AirlinesMeta } from './components/AirlineFilterPanel'
import { resolveAirlineFilterKeyToIata } from './lib/airlineMetaLookup'
import { DurationHistogramFilters } from './components/DurationHistogramFilters'
import { PriceHistogramFilter } from './components/PriceHistogramFilter'
import { LayoverRegionsPanel } from './components/LayoverRegionsPanel'
import { ResultsList } from './components/ResultsList'
import { ResultsViewSwitcher } from './components/ResultsViewSwitcher'
import { ResultsRouteMap, type MapSoloFocus } from './components/ResultsRouteMap'
import { SettingsModal } from './components/SettingsModal'
import { StopsFilterBlock } from './components/StopsFilterBlock'
import { AircraftFilterBlock } from './components/AircraftFilterBlock'
import { FilterChip } from './components/FilterChip'
import { TakeoffLandingHistogramFilters } from './components/TakeoffLandingHistogramFilters'
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
  dedupeDisplayBySchedule,
  sortItineraries,
  itineraryScheduleKey,
  type HourFieldStrings,
  type PriceFieldStrings,
  type FilterState,
  type SortMode,
  type DedupeMode,
} from './lib/filters'
import { itineraryInsightStats } from './lib/resultStats'
import { itineraryCountsByAirline } from './lib/resultInsights'
import type { NormalizedItinerary } from './lib/types'
import {
  searchDirection,
  searchPriceWindow,
  dedupeRoundTripCombos,
  searchPriceWindowRoundTrip,
  refreshFilteredReturns,
  runAirlineTargetedScan,
  dateRange as pwDateRange,
  dateWindow,
  type SearchFlightInput,
  type SerpSearchDebugBundle,
  type PriceWindowSearchInput,
  type PriceWindowPerDateEntry,
  type PriceWindowRoundTripPartial,
} from './services/searchFlights'
import {
  buildPriceWindowFromRoundTripCombos,
  buildPriceWindowShellFromPairMeta,
  filterRoundTripCombos,
  mergePriceWindowResults,
  outboundItinerariesForCell,
  returnItinerariesForCell,
} from './lib/roundTripPricing'
import {
  loadPriceWindowSearchMode,
  PW_BALANCED_CLICK_RESERVE,
  type PriceWindowSearchMode,
} from './lib/priceWindowSearchMode'
import { formatPriceWindowRoundTripStatus } from './lib/priceWindowSearchStatus'
import { discoveryListsFromCombos } from './lib/discoveryRoundTrip'
import { storedToDeepenState } from './lib/storedRoundTripPair'
import { buildFilteredRoundTripDatePairs } from './lib/priceWindowPairFilters'
import { pairMetaFromInternal, pairMetaMapFromList, routeKeysFromPairMeta, type RoundTripPairDeepenState, type RoundTripPairMeta } from './lib/roundTripPairMeta'
import {
  buildRtFilterDistributionPool,
  buildRtFilterPool,
  buildDeepenStatesByOutDate,
  dedupeRtPoolItineraries,
  filterPairMetaListForDisplay,
  passesRtOutboundLegFilter,
  passesRtReturnLegFilter,
  reorderDeepenStateForLegFilters,
} from './lib/rtFilterPool'
import type { SearchProgressState } from './lib/searchProgress'
import {
  estimatePriceWindowSerpQueries,
  estimatePwTrancheSerpQueries,
  formatSerpThrottleHelp,
} from './lib/serpQueryEstimate'
import { effectivePwHourLimit, resolvePwSearchTranche } from './lib/pwSearchTranche'
import {
  formatTimeSinceSearch,
  loadPwLastSearchAt,
  recordPwLastSearchAt,
} from './lib/pwLastSearchTime'
import {
  clearSerpSearchStop,
  createSerpHourBudget,
  requestSerpSearchStop,
  SERP_HOURLY_LIMIT_DEFAULT,
  setActiveSerpHourBudget,
} from './lib/serpHourBudget'
import {
  computeRefreshStats,
  makeComboKey,
  snapshotCombos,
  type ComboSnapshot,
  type RefreshRunStats,
} from './lib/pwRefreshStats'
import {
  formatActivityEvent,
  formatReturnFetchTokenNote,
  formatSearchProgress,
  type SearchActivityEvent,
} from './lib/searchProgress'
import { setSerpApiMinIntervalMs } from './lib/serpApiQueue'
import type { RoundTripCombo } from './lib/roundTripTypes'
import {
  roundTripCombosFromItineraries,
} from './db/searchRepo'
import { mergePerDateUnique } from './lib/pipeline'
import { buildPriceWindowResult } from './lib/routeGrouping'
import { pickPwReturnForOutbound } from './lib/pwReturnAutoPick'
import {
  filterPairMetaListToBounds,
  filterRoundTripCombosToBounds,
  isDatePairInBounds,
  type PriceWindowDateBounds,
} from './lib/priceOverrides'
import { buildRtTokenPriceIndex } from './lib/rtTokenRoutePrice'
import { PriceWindowPanel } from './components/PriceWindowPanel'
import { DateHeatmapPanel } from './components/DateHeatmapPanel'
import { HeatmapQualityFilterBar } from './components/HeatmapQualityFilter'
import {
  computePanelQualityTotals,
  emptyHeatmapQualityTotals,
  type HeatmapCellQuality,
} from './lib/heatmapCellQuality'
import { buildSerpDownloadPayload, downloadJson } from './lib/serpDebugExport'
import { buildSerpCapturePersistPayload } from './lib/serpCaptureSave'
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
import type { SearchCacheParts } from './db/searchHash'
import {
  clampPaxCounts,
  DEFAULT_PAX_COUNTS,
  formatPaxDesc,
  formatPaxSummary,
} from './lib/paxDesc'
import type { SavedResultPayloadV1, SavedResultPayloadV2 } from './db/savedResultTypes'
import { SavedRoundTripsList } from './components/SavedRoundTripsList'
import type { SavedSearchPayloadV1 } from './db/savedSearchTypes'
import { ConfigPresetsBar } from './components/ConfigPresetsBar'
import { PriceWindowSearchConfirmModal } from './components/PriceWindowSearchConfirmModal'
import { PriceWindowPairFiltersFields } from './components/PriceWindowPairFiltersFields'
import {
  formatPairFilterStatsLine,
  loadPriceWindowPairFilters,
  normalizePriceWindowPairFilters,
  savePriceWindowPairFilters,
  type PriceWindowPairFilters,
} from './lib/priceWindowPairFilters'
import {
  loadRoundTripSortMode,
  saveRoundTripSortMode,
  sortModeFromFlags,
  sortModeToFlags,
  type RoundTripSortMode,
} from './lib/roundTripSortMode'
import { ErrorBoundary } from './components/ErrorBoundary'
import { readDefaultConfigPreset, readBootConfigSnapshot, normalizeConfigSnapshot, normalizeFilterSnapshot, useConfigPresets } from './hooks/useConfigPresets'
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

/** Estimated API call breakdown for a "Refresh filtered returns" run. */
type RefreshEstimate = {
  /** Date pairs in range with no deepen state or no ranked entries → outbound scan needed. */
  pairsNeedingScan: number
  /** API calls for pair scans (1 per pair, or 2 when sort mode is 'both'). */
  pairScanCalls: number
  /** Filter-passing departure tokens in pairs that have ranked entries but zero combos. */
  newReturnTokens: number
  /** Filter-passing departure tokens in pairs with existing combos (cleared + re-fetched). */
  refreshTokens: number
  totalCalls: number
}

function fmtMoney(n: number | null, currency: string): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

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
    loadCachedSplitFallback,
    loadRtPairCacheEntry,
    loadRtPairCacheBatchEntries,
    rtPairCacheRouteStatsFor,
    persistRoundTripPairs,
    downloadDb,
    restoreDbFromFile,
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
    priceVerifications,
    upsertVerification,
    removeVerification,
    importVerifications,
  } = useFlightDb()

  const [mainTab, setMainTab] = useState<'search' | 'savedSearches' | 'savedResults'>('search')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [airports, setAirports] = useState<AirportRow[] | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    void import('./data/airports.json').then((m) => {
      setAirports(m.default as AirportRow[])
    })
  }, [])

  const [bootSnapshot] = useState(() => readBootConfigSnapshot())
  const [airlineExcludedCodes, setAirlineExcludedCodes] = useState(
    () => new Set(bootSnapshot.airlineExcludedCodes),
  )
  const [configPresetId, setConfigPresetId] = useState(
    () => readDefaultConfigPreset()?.id ?? '',
  )
  const [configPresetRevision, setConfigPresetRevision] = useState(0)
  const [origins, setOrigins] = useState<string[]>(() =>
    bootSnapshot.origins.length > 0 ? [...bootSnapshot.origins] : ['PHL', 'EWR', 'JFK', 'LGA'],
  )
  const [destinations, setDestinations] = useState<string[]>(() =>
    bootSnapshot.destinations.length > 0 ? [...bootSnapshot.destinations] : ['MAA', 'TRV', 'IXM', 'BLR', 'COK'],
  )
  const [tripType, setTripType] = useState<'oneway' | 'round'>(() => bootSnapshot.tripType ?? 'oneway')
  const [outboundDate, setOutboundDate] = useState(
    () => bootSnapshot.outboundDate || '2026-07-09',
  )
  const [outboundEnd, setOutboundEnd] = useState(
    () => bootSnapshot.outboundEnd || bootSnapshot.outboundDate || '2026-07-09',
  )
  const [returnDate, setReturnDate] = useState(
    () => bootSnapshot.returnDate || '2026-07-19',
  )
  const [returnEnd, setReturnEnd] = useState(
    () => bootSnapshot.returnEnd || bootSnapshot.returnDate || '2026-07-19',
  )
  const [adultCount, setAdultCount] = useState(
    () => bootSnapshot.adultCount ?? DEFAULT_PAX_COUNTS.adults,
  )
  const [childrenCount, setChildrenCount] = useState(
    () => bootSnapshot.childrenCount ?? DEFAULT_PAX_COUNTS.children,
  )
  const [cabinClass, setCabinClass] = useState<number>(
    () => bootSnapshot.cabinClass ?? 1,
  )
  const [outHours, setOutHours] = useState<HourFieldStrings>(() => ({ ...bootSnapshot.outHours }))
  const [retHours, setRetHours] = useState<HourFieldStrings>(() => ({ ...bootSnapshot.retHours }))
  const [outPrice, setOutPrice] = useState<PriceFieldStrings>(() => ({ ...bootSnapshot.outPrice }))
  const [retPrice, setRetPrice] = useState<PriceFieldStrings>(() => ({ ...bootSnapshot.retPrice }))
  const [outTimeRange, setOutTimeRange] = useState<TimeRangeFieldStrings>(() => ({ ...bootSnapshot.outTimeRange }))
  const [retTimeRange, setRetTimeRange] = useState<TimeRangeFieldStrings>(() => ({ ...bootSnapshot.retTimeRange }))
  const [outLegDurationMatch, setOutLegDurationMatch] = useState<LegDurationMatchMode>(
    () => bootSnapshot.outLegDurationMatch,
  )
  const [retLegDurationMatch, setRetLegDurationMatch] = useState<LegDurationMatchMode>(
    () => bootSnapshot.retLegDurationMatch,
  )
  const [outStopsMin, setOutStopsMin] = useState(() => bootSnapshot.outStopsMin)
  const [outStopsMax, setOutStopsMax] = useState(() => bootSnapshot.outStopsMax)
  const [retStopsMin, setRetStopsMin] = useState(() => bootSnapshot.retStopsMin)
  const [retStopsMax, setRetStopsMax] = useState(() => bootSnapshot.retStopsMax)
  const [returnCustomFilters, setReturnCustomFilters] = useState(() => bootSnapshot.returnCustomFilters)
  const [layoverRegionOn, setLayoverRegionOn] = useState<Record<RegionId, boolean>>(() => ({ ...bootSnapshot.layoverRegionOn }))
  const [layoverAirportOff, setLayoverAirportOff] = useState<Set<string>>(
    () => new Set(bootSnapshot.layoverAirportOff),
  )
  /**
   * When false, layover geography is not applied (all hubs allowed). Turning on any region/airport
   * control sets this true so partial “include” lists cannot zero out the whole grid by mistake.
   */
  const [layoverGeoFilterActive, setLayoverGeoFilterActive] = useState(() => bootSnapshot.layoverGeoFilterActive)
  const [mapHubFilter, setMapHubFilter] = useState<Set<string>>(() => new Set())
  const [mapRouteFilter, setMapRouteFilter] = useState<Set<string> | null>(null)
  /** Result card “Map” → highlight one itinerary on the top map (no inline map). */
  const [mapSoloFocus, setMapSoloFocus] = useState<MapSoloFocus | null>(null)
  const routeMapWrapRef = useRef<HTMLDivElement>(null)
  const defaultSearchAppliedRef = useRef(false)
  const [excludeTechnical, setExcludeTechnical] = useState(() => bootSnapshot.excludeTechnical)
  const [showOpenJaw, setShowOpenJaw] = useState(() => bootSnapshot.showOpenJaw)
  const [sortOut, setSortOut] = useState<SortMode>(() => bootSnapshot.sortOut)
  const [sortReturn, setSortReturn] = useState<SortMode>(() => bootSnapshot.sortReturn)
  /** API = live SerpApi (+ save to SQLite). DB = load cached snapshot only (same hash as API runs). */
  const [searchSource, setSearchSource] = useState<'api' | 'db'>('api')
  const [timeBucketsOut, setTimeBucketsOut] = useState<Set<TimeOfDayBucket>>(
    () => new Set(bootSnapshot.timeBucketsOut),
  )
  const [timeBucketsRet, setTimeBucketsRet] = useState<Set<TimeOfDayBucket>>(
    () => new Set(bootSnapshot.timeBucketsRet),
  )
  const [displayTimezone, setDisplayTimezone] = useState(
    () => bootSnapshot.displayTimezone ?? '',
  )

  const [searchGoal, setSearchGoal] = useState<'discovery' | 'priceWindow'>('discovery')
  const [pwOutboundSel, setPwOutboundSel] = useState<{ routeKey: string; date: string; pickedIdx?: number; selectedItinerary?: NormalizedItinerary } | null>(null)
  const [pwReturnSel, setPwReturnSel] = useState<{ routeKey: string; date: string; pickedIdx?: number; selectedItinerary?: NormalizedItinerary } | null>(null)
  const [pwRawOutPerDate, setPwRawOutPerDate] = useState<PriceWindowPerDateEntry[]>([])
  const [pwRawRetPerDate, setPwRawRetPerDate] = useState<PriceWindowPerDateEntry[]>([])
  const [pwRoundTripCombos, setPwRoundTripCombos] = useState<RoundTripCombo[]>([])
  const [pwRoundTripPairMeta, setPwRoundTripPairMeta] = useState<RoundTripPairMeta[]>([])
  const [pwRoundTripDeepenStates, setPwRoundTripDeepenStates] = useState<RoundTripPairDeepenState[]>([])
  const pwDeepenStatesRef = useRef(pwRoundTripDeepenStates)
  useEffect(() => {
    pwDeepenStatesRef.current = pwRoundTripDeepenStates
  }, [pwRoundTripDeepenStates])
  const pwPartialSnapRef = useRef<PriceWindowRoundTripPartial | null>(null)
  const pwPartialUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pwRtSortMode, setPwRtSortMode] = useState<RoundTripSortMode>(loadRoundTripSortMode)
  const [pwSearchMode] = useState<PriceWindowSearchMode>(loadPriceWindowSearchMode)
  const [pwPairFilters, setPwPairFilters] = useState<PriceWindowPairFilters>(() =>
    bootSnapshot.pwPairFilters
      ? normalizePriceWindowPairFilters(bootSnapshot.pwPairFilters)
      : loadPriceWindowPairFilters(),
  )
  const [pwSearchConfirmOpen, setPwSearchConfirmOpen] = useState(false)
  const [pwReplaceOutbound, setPwReplaceOutbound] = useState(false)
  const [pwRefreshLoading, setPwRefreshLoading] = useState(false)
  const [pwRefreshStats, setPwRefreshStats] = useState<RefreshRunStats | null>(null)
  /** Targeted airline scan (uses airlines still allowed in the filter panel). */
  const [pwAirlineScanLoading, setPwAirlineScanLoading] = useState(false)
  /** When true, airline refresh re-fetches returns from existing outbound tokens only. */
  const [pwAirlineScanReturnOnly, setPwAirlineScanReturnOnly] = useState(false)
  /** null = idle, number = confirm pending (shows inline "Clear N combos?" prompt) */
  const [pwClearConfirmCount, setPwClearConfirmCount] = useState<number | null>(null)
  /** null = idle, estimate = refresh confirm pending (shows call breakdown + Confirm/Cancel). */
  const [pwRefreshEstimate, setPwRefreshEstimate] = useState<RefreshEstimate | null>(null)
  /** Rolling "last event" shown in SearchSummaryBar while a search is running. */
  const [pwActivityMessage, setPwActivityMessage] = useState<string | null>(null)
  /**
   * Set of combo keys seen so far in the current search/refresh run.
   * Populated at run start; new entries trigger activity messages.
   */
  const seenComboKeysRef = useRef(new Set<string>())
  /** Snapshot taken at the start of a refresh run for price-delta activity messages. */
  const refreshBeforeSnapRef = useRef<ComboSnapshot>(new Map())
  /** Total estimated API calls for the current/upcoming refresh run (set by handleRefreshEstimate). */
  const pwRefreshEstimateTotalRef = useRef<number>(0)
  const [heatmapQualityFilter, setHeatmapQualityFilter] = useState<Set<HeatmapCellQuality>>(
    () => new Set(),
  )
  const toggleHeatmapQualityFilter = useCallback((q: HeatmapCellQuality) => {
    setHeatmapQualityFilter((prev) => {
      const next = new Set(prev)
      if (next.has(q)) next.delete(q)
      else next.add(q)
      return next
    })
  }, [])
  const [_pwLastSearchAgo, setPwLastSearchAgo] = useState<string | null>(() =>
    formatTimeSinceSearch(loadPwLastSearchAt()),
  )

  useEffect(() => {
    const raw = localStorage.getItem('flight-itinerary-discovery-serp-interval-ms')
    const ms = raw != null ? Number(raw) : 1800
    setSerpApiMinIntervalMs(Number.isFinite(ms) ? ms : 1800)
  }, [])

  useEffect(() => {
    const tick = () => setPwLastSearchAgo(formatTimeSinceSearch(loadPwLastSearchAt()))
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const [loading, setLoading] = useState(false)
  const [searchProgress, setSearchProgress] = useState<SearchProgressState | null>(null)
  const [searchRefreshKey, setSearchRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rawOut, setRawOut] = useState<NormalizedItinerary[]>([])
  const [rawReturn, setRawReturn] = useState<NormalizedItinerary[]>([])
  const [cacheHint, setCacheHint] = useState<string | null>(null)
  const [dedupeMode, setDedupeMode] = useState<DedupeMode>(() => bootSnapshot.dedupeMode ?? 'route')
  const [searchPanelOpen, setSearchPanelOpen] = useState(true)
  const [aircraftSelectedCodes, setAircraftSelectedCodes] = useState<string[]>(
    () => [...bootSnapshot.aircraftSelectedCodes],
  )
  const [aircraftMatchMode, setAircraftMatchMode] = useState<AircraftMatchMode>(
    () => bootSnapshot.aircraftMatchMode,
  )
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
    dedupeMode,
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
    excludeTechnical, showOpenJaw, dedupeMode, returnCustomFilters,
    aircraftSelectedCodes, aircraftMatchMode, sortOut, sortReturn,
  ])

  const currentDateSnapshot = useMemo((): DateSnapshot => ({
    origins: [...origins],
    destinations: [...destinations],
    tripType,
    outboundDate,
    outboundEnd,
    returnDate,
    returnEnd,
    adultCount,
    childrenCount,
    cabinClass,
  }), [
    origins,
    destinations,
    tripType,
    outboundDate,
    outboundEnd,
    returnDate,
    returnEnd,
    adultCount,
    childrenCount,
    cabinClass,
  ])

  const paxCounts = useMemo(
    () => clampPaxCounts({ adults: adultCount, children: childrenCount }),
    [adultCount, childrenCount],
  )
  const paxDesc = useMemo(() => formatPaxDesc(paxCounts), [paxCounts])
  const passengerSummary = useMemo(() => formatPaxSummary(paxCounts), [paxCounts])

  const withPax = useCallback(
    (parts: Omit<SearchCacheParts, 'paxDesc'>): SearchCacheParts => ({ ...parts, paxDesc }),
    [paxDesc],
  )

  const currentConfigSnapshot = useMemo((): ConfigSnapshot => ({
    ...currentFilterSnapshot,
    ...currentDateSnapshot,
    displayTimezone,
    pwPairFilters,
  }), [currentFilterSnapshot, currentDateSnapshot, displayTimezone, pwPairFilters])

  /** Apply the filter portion of a config snapshot. */
  const applyFilterPreset = useCallback((f: FilterSnapshot) => {
    const n = normalizeFilterSnapshot(f)
    setAirlineExcludedCodes(new Set(n.airlineExcludedCodes))
    setOutStopsMin(n.outStopsMin)
    setOutStopsMax(n.outStopsMax)
    setRetStopsMin(n.retStopsMin)
    setRetStopsMax(n.retStopsMax)
    setOutHours({ ...n.outHours })
    setRetHours({ ...n.retHours })
    setOutPrice({ ...n.outPrice })
    setRetPrice({ ...n.retPrice })
    setOutTimeRange({ ...n.outTimeRange })
    setRetTimeRange({ ...n.retTimeRange })
    setOutLegDurationMatch(n.outLegDurationMatch)
    setRetLegDurationMatch(n.retLegDurationMatch)
    setTimeBucketsOut(new Set(n.timeBucketsOut))
    setTimeBucketsRet(new Set(n.timeBucketsRet))
    setLayoverRegionOn({ ...n.layoverRegionOn })
    setLayoverAirportOff(new Set(n.layoverAirportOff))
    setLayoverGeoFilterActive(n.layoverGeoFilterActive)
    setExcludeTechnical(n.excludeTechnical)
    setShowOpenJaw(n.showOpenJaw)
    setDedupeMode(n.dedupeMode ?? 'route')
    setReturnCustomFilters(n.returnCustomFilters)
    setAircraftSelectedCodes(n.aircraftSelectedCodes)
    setAircraftMatchMode(n.aircraftMatchMode)
    setSortOut(n.sortOut)
    setSortReturn(n.sortReturn)
  }, [])

  /** Apply the date portion of a config snapshot. */
  const applyDatePreset = useCallback((d: DateSnapshot) => {
    if (Array.isArray(d.origins)) setOrigins([...d.origins])
    if (Array.isArray(d.destinations)) setDestinations([...d.destinations])
    setTripType(d.tripType)
    setOutboundDate(d.outboundDate)
    setOutboundEnd((d.outboundEnd as string | undefined) ?? d.outboundDate)
    setReturnDate(d.returnDate)
    setReturnEnd((d.returnEnd as string | undefined) ?? d.returnDate)
    setAdultCount(d.adultCount ?? DEFAULT_PAX_COUNTS.adults)
    setChildrenCount(d.childrenCount ?? DEFAULT_PAX_COUNTS.children)
    setCabinClass(d.cabinClass ?? 1)
  }, [])

  /** Apply filter fields only (stops, layover, price, etc.) — not route/dates. */
  const applyFilterFieldsFromConfig = useCallback((c: ConfigSnapshot) => {
    const n = normalizeConfigSnapshot(c)
    applyFilterPreset(n)
    setDisplayTimezone(n.displayTimezone ?? '')
    if (n.pwPairFilters) {
      const pf = normalizePriceWindowPairFilters(n.pwPairFilters)
      setPwPairFilters(pf)
      savePriceWindowPairFilters(pf)
    }
    setConfigPresetRevision((r) => r + 1)
  }, [applyFilterPreset])

  /** Apply both filter + date portions of a unified config preset. */
  const applyConfigPreset = useCallback((c: ConfigSnapshot) => {
    applyFilterFieldsFromConfig(c)
    applyDatePreset(normalizeConfigSnapshot(c))
  }, [applyFilterFieldsFromConfig, applyDatePreset])

  /** Remember date fields per goal when no config preset is selected. */
  const goalDateMemoryRef = useRef<Partial<Record<'discovery' | 'priceWindow', DateSnapshot>>>({})

  const handleSearchGoalChange = useCallback(
    (goal: 'discovery' | 'priceWindow') => {
      if (goal === searchGoal) return
      goalDateMemoryRef.current[searchGoal] = {
        origins: [...origins],
        destinations: [...destinations],
        tripType,
        outboundDate,
        outboundEnd,
        returnDate,
        returnEnd,
        adultCount,
        childrenCount,
        cabinClass,
      }
      setSearchGoal(goal)
      if (configPresetId) {
        const preset = configPresets.presets.find((p) => p.id === configPresetId)
        if (preset) {
          applyDatePreset(preset.config)
          return
        }
      }
      const remembered = goalDateMemoryRef.current[goal]
      if (remembered) applyDatePreset(remembered)
    },
    [
      searchGoal,
      origins,
      destinations,
      tripType,
      outboundDate,
      outboundEnd,
      returnDate,
      returnEnd,
      adultCount,
      childrenCount,
      cabinClass,
      configPresetId,
      configPresets.presets,
      applyDatePreset,
    ],
  )

  const defaultConfigAppliedRef = useRef(false)
  useEffect(() => {
    if (defaultConfigAppliedRef.current) return
    defaultConfigAppliedRef.current = true
    const def = readDefaultConfigPreset()
    if (!def) return
    applyConfigPreset(def.config)
    setConfigPresetId(def.id)
  }, [applyConfigPreset])

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

  const deferredPwDeepenStates = useDeferredValue(pwRoundTripDeepenStates)
  const deferredPwCombos = useDeferredValue(pwRoundTripCombos)

  const pwDeepenByOutDate = useMemo(
    () => buildDeepenStatesByOutDate(pwRoundTripDeepenStates),
    [pwRoundTripDeepenStates],
  )

  /** Sidebar histograms: slim sample (not every ranked outbound × date pair). */
  const pwRtFilterPool = useMemo(
    () => buildRtFilterDistributionPool(deferredPwDeepenStates, deferredPwCombos),
    [deferredPwDeepenStates, deferredPwCombos],
  )

  const filterPoolOut = useMemo(() => {
    if (searchGoal === 'priceWindow' && tripType === 'round') {
      const ow = pwRawOutPerDate.flatMap((d) => d.itineraries)
      const merged = dedupeRtPoolItineraries([...pwRtFilterPool.outbound, ...ow])
      if (merged.length > 0) return merged
    }
    return rawOut
  }, [searchGoal, tripType, pwRtFilterPool, pwRawOutPerDate, rawOut])

  const filterPoolRet = useMemo(() => {
    if (searchGoal === 'priceWindow' && tripType === 'round') {
      const ow = pwRawRetPerDate.flatMap((d) => d.itineraries)
      const merged = dedupeRtPoolItineraries([...pwRtFilterPool.return, ...ow])
      if (merged.length > 0) return merged
    }
    return rawReturn
  }, [searchGoal, tripType, pwRtFilterPool, pwRawRetPerDate, rawReturn])

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
          filterPoolOut,
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
    filterPoolOut,
    airportsByIata,
  ])


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
    for (const it of filterPoolOut) countItin(it)
    for (const it of filterPoolRet) countItin(it)
    return [...counts.entries()]
      .map(([aircraft, routeCount]) => ({ aircraft, routeCount }))
      .sort((a, b) => b.routeCount - a.routeCount || a.aircraft.localeCompare(b.aircraft))
  }, [filterPoolOut, filterPoolRet])

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
      for (const it of filterPoolOut) if (countItin(it, mfr)) n++
      for (const it of filterPoolRet) if (countItin(it, mfr)) n++
      counts[mfr] = n
    }
    return counts
  }, [filterPoolOut, filterPoolRet, aircraftOptionsWithCounts])

  const airlinesFromResults = useMemo(() => {
    const set = new Set<string>()
    for (const it of filterPoolOut) {
      for (const s of it.segments) {
        const c = s.airline?.trim().toUpperCase()
        if (c) set.add(c)
      }
    }
    for (const it of filterPoolRet) {
      for (const s of it.segments) {
        const c = s.airline?.trim().toUpperCase()
        if (c) set.add(c)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [filterPoolOut, filterPoolRet])

  /** IATA codes for airlines still checked in the filter panel (for SerpApi `include_airlines`). */
  const pwIncludedAirlineCodes = useMemo(() => {
    const meta = airlinesMetaJson as AirlinesMeta
    const codes: string[] = []
    const seen = new Set<string>()
    for (const raw of airlinesFromResults) {
      if (airlineExcludedCodes.has(raw)) continue
      const iata = resolveAirlineFilterKeyToIata(raw, meta, airlinesDict)
      if (!iata || seen.has(iata)) continue
      seen.add(iata)
      codes.push(iata)
    }
    return codes.sort((a, b) => a.localeCompare(b))
  }, [airlinesFromResults, airlineExcludedCodes, airlinesDict])

  /** True when the user has narrowed the airline list (at least one excluded). */
  const pwAirlineFilterNarrowed =
    searchGoal === 'priceWindow' &&
    tripType === 'round' &&
    airlineExcludedCodes.size > 0 &&
    pwIncludedAirlineCodes.length > 0

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
    if (dedupeMode === 'route') list = dedupeDisplayByWaypoint(list, sortOut)
    else if (dedupeMode === 'schedule') list = dedupeDisplayBySchedule(list, sortOut)
    return list
  }, [
    rawOut,
    filterOutNoMap,
    sortOut,
    timeBucketsOut,
    tzByIata,
    airlineExcludedCodes,
    dedupeMode,
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
    if (dedupeMode === 'route') list = dedupeDisplayByWaypoint(list, sortReturn)
    else if (dedupeMode === 'schedule') list = dedupeDisplayBySchedule(list, sortReturn)
    return list
  }, [
    rawReturn,
    filterRetNoMap,
    sortReturn,
    effBucketsRet,
    tzByIata,
    airlineExcludedCodes,
    dedupeMode,
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
    if (dedupeMode === 'route') list = dedupeDisplayByWaypoint(list, sortOut)
    else if (dedupeMode === 'schedule') list = dedupeDisplayBySchedule(list, sortOut)
    return list
  }, [
    rawOut,
    filterOut,
    sortOut,
    timeBucketsOut,
    tzByIata,
    airlineExcludedCodes,
    dedupeMode,
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
    if (dedupeMode === 'route') list = dedupeDisplayByWaypoint(list, sortReturn)
    else if (dedupeMode === 'schedule') list = dedupeDisplayBySchedule(list, sortReturn)
    return list
  }, [
    rawReturn,
    filterRet,
    sortReturn,
    effBucketsRet,
    tzByIata,
    airlineExcludedCodes,
    dedupeMode,
    aircraftFilterSet,
    aircraftMatchMode,
    retTakeoffLandingBounds,
  ])

  const pwDateBounds = useMemo((): PriceWindowDateBounds | null => {
    if (searchGoal !== 'priceWindow' || tripType !== 'round') return null
    return {
      outboundStart: outboundDate,
      outboundEnd: outboundEnd,
      returnStart: returnDate,
      returnEnd: returnEnd,
    }
  }, [searchGoal, tripType, outboundDate, outboundEnd, returnDate, returnEnd])

  const pwRoundTripCombosInWindow = useMemo(() => {
    if (!pwDateBounds) return pwRoundTripCombos
    return filterRoundTripCombosToBounds(pwRoundTripCombos, pwDateBounds)
  }, [pwRoundTripCombos, pwDateBounds])

  const pwRoundTripPairMetaInWindow = useMemo(() => {
    if (!pwDateBounds) return pwRoundTripPairMeta
    return filterPairMetaListToBounds(pwRoundTripPairMeta, pwDateBounds)
  }, [pwRoundTripPairMeta, pwDateBounds])

  const pwRtFilterOpts = useMemo(
    () => ({
      filterOut,
      filterRet,
      airlineExcludedCodes,
      aircraftFilterSet,
      aircraftMatchMode,
      timeBucketsOut,
      timeBucketsRet: effBucketsRet,
      tzByIata,
      outTakeoffMin: outTakeoffLandingBounds.takeoffMin,
      outTakeoffMax: outTakeoffLandingBounds.takeoffMax,
      outLandingMin: outTakeoffLandingBounds.landingMin,
      outLandingMax: outTakeoffLandingBounds.landingMax,
      retTakeoffMin: retTakeoffLandingBounds.takeoffMin,
      retTakeoffMax: retTakeoffLandingBounds.takeoffMax,
      retLandingMin: retTakeoffLandingBounds.landingMin,
      retLandingMax: retTakeoffLandingBounds.landingMax,
    }),
    [
      filterOut,
      filterRet,
      airlineExcludedCodes,
      aircraftFilterSet,
      aircraftMatchMode,
      timeBucketsOut,
      effBucketsRet,
      tzByIata,
      outTakeoffLandingBounds,
      retTakeoffLandingBounds,
    ],
  )

  const deferredPwRtFilterOpts = useDeferredValue(pwRtFilterOpts)

  // Only pending when the FILTER OPTIONS themselves haven't been committed yet by the deferred
  // render.  Deepen-state changes (search / refresh updates) intentionally do NOT hide the
  // grid — live heatmap updates are safe because buildRtTokenPriceIndex gives O(1) cell
  // lookups.  Including pwRoundTripDeepenStates !== deferredPwDeepenStates here would hide
  // the grid throughout every refresh (applyPwDeepenStateList fires on every partial), which
  // is what caused the "nothing changed in the heatmap" symptom.
  const pwFiltersPending =
    searchGoal === 'priceWindow' &&
    tripType === 'round' &&
    pwRtFilterOpts !== deferredPwRtFilterOpts

  /** Hide heavy grids during cache load confirm or while deferred filters catch up.
   *  Note: API search no longer hides the grid — live heatmap updates are now safe because
   *  buildRtTokenPriceIndex gives O(1) cell lookups, eliminating the 60-second freeze. */
  const hidePwResultsUi =
    pwSearchConfirmOpen ||
    (pwFiltersPending && searchGoal === 'priceWindow' && tripType === 'round')

  const deferredPwCombosInWindow = useMemo(() => {
    if (!pwDateBounds) return deferredPwCombos
    return filterRoundTripCombosToBounds(deferredPwCombos, pwDateBounds)
  }, [deferredPwCombos, pwDateBounds])

  const pwRtTokenIndex = useMemo(
    () => buildRtTokenPriceIndex(deferredPwDeepenStates, deferredPwCombosInWindow, pwDateBounds),
    [deferredPwDeepenStates, deferredPwCombosInWindow, pwDateBounds],
  )

  const pwRtSortFlags = useMemo(() => sortModeToFlags(pwRtSortMode), [pwRtSortMode])

  const setPwRtSortFromFlags = useCallback((price: boolean, duration: boolean) => {
    const mode = sortModeFromFlags(price, duration)
    setPwRtSortMode(mode)
    saveRoundTripSortMode(mode)
  }, [])

  const pwHasExistingGrid = useMemo(() => {
    if (pwRoundTripDeepenStates.length === 0) return false
    if (!pwDateBounds) return true
    return pwRoundTripDeepenStates.some((s) =>
      isDatePairInBounds(s.outDate, s.retDate, pwDateBounds),
    )
  }, [pwRoundTripDeepenStates, pwDateBounds])

  const pwSerpEstimate = useMemo(() => {
    if (searchGoal !== 'priceWindow' || searchSource !== 'api' || settings.mockMode) return null
    if (tripType === 'round') {
      return estimatePwTrancheSerpQueries({
        outboundDate,
        outboundEnd,
        returnDate,
        returnEnd,
        roundTripSortMode: pwRtSortMode,
        pairFilters: pwPairFilters,
        replaceOutbound: pwReplaceOutbound,
        hasExistingGrid: pwHasExistingGrid,
        alsoSearchOneWay: false,
        plannedHourlySerpCalls: settings.pwHourlySerpCalls,
        hourUsedBeforeSearch:
          serpUsageState.status === 'ok' ? serpUsageState.data.this_hour_searches : undefined,
      })
    }
    return estimatePriceWindowSerpQueries({
      tripType,
      outboundDate,
      outboundEnd,
      returnDate,
      returnEnd,
      alsoSearchOneWay: false,
      roundTripSortMode: pwRtSortMode,
      searchMode: pwSearchMode,
      pairFilters: pwPairFilters,
    })
  }, [
    searchGoal,
    searchSource,
    settings.mockMode,
    tripType,
    outboundDate,
    outboundEnd,
    returnDate,
    returnEnd,
    pwRtSortMode,
    pwSearchMode,
    pwPairFilters,
    pwHasExistingGrid,
    pwReplaceOutbound,
    settings.pwHourlySerpCalls,
    serpUsageState,
  ])

  const pwPairFilterPreview = useMemo(() => {
    if (searchGoal !== 'priceWindow' || tripType !== 'round') return null
    return buildFilteredRoundTripDatePairs(
      outboundDate,
      outboundEnd,
      returnDate,
      returnEnd,
      pwPairFilters,
    )
  }, [searchGoal, tripType, outboundDate, outboundEnd, returnDate, returnEnd, pwPairFilters])

  const pwPairFilterStatsLine = useMemo(
    () =>
      pwPairFilterPreview
        ? formatPairFilterStatsLine(pwPairFilterPreview.stats, pwPairFilters)
        : null,
    [pwPairFilterPreview, pwPairFilters],
  )

  const pwRoundTripFiltered = useMemo(() => {
    if (!pwRoundTripCombosInWindow.length) return []
    return filterRoundTripCombos(pwRoundTripCombosInWindow, deferredPwRtFilterOpts)
  }, [pwRoundTripCombosInWindow, deferredPwRtFilterOpts])

  const pwRoundTripPairMetaFiltered = useMemo(() => {
    if (searchGoal !== 'priceWindow' || tripType !== 'round' || !pwRoundTripPairMetaInWindow.length) {
      return pwRoundTripPairMetaInWindow
    }
    return filterPairMetaListForDisplay(
      pwRoundTripPairMetaInWindow,
      deferredPwDeepenStates,
      deferredPwRtFilterOpts,
    )
  }, [
    searchGoal,
    tripType,
    pwRoundTripPairMetaInWindow,
    deferredPwDeepenStates,
    deferredPwRtFilterOpts,
  ])

  const pwPairMetaMapFiltered = useMemo(
    () => pairMetaMapFromList(pwRoundTripPairMetaFiltered),
    [pwRoundTripPairMetaFiltered],
  )

  // Price window: round-trip bundles and/or one-way leg caches (filters applied)
  const pwOutResultFiltered = useMemo(() => {
    const oneWayOut = pwRawOutPerDate.length
      ? buildPriceWindowResult(
          pwRawOutPerDate.map(({ date, itineraries }) => ({
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
          })),
        )
      : null

    if (pwRoundTripPairMetaFiltered.length) {
      const shell = buildPriceWindowShellFromPairMeta(pwRoundTripPairMetaFiltered).outResult
      if (pwRoundTripFiltered.length) {
        const fromCombos = buildPriceWindowFromRoundTripCombos(pwRoundTripFiltered).outResult
        return mergePriceWindowResults(shell, fromCombos)
      }
      if (oneWayOut) {
        return mergePriceWindowResults(shell, oneWayOut)
      }
      return shell
    }
    if (pwRoundTripFiltered.length) {
      return buildPriceWindowFromRoundTripCombos(pwRoundTripFiltered).outResult
    }
    return oneWayOut
  }, [
    pwRoundTripFiltered,
    pwRoundTripPairMetaFiltered,
    pwRawOutPerDate,
    filterOut,
    filterRet,
    airlineExcludedCodes,
    aircraftFilterSet,
    aircraftMatchMode,
    timeBucketsOut,
    tzByIata,
    outTakeoffLandingBounds,
  ])

  const pwRetResultFiltered = useMemo(() => {
    const oneWayRet = pwRawRetPerDate.length
      ? buildPriceWindowResult(
          pwRawRetPerDate.map(({ date, itineraries }) => ({
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
          })),
        )
      : null

    if (pwRoundTripPairMetaFiltered.length) {
      const shell = buildPriceWindowShellFromPairMeta(pwRoundTripPairMetaFiltered).retResult
      if (pwRoundTripFiltered.length) {
        const fromCombos = buildPriceWindowFromRoundTripCombos(pwRoundTripFiltered).retResult
        return mergePriceWindowResults(shell, fromCombos)
      }
      if (oneWayRet) {
        return mergePriceWindowResults(shell, oneWayRet)
      }
      return shell
    }
    if (pwRoundTripFiltered.length) {
      return buildPriceWindowFromRoundTripCombos(pwRoundTripFiltered).retResult
    }
    return oneWayRet
  }, [
    pwRoundTripFiltered,
    pwRoundTripPairMetaFiltered,
    pwRawRetPerDate,
    filterRet,
    filterOut,
    airlineExcludedCodes,
    aircraftFilterSet,
    aircraftMatchMode,
    effBucketsRet,
    tzByIata,
    retTakeoffLandingBounds,
  ])

  const heatmapQualityInputs = useMemo(
    () => ({
      out: pwOutResultFiltered,
      ret: pwRetResultFiltered,
      combos: pwRoundTripFiltered,
      meta: pwPairMetaMapFiltered,
      bounds: pwDateBounds,
      deepen: deferredPwDeepenStates,
      index: pwRtTokenIndex,
    }),
    [
      pwOutResultFiltered,
      pwRetResultFiltered,
      pwRoundTripFiltered,
      pwPairMetaMapFiltered,
      pwDateBounds,
      deferredPwDeepenStates,
      pwRtTokenIndex,
    ],
  )
  const deferredHeatmapQualityInputs = useDeferredValue(heatmapQualityInputs)

  const heatmapQualityTotals = useMemo(() => {
    if (hidePwResultsUi) return emptyHeatmapQualityTotals()
    return computePanelQualityTotals(
      deferredHeatmapQualityInputs.out,
      deferredHeatmapQualityInputs.ret,
      priceVerifications,
      deferredHeatmapQualityInputs.combos,
      deferredHeatmapQualityInputs.meta,
      deferredHeatmapQualityInputs.bounds,
      deferredHeatmapQualityInputs.deepen,
      deferredHeatmapQualityInputs.index,
    )
  }, [hidePwResultsUi, deferredHeatmapQualityInputs, priceVerifications])

  // If filters change, ensure selected legs still pass filters by snapping to the first valid option.
  useEffect(() => {
    if (searchGoal !== 'priceWindow' || tripType !== 'round') return
    if (!pwOutResultFiltered) return

    if (pwOutboundSel) {
      const bucket = pwOutResultFiltered.perRouteByDate
        .get(pwOutboundSel.routeKey)
        ?.get(pwOutboundSel.date)
      const opts = outboundItinerariesForCell(
        pwOutboundSel.routeKey,
        pwOutboundSel.date,
        bucket,
        pwRoundTripFiltered,
        pwRoundTripDeepenStates,
        (it) => passesItineraryFilters(it, filterOut),
        pwDeepenByOutDate,
      )
      const cur = opts[pwOutboundSel.pickedIdx ?? 0]
      if (!cur) {
        if (opts.length) setPwOutboundSel({ routeKey: pwOutboundSel.routeKey, date: pwOutboundSel.date, pickedIdx: 0, selectedItinerary: opts[0] })
      } else if (!passesItineraryFilters(cur, filterOut)) {
        if (opts.length) setPwOutboundSel({ routeKey: pwOutboundSel.routeKey, date: pwOutboundSel.date, pickedIdx: 0, selectedItinerary: opts[0] })
      }
    }

    if (pwRetResultFiltered && pwReturnSel && pwOutboundSel) {
      const opts = returnItinerariesForCell(
        pwOutboundSel.routeKey,
        pwOutboundSel.date,
        pwReturnSel.routeKey,
        pwReturnSel.date,
        pwRetResultFiltered.perRouteByDate.get(pwReturnSel.routeKey)?.get(pwReturnSel.date),
        pwRoundTripFiltered,
      ).filter((it) => passesItineraryFilters(it, filterRet))
      const cur = opts[pwReturnSel.pickedIdx ?? 0]
      if (!cur) {
        if (opts.length) setPwReturnSel({ routeKey: pwReturnSel.routeKey, date: pwReturnSel.date, pickedIdx: 0, selectedItinerary: opts[0] })
      } else if (!passesItineraryFilters(cur, filterRet)) {
        if (opts.length) setPwReturnSel({ routeKey: pwReturnSel.routeKey, date: pwReturnSel.date, pickedIdx: 0, selectedItinerary: opts[0] })
      }
    }
  }, [
    searchGoal,
    tripType,
    filterOut,
    filterRet,
    pwOutResultFiltered,
    pwRetResultFiltered,
    pwOutboundSel,
    pwReturnSel,
    pwRoundTripFiltered,
    pwRoundTripDeepenStates,
  ])

  // Resolve the user's explicitly selected return cell into an itinerary + date,
  // so outbound panels can build a precise round-trip Google Flights link.
  const pwReturnSelResolved = useMemo(() => {
    if (!pwReturnSel || !pwRetResultFiltered) return null
    if (pwReturnSel.selectedItinerary) {
      return { it: pwReturnSel.selectedItinerary, date: pwReturnSel.date }
    }
    const opts = pwOutboundSel
      ? returnItinerariesForCell(
          pwOutboundSel.routeKey,
          pwOutboundSel.date,
          pwReturnSel.routeKey,
          pwReturnSel.date,
          pwRetResultFiltered.perRouteByDate.get(pwReturnSel.routeKey)?.get(pwReturnSel.date),
          pwRoundTripFiltered,
        )
      : []
    const it = opts[pwReturnSel.pickedIdx ?? 0] ?? opts[0]
    if (it) return { it, date: pwReturnSel.date }
    const bucket = pwRetResultFiltered.perRouteByDate.get(pwReturnSel.routeKey)?.get(pwReturnSel.date)
    return bucket ? { it: bucket.bestItinerary, date: pwReturnSel.date } : null
  }, [pwReturnSel, pwRetResultFiltered, pwOutboundSel, pwRoundTripFiltered])

  const activeFilterSummaryLine = useMemo(() => {
    const parts: string[] = []
    if (outStopsMin.trim()) parts.push(`out stops ≥ ${outStopsMin}`)
    if (outStopsMax.trim()) parts.push(`out stops ≤ ${outStopsMax}`)
    if (retStopsMin.trim()) parts.push(`ret stops ≥ ${retStopsMin}`)
    if (retStopsMax.trim()) parts.push(`ret stops ≤ ${retStopsMax}`)
    if (outPrice.min.trim()) parts.push(`out price ≥ ${outPrice.min}`)
    if (outPrice.max.trim()) parts.push(`out price ≤ ${outPrice.max}`)
    if (retPrice.min.trim()) parts.push(`ret price ≥ ${retPrice.min}`)
    if (retPrice.max.trim()) parts.push(`ret price ≤ ${retPrice.max}`)
    if (outHours.minLayover.trim()) parts.push(`layover ≥ ${outHours.minLayover}h`)
    if (outHours.maxLayover.trim()) parts.push(`layover ≤ ${outHours.maxLayover}h`)
    if (outHours.maxTotal.trim()) parts.push(`out trip ≤ ${outHours.maxTotal}h`)
    if (outHours.minTotal.trim()) parts.push(`out trip ≥ ${outHours.minTotal}h`)
    if (retHours.maxTotal.trim()) parts.push(`ret trip ≤ ${retHours.maxTotal}h`)
    if (retHours.minTotal.trim()) parts.push(`ret trip ≥ ${retHours.minTotal}h`)
    if (outTimeRange.takeoffMin.trim() || outTimeRange.takeoffMax.trim()) {
      parts.push(`out takeoff ${outTimeRange.takeoffMin || '…'}–${outTimeRange.takeoffMax || '…'}`)
    }
    if (retTimeRange.takeoffMin.trim() || retTimeRange.takeoffMax.trim()) {
      parts.push(`ret takeoff ${retTimeRange.takeoffMin || '…'}–${retTimeRange.takeoffMax || '…'}`)
    }
    if (timeBucketsOut.size > 0) parts.push(`${timeBucketsOut.size} out time bucket${timeBucketsOut.size === 1 ? '' : 's'}`)
    if (timeBucketsRet.size > 0) parts.push(`${timeBucketsRet.size} ret time bucket${timeBucketsRet.size === 1 ? '' : 's'}`)
    if (airlineExcludedCodes.size > 0) {
      parts.push(`${airlineExcludedCodes.size} airline${airlineExcludedCodes.size === 1 ? '' : 's'} excluded`)
    }
    if (aircraftSelectedCodes.length > 0) {
      parts.push(`${aircraftSelectedCodes.length} aircraft (${aircraftMatchMode})`)
    }
    if (returnCustomFilters) parts.push('return filters on')
    if (layoverGeoFilterActive) parts.push('layover geo on')
    if (displayTimezone) parts.push(`tz ${displayTimezone}`)
    return parts.length ? parts.join(' · ') : null
  }, [
    outStopsMin,
    outStopsMax,
    retStopsMin,
    retStopsMax,
    outPrice,
    retPrice,
    outHours.minLayover,
    outHours.maxLayover,
    outHours.maxTotal,
    outHours.minTotal,
    retHours.maxTotal,
    retHours.minTotal,
    outTimeRange.takeoffMin,
    outTimeRange.takeoffMax,
    retTimeRange.takeoffMin,
    retTimeRange.takeoffMax,
    timeBucketsOut,
    timeBucketsRet,
    airlineExcludedCodes,
    aircraftSelectedCodes,
    aircraftMatchMode,
    returnCustomFilters,
    layoverGeoFilterActive,
    displayTimezone,
  ])

  const outboundInsightStats = useMemo(() => itineraryInsightStats(displayOut), [displayOut])

  const searchSummaryStats = useMemo(() => {
    if (searchGoal !== 'priceWindow' || !hasSearched) return outboundInsightStats
    const routeCount = pwOutResultFiltered?.routeKeyOrder?.length ?? 0
    if (routeCount === 0 && !pwRoundTripPairMeta.length && !pwRoundTripCombos.length) {
      return outboundInsightStats
    }
    const prices: number[] = []
    for (const m of pwRoundTripPairMetaFiltered) {
      const p = m.globalInitialMin
      if (p != null && p > 0) prices.push(p)
    }
    for (const c of pwRoundTripFiltered) {
      if (c.roundTripPrice > 0) prices.push(c.roundTripPrice)
    }
    prices.sort((a, b) => a - b)
    return {
      count: routeCount,
      cheapest: prices[0] ?? null,
      medianPrice: prices.length ? prices[Math.floor(prices.length / 2)] ?? null : null,
      highest: prices.length ? prices[prices.length - 1] ?? null : null,
      fastestMins: null,
      medianMins: null,
      slowestMins: null,
    }
  }, [
    searchGoal,
    hasSearched,
    outboundInsightStats,
    pwOutResultFiltered,
    pwRoundTripPairMeta,
    pwRoundTripCombos,
    pwRoundTripPairMetaFiltered,
    pwRoundTripFiltered,
  ])

  const pwEmptyGridHint = useMemo((): string | null => {
    if (searchGoal !== 'priceWindow' || !hasSearched || loading) return null
    const hasRaw =
      pwRoundTripPairMeta.length > 0 ||
      pwRoundTripCombos.length > 0 ||
      pwRawOutPerDate.length > 0
    if (!hasRaw) return null
    const visibleRoutes = pwOutResultFiltered?.routeKeyOrder?.length ?? 0
    if (visibleRoutes > 0) return null
    const unfilteredRoutes = routeKeysFromPairMeta(pwRoundTripPairMetaInWindow).length
    if (unfilteredRoutes > 0) {
      return 'Cached routes loaded, but sidebar filters hide every route. Reset price, stops, duration, airline, or layover filters to see the heatmap.'
    }
    return null
  }, [
    searchGoal,
    hasSearched,
    loading,
    pwRoundTripPairMeta,
    pwRoundTripCombos,
    pwRawOutPerDate,
    pwOutResultFiltered,
    pwRoundTripPairMetaInWindow,
  ])

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

  const airlineItinCountsOut = useMemo(
    () =>
      itineraryCountsByAirline(
        searchGoal === 'priceWindow' && tripType === 'round' ? filterPoolOut : displayOut,
      ),
    [searchGoal, tripType, filterPoolOut, displayOut],
  )
  const airlineItinCountsRet = useMemo(
    () =>
      itineraryCountsByAirline(
        searchGoal === 'priceWindow' && tripType === 'round' ? filterPoolRet : displayReturn,
      ),
    [searchGoal, tripType, filterPoolRet, displayReturn],
  )

  /** Total vs filter-passing counts for the current price-window grid (always visible). */
  const pwGridVisibilityStats = useMemo(() => {
    if (searchGoal !== 'priceWindow' || tripType !== 'round' || pwRoundTripDeepenStates.length === 0) {
      return null
    }
    const pool = buildRtFilterPool(pwRoundTripDeepenStates, pwRoundTripCombosInWindow)
    const airlineOk = (it: NormalizedItinerary) => passesAirlineResultFilter(it, airlineExcludedCodes)
    const outboundPassing = pool.outbound.filter(
      (it) => airlineOk(it) && passesRtOutboundLegFilter(it, pwRtFilterOpts),
    ).length
    const airlineCombos = pwRoundTripCombosInWindow.filter(
      (c) => airlineOk(c.outIt) && airlineOk(c.retIt),
    )
    const outboundPassingCombos = airlineCombos.filter((c) =>
      passesRtOutboundLegFilter(c.outIt, pwRtFilterOpts),
    )
    const rawReturnItineraries = outboundPassingCombos.length
    const filteredReturnItineraries = outboundPassingCombos.filter((c) =>
      passesRtReturnLegFilter(c.retIt, pwRtFilterOpts),
    ).length
    const filteredRoundTrips = pwRoundTripFiltered.length
    return {
      outboundPassing,
      rawReturnItineraries,
      filteredReturnItineraries,
      filteredRoundTrips,
    }
  }, [
    searchGoal,
    tripType,
    pwRoundTripDeepenStates,
    pwRoundTripCombosInWindow,
    pwRoundTripFiltered,
    airlineExcludedCodes,
    pwRtFilterOpts,
  ])

  const outPaginationKey = useMemo(() => displayOut.map(itineraryScheduleKey).join('\u001e'), [displayOut])
  const retPaginationKey = useMemo(() => displayReturn.map(itineraryScheduleKey).join('\u001e'), [displayReturn])


  const runSearch = useCallback(async () => {
    setError(null)
    setCacheHint(null)
    setSearchProgress(null)

    if (searchSource === 'api' && !settings.mockMode && !settings.apiKey.trim()) {
      setError('Add your SerpApi key in Settings or enable mock mode.')
      return
    }
    if (!origins.length || !destinations.length) {
      setError('Select at least one origin and one destination airport.')
      return
    }

    setHasSearched(true)
    clearSerpSearchStop()
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
      adults: paxCounts.adults,
      children: paxCounts.children,
      cabinClass,
    }

    let serpDebugOutbound: SerpSearchDebugBundle | null = null
    let serpDebugRoundTrip: SerpSearchDebugBundle | null = null

    try {
      if (tripType === 'round') {
        const rtCacheBase = {
          origins,
          destinations,
          maxSegments: API_MAX_SEGMENTS,
          mockMode: settings.mockMode,
          paxDesc,
        }
        const { pairs } = buildFilteredRoundTripDatePairs(
          outboundDate,
          outboundEnd,
          returnDate,
          returnEnd,
          null,
        )
        if (!pairs.length) {
          setError('No valid round-trip date pairs in the selected windows.')
          return
        }

        let combos: RoundTripCombo[] = []

        if (searchSource === 'db') {
          if (settings.mockMode) {
            setRawOut([])
            setRawReturn([])
            setError('Mock mode has no SQLite cache. Use Search API or disable mock mode in Settings.')
            return
          }
          for (const { outDate, retDate } of pairs) {
            const cached = await loadRtPairCacheEntry(
              { ...rtCacheBase, outDate, retDate },
              { allowStale: true },
            )
            if (cached) {
              combos.push(...cached.payload.combos)
              continue
            }
            const rows =
              (await loadCachedSplitFallback(
                withPax({
                  direction: 'roundTrip',
                  origins,
                  destinations,
                  centerDate: outDate,
                  returnDate: retDate,
                  flexDays: 0,
                  maxSegments: API_MAX_SEGMENTS,
                  mockMode: settings.mockMode,
                }),
              )) ?? []
            combos.push(...roundTripCombosFromItineraries(rows))
          }
          if (!combos.length) {
            setRawOut([])
            setRawReturn([])
            setError(
              'No cached round-trip data for these date pairs. Run Search API once (Routing discovery or Price window) with the same route, dates, and passengers.',
            )
            return
          }
          setCacheHint(
            `Round-trip cache: ${combos.length} combo${combos.length === 1 ? '' : 's'} across ${pairs.length} date pair${pairs.length === 1 ? '' : 's'}.`,
          )
        } else {
          const rtRes = await searchPriceWindowRoundTrip(
            {
              origins,
              destinations,
              startDate: outboundDate,
              endDate: outboundEnd,
              returnStartDate: returnDate,
              returnEndDate: returnEnd,
              maxSegments: API_MAX_SEGMENTS,
              mockMode: settings.mockMode,
              apiKey: settings.apiKey,
              maxTotalHours: emptyToNull(outHours.maxTotal),
              showHidden: settings.showHidden,
              deepSearch: settings.deepSearch,
              gl: settings.gl,
              hl: settings.hl,
              currency: settings.currency,
              adults: paxCounts.adults,
              children: paxCounts.children,
              cabinClass,
              roundTripSortMode: 'both',
              searchMode: 'fast',
            },
            {
              destinations,
              excludedAirports: PIPELINE_EXCLUDED_NONE,
            },
            (state) => setSearchProgress(state),
          )
          combos = rtRes.combos
          serpDebugRoundTrip = rtRes.serpDebug
          setSerpCapture({ outbound: null, return: null })
          if (!settings.mockMode && rtRes.pairDeepenStates.length > 0) {
            await persistRoundTripPairs(rtCacheBase, rtRes.pairDeepenStates, rtRes.pairMeta, tzByIata)
          }
          if (rtRes.pausedEarly) {
            setCacheHint(
              `Round-trip search paused (${rtRes.pairsCompleted ?? '?'}/${rtRes.pairsTotal ?? '?'} pairs). ${rtRes.pauseReason ?? ''}`,
            )
          } else {
            setCacheHint(
              `Round-trip scan: ${rtRes.pairMeta.length} date pair${rtRes.pairMeta.length === 1 ? '' : 's'} (SerpApi type 1, bundled fares).`,
            )
          }
        }

        const lists = discoveryListsFromCombos(combos)
        setRawOut(lists.outbound)
        setRawReturn(lists.return)

        const outCount = lists.outbound.length
        const retCount = lists.return.length
        if (outCount > 0 || retCount > 0) {
          void recordSearchHistory(
            {
              v: 1,
              origins: [...origins],
              destinations: [...destinations],
              tripType: 'round',
              searchGoal: 'discovery',
              outboundDate,
              outboundEnd,
              returnDate,
              returnEnd,
              adultCount: paxCounts.adults,
              childrenCount: paxCounts.children,
              searchSource,
              mockMode: settings.mockMode,
              deepSearch: settings.deepSearch,
              showHidden: settings.showHidden,
              gl: settings.gl,
              hl: settings.hl,
              currency: settings.currency,
            },
            outCount,
            retCount,
          )
        }

        if (searchSource === 'api' && serpDebugRoundTrip) {
          const { data } = buildSerpCapturePersistPayload({
            summary: {
              searchGoal: 'discovery',
              origins,
              destinations,
              outboundDate,
              outboundEnd,
              returnDate,
              returnEnd,
            },
            outbound: null,
            return: null,
            roundTrip: serpDebugRoundTrip,
          })
          void saveSerpApiSearchCapture(
            {
              mockMode: settings.mockMode,
              origins,
              destinations,
              outboundDate,
              outboundEnd,
              returnDate,
              returnEnd,
              deepSearch: settings.deepSearch,
              showHidden: settings.showHidden,
              gl: settings.gl,
              hl: settings.hl,
              currency: settings.currency,
              searchGoal: 'discovery',
            },
            data,
          )
        }
        return
      }

      const outParts = {
        direction: 'outbound' as const,
        origins,
        destinations,
        centerDate: outCenter,
        flexDays: outFlex,
        maxSegments: API_MAX_SEGMENTS,
        mockMode: settings.mockMode,
      }

      let out: NormalizedItinerary[] | null = null

      if (searchSource === 'db') {
        if (settings.mockMode) {
          setRawOut([])
          setRawReturn([])
          setError('Mock mode has no SQLite cache. Use Search API or disable mock mode in Settings.')
          return
        }
        out = await loadCachedSplitFallback(withPax(outParts))
        if (!out?.length) {
          // Fallback: try per-date cache rows (written by Price Window searches)
          const window = dateWindow(outParts.centerDate, outParts.flexDays)
          const perDateFallback: NormalizedItinerary[][] = []
          for (const date of window) {
            const cached = await loadCachedSplitFallback(withPax({ ...outParts, centerDate: date, flexDays: 0 }))
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
            'No cached snapshot for this search. Run Search API once with the same origins, destinations, dates, flex ± days, passengers, max segments, and Settings (gl / hl / currency / deep search / show hidden).',
          )
          return
        }
      } else {
        const outRes = await searchDirection(
          { ...baseInput, centerDate: outCenter, maxSegments: API_MAX_SEGMENTS },
          'outbound',
          {
            destinations,
            roundTrip: false,
            excludedAirports: PIPELINE_EXCLUDED_NONE,
            sort: sortOut,
          },
          (state) => setSearchProgress(state),
        )
        out = outRes.itineraries
        serpDebugOutbound = outRes.serpDebug
        setSerpCapture({ outbound: outRes.serpDebug, return: null })
        if (!settings.mockMode) {
          // Persist merged discovery row (discovery DB-load key)
          void persistSearch(withPax(outParts), outRes.itineraries, tzByIata)
          // Also persist per-date rows so Price Window DB-load can read them
          for (const { date, itineraries } of outRes.perDate) {
            void persistSearch(withPax({ ...outParts, centerDate: date, flexDays: 0 }), itineraries, tzByIata)
          }
        }
      }
      setRawOut(out)
      setRawReturn([])

      const outCount = out?.length ?? 0
      const retCount = 0
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
          adultCount: paxCounts.adults,
          childrenCount: paxCounts.children,
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
        const { data } = buildSerpCapturePersistPayload({
          summary: {
            searchGoal: 'discovery',
            origins,
            destinations,
            outboundDate,
            outboundEnd,
            returnDate: null,
            returnEnd: null,
          },
          outbound: serpDebugOutbound,
          return: null,
        })
        void saveSerpApiSearchCapture(
          {
            mockMode: settings.mockMode,
            origins,
            destinations,
            outboundDate,
            outboundEnd,
            returnDate: null,
            returnEnd: null,
            deepSearch: settings.deepSearch,
            showHidden: settings.showHidden,
            gl: settings.gl,
            hl: settings.hl,
            currency: settings.currency,
            searchGoal: 'discovery',
          },
          data,
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Search failed'
      setError(msg.includes('\n') ? msg : formatSerpThrottleHelp(msg))
    } finally {
      setLoading(false)
      setSearchProgress(null)
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
    sortOut,
    sortReturn,
    searchSource,
    loadCached,
    loadCachedSplitFallback,
    persistSearch,
    persistRoundTripPairs,
    loadRtPairCacheEntry,
    saveSerpApiSearchCapture,
    tzByIata,
    outHours,
    paxDesc,
    recordSearchHistory,
  ])

  const runPriceWindowSearch = useCallback(async (runOpts?: {
    sortMode?: RoundTripSortMode
    alsoSearchOneWay?: boolean
    searchMode?: PriceWindowSearchMode
    pairFilters?: PriceWindowPairFilters
    replaceOutbound?: boolean
  }) => {
    const activeSortMode = runOpts?.sortMode ?? pwRtSortMode
    const activeAlsoOneWay = runOpts?.alsoSearchOneWay === true
    const activeSearchMode = runOpts?.searchMode ?? pwSearchMode
    const activePairFilters = runOpts?.pairFilters ?? pwPairFilters
    const replaceOutbound = runOpts?.replaceOutbound === true

    const bounds: PriceWindowDateBounds | null =
      tripType === 'round'
        ? {
            outboundStart: outboundDate,
            outboundEnd: outboundEnd,
            returnStart: returnDate,
            returnEnd: returnEnd,
          }
        : null
    const existingInWindow = pwDeepenStatesRef.current.filter((s) =>
      bounds ? isDatePairInBounds(s.outDate, s.retDate, bounds) : true,
    )
    const hasExistingGrid = existingInWindow.length > 0
    const pwTranche = resolvePwSearchTranche(replaceOutbound, hasExistingGrid)
    const useTranche = tripType === 'round' && searchSource === 'api'

    setError(null)
    setCacheHint(null)
    setSearchProgress(null)

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
    clearSerpSearchStop()
    setLoading(true)
    setPwActivityMessage(null)
    // Seed only for continue-tranche (grid already has combos). Refresh / airline scans
    // start empty so each re-fetched return shows in the activity ticker.
    if (useTranche && pwTranche === 'continue') {
      const snap = snapshotCombos(pwRoundTripCombos)
      seenComboKeysRef.current = new Set(snap.keys())
      refreshBeforeSnapRef.current = snap
    } else {
      seenComboKeysRef.current = new Set()
      refreshBeforeSnapRef.current = new Map()
    }
    await new Promise<void>((r) => setTimeout(r, 0))
    setSerpCapture({ outbound: null, return: null })
    setPwOutboundSel(null)
    setPwReturnSel(null)

    const clearPwGrid =
      searchSource === 'api' && (replaceOutbound || pwTranche === 'initial')
    if (clearPwGrid) {
      setPwRawOutPerDate([])
      setPwRawRetPerDate([])
      setPwRoundTripCombos([])
      setPwRoundTripPairMeta([])
      setPwRoundTripDeepenStates([])
      pwDeepenStatesRef.current = []
    }
    if (clearPwGrid) {
      setRawOut([])
      setRawReturn([])
    }

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
        paxDesc,
      } as const
    }

    function pwRtHashParts(origs: string[], dests: string[], outDate: string, retDate: string) {
      return {
        direction: 'roundTrip' as const,
        origins: origs,
        destinations: dests,
        centerDate: outDate,
        returnDate: retDate,
        flexDays: 0,
        maxSegments: API_MAX_SEGMENTS,
        mockMode: settings.mockMode,
        paxDesc,
      }
    }

    const serpCtx = {
      destinations,
      roundTrip: tripType === 'round',
      excludedAirports: PIPELINE_EXCLUDED_NONE,
    }

    try {
      if (searchSource === 'api' && !settings.mockMode) {
        const hourUsed =
          serpUsageState.status === 'ok' ? (serpUsageState.data.this_hour_searches ?? 0) : 0
        const accountHourLimit =
          serpUsageState.status === 'ok'
            ? serpUsageState.data.account_rate_limit_per_hour
            : undefined
        const hourLimit = effectivePwHourLimit(accountHourLimit, settings.pwHourlySerpCalls)
        const budget = createSerpHourBudget({
          hourLimit,
          baselineUsed: hourUsed,
          onChange: (snap) => {
            setSearchProgress((prev) =>
              prev
                ? {
                    ...prev,
                    hourUsed: snap.usedThisHour,
                    hourLimit: snap.hourLimit,
                    sessionCalls: snap.sessionCalls,
                    clickReserve: snap.clickReserve,
                    clickReserveRemaining: snap.clickReserveRemaining,
                    remainingForAutoDeepen: snap.remainingForAutoDeepen,
                  }
                : {
                    phase: 'roundTrip',
                    current: 0,
                    total: 1,
                    hourUsed: snap.usedThisHour,
                    hourLimit: snap.hourLimit,
                    sessionCalls: snap.sessionCalls,
                    clickReserve: snap.clickReserve,
                    clickReserveRemaining: snap.clickReserveRemaining,
                    remainingForAutoDeepen: snap.remainingForAutoDeepen,
                  },
            )
          },
        })
        if (tripType === 'round' && !useTranche && activeSearchMode === 'balanced') {
          budget.setClickReserve(PW_BALANCED_CLICK_RESERVE)
        }
        setActiveSerpHourBudget(budget)
      }

      // ── Database mode: load each date from SQLite cache ──────────────────
      if (searchSource === 'db') {
        setCacheHint('Loading round-trip cache from browser database…')
        if (tripType === 'round') {
          const { pairs } = buildFilteredRoundTripDatePairs(
            outboundDate,
            outboundEnd,
            returnDate,
            returnEnd,
            activePairFilters,
          )
          if (!pairs.length) {
            setError(
              'No date pairs match your filters. Widen trip length, increase sparse stride, or raise the pair cap.',
            )
            return
          }
          setSearchProgress({
            phase: 'roundTrip',
            current: 0,
            total: pairs.length,
            datePair: 'Reading rt_pair_cache…',
          })
          const combos: RoundTripCombo[] = []
          const pairMeta: RoundTripPairMeta[] = []
          const deepenStates: RoundTripPairDeepenState[] = []
          let pairsFromRtCache = 0
          let pairsFromSplitFallback = 0
          const rtCacheBase = {
            origins,
            destinations,
            maxSegments: API_MAX_SEGMENTS,
            mockMode: settings.mockMode,
            paxDesc,
          }
          const batchHits = await loadRtPairCacheBatchEntries(rtCacheBase, pairs, { allowStale: true })
          setSearchProgress({
            phase: 'roundTrip',
            current: pairs.length,
            total: pairs.length,
            datePair: `Loaded ${batchHits.length} cached date pair${batchHits.length === 1 ? '' : 's'}`,
          })
          const batchByCell = new Map(batchHits.map((h) => [`${h.outDate}|${h.retDate}`, h]))
          for (let pi = 0; pi < pairs.length; pi++) {
            const { outDate, retDate } = pairs[pi]!
            const cached = batchByCell.get(`${outDate}|${retDate}`)
            if (cached) {
              pairsFromRtCache++
              pairMeta.push(cached.payload.pairMeta)
              deepenStates.push(storedToDeepenState(cached.payload))
              if (cached.payload.combos.length) {
                combos.push(...cached.payload.combos)
              }
              continue
            }
            const rows =
              (await loadCachedSplitFallback(pwRtHashParts(origins, destinations, outDate, retDate))) ?? []
            if (rows.length) {
              pairsFromSplitFallback++
              combos.push(...roundTripCombosFromItineraries(rows))
            }
            if (pi > 0 && pi % 25 === 0) {
              await new Promise<void>((r) => setTimeout(r, 0))
            }
          }
          if (!combos.length && !pairMeta.length) {
            const cacheStats = await rtPairCacheRouteStatsFor({
              origins,
              destinations,
              maxSegments: API_MAX_SEGMENTS,
              mockMode: settings.mockMode,
              paxDesc,
            })
            const staleHint =
              cacheStats.routeStale > 0 && cacheStats.routeFresh === 0
                ? ` Found ${cacheStats.routeStale} cached row${cacheStats.routeStale === 1 ? '' : 's'} for this route but past cache TTL — raise Cache TTL in Settings or run API to refresh.`
                : ''
            const otherHint =
              cacheStats.totalFresh > 0 && cacheStats.routeFresh === 0 && cacheStats.routeStale === 0
                ? ` Cache has ${cacheStats.totalFresh} fresh row${cacheStats.totalFresh === 1 ? '' : 's'} for other routes.`
                : cacheStats.routeTotal === 0
                  ? ' No round-trip cache rows found in this browser yet.'
                  : cacheStats.routeTotal > 0
                    ? ` Found ${cacheStats.routeTotal} row${cacheStats.routeTotal === 1 ? '' : 's'} for this route but none matched the requested date pairs.`
                    : ''
            setError(
              `No cached round-trip data for ${pairs.length} date pair${pairs.length === 1 ? '' : 's'} ` +
                `(${origins.join('+')} → ${destinations.join('+')}, pax ${paxDesc}).` +
                otherHint +
                staleHint +
                ' Run Search with Source = API (same route, dates, passengers); results are saved after each scan.',
            )
            return
          }
          startTransition(() => {
            setPwRoundTripCombos(combos)
            if (pairMeta.length > 0) {
              setPwRoundTripPairMeta(pairMeta)
              setPwRoundTripDeepenStates(deepenStates)
              pwDeepenStatesRef.current = deepenStates
            } else {
              setPwRoundTripPairMeta([])
              setPwRoundTripDeepenStates([])
              pwDeepenStatesRef.current = []
            }
          })
          const filteredMeta = filterPairMetaListForDisplay(pairMeta, deepenStates, pwRtFilterOpts)
          const routesAfterFilters = new Set(
            filteredMeta.flatMap((m) => Object.keys(m.initialMinByRoute)),
          )
          const metaLine =
            pairMeta.length > 0 && !combos.length
              ? `${pairMeta.length} date pair${pairMeta.length === 1 ? '' : 's'} (initial scan — deepen cells for itineraries)`
              : `${combos.length} combo${combos.length === 1 ? '' : 's'} across ${pairs.length} date pair${pairs.length === 1 ? '' : 's'}`
          const srcBits = [
            pairsFromRtCache ? `${pairsFromRtCache} rt-pair cache` : '',
            pairsFromSplitFallback ? `${pairsFromSplitFallback} split fallback` : '',
          ].filter(Boolean)
          setCacheHint(
            `Round-trip cache: ${metaLine}${srcBits.length ? ` · ${srcBits.join(', ')}` : ''}.` +
              (pairMeta.length > 0 && routesAfterFilters.size === 0
                ? ' Sidebar filters hide every route — reset price/stops/time filters to see the grid.'
                : ''),
          )
          if (pairMeta.length > 0 && routesAfterFilters.size === 0) {
            setError(
              'Cached round-trip data loaded, but sidebar filters hide every route. Reset filters or choose a different config preset.',
            )
          }

          if (activeAlsoOneWay) {
            const outDates = pwDateRange(outboundDate, outboundEnd)
            const outPerDate: PriceWindowPerDateEntry[] = []
            for (const date of outDates) {
              const itineraries =
                (await loadCachedSplitFallback(pwHashParts('outbound', origins, destinations, date))) ?? []
              outPerDate.push({ date, itineraries })
            }
            setPwRawOutPerDate(outPerDate)
            const retDates = pwDateRange(returnDate, returnEnd)
            const retPerDate: PriceWindowPerDateEntry[] = []
            for (const date of retDates) {
              const itineraries =
                (await loadCachedSplitFallback(pwHashParts('return', destinations, origins, date))) ?? []
              retPerDate.push({ date, itineraries })
            }
            setPwRawRetPerDate(retPerDate)
            setCacheHint((h) => `${h ?? ''} One-way leg cache loaded for comparison.`)
          }
        } else {
          const outDates = pwDateRange(outboundDate, outboundEnd)
          const outPerDate: PriceWindowPerDateEntry[] = []
          for (const date of outDates) {
            const itineraries =
              (await loadCachedSplitFallback(pwHashParts('outbound', origins, destinations, date))) ?? []
            outPerDate.push({ date, itineraries })
          }
          if (!outPerDate.some((d) => d.itineraries.length > 0)) {
            setError('No cached price window data for outbound. Run Search API once with the same route and date window.')
            return
          }
          setPwRawOutPerDate(outPerDate)
          setRawOut(outPerDate.flatMap((d) => d.itineraries))
          setCacheHint('Price window loaded from cache.')
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
        adults: paxCounts.adults,
        children: paxCounts.children,
        cabinClass,
        expandWithinPctOfGlobalMin: settings.rtExpandWithinPctEnabled
          ? settings.rtExpandWithinPct
          : null,
      }

      let pwOutCount = 0
      let pwRetCount = 0
      let rtPaused = false
      let serpDebugPwOutbound: SerpSearchDebugBundle | null = null
      let serpDebugPwReturn: SerpSearchDebugBundle | null = null

      if (tripType === 'round') {
        const rtRes = await searchPriceWindowRoundTrip(
          {
            ...baseInput,
            returnStartDate: returnDate,
            returnEndDate: returnEnd,
            maxTotalHours: emptyToNull(outHours.maxTotal),
            roundTripSortMode: activeSortMode,
            searchMode: useTranche ? 'tranche' : activeSearchMode,
            pairFilters: activePairFilters,
            pwTranche: useTranche ? pwTranche : undefined,
            plannedHourlySerpCalls: useTranche ? settings.pwHourlySerpCalls : undefined,
            existingPairDeepenStates:
              useTranche && pwTranche === 'continue' ? existingInWindow : undefined,
            rtLegFilterOpts: pwRtFilterOpts,
          },
          serpCtx,
          (state) => setSearchProgress(state),
          (snap) => {
            pwPartialSnapRef.current = snap
            pwDeepenStatesRef.current = snap.pairDeepenStates
            // Activity ticker: immediately find and display the latest new combo
            const activity = drainActivityEvents(
              snap.pairDeepenStates,
              seenComboKeysRef.current,
              refreshBeforeSnapRef.current,
              settings.currency,
            )
            if (activity) setPwActivityMessage(activity)
            if (pwPartialUiTimerRef.current) return
            pwPartialUiTimerRef.current = setTimeout(() => {
              pwPartialUiTimerRef.current = null
              const latest = pwPartialSnapRef.current
              if (!latest) return
              setPwRoundTripPairMeta(latest.pairMeta)
              setPwRoundTripCombos(latest.combos)
            }, 2000)
          },
        )
        const filterLine =
          rtRes.pairFilterStats != null
            ? formatPairFilterStatsLine(rtRes.pairFilterStats, activePairFilters)
            : null
        setPwRoundTripCombos(rtRes.combos)
        setPwRoundTripPairMeta(rtRes.pairMeta)
        setPwRoundTripDeepenStates(rtRes.pairDeepenStates)
        serpDebugPwOutbound = rtRes.serpDebug
        setSerpCapture({ outbound: rtRes.serpDebug, return: null })
        pwOutCount = rtRes.pairMeta.length || rtRes.combos.length
        pwRetCount = pwOutCount

        let rtStatusLine = formatPriceWindowRoundTripStatus({
          mode: useTranche ? 'tranche' : activeSearchMode,
          pairMeta: rtRes.pairMeta,
          pairsTotal: rtRes.pairsTotal,
          pairsCompleted: rtRes.pairsCompleted,
          combosCount: rtRes.combos.length,
          autoDeepenedCells: rtRes.autoDeepenedCells,
          pausedEarly: rtRes.pausedEarly,
          pauseReason: rtRes.pauseReason,
          routesRemaining: rtRes.routesRemaining,
          filterLine,
        })
        if (rtRes.pausedEarly) {
          rtPaused = true
        } else if (!useTranche && activeSearchMode === 'balanced') {
          rtStatusLine += ` (${PW_BALANCED_CLICK_RESERVE} Serp calls reserved for cell clicks.)`
        }
        setCacheHint(rtStatusLine)

        if (useTranche && searchSource === 'api' && !settings.mockMode) {
          recordPwLastSearchAt()
          setPwLastSearchAgo(formatTimeSinceSearch(loadPwLastSearchAt()))
        }

        if (!settings.mockMode && rtRes.pairDeepenStates.length > 0) {
          if (pwPartialUiTimerRef.current) {
            clearTimeout(pwPartialUiTimerRef.current)
            pwPartialUiTimerRef.current = null
          }
          setCacheHint((h) => `${h ?? ''} · Saving cache…`)
          await new Promise<void>((r) => setTimeout(r, 0))
          await persistRoundTripPairs(
            {
              origins,
              destinations,
              maxSegments: API_MAX_SEGMENTS,
              mockMode: settings.mockMode,
              paxDesc,
            },
            rtRes.pairDeepenStates,
            rtRes.pairMeta,
            tzByIata,
            { flushToDisk: true },
          )
        }

        if (activeAlsoOneWay && !rtPaused) {
          const outRes = await searchPriceWindow(
            baseInput,
            'outbound',
            serpCtx,
            (state) => setSearchProgress(state),
          )
          setPwRawOutPerDate(outRes.perDate)
          if (!settings.mockMode) {
            for (const { date, itineraries } of outRes.perDate) {
              void persistSearch(pwHashParts('outbound', origins, destinations, date), itineraries, tzByIata)
            }
          }
          const retInput: PriceWindowSearchInput = {
            ...baseInput,
            origins: destinations,
            destinations: origins,
            startDate: returnDate,
            endDate: returnEnd,
            maxTotalHours: emptyToNull(effRetHours.maxTotal),
          }
          const retRes = await searchPriceWindow(
            retInput,
            'return',
            serpCtx,
            (state) => setSearchProgress(state),
          )
          setPwRawRetPerDate(retRes.perDate)
          serpDebugPwReturn = retRes.serpDebug
          setSerpCapture((prev) => ({
            outbound: prev.outbound,
            return: retRes.serpDebug,
          }))
          if (!settings.mockMode) {
            for (const { date, itineraries } of retRes.perDate) {
              void persistSearch(pwHashParts('return', destinations, origins, date), itineraries, tzByIata)
            }
          }
        }
      } else {
        const outRes = await searchPriceWindow(
          baseInput,
          'outbound',
          serpCtx,
          (state) => setSearchProgress(state),
        )
        setPwRawOutPerDate(outRes.perDate)
        setRawOut(outRes.perDate.flatMap((d) => d.itineraries))
        serpDebugPwOutbound = outRes.serpDebug
        setSerpCapture({ outbound: outRes.serpDebug, return: null })
        pwOutCount = outRes.perDate.reduce((s, d) => s + d.itineraries.length, 0)

        if (!settings.mockMode) {
          for (const { date, itineraries } of outRes.perDate) {
            void persistSearch(pwHashParts('outbound', origins, destinations, date), itineraries, tzByIata)
          }
        }
        setCacheHint(
          `One-way price window complete · ${outRes.perDate.length} outbound date${outRes.perDate.length === 1 ? '' : 's'} · ${pwOutCount} itineraries.`,
        )
      }

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
          adultCount: paxCounts.adults,
          childrenCount: paxCounts.children,
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

      if (searchSource === 'api' && (serpDebugPwOutbound || serpDebugPwReturn)) {
        const pwRtBundle =
          serpDebugPwOutbound?.direction === 'roundTrip' ? serpDebugPwOutbound : null
        const { data } = buildSerpCapturePersistPayload({
          summary: {
            searchGoal: 'priceWindow',
            origins,
            destinations,
            outboundDate,
            outboundEnd,
            returnDate: tripType === 'round' ? returnDate : null,
            returnEnd: tripType === 'round' ? returnEnd : null,
          },
          outbound: pwRtBundle ? null : serpDebugPwOutbound,
          return: pwRtBundle ? null : serpDebugPwReturn,
          roundTrip: pwRtBundle,
        })
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
            searchGoal: 'priceWindow',
          },
          data,
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Search failed'
      setError(msg.includes('\n') ? msg : formatSerpThrottleHelp(msg))
    } finally {
      setActiveSerpHourBudget(null)
      setLoading(false)
      setSearchProgress(null)
      setPwActivityMessage(null)
      seenComboKeysRef.current = new Set()
      if (!settings.mockMode) {
        setSearchRefreshKey((k) => k + 1)
        if (searchSource === 'api') void refreshSerpUsage()
      }
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
    outHours,
    effRetHours,
    searchSource,
    persistSearch,
    loadCached,
    loadCachedSplitFallback,
    loadRtPairCacheEntry,
    loadRtPairCacheBatchEntries,
    rtPairCacheRouteStatsFor,
    persistRoundTripPairs,
    tzByIata,
    recordSearchHistory,
    pwRtSortMode,
    pwSearchMode,
    pwPairFilters,
    pwRtFilterOpts,
    paxDesc,
    serpUsageState,
    refreshSerpUsage,
    saveSerpApiSearchCapture,
    settings.pwHourlySerpCalls,
  ])

  const validatePriceWindowRequest = useCallback((): boolean => {
    setError(null)
    if (searchSource === 'api' && !settings.mockMode && !settings.apiKey.trim()) {
      setError('Add your SerpApi key in Settings or enable mock mode.')
      return false
    }
    if (!origins.length || !destinations.length) {
      setError('Select at least one origin and one destination airport.')
      return false
    }
    if (outboundDate > outboundEnd) {
      setError('Outbound window: start date must be before end date.')
      return false
    }
    if (tripType === 'round' && returnDate > returnEnd) {
      setError('Return window: start date must be before end date.')
      return false
    }
    if (searchSource === 'db' && settings.mockMode) {
      setError('Mock mode has no SQLite cache. Use Search API or disable mock mode in Settings.')
      return false
    }
    if (searchSource === 'db' && !dbReady) {
      setError('Browser database is still opening. Wait a moment and try again.')
      return false
    }
    return true
  }, [
    searchSource,
    settings.mockMode,
    settings.apiKey,
    dbReady,
    origins.length,
    destinations.length,
    outboundDate,
    outboundEnd,
    tripType,
    returnDate,
    returnEnd,
  ])

  const applyPwDeepenStateList = useCallback((nextStates: RoundTripPairDeepenState[]) => {
    pwDeepenStatesRef.current = nextStates
    setPwRoundTripDeepenStates(nextStates)
    setPwRoundTripCombos(dedupeRoundTripCombos(nextStates.flatMap((s) => s.combos)))
    setPwRoundTripPairMeta(
      nextStates.map((s) =>
        pairMetaFromInternal({
          outDate: s.outDate,
          retDate: s.retDate,
          ranked: s.ranked,
          fetchedCount: s.fetchedCount,
          initialMinByRoute: s.initialMinByRoute,
          globalInitialMin: s.globalInitialMin,
        }),
      ),
    )
  }, [])

  const handleStopSerpSearch = useCallback(() => {
    requestSerpSearchStop()
    setCacheHint('Stopping — no new API calls after the current one finishes.')
  }, [])

  const pwSerpRunActive = loading || pwRefreshLoading || pwAirlineScanLoading

  const pwReturnFetchTokenNote = useMemo(() => {
    if (!pwSerpRunActive || !searchProgress) return null
    return formatReturnFetchTokenNote(searchProgress, pwRoundTripDeepenStates)
  }, [pwSerpRunActive, searchProgress, pwRoundTripDeepenStates])

  // ── Return-data refresh helpers ───────────────────────────────────────────
  /**
   * Diff combos from `states` against `seenKeys` (already emitted this run),
   * emit the most recent new-or-updated combo as an activity line. Mutates `seenKeys`.
   * `beforeSnap` supplies pre-run prices so re-fetches show as updates when the price moved.
   */
  function drainActivityEvents(
    states: RoundTripPairDeepenState[],
    seenKeys: Set<string>,
    beforeSnap: ComboSnapshot,
    currency: string,
  ): string | null {
    let latestEvent: SearchActivityEvent | null = null
    for (const s of states) {
      for (const c of s.combos) {
        const k = makeComboKey(c)
        if (seenKeys.has(k)) continue
        seenKeys.add(k)
        const oldPrice = beforeSnap.get(k)
        if (oldPrice !== undefined && oldPrice !== c.roundTripPrice) {
          latestEvent = { kind: 'returnUpdated', combo: c, oldPrice, currency }
        } else {
          latestEvent = { kind: 'returnAdded', combo: c, currency }
        }
      }
    }
    return latestEvent ? formatActivityEvent(latestEvent) : null
  }

  /**
   * Overwrite entries in `full` that appear in `refreshed` (matched by outDate+retDate),
   * leaving all other states unchanged. Used to splice refresh results back in.
   */
  function mergeDeepenStatesIntoFull(
    full: RoundTripPairDeepenState[],
    refreshed: RoundTripPairDeepenState[],
  ): RoundTripPairDeepenState[] {
    const refreshedMap = new Map(refreshed.map((s) => [`${s.outDate}|${s.retDate}`, s]))
    const merged = full.map((s) => refreshedMap.get(`${s.outDate}|${s.retDate}`) ?? s)
    // Append any refreshed states for pairs that weren't in `full` (new pair scans)
    for (const s of refreshed) {
      const key = `${s.outDate}|${s.retDate}`
      if (!full.some((f) => `${f.outDate}|${f.retDate}` === key)) merged.push(s)
    }
    return merged
  }

  // ── Return-data clear ─────────────────────────────────────────────────────
  /** Show the inline "Clear N combos?" confirm by counting affected combos. */
  const handleClearReturnData = useCallback(() => {
    setPwRefreshEstimate(null) // dismiss any open refresh estimate confirm
    const affected = pwRoundTripDeepenStates.filter((s) => {
      if (pwDateBounds && !isDatePairInBounds(s.outDate, s.retDate, pwDateBounds)) return false
      // Keep states that have at least one filter-passing ranked itinerary
      return s.filteredRankedCount == null ? s.ranked.length > 0 : s.filteredRankedCount > 0
    })
    const comboCount = affected.reduce((sum, s) => sum + s.combos.length, 0)
    setPwClearConfirmCount(comboCount)
  }, [pwRoundTripDeepenStates, pwDateBounds])

  /** Execute the clear: zero out combos + fetchedCount for filter-matching states. */
  const confirmClearReturnData = useCallback(async () => {
    setPwClearConfirmCount(null)
    setPwRefreshStats(null)

    const clearedKeys = new Set<string>()
    const clearedStates = pwRoundTripDeepenStates
      .filter((s) => {
        if (pwDateBounds && !isDatePairInBounds(s.outDate, s.retDate, pwDateBounds)) return false
        return s.filteredRankedCount == null ? s.ranked.length > 0 : s.filteredRankedCount > 0
      })
      .map((s) => {
        clearedKeys.add(`${s.outDate}|${s.retDate}`)
        return { ...s, combos: [], fetchedCount: 0 } as RoundTripPairDeepenState
      })

    const merged = pwRoundTripDeepenStates.map((s) =>
      clearedKeys.has(`${s.outDate}|${s.retDate}`)
        ? clearedStates.find((c) => c.outDate === s.outDate && c.retDate === s.retDate)!
        : s,
    )
    applyPwDeepenStateList(merged)

    // Persist cleared states to SQLite
    await persistRoundTripPairs(
      { origins, destinations, maxSegments: API_MAX_SEGMENTS, mockMode: settings.mockMode, paxDesc },
      clearedStates,
      clearedStates.map((s) => pairMetaFromInternal(s)),
      tzByIata,
      { flushToDisk: true },
    )
  }, [
    pwRoundTripDeepenStates,
    pwDateBounds,
    applyPwDeepenStateList,
    persistRoundTripPairs,
    origins,
    destinations,
    settings.mockMode,
    paxDesc,
    tzByIata,
  ])

  // ── Refresh filtered returns ───────────────────────────────────────────────
  const runRefreshReturnsSearch = useCallback(async () => {
    if (settings.mockMode) {
      setError('Refresh is not available in mock mode.')
      return
    }
    if (!settings.apiKey.trim()) {
      setError('Add your SerpApi key in Settings before refreshing.')
      return
    }

    setError(null)
    setPwRefreshStats(null)
    clearSerpSearchStop()
    setPwRefreshLoading(true)

    // Snapshot before-state for stats comparison and price-delta activity messages
    const beforeSnap = snapshotCombos(pwRoundTripCombos)
    const beforeStates = [...pwRoundTripDeepenStates]
    setPwActivityMessage(null)
    seenComboKeysRef.current = new Set()
    refreshBeforeSnapRef.current = beforeSnap

    // Determine target date pairs: in-window states with filter-passing ranked entries.
    // Clear their combos + reset fetchedCount so the allocator re-fetches them.
    // Apply the current filter live (filteredRankedCount is stale when filters change
    // without re-running a search) and apply filter-first reorder so the allocator
    // fetches exactly 1 departure-token call per filter-passing route rather than
    // (rankedIndex+1) calls due to rank-walk overshoot on unordered ranked arrays.
    const clearedKeys = new Set<string>()
    const clearedStates = pwRoundTripDeepenStates
      .filter((s) => {
        if (pwDateBounds && !isDatePairInBounds(s.outDate, s.retDate, pwDateBounds)) return false
        // Use live filter instead of stale filteredRankedCount
        if (pwRtFilterOpts) {
          return s.ranked.some((r) => passesRtOutboundLegFilter(r.it, pwRtFilterOpts))
        }
        return s.ranked.length > 0
      })
      .map((s) => {
        clearedKeys.add(`${s.outDate}|${s.retDate}`)
        const base: RoundTripPairDeepenState = { ...s, combos: [], fetchedCount: 0 }
        if (!pwRtFilterOpts) return base
        // Filter-first reorder: put filter-passing unfetched outbounds first so the
        // allocator finds them at index 0 and needs only 1 SerpApi call per route.
        const reordered = reorderDeepenStateForLegFilters(base, pwRtFilterOpts)
        let count = 0
        for (const { it } of reordered.ranked) {
          if (passesRtOutboundLegFilter(it, pwRtFilterOpts)) count++
          else break
        }
        return { ...reordered, filteredRankedCount: count }
      })

    // Set up SerpApi hour budget (same system as regular price-window search)
    const hourUsed =
      serpUsageState.status === 'ok' ? (serpUsageState.data.this_hour_searches ?? 0) : 0
    const accountHourLimit =
      serpUsageState.status === 'ok'
        ? serpUsageState.data.account_rate_limit_per_hour
        : undefined
    const hourLimit = effectivePwHourLimit(accountHourLimit, settings.pwHourlySerpCalls)
    const budget = createSerpHourBudget({
      hourLimit,
      baselineUsed: hourUsed,
      onChange: (snap) => {
        setSearchProgress((prev) => prev ? { ...prev, hourUsed: snap.usedThisHour, hourLimit: snap.hourLimit } : null)
      },
    })
    setActiveSerpHourBudget(budget)

    const serpCtx = {
      excludedAirports: PIPELINE_EXCLUDED_NONE,
      destinations,
    }
    const baseInput: PriceWindowSearchInput = {
      origins,
      destinations,
      startDate: outboundDate,
      endDate: outboundEnd,
      maxSegments: API_MAX_SEGMENTS,
      mockMode: settings.mockMode,
      apiKey: settings.apiKey,
      maxTotalHours: null,
      showHidden: false,
      deepSearch: settings.deepSearch,
      gl: settings.gl,
      hl: settings.hl,
      currency: settings.currency,
      adults: paxCounts.adults,
      children: paxCounts.children,
      cabinClass,
      roundTripSortMode: pwRtSortMode,
      pairFilters: pwPairFilters,
      rtLegFilterOpts: pwRtFilterOpts,
      plannedHourlySerpCalls: settings.pwHourlySerpCalls,
    }

    try {
      const result = await refreshFilteredReturns(
        { ...baseInput, returnStartDate: returnDate, returnEndDate: returnEnd },
        clearedStates,
        serpCtx,
        (progress) => setSearchProgress({
          ...progress,
          // Surface the pre-computed estimate total so the progress bar can show
          // "N/total calls" instead of the internal pair-level counter.
          estimatedTotalCalls: pwRefreshEstimateTotalRef.current > 0
            ? pwRefreshEstimateTotalRef.current
            : undefined,
        }),
        (partial) => {
          const activity = drainActivityEvents(
            partial.pairDeepenStates,
            seenComboKeysRef.current,
            refreshBeforeSnapRef.current,
            settings.currency,
          )
          if (activity) setPwActivityMessage(activity)
          applyPwDeepenStateList(
            mergeDeepenStatesIntoFull(pwRoundTripDeepenStates, partial.pairDeepenStates),
          )
        },
      )

      // Merge refreshed states back into the full deepen state list
      const finalMerged = mergeDeepenStatesIntoFull(pwRoundTripDeepenStates, result.pairDeepenStates)
      applyPwDeepenStateList(finalMerged)

      // Persist to SQLite
      if (result.pairDeepenStates.length > 0) {
        await persistRoundTripPairs(
          { origins, destinations, maxSegments: API_MAX_SEGMENTS, mockMode: settings.mockMode, paxDesc },
          result.pairDeepenStates,
          result.pairMeta,
          tzByIata,
          { flushToDisk: true },
        )
      }

      // Compute and show stats
      const allAfterCombos = finalMerged.flatMap((s) => s.combos)
      const stats = computeRefreshStats(
        beforeSnap,
        beforeStates,
        finalMerged,
        allAfterCombos,
        pwRtFilterOpts,
        result.pairsScanned,
      )
      setPwRefreshStats(stats)

      if (result.pausedEarly) {
        setError(result.pauseReason ?? 'Refresh paused — partial results shown.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setActiveSerpHourBudget(null)
      setSearchProgress(null)
      setPwActivityMessage(null)
      seenComboKeysRef.current = new Set()
      pwRefreshEstimateTotalRef.current = 0
      setPwRefreshLoading(false)
      void refreshSerpUsage()
    }
  }, [
    settings,
    origins,
    destinations,
    outboundDate,
    outboundEnd,
    returnDate,
    returnEnd,
    pwRtSortMode,
    pwPairFilters,
    pwRtFilterOpts,
    pwRoundTripCombos,
    pwRoundTripDeepenStates,
    pwDateBounds,
    serpUsageState,
    applyPwDeepenStateList,
    persistRoundTripPairs,
    paxCounts,
    paxDesc,
    tzByIata,
    refreshSerpUsage,
  ])

  // ── Targeted airline scan (uses filter-panel airline selection) ───────────
  const runAirlineTargetedScanCallback = useCallback(async () => {
    const codes = pwIncludedAirlineCodes
    if (codes.length === 0) {
      setError('No valid IATA airline codes for the selected airlines (SerpApi requires 2-letter codes like QR).')
      return
    }
    clearSerpSearchStop()
    setPwAirlineScanLoading(true)
    setPwRefreshStats(null)
    setError(null)
    setPwActivityMessage(null)
    const beforeSnap = snapshotCombos(pwRoundTripCombos)
    seenComboKeysRef.current = new Set()
    refreshBeforeSnapRef.current = beforeSnap

    const hourUsed =
      serpUsageState?.status === 'ok' ? (serpUsageState.data.this_hour_searches ?? 0) : 0
    const accountHourLimit =
      serpUsageState?.status === 'ok'
        ? serpUsageState.data.account_rate_limit_per_hour
        : undefined
    const hourLimit = effectivePwHourLimit(accountHourLimit, settings.pwHourlySerpCalls)
    const budget = createSerpHourBudget({
      hourLimit,
      baselineUsed: hourUsed,
      onChange: (snap) => {
        setSearchProgress((prev) =>
          prev
            ? {
                ...prev,
                hourUsed: snap.usedThisHour,
                hourLimit: snap.hourLimit,
                sessionCalls: snap.sessionCalls,
              }
            : null,
        )
      },
    })
    setActiveSerpHourBudget(budget)
    setSearchProgress({
      phase: pwAirlineScanReturnOnly ? 'returnFetch' : 'pairScan',
      current: 0,
      total: 0,
      includeAirlines: codes,
    })

    const serpCtx = {
      excludedAirports: PIPELINE_EXCLUDED_NONE,
      destinations,
    }
    const scanInput: PriceWindowSearchInput & {
      returnStartDate: string
      returnEndDate: string
      targetAirlines: string[]
      scanMode: 'outboundAndReturn' | 'returnOnly'
    } = {
      origins,
      destinations,
      startDate: outboundDate,
      endDate: outboundEnd,
      returnStartDate: returnDate,
      returnEndDate: returnEnd,
      maxSegments: API_MAX_SEGMENTS,
      mockMode: settings.mockMode,
      apiKey: settings.apiKey,
      maxTotalHours: null,
      showHidden: false,
      deepSearch: false,
      gl: settings.gl,
      hl: settings.hl,
      currency: settings.currency,
      adults: paxCounts.adults,
      children: paxCounts.children,
      cabinClass,
      roundTripSortMode: pwRtSortMode,
      pairFilters: pwPairFilters,
      rtLegFilterOpts: pwRtFilterOpts,
      targetAirlines: codes,
      scanMode: pwAirlineScanReturnOnly ? 'returnOnly' : 'outboundAndReturn',
    }

    try {
      const result = await runAirlineTargetedScan(
        scanInput,
        pwRoundTripDeepenStates,
        serpCtx,
        (progress) => setSearchProgress(progress),
        (partial) => {
          const activity = drainActivityEvents(
            partial.pairDeepenStates,
            seenComboKeysRef.current,
            refreshBeforeSnapRef.current,
            settings.currency,
          )
          if (activity) setPwActivityMessage(activity)
          applyPwDeepenStateList(
            mergeDeepenStatesIntoFull(pwRoundTripDeepenStates, partial.pairDeepenStates),
          )
        },
      )

      const finalMerged = mergeDeepenStatesIntoFull(pwRoundTripDeepenStates, result.pairDeepenStates)
      applyPwDeepenStateList(finalMerged)

      if (result.pausedEarly) {
        setError(result.pauseReason ?? 'Filtered airline refresh paused — partial results shown.')
      }

      if (result.pairDeepenStates.length > 0) {
        await persistRoundTripPairs(
          { origins, destinations, maxSegments: API_MAX_SEGMENTS, mockMode: settings.mockMode, paxDesc },
          result.pairDeepenStates,
          result.pairDeepenStates.map((s) => pairMetaFromInternal(s)),
          tzByIata,
          { flushToDisk: true },
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Filtered airline refresh failed')
    } finally {
      setActiveSerpHourBudget(null)
      setSearchProgress(null)
      setPwActivityMessage(null)
      setPwAirlineScanLoading(false)
      void refreshSerpUsage()
    }
  }, [
    pwIncludedAirlineCodes,
    pwAirlineScanReturnOnly,
    settings,
    origins,
    destinations,
    outboundDate,
    outboundEnd,
    returnDate,
    returnEnd,
    pwRtSortMode,
    pwPairFilters,
    pwRtFilterOpts,
    pwRoundTripDeepenStates,
    pwRoundTripCombos,
    serpUsageState,
    applyPwDeepenStateList,
    persistRoundTripPairs,
    paxCounts,
    paxDesc,
    tzByIata,
    refreshSerpUsage,
  ])

  // ── Refresh call estimate ──────────────────────────────────────────────────
  /**
   * Compute an estimate of the API calls needed for "Refresh filtered returns"
   * without making any network requests.  Called synchronously when the user
   * clicks the button so they can confirm before anything fires.
   */
  const computePwRefreshEstimate = useCallback((): RefreshEstimate => {
    const { pairs } = buildFilteredRoundTripDatePairs(
      outboundDate,
      outboundEnd,
      returnDate,
      returnEnd,
      pwPairFilters,
    )
    const deepenByKey = new Map(
      pwRoundTripDeepenStates.map((s) => [`${s.outDate}|${s.retDate}`, s]),
    )
    const scanCallsPerPair = pwRtSortMode === 'both' ? 2 : 1
    let pairsNeedingScan = 0
    let newReturnTokens = 0
    let refreshTokens = 0
    for (const { outDate, retDate } of pairs) {
      const state = deepenByKey.get(`${outDate}|${retDate}`)
      if (!state || state.ranked.length === 0) {
        pairsNeedingScan++
        continue
      }
      // Apply the CURRENT filter live instead of trusting state.filteredRankedCount,
      // which is only updated during a search reorder — not when filters change in the UI.
      const tokenCount = pwRtFilterOpts
        ? state.ranked.filter((r) => passesRtOutboundLegFilter(r.it, pwRtFilterOpts)).length
        : state.ranked.length
      if (tokenCount === 0) continue
      if (state.combos.length === 0) {
        newReturnTokens += tokenCount
      } else {
        refreshTokens += tokenCount
      }
    }
    return {
      pairsNeedingScan,
      pairScanCalls: pairsNeedingScan * scanCallsPerPair,
      newReturnTokens,
      refreshTokens,
      totalCalls: pairsNeedingScan * scanCallsPerPair + newReturnTokens + refreshTokens,
    }
  }, [outboundDate, outboundEnd, returnDate, returnEnd, pwPairFilters, pwRoundTripDeepenStates, pwRtSortMode, pwRtFilterOpts])

  /** First-click handler: compute estimate and show inline confirm (no API calls yet). */
  const handleRefreshEstimate = useCallback(() => {
    setPwClearConfirmCount(null)
    const estimate = computePwRefreshEstimate()
    pwRefreshEstimateTotalRef.current = estimate.totalCalls
    setPwRefreshEstimate(estimate)
  }, [computePwRefreshEstimate])

  const requestPriceWindowSearch = useCallback(() => {
    if (!validatePriceWindowRequest()) return
    if (searchGoal === 'priceWindow' && searchSource === 'api' && !settings.mockMode) {
      startTransition(() => setPwSearchConfirmOpen(true))
      return
    }
    void runPriceWindowSearch(searchGoal === 'priceWindow' && tripType === 'round' ? { searchMode: 'tranche' } : undefined)
  }, [
    validatePriceWindowRequest,
    searchGoal,
    searchSource,
    settings.mockMode,
    tripType,
    runPriceWindowSearch,
  ])

  const handlePwSearchProceed = useCallback(
    (opts: { sortMode: RoundTripSortMode; pairFilters: PriceWindowPairFilters }) => {
      setPwRtSortMode(opts.sortMode)
      saveRoundTripSortMode(opts.sortMode)
      setPwPairFilters(opts.pairFilters)
      savePriceWindowPairFilters(opts.pairFilters)
      setPwSearchConfirmOpen(false)
      if (searchSource !== 'api') setSearchSource('api')
      const runOpts = {
        sortMode: opts.sortMode,
        alsoSearchOneWay: false,
        pairFilters: opts.pairFilters,
        replaceOutbound: pwReplaceOutbound,
        searchMode: tripType === 'round' ? ('tranche' as const) : pwSearchMode,
      }
      requestAnimationFrame(() => {
        void runPriceWindowSearch(runOpts)
      })
    },
    [runPriceWindowSearch, searchSource, tripType, pwSearchMode, pwReplaceOutbound],
  )

  const applySearchHistory = useCallback(
    async (row: SearchHistoryRow) => {
      const s = row.snapshot
      const snapPax = clampPaxCounts({
        adults: s.adultCount ?? DEFAULT_PAX_COUNTS.adults,
        children: s.childrenCount ?? DEFAULT_PAX_COUNTS.children,
      })
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
      setAdultCount(snapPax.adults)
      setChildrenCount(snapPax.children)
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

      const loadedOut = await loadCached({ ...outParts, paxDesc: formatPaxDesc(snapPax) })
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
      const loadedRet = await loadCached({ ...retParts, paxDesc: formatPaxDesc(snapPax) })
      if (!loadedRet?.length) {
        setError('Return leg not in cache for this history entry. Run a full round-trip Search API search again.')
        setRawReturn([])
        return
      }
      setRawReturn(loadedRet)
    },
    [loadCached, update],
  )

  const applySavedSearchPayload = useCallback((
    p: SavedSearchPayloadV1,
    opts?: { skipFilters?: boolean },
  ) => {
    if (p.v !== 1) return
    setOrigins([...p.origins])
    setDestinations([...p.destinations])
    setTripType(p.tripType)
    setOutboundDate(p.outboundDate)
    setOutboundEnd(p.outboundEnd ?? addDaysIso(p.outboundDate, p.flexDays ?? 0))
    setReturnDate(p.returnDate)
    setReturnEnd(p.returnEnd ?? addDaysIso(p.returnDate, p.flexDays ?? 0))
    setAdultCount(p.adultCount ?? DEFAULT_PAX_COUNTS.adults)
    setChildrenCount(p.childrenCount ?? DEFAULT_PAX_COUNTS.children)
    setCabinClass(p.cabinClass ?? 1)
    setSearchSource(p.searchSource)
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
    if (opts?.skipFilters) {
      setMapHubFilter(new Set())
      setMapRouteFilter(null)
      setMapSoloFocus(null)
      setRawOut([])
      setRawReturn([])
      setHasSearched(false)
      setError(null)
      setSerpCapture({ outbound: null, return: null })
      return
    }
    const n = normalizeFilterSnapshot({
      airlineExcludedCodes: p.airlineExcludedCodes,
      outStopsMin: p.outStopsMin,
      outStopsMax: p.outStopsMax,
      retStopsMin: p.retStopsMin,
      retStopsMax: p.retStopsMax,
      outHours: p.outHours,
      retHours: p.retHours,
      outPrice: p.outPrice,
      retPrice: p.retPrice,
      outTimeRange: p.outTimeRange,
      retTimeRange: p.retTimeRange,
      outLegDurationMatch: p.outLegDurationMatch,
      retLegDurationMatch: p.retLegDurationMatch,
      timeBucketsOut: p.timeBucketsOut,
      timeBucketsRet: p.timeBucketsRet,
      layoverRegionOn: p.layoverRegionOn,
      layoverAirportOff: p.layoverAirportOff,
      layoverGeoFilterActive: p.layoverGeoFilterActive,
      excludeTechnical: p.excludeTechnical,
      showOpenJaw: p.showOpenJaw,
      dedupeMode: p.dedupeMode ?? 'route',
      returnCustomFilters: p.returnCustomFilters,
      aircraftSelectedCodes: p.aircraftSelectedCodes,
      aircraftMatchMode: p.aircraftMatchMode,
      sortOut: p.sortOut,
      sortReturn: p.sortReturn,
    })
    applyFilterPreset(n)
    setDisplayTimezone(p.displayTimezone ?? '')
    setConfigPresetRevision((r) => r + 1)
    setMapHubFilter(new Set())
    setMapRouteFilter(null)
    setMapSoloFocus(null)
    setRawOut([])
    setRawReturn([])
    setHasSearched(false)
    setError(null)
    setSerpCapture({ outbound: null, return: null })
  }, [update, applyFilterPreset])

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
      adultCount,
      childrenCount,
      cabinClass,
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
      dedupeMode,
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
      const defPreset = readDefaultConfigPreset()
      // When a ★ config preset is active it is the source of truth for the whole form
      // (origins, dates AND filters).  The saved search still provides API-level settings
      // (gl, hl, currency, deepSearch…) which are applied first, then the preset overrides
      // every form field so the app always boots into the exact state the preset encodes.
      // Without this, applySavedSearchPayload would leave the saved-search origins/dates in
      // place and only applyFilterFieldsFromConfig would run — silently ignoring the preset's
      // route/date portion and forcing the user to switch presets and back to get them.
      applySavedSearchPayload(p, { skipFilters: Boolean(defPreset) })
      if (defPreset) {
        applyConfigPreset(defPreset.config)
        setConfigPresetId(defPreset.id)
      }
      setCacheHint('Loaded your default search form.')
    })
    return () => {
      cancelled = true
    }
  }, [dbReady, loadDefaultSavedSearchPayload, applySavedSearchPayload, applyConfigPreset])

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

  /** Outbound pick → auto return: same return date when valid, else cheapest bundled RT for that outbound. */
  const handleOutboundSelect = useCallback(
    (sel: { routeKey: string; date: string; pickedIdx?: number; selectedItinerary?: NormalizedItinerary } | null) => {
      setPwOutboundSel(sel)

      if (!sel || !pwRetResultFiltered || !pwOutResultFiltered) return

      const picked = pickPwReturnForOutbound({
        outboundRouteKey: sel.routeKey,
        outboundDate: sel.date,
        preferredRetDate: pwReturnSel?.date ?? null,
        outResult: pwOutResultFiltered,
        retResult: pwRetResultFiltered,
        combos: pwRoundTripFiltered,
        pairMeta: pwPairMetaMapFiltered,
        dateBounds: pwDateBounds,
        roundTripDeepenStates: pwRoundTripDeepenStates,
      })
      setPwReturnSel(picked)
    },
    [
      pwRetResultFiltered,
      pwOutResultFiltered,
      pwReturnSel?.date,
      pwRoundTripFiltered,
      pwPairMetaMapFiltered,
      pwDateBounds,
      pwRoundTripDeepenStates,
    ],
  )

  // When scan data arrives after an outbound pick, apply the same return auto-pick rule.
  useEffect(() => {
    if (!pwOutboundSel || pwReturnSel || !pwRetResultFiltered || !pwOutResultFiltered) return
    const picked = pickPwReturnForOutbound({
      outboundRouteKey: pwOutboundSel.routeKey,
      outboundDate: pwOutboundSel.date,
      preferredRetDate: null,
      outResult: pwOutResultFiltered,
      retResult: pwRetResultFiltered,
      combos: pwRoundTripFiltered,
      pairMeta: pwPairMetaMapFiltered,
      dateBounds: pwDateBounds,
      roundTripDeepenStates: pwRoundTripDeepenStates,
    })
    if (picked) setPwReturnSel(picked)
  }, [
    pwOutboundSel,
    pwReturnSel,
    pwRetResultFiltered,
    pwOutResultFiltered,
    pwRoundTripFiltered,
    pwPairMetaMapFiltered,
    pwDateBounds,
    pwRoundTripDeepenStates,
  ])

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

  const resetAllFilters = useCallback(() => {
    // Stops and durations
    setOutStopsMin(''); setOutStopsMax(''); setRetStopsMin(''); setRetStopsMax('')
    setOutHours({ ...EMPTY_HOURS }); setRetHours({ ...EMPTY_HOURS })
    setOutLegDurationMatch('any'); setRetLegDurationMatch('any')
    // Price
    setOutPrice({ ...EMPTY_PRICE }); setRetPrice({ ...EMPTY_PRICE })
    // Time and timezone
    setTimeBucketsOut(new Set()); setTimeBucketsRet(new Set())
    setOutTimeRange({ ...EMPTY_TIME_RANGE }); setRetTimeRange({ ...EMPTY_TIME_RANGE })
    setDisplayTimezone('')
    // Airlines, aircraft, and layover
    setAirlineExcludedCodes(new Set())
    setAircraftSelectedCodes([]); setAircraftMatchMode('any')
    setLayoverGeoFilterActive(false)
    setLayoverRegionOn(() => {
      const o = {} as Record<RegionId, boolean>
      for (const k of REGION_IDS_IN_UI_ORDER) o[k] = true
      return o
    })
    setLayoverAirportOff(new Set())
    setExcludeTechnical(false); setShowOpenJaw(true); setUniqueRoutesOnly(true)
  }, [])

  if (!airports || !dbReady) {
    return (
      <div className="app">
        <p className="muted">{dbError ?? 'Loading airport directory and local database…'}</p>
      </div>
    )
  }

  return (
    <div className="dx">
      {/* ── HEADER ────────────────────────────────────────────── */}
      <div className="dx-head">
        {/* Row 1: logo · tabs · quota · settings */}
        <div className="dx-bar1">
          <div className="dx-logo">
            <img src="/logo.png" alt="Flight Itinerary Discovery" className="dx-logo-img" />
            <span className="dx-word">Flight Itinerary <small>Discovery</small></span>
          </div>
          <div className="dx-tabs">
            <button type="button" className={`dx-tab${mainTab === 'search' ? ' on' : ''}`} onClick={() => setMainTab('search')}>
              Search
            </button>
            <button type="button" className={`dx-tab${mainTab === 'savedSearches' ? ' on' : ''}`} onClick={() => setMainTab('savedSearches')}>
              Saved searches
              {savedSearches.length > 0 && <span className="badge">{savedSearches.length}</span>}
            </button>
            <button type="button" className={`dx-tab${mainTab === 'savedResults' ? ' on' : ''}`} onClick={() => setMainTab('savedResults')}>
              Saved results
              {savedResults.length > 0 && <span className="badge">{savedResults.length}</span>}
            </button>
          </div>
          <div className="dx-bar1-right">
            {settings.apiKey.trim() && serpUsageState.status === 'ok' && (() => {
              const d = serpUsageState.data
              const used = d.this_month_usage ?? 0
              const total = d.searches_per_month ?? 5000
              const pct = total > 0 ? Math.min(100, Math.round(used / total * 100)) : 0
              const left = d.total_searches_left ?? Math.max(0, total - used)
              const syncStr = serpUsageState.fetchedAt
                ? serpUsageState.fetchedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                : null
              return (
                <div className="dx-quota">
                  <div>
                    <div className="lab">SerpAPI quota</div>
                    <div className="fig"><b>{used.toLocaleString()}</b> <span>/ {total.toLocaleString()}</span></div>
                  </div>
                  <div className="dx-meter">
                    <div className="track"><div className="fill" style={{ width: `${pct}%` }}/></div>
                    <div className="sub">
                      <span>{left.toLocaleString()} left</span>
                      {syncStr && <span>synced {syncStr}</span>}
                    </div>
                  </div>
                  <button className="dx-iconbtn" title="Refresh quota" onClick={() => void refreshSerpUsage()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
                  </button>
                </div>
              )
            })()}
            {settings.apiKey.trim() && serpUsageState.status === 'error' && (
              <span className="dx-spill" style={{ fontSize: 11.5 }}>
                <span className="sw" style={{ background: 'var(--red)' }}/>
                SerpAPI ⚠
              </span>
            )}
            <button type="button" className="dx-settings" onClick={() => setSettingsOpen(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
              Settings
            </button>
          </div>
        </div>

        {/* Row 2: route · trip params · status pills · stats · history */}
        {mainTab === 'search' && (
          <div className="dx-bar2">
            <div className="dx-route">
              <div className="dx-route-row">
                {origins.map((o, i) => (
                  <span key={o} className="dx-iata">{i > 0 && <span className="dx-iata-sep">/</span>}{o}</span>
                ))}
                {origins.length === 0 && <span className="dx-iata dx-iata-empty">—</span>}
              </div>
              <div className="dx-route-mid">
                <span className="dx-route-arr">→</span>
              </div>
              <div className="dx-route-row">
                {destinations.map((d, i) => (
                  <span key={d} className="dx-iata">{i > 0 && <span className="dx-iata-sep">/</span>}{d}</span>
                ))}
                {destinations.length === 0 && <span className="dx-iata dx-iata-empty">—</span>}
              </div>
            </div>
            <div className="dx-trip">
              <div className="params">
                <b>{outboundDate}{tripType === 'round' ? ` — ${returnDate}` : ''}</b>
                <span className="sep"/>
                {passengerSummary}
                <span className="sep"/>
                <b>{tripType === 'round' ? 'Round trip' : 'One way'}</b>
              </div>
              {cacheHint && cacheHint !== 'Loaded your default search form.' && (
                <div className="cache">{cacheHint}</div>
              )}
            </div>
            {pwSerpRunActive && searchProgress && (
              <div className="dx-status">
                <span className="dx-spill">
                  <span className="sw" style={{ background: 'var(--amber)' }}/>
                  {formatSearchProgress(searchProgress)}
                  {searchSource === 'api' && !settings.mockMode && (
                    <button
                      type="button"
                      className="btn btn-xs btn-danger"
                      style={{ marginLeft: 6, height: 20, padding: '0 6px', fontSize: 10.5 }}
                      onClick={handleStopSerpSearch}
                    >
                      Stop
                    </button>
                  )}
                </span>
                {pwActivityMessage && (
                  <span className="dx-spill" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pwActivityMessage}
                  </span>
                )}
              </div>
            )}
            {error && (
              <div className="dx-status">
                <span className="dx-spill" style={{ borderColor: 'rgba(239,90,90,0.4)', background: 'rgba(239,90,90,0.08)', color: 'var(--red)' }}>
                  <span className="sw" style={{ background: 'var(--red)' }}/>{error}
                </span>
              </div>
            )}
            <div className="dx-bar2-stats">
              {hasSearched && (
                <span className="dx-live">
                  <span className="pulse"/>
                  {searchSummaryStats.count} result{searchSummaryStats.count !== 1 ? 's' : ''}
                </span>
              )}
              {hasSearched && searchSummaryStats.cheapest != null && (
                <div className="dx-fig">
                  <span className="v cheap">{fmtMoney(searchSummaryStats.cheapest, settings.currency)}</span>
                  <span className="k">Cheapest</span>
                </div>
              )}
              {hasSearched && searchSummaryStats.medianPrice != null && (
                <div className="dx-fig">
                  <span className="v">{fmtMoney(searchSummaryStats.medianPrice, settings.currency)}</span>
                  <span className="k">Median</span>
                </div>
              )}
              {hasSearched && searchSummaryStats.highest != null && (
                <div className="dx-fig">
                  <span className="v dear">{fmtMoney(searchSummaryStats.highest, settings.currency)}</span>
                  <span className="k">Highest</span>
                </div>
              )}
              {searchHistory.length > 0 && (
                <select
                  className="dx-hist"
                  value=""
                  onChange={(e) => {
                    const row = searchHistory.find((r) => String(r.id) === e.target.value)
                    if (row) void applySearchHistory(row)
                  }}
                  style={{ background: 'var(--raise)', border: '1px solid var(--line)', color: 'var(--ink-1)', borderRadius: 9, padding: '8px 12px', fontSize: 12.5, fontFamily: 'inherit' }}
                >
                  <option value="" disabled>History · open recent…</option>
                  {searchHistory.slice(0, 15).map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {`${(r.snapshot.origins ?? []).join(',')}→${(r.snapshot.destinations ?? []).join(',')}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── BODY ──────────────────────────────────────────────── */}
      {mainTab === 'search' ? (
        <div className="dx-body">
          {/* LEFT RAIL */}
          {searchPanelOpen ? (
            <div className={`dx-rail${returnCustomFilters && tripType === 'round' ? ' dx-rail--wide' : ''}`}>
              <div className="dx-rail-hd">
                <h3>Search</h3>
                <button className="hide" onClick={() => setSearchPanelOpen(false)}>✕ Hide</button>
              </div>
              <div className="dx-rail-scroll">
              {/* --- Run section --- */}
              <div className="dx-sec">
                <div className="dx-two" style={{ marginBottom: 16 }}>
                  <div>
                    <div className="rl">Goal</div>
                    <div className="dx-radio">
                      <div className={`rr ${searchGoal === 'discovery' ? 'on' : ''}`} onClick={() => handleSearchGoalChange('discovery')}><span className="ring"/>Discovery</div>
                      <div className={`rr ${searchGoal === 'priceWindow' ? 'on' : ''}`} onClick={() => handleSearchGoalChange('priceWindow')}><span className="ring"/>Price window</div>
                    </div>
                  </div>
                  <div>
                    <div className="rl">Source</div>
                    <div className="dx-radio">
                      <div className={`rr ${searchSource === 'api' ? 'on' : ''}`} onClick={() => setSearchSource('api')}><span className="ring"/>API</div>
                      <div className={`rr ${searchSource === 'db' ? 'on' : ''}`} onClick={() => setSearchSource('db')}><span className="ring"/>Database</div>
                    </div>
                  </div>
                </div>
                {/* PW sort, tranche, replace-outbound options kept inline */}
            {searchGoal === 'priceWindow' && searchSource === 'api' && !settings.mockMode && tripType === 'round' && (
              <div className="search-top-bar-sort" role="group" aria-labelledby="serpapi-sort-label">
                <span id="serpapi-sort-label" className="label search-top-bar-sort-label">
                  SerpApi sort
                </span>
                <label
                  className="check check-inline"
                  title="Price-sorted round-trip query per date pair (1 query/pair if duration off)"
                >
                  <input
                    type="checkbox"
                    checked={pwRtSortFlags.price}
                    onChange={(e) => {
                      const on = e.target.checked
                      if (!on && !pwRtSortFlags.duration) return
                      setPwRtSortFromFlags(on, pwRtSortFlags.duration)
                    }}
                  />
                  Price
                </label>
                <label
                  className="check check-inline"
                  title="Duration-sorted round-trip query per date pair (1 query/pair if price off)"
                >
                  <input
                    type="checkbox"
                    checked={pwRtSortFlags.duration}
                    onChange={(e) => {
                      const on = e.target.checked
                      if (!on && !pwRtSortFlags.price) return
                      setPwRtSortFromFlags(pwRtSortFlags.price, on)
                    }}
                  />
                  Duration
                </label>
              </div>
            )}
            {searchGoal === 'priceWindow' && tripType === 'round' && searchSource === 'api' && !settings.mockMode && (
              <div className="search-top-bar-tranche">
                <p className="muted tiny search-top-bar-tranche-hint">
                  First run: full date-pair grid, then remaining budget for return fetches (50-25-25).
                </p>
                <p className="muted tiny search-top-bar-tranche-hint">
                  Later runs: {settings.pwHourlySerpCalls} return fetches (50-25-25) — existing grid kept.
                </p>
                {pwHasExistingGrid && (
                  <label
                    className="check search-top-bar-tranche-continue"
                    title="Unchecked = later run (continue). Checked = first run again (replace grid for this window)."
                  >
                    <input
                      type="checkbox"
                      checked={pwReplaceOutbound}
                      onChange={(e) => setPwReplaceOutbound(e.target.checked)}
                    />
                    Replace existing outbound
                  </label>
                )}
              </div>
            )}
            <button
              type="button"
              className="dx-run"
              disabled={loading || pwRefreshLoading}
              onClick={() => searchGoal === 'priceWindow' ? requestPriceWindowSearch() : void runSearch()}
            >
              {loading ? 'Searching…' : searchGoal === 'priceWindow' ? 'Run price window search' : 'Search'}
            </button>
            {settings.mockMode && <span className="muted tiny">Mock</span>}
            {/* ── Return refresh section (price window round-trip only) ── */}
            {searchGoal === 'priceWindow' && tripType === 'round' && searchSource === 'api' && !settings.mockMode && (
              <div className="search-top-bar-refresh">
                {pwClearConfirmCount !== null ? (
                  <div className="search-top-bar-refresh-confirm">
                    <span className="muted tiny">
                      Clear {pwClearConfirmCount} return combo{pwClearConfirmCount === 1 ? '' : 's'} for filter-matching pairs?
                    </span>
                    <button
                      type="button"
                      className="btn btn-xs btn-danger"
                      onClick={() => void confirmClearReturnData()}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-secondary"
                      onClick={() => setPwClearConfirmCount(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : pwRefreshEstimate !== null ? (
                  <div className="search-top-bar-refresh-estimate">
                    <span className="muted tiny">
                      ~{pwRefreshEstimate.totalCalls} API call{pwRefreshEstimate.totalCalls === 1 ? '' : 's'} estimated
                      {pwRefreshEstimate.pairsNeedingScan > 0 && (
                        ` · ${pwRefreshEstimate.pairsNeedingScan} pair${pwRefreshEstimate.pairsNeedingScan === 1 ? '' : 's'} with no outbound (${pwRefreshEstimate.pairScanCalls} scan call${pwRefreshEstimate.pairScanCalls === 1 ? '' : 's'})`
                      )}
                      {pwRefreshEstimate.newReturnTokens > 0 && (
                        ` · ${pwRefreshEstimate.newReturnTokens} outbound with no return`
                      )}
                      {pwRefreshEstimate.refreshTokens > 0 && (
                        ` · ${pwRefreshEstimate.refreshTokens} return${pwRefreshEstimate.refreshTokens === 1 ? '' : 's'} to refresh`
                      )}
                    </span>
                    <div className="search-top-bar-refresh-estimate-actions">
                      <button
                        type="button"
                        className="btn btn-xs btn-accent"
                        onClick={() => { setPwRefreshEstimate(null); void runRefreshReturnsSearch() }}
                      >
                        Confirm refresh
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-secondary"
                        onClick={() => setPwRefreshEstimate(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="search-top-bar-refresh-actions">
                    <button
                      type="button"
                      className="btn btn-xs btn-secondary"
                      disabled={loading || pwRefreshLoading || !pwHasExistingGrid}
                      title="Delete existing return combos for filter-matching date pairs (standalone, no re-fetch)"
                      onClick={handleClearReturnData}
                    >
                      Clear return data
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-accent"
                      disabled={loading || pwRefreshLoading}
                      title="Re-fetch return prices for all filtered date pairs using saved departure tokens; runs pair scan for empty cells"
                      onClick={handleRefreshEstimate}
                    >
                      {pwRefreshLoading ? 'Refreshing…' : 'Refresh filtered returns'}
                    </button>
                    {pwAirlineFilterNarrowed && (
                      <div className="search-top-bar-airline-scan">
                        <label
                          className="check airline-scan-return-only"
                          title="Skip the outbound scan and re-fetch returns using departure tokens already saved for the selected airlines"
                        >
                          <input
                            type="checkbox"
                            checked={pwAirlineScanReturnOnly}
                            onChange={(e) => { setPwAirlineScanReturnOnly(e.target.checked) }}
                            disabled={pwAirlineScanLoading || loading || pwRefreshLoading}
                          />
                          <span className="tiny">Return only (existing outbound tokens)</span>
                        </label>
                        <button
                          type="button"
                          className="btn btn-xs btn-primary"
                          disabled={
                            pwAirlineScanLoading ||
                            loading ||
                            pwRefreshLoading
                          }
                          title={
                            pwAirlineScanReturnOnly
                              ? `Re-fetch returns for ${pwIncludedAirlineCodes.join(', ')} using saved outbound departure tokens (filter-passing, price order)`
                              : `Fresh outbound scan for ${pwIncludedAirlineCodes.join(', ')}, then fetch returns for filter-passing outbounds in price order`
                          }
                          onClick={() => { void runAirlineTargetedScanCallback() }}
                        >
                          {pwAirlineScanLoading ? 'Refreshing…' : 'Refresh filtered airlines'}
                        </button>
                        <p className="search-top-bar-include-airlines-hint tiny muted">
                          SerpApi <span className="mono">include_airlines</span> on every call:{' '}
                          <span className="mono">{pwIncludedAirlineCodes.join(', ') || '—'}</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {pwAirlineScanLoading && searchProgress?.includeAirlines?.length ? (
                  <p className="search-top-bar-include-airlines-live" role="status" aria-live="polite">
                    <span className="search-top-bar-include-airlines-label">include_airlines (every SerpApi call):</span>{' '}
                    <span className="mono">{searchProgress.includeAirlines.join(', ')}</span>
                  </p>
                ) : null}
                {pwSerpRunActive && searchProgress && (
                  <div className="search-top-bar-refresh-progress-row">
                    <p className="search-top-bar-refresh-progress" role="status" aria-live="polite">
                      {formatSearchProgress(searchProgress)}
                      {pwReturnFetchTokenNote && (
                        <span className="search-top-bar-refresh-route"> · {pwReturnFetchTokenNote}</span>
                      )}
                    </p>
                    <button
                      type="button"
                      className="btn btn-xs btn-danger"
                      onClick={handleStopSerpSearch}
                      title="Stop after the current API call — partial results are kept"
                    >
                      Stop
                    </button>
                  </div>
                )}
                {pwSerpRunActive && pwActivityMessage && (
                  <p className="search-top-bar-refresh-activity" role="status" aria-live="polite">
                    {pwActivityMessage}
                  </p>
                )}
                {pwGridVisibilityStats && (
                  <div className="search-top-bar-refresh-stats">
                    <div className="search-top-bar-refresh-row">
                      <span className="refresh-stat-label">Total found:</span>
                      <span>{pwGridVisibilityStats.outboundPassing} outbound</span>
                      <span>
                        · {pwGridVisibilityStats.rawReturnItineraries} return itinerar{pwGridVisibilityStats.rawReturnItineraries === 1 ? 'y' : 'ies'}
                      </span>
                    </div>
                    <div className="search-top-bar-refresh-row">
                      <span className="refresh-stat-label">Pass filter:</span>
                      <span>
                        {pwGridVisibilityStats.filteredReturnItineraries} return itinerar{pwGridVisibilityStats.filteredReturnItineraries === 1 ? 'y' : 'ies'}
                      </span>
                      <span>
                        · {pwGridVisibilityStats.filteredRoundTrips} round-trip{pwGridVisibilityStats.filteredRoundTrips === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                )}
                {pwRefreshStats && !pwRefreshLoading && (
                  <div className="search-top-bar-refresh-stats">
                    <div className="search-top-bar-refresh-row">
                      <span className="refresh-stat-label">All pairs:</span>
                      <span>+{pwRefreshStats.newReturnCombos} return</span>
                      {pwRefreshStats.newOutboundItineraries > 0 && (
                        <span>· +{pwRefreshStats.newOutboundItineraries} outbound</span>
                      )}
                    </div>
                    <div className="search-top-bar-refresh-row">
                      <span className="refresh-stat-label">Filtered:</span>
                      <span>+{pwRefreshStats.filteredNewReturn} return</span>
                      {pwRefreshStats.filteredNewOutbound > 0 && (
                        <span>· +{pwRefreshStats.filteredNewOutbound} outbound</span>
                      )}
                      {(pwRefreshStats.filteredPriceUp + pwRefreshStats.filteredPriceSame + pwRefreshStats.filteredPriceDown) > 0 && (
                        <span className="refresh-stat-prices">
                          · ↑{pwRefreshStats.filteredPriceUp} ={pwRefreshStats.filteredPriceSame} ↓{pwRefreshStats.filteredPriceDown}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {pwSerpEstimate &&
              searchGoal === 'priceWindow' &&
              tripType === 'oneway' &&
              searchSource === 'api' &&
              !settings.mockMode && (
                <span
                  className="muted tiny search-top-bar-estimate"
                  title={pwSerpEstimate.summary}
                >
                  {pwSerpEstimate.summary}
                </span>
              )}
            {cacheHint && cacheHint !== 'Loaded your default search form.' && (
              <span className="muted tiny search-top-bar-hint search-status-hint" title={cacheHint}>
                {cacheHint}
              </span>
            )}
            {error && <span className="error-inline search-error-multiline">{error}</span>}
              </div>{/* end dx-sec run */}

              {/* ── Config presets ── */}
              <div className="dx-sec">
                <div className="dx-sec-t">Config presets</div>
                <ConfigPresetsBar
            presets={configPresets.presets}
            selectedPresetId={configPresetId}
            onSelectedPresetIdChange={setConfigPresetId}
            currentConfig={currentConfigSnapshot}
            onApply={applyConfigPreset}
            onSave={configPresets.savePreset}
            onUpdate={configPresets.updatePreset}
            onRename={configPresets.renamePreset}
            onDelete={configPresets.deletePreset}
            onSetDefault={configPresets.setDefault}
            onClearDefault={configPresets.clearDefault}
                />
              </div>{/* end dx-sec config */}

              {/* ── Route and dates ── */}
              <div className="dx-sec">
                <div className="dx-sec-t">Route and dates</div>
                <div className="dx-sec-body">
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
              <div className="grid-2 tight-gap">
                <label className="field-tight">
                  <span className="label">Adults</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={9}
                    step={1}
                    value={adultCount}
                    onChange={(e) => setAdultCount(Number(e.target.value))}
                  />
                </label>
                <label className="field-tight">
                  <span className="label">Children</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={9}
                    step={1}
                    value={childrenCount}
                    onChange={(e) => setChildrenCount(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="field-tight">
                <span className="label">Cabin class</span>
                <select
                  className="input"
                  value={cabinClass}
                  onChange={(e) => setCabinClass(Number(e.target.value))}
                >
                  <option value={1}>Economy</option>
                  <option value={2}>Premium Economy</option>
                  <option value={3}>Business</option>
                  <option value={4}>First</option>
                </select>
              </label>
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

              {searchGoal === 'priceWindow' && tripType === 'round' && (
                <details className="pw-pair-filters-section">
                  <summary className="pw-pair-filters-summary">
                    <span className="pw-pair-filters-summary-chevron">▶</span>
                    Date pair filters
                    {pwPairFilterStatsLine ? (
                      <span className="pw-pair-filters-summary-note"> · {pwPairFilterStatsLine}</span>
                    ) : null}
                  </summary>
                  <PriceWindowPairFiltersFields
                    filters={pwPairFilters}
                    onChange={(next) => {
                      setPwPairFilters(next)
                      savePriceWindowPairFilters(next)
                    }}
                    statsLine={pwPairFilterStatsLine}
                  />
                </details>
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
              </div>{/* end dx-sec route */}

              {/* ── Active filter summary + reset ── */}
              <div className="dx-sec" style={{ paddingBottom: 4 }}>
                <button type="button" className="btn btn-ghost btn-small" onClick={resetAllFilters}>Reset all filters</button>
                {activeFilterSummaryLine ? (
                  <div className="dx-filter-summary">{activeFilterSummaryLine}</div>
                ) : null}
              </div>

              {/* ── Stops and durations ── */}
              <div
                key={`cfg-filters-stops-${configPresetId}-${configPresetRevision}`}
                className="dx-sec"
              >
                <div className="dx-sec-t">
                  Stops and durations
                  <button type="button" className="dx-sec-reset" onClick={() => {
                    setOutStopsMin('')
                    setOutStopsMax('')
                    setRetStopsMin('')
                    setRetStopsMax('')
                    setOutHours({ ...EMPTY_HOURS })
                    setRetHours({ ...EMPTY_HOURS })
                    setOutLegDurationMatch('any')
                    setRetLegDurationMatch('any')
                  }}>Reset</button>
                </div>
                <div className="dx-sec-body">
              {returnCustomFilters && tripType === 'round' ? (
                <div className="filter-dual-wrap">
                  <div className="filter-dual-col">
                    <div className="filter-col-head">Outbound</div>
                    <StopsFilterBlock
                      distributionSource={filterPoolOut}
                      stopsMin={outStopsMin}
                      stopsMax={outStopsMax}
                      onStopsMin={setOutStopsMin}
                      onStopsMax={setOutStopsMax}
                    />
                    <div className="duration-hist-block">
                      <DurationHistogramFilters
                        noOuterBlock
                        distributionSource={filterPoolOut}
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
                              <FilterChip radio selected={outLegDurationMatch === 'any'} onClick={() => setOutLegDurationMatch('any')} aria-label="At least one leg">Any</FilterChip>
                              <FilterChip radio selected={outLegDurationMatch === 'all'} onClick={() => setOutLegDurationMatch('all')} aria-label="Every leg">Every</FilterChip>
                            </div>
                          </div>
                        }
                      />
                    </div>
                  </div>
                  <div className="filter-dual-col">
                    <div className="filter-col-head">Return</div>
                    <StopsFilterBlock
                      distributionSource={filterPoolRet}
                      stopsMin={retStopsMin}
                      stopsMax={retStopsMax}
                      onStopsMin={setRetStopsMin}
                      onStopsMax={setRetStopsMax}
                    />
                    <div className="duration-hist-block">
                      <DurationHistogramFilters
                        noOuterBlock
                        distributionSource={filterPoolRet}
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
                              <FilterChip radio selected={retLegDurationMatch === 'any'} onClick={() => setRetLegDurationMatch('any')} aria-label="At least one leg">Any</FilterChip>
                              <FilterChip radio selected={retLegDurationMatch === 'all'} onClick={() => setRetLegDurationMatch('all')} aria-label="Every leg">Every</FilterChip>
                            </div>
                          </div>
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="filter-section">
                  <div className="filter-section-title">Outbound</div>
                  <StopsFilterBlock
                    distributionSource={filterPoolOut}
                    stopsMin={outStopsMin}
                    stopsMax={outStopsMax}
                    onStopsMin={setOutStopsMin}
                    onStopsMax={setOutStopsMax}
                  />
                  <div className="duration-hist-block">
                    <DurationHistogramFilters
                      noOuterBlock
                      distributionSource={filterPoolOut}
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
                            <FilterChip radio selected={outLegDurationMatch === 'any'} onClick={() => setOutLegDurationMatch('any')} aria-label="At least one leg">Any</FilterChip>
                            <FilterChip radio selected={outLegDurationMatch === 'all'} onClick={() => setOutLegDurationMatch('all')} aria-label="Every leg">Every</FilterChip>
                          </div>
                        </div>
                      }
                    />
                  </div>
                </div>
              )}
                </div>
              </div>{/* end dx-sec stops */}

              {/* ── Price ── */}
              <div
                key={`cfg-filters-price-${configPresetId}-${configPresetRevision}`}
                className="dx-sec"
              >
                <div className="dx-sec-t">
                  Price
                  <button type="button" className="dx-sec-reset" onClick={() => {
                    setOutPrice({ ...EMPTY_PRICE })
                    setRetPrice({ ...EMPTY_PRICE })
                  }}>Reset</button>
                </div>
                <div className="dx-sec-body">
              {returnCustomFilters && tripType === 'round' ? (
                <div className="filter-dual-wrap">
                  <div className="filter-dual-col">
                    <div className="filter-col-head">Outbound</div>
                    <div className="duration-hist-block">
                      <PriceHistogramFilter
                        distributionSource={filterPoolOut}
                        minStr={outPrice.min}
                        maxStr={outPrice.max}
                        onMin={(v) => setOutPrice((p) => ({ ...p, min: v }))}
                        onMax={(v) => setOutPrice((p) => ({ ...p, max: v }))}
                        currencyCode={settings.currency}
                      />
                    </div>
                  </div>
                  <div className="filter-dual-col">
                    <div className="filter-col-head">Return</div>
                    <div className="duration-hist-block">
                      <PriceHistogramFilter
                        distributionSource={filterPoolRet}
                        minStr={retPrice.min}
                        maxStr={retPrice.max}
                        onMin={(v) => setRetPrice((p) => ({ ...p, min: v }))}
                        onMax={(v) => setRetPrice((p) => ({ ...p, max: v }))}
                        currencyCode={settings.currency}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="filter-section">
                  <div className="filter-section-title">Outbound</div>
                  <div className="duration-hist-block">
                    <PriceHistogramFilter
                      distributionSource={filterPoolOut}
                      minStr={outPrice.min}
                      maxStr={outPrice.max}
                      onMin={(v) => setOutPrice((p) => ({ ...p, min: v }))}
                      onMax={(v) => setOutPrice((p) => ({ ...p, max: v }))}
                      currencyCode={settings.currency}
                    />
                  </div>
                </div>
              )}
                </div>
              </div>{/* end dx-sec price */}

              {/* ── Time and timezone ── */}
              <div
                key={`cfg-filters-time-${configPresetId}-${configPresetRevision}`}
                className="dx-sec"
              >
                <div className="dx-sec-t">
                  Time and timezone
                  <button type="button" className="dx-sec-reset" onClick={() => {
                    setTimeBucketsOut(new Set())
                    setTimeBucketsRet(new Set())
                    setOutTimeRange({ ...EMPTY_TIME_RANGE })
                    setRetTimeRange({ ...EMPTY_TIME_RANGE })
                    setDisplayTimezone('')
                  }}>Reset</button>
                </div>
                <div className="dx-sec-body">
              {returnCustomFilters && tripType === 'round' ? (
                <div className="filter-dual-wrap">
                  <div className="filter-dual-col">
                    <div className="filter-col-head">Outbound</div>
                    <div className="filter-section-title sub">First departure (local)</div>
                    <div className="filter-chip-row" role="group" aria-label="First departure time buckets">
                      {TIME_BUCKET_DEFS.map(({ id, label, hint }) => (
                        <FilterChip key={id} selected={timeBucketsOut.has(id)} onClick={() => toggleBucket('out', id)} title={hint} aria-label={`${label}, ${hint}`}>{label}</FilterChip>
                      ))}
                    </div>
                    <div className="duration-hist-block">
                      <TakeoffLandingHistogramFilters
                        distributionSource={filterPoolOut}
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
                  <div className="filter-dual-col">
                    <div className="filter-col-head">Return</div>
                    <div className="filter-section-title sub">First departure (local)</div>
                    <div className="filter-chip-row" role="group" aria-label="First departure time buckets (return)">
                      {TIME_BUCKET_DEFS.map(({ id, label, hint }) => (
                        <FilterChip key={id} selected={timeBucketsRet.has(id)} onClick={() => toggleBucket('ret', id)} title={hint} aria-label={`${label}, ${hint}`}>{label}</FilterChip>
                      ))}
                    </div>
                    <div className="duration-hist-block">
                      <TakeoffLandingHistogramFilters
                        distributionSource={filterPoolRet}
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
                </div>
              ) : (
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
                      distributionSource={filterPoolOut}
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
              )}

              <label className="field-tight filter-dual-below">
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
              </div>{/* end dx-sec time */}

              {/* ── Airlines and regions ── */}
              <div className="dx-sec">
                <div className="dx-sec-t">
                  Airlines and regions
                  <button type="button" className="dx-sec-reset" onClick={() => {
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
                  }}>Reset</button>
                </div>
                <div className="dx-sec-body">
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
            rawItineraries={filterPoolOut}
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
            <div className="field-tight dx-dedup-row">
              <span className="label">Dedup</span>
              <div className="dx-dedup-btns" role="group" aria-label="Deduplication mode">
                {([
                  ['off',      'All'],
                  ['route',    'Per route'],
                  ['schedule', 'Per schedule'],
                ] as [DedupeMode, string][]).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`dx-dedup-btn${dedupeMode === mode ? ' on' : ''}`}
                    onClick={() => setDedupeMode(mode)}
                    title={
                      mode === 'off'      ? 'Show all itineraries (one row per date/variant)' :
                      mode === 'route'    ? 'One row per route — keeps cheapest fare' :
                      'One row per route + layover combo — shows different connection lengths separately'
                    }
                  >{label}</button>
                ))}
              </div>
            </div>
                </div>
                </div>
              </div>{/* end dx-sec airlines */}

              {(serpCapture.outbound || serpCapture.return) && (
                <div className="dx-sec">
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

              </div>{/* end dx-rail-scroll */}
              {/* ── Save actions ── */}
              <div className="dx-rail-foot">
                <button type="button" className="btn btn-secondary btn-tiny" onClick={handleSaveSearch}>Save search</button>
                <button type="button" className="btn btn-ghost btn-tiny" onClick={handleSaveAsDefault}>Save as default</button>
              </div>
            </div>
          ) : (
            <button type="button" className="dx-rail-show" onClick={() => setSearchPanelOpen(true)} title="Show search panel">☰</button>
          )}
          {/* CENTER */}
          <div className="dx-center">
        <ErrorBoundary inline label="Results render error">
        <div className="results-stack">
          {searchGoal === 'priceWindow' &&
          (pwOutResultFiltered || pwRetResultFiltered || loading || pwEmptyGridHint) ? (
            hidePwResultsUi ? (
              <p className="muted pw-search-busy-hint">
                {loading
                  ? 'Price window search in progress — grids hidden so the page stays responsive. Progress shows in the search bar.'
                  : pwFiltersPending
                    ? 'Applying filters to the price window…'
                    : 'Confirm search to continue.'}
              </p>
            ) : loading && !(pwOutResultFiltered || pwRetResultFiltered) ? (
              <p className="muted pw-search-busy-hint">
                Loading price window from browser database… {searchProgress?.datePair ?? ''}
              </p>
            ) : pwEmptyGridHint && !(pwOutResultFiltered?.routeKeyOrder?.length) ? (
              <div className="pw-filter-empty-banner" role="alert">
                <p>{pwEmptyGridHint}</p>
                <button type="button" className="btn btn-secondary btn-small" onClick={resetAllFilters}>
                  Reset all filters
                </button>
              </div>
            ) : (
            <div className="pw-panels-stack">
              <HeatmapQualityFilterBar
                activeFilter={heatmapQualityFilter}
                onToggle={toggleHeatmapQualityFilter}
                onClear={() => setHeatmapQualityFilter(new Set())}
                qualityTotals={heatmapQualityTotals}
              />
              {/* Total round-trip panel — shows combined prices; clicking drives the Outbound+Return panels */}
              {tripType === 'round' && pwOutResultFiltered && pwRetResultFiltered && (
                <PriceWindowPanel
                  result={pwOutResultFiltered}
                  currency={settings.currency}
                  title="Total round-trip by date"
                  summaryTitle="Selected itinerary"
                  panelTestId="pw-panel-total"
                  namesByIata={namesByIata}
                  returnResult={pwRetResultFiltered}
                  roundTripPairMeta={pwPairMetaMapFiltered}
                  onRouteSelect={handleOutboundSelect}
                  controlledSelection={pwOutboundSel}
                  selectionOnly={true}
                  selectedReturnIt={pwReturnSelResolved?.it ?? null}
                  selectedReturnDate={pwReturnSel?.date ?? pwReturnSelResolved?.date}
                  maxPrice={filterOut.maxPrice}
                  onSave={savePriceWindowSelection}
                  tzByIata={tzByIata}
                  displayTimezone={displayTimezone}
                  airlineDirectory={airlinesDict}
                  airlinesMeta={airlinesMetaJson as AirlinesMeta}
                  layoverLongMinHours={settings.layoverLongMinHours}
                  layoverShortMaxHours={settings.layoverShortMaxHours}
                  verifications={priceVerifications}
                  onUpsertVerification={(row) => void upsertVerification(row)}
                  onRemoveVerification={(rk, od, rd) => void removeVerification(rk, od, rd)}
                  adults={paxCounts.adults}
                  children={paxCounts.children}
                  cabinClass={cabinClass}
                  roundTripCombos={pwRoundTripFiltered}
                  roundTripDeepenStates={pwRoundTripDeepenStates}
                  rtTokenIndex={pwRtTokenIndex}
                  deepenByOutDate={pwDeepenByOutDate}
                  outboundLegFilter={(it) => passesItineraryFilters(it, filterOut)}
                  returnLegFilter={(it) => passesItineraryFilters(it, filterRet)}
                  dateBounds={pwDateBounds}
                  qualityFilter={heatmapQualityFilter}
                  routeStopsMin={filterOut.minStops}
                  routeStopsMax={filterOut.maxStops}
                />
              )}
              {/* Selected itinerary summary — one-way only (round-trip uses pw-panel-total above) */}
              {tripType === 'oneway' && pwOutResultFiltered && (
                <PriceWindowPanel
                  result={pwOutResultFiltered}
                  currency={settings.currency}
                  title="Selected itinerary"
                  summaryTitle="Selected itinerary"
                  panelTestId="pw-panel-oneway-summary"
                  namesByIata={namesByIata}
                  onRouteSelect={handleOutboundSelect}
                  controlledSelection={pwOutboundSel}
                  selectionOnly={true}
                  hideReturn={true}
                  maxPrice={filterOut.maxPrice}
                  onSave={savePriceWindowSelection}
                  tzByIata={tzByIata}
                  displayTimezone={displayTimezone}
                  airlineDirectory={airlinesDict}
                  airlinesMeta={airlinesMetaJson as AirlinesMeta}
                  layoverLongMinHours={settings.layoverLongMinHours}
                  layoverShortMaxHours={settings.layoverShortMaxHours}
                  verifications={priceVerifications}
                  onUpsertVerification={(row) => void upsertVerification(row)}
                  onRemoveVerification={(rk, od, rd) => void removeVerification(rk, od, rd)}
                  adults={paxCounts.adults}
                  children={paxCounts.children}
                  cabinClass={cabinClass}
                  outboundLegFilter={(it) => passesItineraryFilters(it, filterOut)}
                  dateBounds={pwDateBounds}
                  qualityFilter={heatmapQualityFilter}
                  routeStopsMin={filterOut.minStops}
                  routeStopsMax={filterOut.maxStops}
                />
              )}
              {/* Outbound panel — shows itinerary picker for the currently selected outbound cell */}
              {pwOutResultFiltered && (
                <PriceWindowPanel
                  result={pwOutResultFiltered}
                  currency={settings.currency}
                  title="Outbound by date"
                  panelTestId="pw-panel-outbound"
                  roundTripCombos={pwRoundTripFiltered}
                  roundTripPairMeta={pwPairMetaMapFiltered}
                  roundTripDeepenStates={pwRoundTripDeepenStates}
                  rtTokenIndex={pwRtTokenIndex}
                  deepenByOutDate={pwDeepenByOutDate}
                  namesByIata={namesByIata}
                  returnResult={pwRetResultFiltered}
                  onRouteSelect={handleOutboundSelect}
                  controlledSelection={pwOutboundSel}
                  selectedReturnIt={pwReturnSelResolved?.it ?? null}
                  selectedReturnDate={pwReturnSel?.date ?? pwReturnSelResolved?.date}
                  maxPrice={filterOut.maxPrice}
                  onSave={savePriceWindowSelection}
                  airlineDirectory={airlinesDict}
                  airlinesMeta={airlinesMetaJson as AirlinesMeta}
                  adults={paxCounts.adults}
                  children={paxCounts.children}
                  cabinClass={cabinClass}
                  outboundLegFilter={(it) => passesItineraryFilters(it, filterOut)}
                  returnLegFilter={(it) => passesItineraryFilters(it, filterRet)}
                  dateBounds={pwDateBounds}
                  qualityFilter={heatmapQualityFilter}
                  routeStopsMin={filterOut.minStops}
                  routeStopsMax={filterOut.maxStops}
                />
              )}
              {/* Return panel — shows return prices filtered by selected outbound route */}
              {tripType === 'round' && pwRetResultFiltered && (
                <PriceWindowPanel
                  result={pwRetResultFiltered}
                  currency={settings.currency}
                  title="Return by date"
                  panelTestId="pw-panel-return"
                  roundTripCombos={pwRoundTripFiltered}
                  roundTripPairMeta={pwPairMetaMapFiltered}
                  roundTripDeepenStates={pwRoundTripDeepenStates}
                  rtTokenIndex={pwRtTokenIndex}
                  deepenByOutDate={pwDeepenByOutDate}
                  pairedOutboundResult={pwOutResultFiltered}
                  pairedOutboundRouteKey={pwOutboundSel?.routeKey ?? null}
                  pairedOutboundDate={pwOutboundSel?.date ?? null}
                  pairedOutboundSelection={pwOutboundSel}
                  namesByIata={namesByIata}
                  onRouteSelect={setPwReturnSel}
                  controlledSelection={pwReturnSel}
                  maxPrice={filterRet.maxPrice}
                  airlineDirectory={airlinesDict}
                  airlinesMeta={airlinesMetaJson as AirlinesMeta}
                  adults={paxCounts.adults}
                  children={paxCounts.children}
                  cabinClass={cabinClass}
                  outboundLegFilter={(it) => passesItineraryFilters(it, filterOut)}
                  returnLegFilter={(it) => passesItineraryFilters(it, filterRet)}
                  dateBounds={pwDateBounds}
                  qualityFilter={heatmapQualityFilter}
                  routeStopsMin={filterRet.minStops}
                  routeStopsMax={filterRet.maxStops}
                />
              )}
              {/* Date heatmap — outbound × return date matrix for a selected route */}
              {tripType === 'round' && pwOutResultFiltered && pwRetResultFiltered && (
                <DateHeatmapPanel
                  outResult={pwOutResultFiltered}
                  retResult={pwRetResultFiltered}
                  roundTripCombos={pwRoundTripFiltered}
                  roundTripPairMeta={pwPairMetaMapFiltered}
                  roundTripDeepenStates={pwRoundTripDeepenStates}
                  rtTokenIndex={pwRtTokenIndex}
                  currency={settings.currency}
                  namesByIata={namesByIata}
                  airlineDirectory={airlinesDict}
                  airlinesMeta={airlinesMetaJson as AirlinesMeta}
                  paxDesc={paxDesc}
                  verifications={priceVerifications}
                  onUpsertVerification={(row) => void upsertVerification(row)}
                  onRemoveVerification={(rk, od, rd) => void removeVerification(rk, od, rd)}
                  onImportVerifications={importVerifications}
                  preferredRouteKey={pwOutboundSel?.routeKey ?? null}
                  dateBounds={pwDateBounds}
                  qualityFilter={heatmapQualityFilter}
                  outboundLegFilter={(it) => passesItineraryFilters(it, filterOut)}
                  returnLegFilter={(it) => passesItineraryFilters(it, filterRet)}
                />
              )}
            </div>
            )
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
              <ResultsViewSwitcher
                persistKey="out"
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
                cabinClass={cabinClass}
              />
              {tripType === 'round' && (
                <ResultsViewSwitcher
                  persistKey="ret"
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
                  cabinClass={cabinClass}
                />
              )}
            </>
          )}

        </div>
        </ErrorBoundary>
          </div>
        </div>
      ) : mainTab === 'savedSearches' ? (
        <div className="dx-body dx-saved-page">
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
        </div>
      ) : (
        <div className="dx-body dx-saved-page">
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
              cabinClass={cabinClass}
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
              cabinClass={cabinClass}
            />
          </div>
        </div>
      )}

      <PriceWindowSearchConfirmModal
        open={pwSearchConfirmOpen}
        tripType={tripType}
        outboundDate={outboundDate}
        outboundEnd={outboundEnd}
        returnDate={returnDate}
        returnEnd={returnEnd}
        sortMode={pwRtSortMode}
        pairFilters={pwPairFilters}
        hasExistingGrid={pwHasExistingGrid}
        replaceOutbound={pwReplaceOutbound}
        plannedHourlySerpCalls={settings.pwHourlySerpCalls}
        hourUsed={serpUsageState.status === 'ok' ? serpUsageState.data.this_hour_searches : undefined}
        hourLimit={
          serpUsageState.status === 'ok'
            ? serpUsageState.data.account_rate_limit_per_hour
            : SERP_HOURLY_LIMIT_DEFAULT
        }
        onProceed={handlePwSearchProceed}
        onCancel={() => setPwSearchConfirmOpen(false)}
      />

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
        onDownloadDb={() => void downloadDb()}
        onRestoreDb={(file) => void restoreDbFromFile(file)}
        onResetSqlite={() => void resetEntireDb()}
        getSerpCaptureRows={getSerpCaptureRows}
        getSerpCaptureStoredRecord={getSerpCaptureStoredRecord}
        onDeleteSerpCapture={(id) => void removeSerpCapture(id)}
      />
    </div>
  )
}
