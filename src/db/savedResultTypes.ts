import type { NormalizedItinerary } from '../lib/types'

export type SavedResultLeg = 'outbound' | 'return'

export type SavedResultPayloadV1 = {
  v: 1
  itinerary: NormalizedItinerary
  gfOrigins: string[]
  gfDestinations: string[]
  linkDate: string
  returnDate: string | null
  tripType: 'oneway' | 'round'
}

export type SavedResultRow = {
  id: number
  createdAt: number
  leg: SavedResultLeg
  scheduleKey: string
  payload: SavedResultPayloadV1
}
