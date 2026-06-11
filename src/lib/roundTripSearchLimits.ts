/** Manual / legacy click-to-fetch batch size. */
export const ROUND_TRIP_DEEPEN_BATCH = 2
/** @deprecated legacy balanced mode */
export const ROUND_TRIP_INITIAL_OUTBOUND_FOLLOW = 2
/** Store all tokened outbounds from initial scans (hard cap guards memory). */
export const ROUND_TRIP_RANK_STORE_MAX = 250
/** @deprecated use ROUND_TRIP_RANK_STORE_MAX */
export const ROUND_TRIP_RANK_CAP = ROUND_TRIP_RANK_STORE_MAX

/** @deprecated use ROUND_TRIP_INITIAL_OUTBOUND_FOLLOW */
export const ROUND_TRIP_DEFAULT_OUTBOUND_FOLLOW = ROUND_TRIP_INITIAL_OUTBOUND_FOLLOW
/** @deprecated use ROUND_TRIP_RANK_CAP */
export const ROUND_TRIP_EXTENDED_OUTBOUND_FOLLOW = ROUND_TRIP_RANK_CAP
/** @deprecated use ROUND_TRIP_RANK_CAP */
export const ROUND_TRIP_MAX_OUTBOUND_FOLLOW = ROUND_TRIP_RANK_CAP
