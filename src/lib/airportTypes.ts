export type AirportRow = {
  iata: string
  name: string
  city: string
  country: string
  countryIso: string
  /** IANA timezone from OpenFlights (may be empty). */
  tz: string
  lat: number | null
  lon: number | null
}
