import { describe, expect, it } from 'vitest'
import { legVerificationKey, vKey } from '../db/priceVerificationRepo'
import { buildPriceWindowResult, makeRouteGroupKey } from './routeGrouping'
import { minCombinedForDatePair } from './priceOverrides'
import { snapshotPricesForCell, validateAllTotalGridCells } from './pwPriceConsistencyCheck'
import type { NormalizedItinerary } from './types'
import type { RoundTripCombo } from './roundTripTypes'

function stubIt(
  dep: string,
  arr: string,
  airline: string,
  price: number,
  waypointKey: string,
  depTime = '10:00',
): NormalizedItinerary {
  return {
    waypointKey,
    price,
    totalDurationMinutes: 600,
    segments: [
      {
        dep,
        arr,
        airline,
        flightNumber: `${airline}100`,
        depTime,
        arrTime: '22:00',
        durationMinutes: 600,
      },
    ],
    layovers: [],
    airlines: [airline],
  }
}

describe('pwPriceConsistencyCheck', () => {
  it('keeps total, outbound, return, heatmap, and hero aligned for a priced cell', () => {
    const outIt = stubIt('JFK', 'MAA', 'QR', 2100, 'JFK-DOH-MAA')
    const retIt = stubIt('MAA', 'JFK', 'QR', 1966, 'MAA-DOH-JFK', '04:20')
    const routeKey = makeRouteGroupKey(outIt)

    const outResult = buildPriceWindowResult([
      { date: '2026-07-07', itineraries: [outIt] },
    ])
    const retResult = buildPriceWindowResult([
      { date: '2026-08-30', itineraries: [retIt] },
    ])

    const combos: RoundTripCombo[] = [
      {
        routeKey,
        outDate: '2026-07-07',
        retDate: '2026-08-30',
        outIt,
        retIt,
        roundTripPrice: 4066,
      },
    ]

    const ctx = { outResult, retResult, roundTripCombos: combos }
    const snap = snapshotPricesForCell(ctx, routeKey, '2026-07-07')
    expect(snap).not.toBeNull()
    expect(snap!.pairMin).toBe(4066)
    expect(snap!.totalGrid).toBe(4066)
    expect(snap!.outboundGrid).toBe(4066)
    expect(snap!.returnGrid).toBe(4066)
    expect(snap!.heatmap).toBe(4066)
    expect(snap!.heroFare).toBe(4066)

    const report = validateAllTotalGridCells(ctx)
    expect(report.checked).toBe(1)
    expect(report.mismatches).toEqual([])
  })

  it('reports mismatches when return grid price diverges', () => {
    const outIt = stubIt('JFK', 'MAA', 'QR', 2100, 'JFK-DOH-MAA')
    const retItCheap = stubIt('MAA', 'JFK', 'QR', 1966, 'MAA-DOH-JFK', '04:20')
    const retItExpensive = stubIt('MAA', 'JFK', 'QR', 2500, 'MAA-DOH-JFK', '18:00')
    const routeKey = makeRouteGroupKey(outIt)

    const outResult = buildPriceWindowResult([
      { date: '2026-07-07', itineraries: [outIt] },
    ])
    const retResult = buildPriceWindowResult([
      { date: '2026-08-30', itineraries: [retItCheap, retItExpensive] },
    ])

    const combos: RoundTripCombo[] = [
      {
        routeKey,
        outDate: '2026-07-07',
        retDate: '2026-08-30',
        outIt,
        retIt: retItCheap,
        roundTripPrice: 4066,
      },
      {
        routeKey,
        outDate: '2026-07-07',
        retDate: '2026-08-30',
        outIt,
        retIt: retItExpensive,
        roundTripPrice: 4675,
      },
    ]

    const ctx = { outResult, retResult, roundTripCombos: combos }
    const snap = snapshotPricesForCell(ctx, routeKey, '2026-07-07')
    expect(snap!.pairMin).toBe(4066)
    expect(snap!.totalGrid).toBe(4066)
    expect(snap!.returnGrid).toBe(4066)
  })

  it('uses min of verified-updated and next-cheapest schedule (6472 verified → cell shows 5377)', () => {
    const outCheap = stubIt('JFK', 'MAA', 'EY', 4587, 'JFK-AUH-MAA', '22:20')
    const outAlt = stubIt('JFK', 'MAA', 'EY', 5377, 'JFK-AUH-MAA', '15:45')
    const retIt = stubIt('MAA', 'JFK', 'EY', 4587, 'MAA-AUH-JFK', '21:55')
    const routeKey = makeRouteGroupKey(outCheap)

    const outResult = buildPriceWindowResult([
      { date: '2026-07-05', itineraries: [outCheap, outAlt] },
    ])
    const retResult = buildPriceWindowResult([
      { date: '2026-08-27', itineraries: [retIt] },
    ])

    const combos: RoundTripCombo[] = [
      {
        routeKey,
        outDate: '2026-07-05',
        retDate: '2026-08-27',
        outIt: outCheap,
        retIt,
        roundTripPrice: 4587,
      },
      {
        routeKey,
        outDate: '2026-07-05',
        retDate: '2026-08-27',
        outIt: outAlt,
        retIt,
        roundTripPrice: 5377,
      },
    ]

    const verifications = new Map([
      [
        vKey(routeKey, legVerificationKey(outCheap), legVerificationKey(retIt)),
        {
          id: 1,
          routeKey,
          outDate: '2026-07-05',
          retDate: '2026-08-27',
          outDepTime: legVerificationKey(outCheap),
          retDepTime: legVerificationKey(retIt),
          verifiedPrice: 6472,
          currency: 'USD',
          paxDesc: '',
          note: '',
          updatedAt: Date.now(),
        },
      ],
    ])

    const pairMin = minCombinedForDatePair(
      routeKey,
      '2026-07-05',
      '2026-08-27',
      outResult,
      retResult,
      verifications,
      combos,
    )
    expect(pairMin).toBe(5377)
  })
})
