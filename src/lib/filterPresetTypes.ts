import type {
  HourFieldStrings,
  PriceFieldStrings,
  LegDurationMatchMode,
  AircraftMatchMode,
  SortMode,
} from './filters'
import type { TimeRangeFieldStrings } from './timeRangeFilter'
import type { TimeOfDayBucket } from './timeBuckets'
import type { RegionId } from '../data/regions'

/**
 * All client-side filter state that can be saved as a named preset.
 * Route/date fields are intentionally excluded — presets are about
 * HOW you filter results, not WHERE/WHEN you're flying.
 */
export type FilterSnapshot = {
  airlineExcludedCodes: string[]
  outStopsMin: string
  outStopsMax: string
  retStopsMin: string
  retStopsMax: string
  outHours: HourFieldStrings
  retHours: HourFieldStrings
  outPrice: PriceFieldStrings
  retPrice: PriceFieldStrings
  outTimeRange: TimeRangeFieldStrings
  retTimeRange: TimeRangeFieldStrings
  outLegDurationMatch: LegDurationMatchMode
  retLegDurationMatch: LegDurationMatchMode
  timeBucketsOut: TimeOfDayBucket[]
  timeBucketsRet: TimeOfDayBucket[]
  layoverRegionOn: Record<RegionId, boolean>
  layoverAirportOff: string[]
  layoverGeoFilterActive: boolean
  excludeTechnical: boolean
  showOpenJaw: boolean
  uniqueRoutesOnly: boolean
  returnCustomFilters: boolean
  aircraftSelectedCodes: string[]
  aircraftMatchMode: AircraftMatchMode
  sortOut: SortMode
  sortReturn: SortMode
}

export type FilterPreset = {
  id: string
  name: string
  /** One preset may be marked as default; applied automatically on app load. */
  isDefault: boolean
  filters: FilterSnapshot
}

// ── Date presets ─────────────────────────────────────────────────────────────

/**
 * All date/trip-type state that can be saved as a named preset.
 * Covers both routing-discovery (outboundDate + outboundEnd, returnDate + returnEnd)
 * and price-window (pwOut*/pwRet* ranges).
 */
export type DateSnapshot = {
  tripType: 'oneway' | 'round'
  outboundDate: string
  outboundEnd: string
  returnDate: string
  returnEnd: string
}

export type DatePreset = {
  id: string
  name: string
  isDefault: boolean
  dates: DateSnapshot
}

// ── Unified config presets (replaces the two separate bars) ──────────────────

/** Everything needed to fully recreate a search setup: filters + dates together. */
export type ConfigSnapshot = FilterSnapshot & DateSnapshot

export type ConfigPreset = {
  id: string
  name: string
  /** Applied automatically on app load when true. */
  isDefault: boolean
  config: ConfigSnapshot
}
