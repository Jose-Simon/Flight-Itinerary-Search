import type { SavedSearchPayloadV1 } from '../db/savedSearchTypes'

function shortenList(codes: string[], maxBeforePlus: number): string {
  const u = codes.map((c) => c.trim().toUpperCase()).filter(Boolean)
  if (u.length === 0) return '—'
  if (u.length <= maxBeforePlus) return u.join(', ')
  return `${u.slice(0, maxBeforePlus).join(', ')} +${u.length - maxBeforePlus}`
}

/** Short route + dates line used as the saved row title (no prompt). */
export function savedSearchTitleFromPayload(p: SavedSearchPayloadV1): string {
  const o = shortenList(p.origins, 4)
  const d = shortenList(p.destinations, 4)
  const dates =
    p.tripType === 'round' ? `${p.outboundDate} · ${p.returnDate}` : p.outboundDate
  const trip = p.tripType === 'round' ? 'Round' : 'One way'
  return `${o} → ${d} · ${dates} · ${trip} · ±${p.flexDays}d`
}

/** Multi-line parameter summary for the saved card body (muted). */
export function savedSearchDetailLinesFromPayload(p: SavedSearchPayloadV1): string[] {
  const L: string[] = []
  const o = p.origins.map((c) => c.trim().toUpperCase()).filter(Boolean).join(', ')
  const d = p.destinations.map((c) => c.trim().toUpperCase()).filter(Boolean).join(', ')
  L.push(`Origins: ${o || '—'}`)
  L.push(`Destinations: ${d || '—'}`)
  L.push(
    p.tripType === 'round'
      ? `Dates: ${p.outboundDate} outbound · ${p.returnDate} return · flex ±${p.flexDays}d`
      : `Dates: ${p.outboundDate} · flex ±${p.flexDays}d`,
  )
  L.push(
    `Trip: ${p.tripType === 'round' ? 'Round trip' : 'One way'}${p.returnCustomFilters ? ' · separate return filters' : ''} · ${p.searchSource === 'api' ? 'Search API' : 'Search database'}`,
  )
  L.push(
    `Sort: ${p.sortOut} (out)${p.tripType === 'round' ? ` · ${p.sortReturn} (return)` : ''}`,
  )

  const bits: string[] = []
  if (p.outStopsMin.trim() || p.outStopsMax.trim()) {
    bits.push(`Out stops ${p.outStopsMin.trim() || '…'}–${p.outStopsMax.trim() || '…'}`)
  }
  if (p.tripType === 'round' && p.returnCustomFilters && (p.retStopsMin.trim() || p.retStopsMax.trim())) {
    bits.push(`Ret stops ${p.retStopsMin.trim() || '…'}–${p.retStopsMax.trim() || '…'}`)
  }
  if (p.outPrice.min.trim() || p.outPrice.max.trim()) {
    bits.push(
      `Out price ${p.outPrice.min.trim() || '…'}–${p.outPrice.max.trim() || '…'} ${p.settingsSearch.currency}`,
    )
  }
  if (p.tripType === 'round' && p.returnCustomFilters && (p.retPrice.min.trim() || p.retPrice.max.trim())) {
    bits.push(
      `Ret price ${p.retPrice.min.trim() || '…'}–${p.retPrice.max.trim() || '…'} ${p.settingsSearch.currency}`,
    )
  }
  if (p.timeBucketsOut.length) bits.push(`Out time buckets: ${p.timeBucketsOut.join(', ')}`)
  if (p.timeBucketsRet.length) bits.push(`Ret time buckets: ${p.timeBucketsRet.join(', ')}`)
  const outTk = p.outTimeRange.takeoffMin.trim() || p.outTimeRange.takeoffMax.trim()
  const outLd = p.outTimeRange.landingMin.trim() || p.outTimeRange.landingMax.trim()
  if (outTk || outLd) {
    bits.push(
      `Out takeoff ${p.outTimeRange.takeoffMin || '…'}–${p.outTimeRange.takeoffMax || '…'} · landing ${p.outTimeRange.landingMin || '…'}–${p.outTimeRange.landingMax || '…'}`,
    )
  }
  if (p.tripType === 'round' && p.returnCustomFilters) {
    const rt = p.retTimeRange.takeoffMin.trim() || p.retTimeRange.takeoffMax.trim()
    const rl = p.retTimeRange.landingMin.trim() || p.retTimeRange.landingMax.trim()
    if (rt || rl) {
      bits.push(
        `Ret takeoff ${p.retTimeRange.takeoffMin || '…'}–${p.retTimeRange.takeoffMax || '…'} · landing ${p.retTimeRange.landingMin || '…'}–${p.retTimeRange.landingMax || '…'}`,
      )
    }
  }
  if (bits.length) L.push(bits.join(' · '))

  if (p.displayTimezone.trim()) L.push(`Display timezone: ${p.displayTimezone}`)
  if (p.aircraftSelectedCodes.length) {
    L.push(`Aircraft: ${p.aircraftMatchMode} match · ${p.aircraftSelectedCodes.length} type(s)`)
  }
  if (p.airlineExcludedCodes.length) {
    L.push(`Airlines excluded: ${p.airlineExcludedCodes.length}`)
  }
  L.push(
    `Layover geography filter: ${p.layoverGeoFilterActive ? 'on' : 'off'} · Unique airport routes: ${p.uniqueRoutesOnly ? 'yes' : 'no'} · Technical stops: ${p.excludeTechnical ? 'excluded' : 'included'}${p.tripType === 'round' ? ` · Open jaw: ${p.showOpenJaw ? 'shown' : 'hidden'}` : ''}`,
  )
  L.push(
    `API prefs: ${p.settingsSearch.currency.toUpperCase()} · mock ${p.settingsSearch.mockMode ? 'on' : 'off'} · deep ${p.settingsSearch.deepSearch ? 'on' : 'off'} · hidden fares ${p.settingsSearch.showHidden ? 'on' : 'off'}`,
  )
  return L
}
