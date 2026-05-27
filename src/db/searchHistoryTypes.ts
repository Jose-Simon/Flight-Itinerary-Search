/** Serialized search form + Settings fields that affect cache hash (see HashParts). */
export type SearchHistorySnapshotV1 = {
  v: 1
  origins: string[]
  destinations: string[]
  tripType: 'oneway' | 'round'
  outboundDate: string
  returnDate: string
  flexDays: number
  searchSource: 'api' | 'db'
  mockMode: boolean
  deepSearch: boolean
  showHidden: boolean
  gl: string
  hl: string
  currency: string
}

export type SearchHistoryRow = {
  id: number
  createdAt: number
  snapshot: SearchHistorySnapshotV1
  outboundCount: number
  returnCount: number
}
