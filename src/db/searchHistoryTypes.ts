/** Serialized search form + Settings fields that affect cache hash (see HashParts). */
export type SearchHistorySnapshotV1 = {
  v: 1
  origins: string[]
  destinations: string[]
  tripType: 'oneway' | 'round'
  searchGoal?: 'discovery' | 'priceWindow'
  outboundDate: string
  outboundEnd?: string
  returnDate: string
  returnEnd?: string
  /** Price window outbound date range (priceWindow goal only) */
  pwOutStart?: string
  pwOutEnd?: string
  /** Price window return date range (priceWindow goal, round trip only) */
  pwRetStart?: string
  pwRetEnd?: string
  /** @deprecated kept for reading old history entries; use outboundEnd / returnEnd instead */
  flexDays?: number
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
