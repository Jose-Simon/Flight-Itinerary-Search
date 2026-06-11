import type { RegionId } from '../data/regions'
import type {
  AircraftMatchMode,
  DedupeMode,
  HourFieldStrings,
  LegDurationMatchMode,
  PriceFieldStrings,
  SortMode,
} from '../lib/filters'
import type { TimeRangeFieldStrings } from '../lib/timeRangeFilter'
import type { TimeOfDayBucket } from '../lib/timeBuckets'

/** Full search form (+ relevant Settings) for named saves and default startup. */
export type SavedSearchPayloadV1 = {
  v: 1
  origins: string[]
  destinations: string[]
  tripType: 'oneway' | 'round'
  outboundDate: string
  outboundEnd: string
  returnDate: string
  returnEnd: string
  adultCount?: number
  childrenCount?: number
  /** Cabin class: 1=Economy (default), 2=Premium Economy, 3=Business, 4=First */
  cabinClass?: number
  /** @deprecated kept for reading old saved searches; use outboundEnd / returnEnd instead */
  flexDays?: number
  returnCustomFilters: boolean
  outHours: HourFieldStrings
  retHours: HourFieldStrings
  outPrice: PriceFieldStrings
  retPrice: PriceFieldStrings
  outTimeRange: TimeRangeFieldStrings
  retTimeRange: TimeRangeFieldStrings
  outLegDurationMatch: LegDurationMatchMode
  retLegDurationMatch: LegDurationMatchMode
  outStopsMin: string
  outStopsMax: string
  retStopsMin: string
  retStopsMax: string
  layoverRegionOn: Record<RegionId, boolean>
  layoverAirportOff: string[]
  layoverGeoFilterActive: boolean
  excludeTechnical: boolean
  showOpenJaw: boolean
  sortOut: SortMode
  sortReturn: SortMode
  searchSource: 'api' | 'db'
  timeBucketsOut: TimeOfDayBucket[]
  timeBucketsRet: TimeOfDayBucket[]
  displayTimezone: string
  dedupeMode: DedupeMode
  aircraftSelectedCodes: string[]
  aircraftMatchMode: AircraftMatchMode
  airlineExcludedCodes: string[]
  settingsSearch: {
    mockMode: boolean
    gl: string
    hl: string
    currency: string
    deepSearch: boolean
    showHidden: boolean
    layoverLongMinHours: number
    layoverShortMaxHours: number
  }
}

export type SavedSearchRow = {
  id: number
  createdAt: number
  name: string
  payload: SavedSearchPayloadV1
}
