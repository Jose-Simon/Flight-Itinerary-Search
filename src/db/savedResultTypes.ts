import type { NormalizedItinerary } from '../lib/types'

export type SavedResultLeg = 'outbound' | 'return' | 'roundtrip'

/** Single-leg save (from Discovery/Search results or one-way Price Window). */
export type SavedResultPayloadV1 = {
  v: 1
  itinerary: NormalizedItinerary
  gfOrigins: string[]
  gfDestinations: string[]
  linkDate: string
  returnDate: string | null
  tripType: 'oneway' | 'round'
}

/** Round-trip save (from Price Window "Save both"). Both legs in a single row. */
export type SavedResultPayloadV2 = {
  v: 2
  outboundItinerary: NormalizedItinerary
  returnItinerary: NormalizedItinerary
  /** Airports for the outbound origin side. */
  gfOrigins: string[]
  /** Airports for the outbound destination side. */
  gfDestinations: string[]
  outboundDate: string
  returnDate: string
}

export type SavedResultPayload = SavedResultPayloadV1 | SavedResultPayloadV2

export type SavedResultRow = {
  id: number
  createdAt: number
  leg: SavedResultLeg
  scheduleKey: string
  payload: SavedResultPayload
}
