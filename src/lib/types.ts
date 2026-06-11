export type TripDirection = 'outbound' | 'return'

export type NormalizedLayover = {
  airport: string
  name?: string
  durationMinutes: number
  isTechnical: boolean
  /** In a user-excluded region but kept (technical) */
  excludedRegionButAllowed?: boolean
}

export type NormalizedSegment = {
  dep: string
  arr: string
  depTime?: string
  arrTime?: string
  durationMinutes: number
  airline?: string
  /** SerpApi / Google static logo URL when present */
  airlineLogo?: string
  flightNumber?: string
  airplane?: string
  /** Seat pitch in inches, parsed from SerpApi `legroom` field (e.g. "31 in" → 31). */
  legroom?: number
  /** True when Google flags this flight as often delayed by 30+ minutes. */
  oftenDelayed?: boolean
  /** Amenity strings from SerpApi `extensions[]` (Wi-Fi, power, video, etc.). */
  amenities?: string[]
}

export type NormalizedItinerary = {
  waypointKey: string
  segments: NormalizedSegment[]
  layovers: NormalizedLayover[]
  totalDurationMinutes: number
  airlines: string[]
  /** Fare from SerpApi when present (currency from search / Settings). */
  price?: number
  /** Open jaw vs primary hub (first selected dest / first origin) */
  openJaw?: boolean
  /** Raw option for token / debugging */
  raw?: unknown
}
