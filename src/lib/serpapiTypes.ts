/**
 * Shapes we parse from SerpApi `engine=google_flights`. The live JSON often includes more fields
 * on each option and at the root — inspect `NormalizedItinerary.raw` for the full object. Commonly useful extras:
 * - `price`, `type` (round trip / one way), `booking_token`, `departure_token`, `booking_link`
 * - `carbon_emissions` / sustainability hints (when returned)
 * - `extensions` on segments: amenities, “often delayed”, etc.
 * - Root: `search_parameters`, `search_metadata`, `price_insights`, `airports`, `airlines` dictionaries
 * Google’s own UI count (e.g. 147) can differ: SerpApi returns `best_flights` + `other_flights` pages, and we sum those rows per date request.
 */

export type SerpAirport = {
  name?: string
  id?: string
  time?: string
}

export type SerpFlightSegment = {
  departure_airport?: SerpAirport
  arrival_airport?: SerpAirport
  duration?: number
  airplane?: string
  airline?: string
  airline_logo?: string
  flight_number?: string
  extensions?: string[]
  /** e.g. "31 in" — legroom/seat pitch for this segment. */
  legroom?: string
  /** True when Google flags this flight as often delayed by 30+ minutes. */
  often_delayed_by_over_30_min?: boolean
}

export type SerpLayover = {
  duration?: number
  name?: string
  id?: string
}

export type SerpFlightOption = {
  flights?: SerpFlightSegment[]
  layovers?: SerpLayover[]
  total_duration?: number
  departure_token?: string
  price?: number
}

export type SerpGoogleFlightsResponse = {
  search_metadata?: { status?: string }
  error?: string
  best_flights?: SerpFlightOption[]
  other_flights?: SerpFlightOption[]
}
