import type { NormalizedItinerary, NormalizedSegment } from './types'

// ---------------------------------------------------------------------------
// Minimal protobuf encoder (wire types 0 = varint, 2 = LEN)
// ---------------------------------------------------------------------------

function pbVarintBytes(value: number): number[] {
  const out: number[] = []
  while (value > 0x7f) {
    out.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  out.push(value & 0x7f)
  return out
}

function pbVarint(fieldNum: number, val: number): number[] {
  return [...pbVarintBytes((fieldNum << 3) | 0), ...pbVarintBytes(val)]
}

function pbStr(fieldNum: number, str: string): number[] {
  const enc = Array.from(new TextEncoder().encode(str))
  return [...pbVarintBytes((fieldNum << 3) | 2), ...pbVarintBytes(enc.length), ...enc]
}

function pbLen(fieldNum: number, data: number[]): number[] {
  return [...pbVarintBytes((fieldNum << 3) | 2), ...pbVarintBytes(data.length), ...data]
}

// ---------------------------------------------------------------------------
// Google Flights TFS parameter builder
//
// Schema confirmed from live Google Flights booking URLs:
//
//   FlightSearch {
//     1:  varint  = 28 (constant)
//     2:  varint  = 1 (oneway) | 2 (round trip)
//     3:  LEN[]   = repeated LegGroup (outbound + return both use field 3)
//     8:  varint  = 1 (adults)
//     9:  varint  = 1 (economy)
//     14: varint  = 1 (constant in all observed URLs)
//     16: LEN     = { 1: varint(-1) }  (max-uint64 sentinel; 11 inner bytes)
//     19: varint  = 1 (constant in all observed URLs)
//   }
//   LegGroup {
//     2:  string  = departure date "YYYY-MM-DD"
//     4:  LEN[]   = repeated Segment
//     13: LEN     = AirportNode — leg's departure airport, IATA form
//     14: LEN     = AirportNode — leg's final arrival airport, IATA form
//   }
//   AirportNode (fields 13 and 14):
//     type=1 (IATA): { 1: varint(1), 2: string(IATA) }
//   Segment {
//     1: string  = departure IATA
//     2: string  = departure date "YYYY-MM-DD"
//     3: string  = arrival IATA
//     5: string  = IATA airline code (e.g. "QR") — extracted from flight_number
//     6: string  = flight number digits only (e.g. "702")
//   }
// ---------------------------------------------------------------------------

// Varint encoding of max uint64 (0xFFFF...FF = -1 as int64).
// Used inside field 16's inner message.  pbVarintBytes() cannot handle this
// value directly because JS bitwise ops work on 32-bit signed integers.
const MAX_UINT64_VARINT: number[] = [
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01,
]

/** Build an AirportNode: { 1: varint(1), 2: string(IATA) } */
function airportNode(iata: string): number[] {
  return [...pbVarint(1, 1), ...pbStr(2, iata)]
}

function segmentDate(seg: NormalizedSegment, fallbackDate: string): string {
  // depTime is stored as "YYYY-MM-DD HH:mm" — extract date portion
  const d = seg.depTime?.slice(0, 10)
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fallbackDate
}

function flightNumOnly(seg: NormalizedSegment): string {
  // Strip 2-char IATA carrier prefix (handles letter-first AND digit-first codes like "4Y"):
  // "QR 702" → "702", "LH758" → "758", "B6 1234" → "1234", "4Y 51" → "51", "2W 123" → "123"
  const m = seg.flightNumber?.trim().match(/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\s*(\d+)/)
  if (m) return m[1]
  // Fallback: strip any leading non-digit run (e.g. bare digits already)
  return seg.flightNumber?.replace(/^[^0-9]*/, '').trim() ?? ''
}

/**
 * Extract the IATA 2-char carrier code from a flight number string.
 * "EY 263" → "EY",  "QR702" → "QR",  "B6 1234" → "B6",  "4Y 51" → "4Y"
 * Falls back to empty string (Google Flights will infer from flight number).
 *
 * IATA codes may start with a digit (e.g. Condor = "4Y", World2fly = "2W"),
 * so we match [A-Z][A-Z0-9] OR [0-9][A-Z] to cover both forms.
 *
 * Note: seg.airline is the *full airline name* ("Etihad Airways"), NOT the IATA
 * code. The IATA code lives in the flight_number string from SerpApi.
 */
function airlineCodeFromSeg(seg: NormalizedSegment): string {
  const m = seg.flightNumber?.trim().match(/^([A-Z][A-Z0-9]|[0-9][A-Z])\s*\d/)
  return m ? m[1] : ''
}

function buildSegmentProto(seg: NormalizedSegment, fallbackDate: string): number[] {
  // Use IATA code extracted from flight_number ("EY 263" → "EY"), NOT seg.airline
  // which is the full airline name ("Etihad Airways") and invalid as a TFS carrier code.
  const iataCode = airlineCodeFromSeg(seg)
  const num = flightNumOnly(seg)
  return [
    ...pbStr(1, seg.dep),
    ...pbStr(2, segmentDate(seg, fallbackDate)),
    ...pbStr(3, seg.arr),
    ...(iataCode ? pbStr(5, iataCode) : []),
    ...(num ? pbStr(6, num) : []),
  ]
}

/**
 * Build a LegGroup proto message.
 * Field 6  = leg-level carrier code (from first segment; present in live GF booking URLs)
 * Field 13 = leg's departure airport (IATA), field 14 = leg's final arrival airport (IATA).
 * This matches live Google Flights booking URLs: each leg carries its own OD pair,
 * not the trip-level destination.
 */
function buildLegProto(
  legDate: string,
  segs: NormalizedSegment[],
  legOrigin: string,
  legDest: string,
): number[] {
  // LegGroup.6 = dominant carrier for the leg (first segment's IATA code)
  const legCarrier = segs.length > 0 ? airlineCodeFromSeg(segs[0]) : ''
  return [
    ...pbStr(2, legDate),
    ...segs.flatMap(s => pbLen(4, buildSegmentProto(s, legDate))),
    ...(legCarrier ? pbStr(6, legCarrier) : []),
    ...pbLen(13, airportNode(legOrigin)),
    ...pbLen(14, airportNode(legDest)),
  ]
}

/**
 * Build a Google Flights deep-link with specific flight numbers pre-selected.
 * Uses the TFS protobuf parameter (reverse-engineered from live GF booking URLs).
 * Navigates to /travel/flights (search page with flights highlighted).
 *
 * Falls back gracefully: returns null if segments have no flight numbers.
 *
 * @param roundTrip  Pass `true` when the search is a round trip even if `returnIt`
 *   is null (e.g. linking to just the outbound leg of a round-trip search).
 *   When `returnIt` is provided, the trip is always treated as round-trip regardless.
 *   Controls root.2 and root.19 in the TFS protobuf (1 = one-way, 2 = round-trip).
 * @param travelClass  Cabin class: 1=Economy (default), 2=Premium Economy, 3=Business, 4=First.
 *   Maps to TFS root.9.
 */
export function buildGoogleFlightsDeepLink(
  outbound: NormalizedItinerary,
  outboundDate: string,
  returnIt: NormalizedItinerary | null = null,
  returnDate: string | null = null,
  adults = 1,
  children = 0,
  roundTrip = false,
  travelClass = 1,
): string | null {
  // Need at least one segment with a flight number
  if (!outbound.segments.some(s => s.flightNumber)) return null

  const isRoundTrip = returnIt != null || roundTrip
  const outOrigin = outbound.segments[0]?.dep ?? ''
  const outDest = outbound.segments.at(-1)?.arr ?? ''
  // Use the first segment's actual departure date for LegGroup.2.
  // outboundDate may be a search-range start (e.g. "2026-08-01") while the
  // itinerary departs on "2026-08-10" — GF falls back to the search landing
  // page if LegGroup.2 doesn't match the segment dates.
  const outLegDate = outbound.segments[0]?.depTime?.slice(0, 10) || outboundDate
  const outLeg = buildLegProto(outLegDate, outbound.segments, outOrigin, outDest)

  const bytes: number[] = [
    ...pbVarint(1, 28),
    ...pbVarint(2, isRoundTrip ? 2 : 1),
    ...pbLen(3, outLeg),
  ]

  if (returnIt && returnDate) {
    const retOrigin = returnIt.segments[0]?.dep ?? ''
    const retDest = returnIt.segments.at(-1)?.arr ?? ''
    // Same: use actual return first-segment date, not search range start.
    const retLegDate = returnIt.segments[0]?.depTime?.slice(0, 10) || returnDate
    bytes.push(...pbLen(3, buildLegProto(retLegDate, returnIt.segments, retOrigin, retDest)))
  }

  // Passengers: field 8 is repeated — one entry per passenger.
  // Value 1 = adult, value 2 = child (confirmed by live GF URL diff).
  const adultCount = Math.max(1, adults)
  const childCount = Math.max(0, children)
  for (let i = 0; i < adultCount; i++) bytes.push(...pbVarint(8, 1))
  for (let i = 0; i < childCount; i++) bytes.push(...pbVarint(8, 2))
  // Cabin class: 1=Economy, 2=Premium Economy, 3=Business, 4=First (TFS root.9)
  bytes.push(...pbVarint(9, travelClass))
  // Additional root fields present in all observed Google Flights booking URLs.
  // root.14 = 1 (constant); root.16 = { 1: max-uint64 }; root.19 mirrors trip type.
  bytes.push(...pbVarint(14, 1))
  bytes.push(...pbLen(16, [...pbVarintBytes((1 << 3) | 0), ...MAX_UINT64_VARINT]))
  bytes.push(...pbVarint(19, isRoundTrip ? 2 : 1))

  // Encode as base64url (no padding, + → -, / → _)
  let binaryStr = ''
  for (const b of bytes) binaryStr += String.fromCharCode(b)
  const b64 = btoa(binaryStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return `https://www.google.com/travel/flights/booking?tfs=${b64}`
}

// ---------------------------------------------------------------------------

const MAX_AIRPORTS_FOR_DEEP_LINK = 2

/** Natural-language style URL; may not reproduce exact multi-stop routing. */
export function buildGoogleFlightsSearchUrl(
  origins: string[],
  destinations: string[],
  outboundDate: string,
  returnDate: string | null,
): { url: string; reliable: boolean } {
  const reliable =
    origins.length <= MAX_AIRPORTS_FOR_DEEP_LINK &&
    destinations.length <= MAX_AIRPORTS_FOR_DEEP_LINK

  // GF's ?q= natural-language endpoint only understands a single airport code per
  // origin/destination — comma-separated codes like "JFK,EWR" are not parsed and
  // result in the generic landing page being shown. Use the first code of each.
  const from = origins[0] ?? ''
  const to = destinations[0] ?? ''
  let q = `Flights from ${from} to ${to} on ${outboundDate}`
  if (returnDate) q += ` through ${returnDate}`
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`
  return { url, reliable }
}

export function itineraryDetailsText(
  it: NormalizedItinerary,
  label: string,
  date: string,
): string {
  const lines = [
    `${label} — ${date}`,
    `Waypoints: ${it.waypointKey}`,
    `Total: ${Math.round(it.totalDurationMinutes / 60)}h ${it.totalDurationMinutes % 60}m`,
    ...it.segments.map(
      (s, i) =>
        `  ${i + 1}. ${s.dep} → ${s.arr}  ${s.airline ?? ''} ${s.flightNumber ?? ''}  ${fmt(s.durationMinutes)}  ${s.airplane ?? ''}`,
    ),
  ]
  if (it.layovers.length) {
    lines.push('Layovers:')
    for (const l of it.layovers) {
      lines.push(
        `  ${l.airport}  ${fmt(l.durationMinutes)}${l.isTechnical ? ' (technical?)' : ''}${l.excludedRegionButAllowed ? ' [excluded region]' : ''}`,
      )
    }
  }
  return lines.join('\n')
}

function fmt(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}m`
}
