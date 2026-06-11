import { useEffect, useMemo, useState } from 'react'
import {
  estimatePwTrancheSerpQueries,
  validatePriceWindowDateGrid,
  type SerpQueryEstimate,
} from '../lib/serpQueryEstimate'
import { SERP_HOURLY_LIMIT_DEFAULT } from '../lib/serpHourBudget'
import {
  buildFilteredRoundTripDatePairs,
  formatPairFilterStatsLine,
  type PriceWindowPairFilters,
} from '../lib/priceWindowPairFilters'
import { roundTripSortModeLabel, type RoundTripSortMode } from '../lib/roundTripSortMode'
import { PriceWindowPairFiltersFields } from './PriceWindowPairFiltersFields'

type Props = {
  open: boolean
  tripType: 'oneway' | 'round'
  outboundDate: string
  outboundEnd: string
  returnDate: string
  returnEnd: string
  sortMode: RoundTripSortMode
  pairFilters: PriceWindowPairFilters
  hasExistingGrid: boolean
  replaceOutbound: boolean
  plannedHourlySerpCalls: number
  hourUsed?: number
  hourLimit?: number
  onProceed: (opts: {
    sortMode: RoundTripSortMode
    pairFilters: PriceWindowPairFilters
  }) => void
  onCancel: () => void
}

function buildOneWayEstimate(outboundDate: string, outboundEnd: string): SerpQueryEstimate {
  const outDays = Math.max(1, Math.round((Date.parse(outboundEnd) - Date.parse(outboundDate)) / 86400000) + 1)
  const calls = outDays * 2
  return {
    min: calls,
    max: calls,
    datePairs: 0,
    outboundDays: outDays,
    returnDays: 0,
    summary: `~${calls} SerpApi calls (${outDays} outbound day${outDays === 1 ? '' : 's'}, price + duration)`,
  }
}

export function PriceWindowSearchConfirmModal({
  open,
  tripType,
  outboundDate,
  outboundEnd,
  returnDate,
  returnEnd,
  sortMode: initialSortMode,
  pairFilters: initialPairFilters,
  hasExistingGrid,
  replaceOutbound,
  plannedHourlySerpCalls,
  hourUsed,
  hourLimit = SERP_HOURLY_LIMIT_DEFAULT,
  onProceed,
  onCancel,
}: Props) {
  const [sortMode, setSortMode] = useState(initialSortMode)
  const [pairFilters, setPairFilters] = useState(initialPairFilters)

  useEffect(() => {
    if (open) {
      setSortMode(initialSortMode)
      setPairFilters(initialPairFilters)
    }
  }, [open, initialSortMode, initialPairFilters])

  const estimate = useMemo(
    () =>
      tripType === 'round'
        ? estimatePwTrancheSerpQueries({
            outboundDate,
            outboundEnd,
            returnDate,
            returnEnd,
            roundTripSortMode: sortMode,
            pairFilters,
            replaceOutbound,
            hasExistingGrid,
            alsoSearchOneWay: false,
            plannedHourlySerpCalls,
            hourUsedBeforeSearch: hourUsed,
          })
        : buildOneWayEstimate(outboundDate, outboundEnd),
    [
      tripType,
      outboundDate,
      outboundEnd,
      returnDate,
      returnEnd,
      sortMode,
      pairFilters,
      replaceOutbound,
      hasExistingGrid,
      plannedHourlySerpCalls,
      hourUsed,
    ],
  )

  const dateGridError = useMemo(
    () =>
      validatePriceWindowDateGrid({
        tripType,
        outboundDays: estimate.outboundDays,
        returnDays: estimate.returnDays,
        roundTripSortMode: sortMode,
        outboundDate,
        outboundEnd,
        returnDate,
        returnEnd,
        pairFilters,
      }),
    [
      tripType,
      estimate.outboundDays,
      estimate.returnDays,
      sortMode,
      outboundDate,
      outboundEnd,
      returnDate,
      returnEnd,
      pairFilters,
    ],
  )

  const pairFilterStatsLineLive = useMemo(() => {
    if (tripType !== 'round') return null
    const built = buildFilteredRoundTripDatePairs(
      outboundDate,
      outboundEnd,
      returnDate,
      returnEnd,
      pairFilters,
    )
    return formatPairFilterStatsLine(built.stats, pairFilters)
  }, [tripType, outboundDate, outboundEnd, returnDate, returnEnd, pairFilters])

  const hourLeft = hourUsed != null ? Math.max(0, hourLimit - hourUsed) : null
  const hourWarning =
    hourLeft != null && estimate.max > hourLeft && !dateGridError
      ? `May pause partway — est. ${estimate.max} calls, ~${hourLeft} left this Serp hour (${hourUsed}/${hourLimit} used).`
      : null

  if (!open) return null

  const trancheHint =
    tripType === 'round'
      ? replaceOutbound || !hasExistingGrid
        ? `First run: full date-pair grid, then remaining budget for return fetches (50-25-25).`
        : `Later runs: ${plannedHourlySerpCalls} return fetches (50-25-25) — existing grid kept.`
      : null

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-search-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="modal pw-search-confirm-modal">
        <header className="modal-head">
          <h2 id="pw-search-confirm-title">Confirm price window search</h2>
        </header>
        <div className="modal-body">
          {tripType === 'round' && (
            <>
              <p className="muted tiny">{trancheHint}</p>
              {hasExistingGrid && (
                <p className="pw-search-confirm-summary-line">
                  <strong>Mode:</strong>{' '}
                  {replaceOutbound ? 'Replace existing outbound' : 'Continue existing grid'}
                </p>
              )}
              <p className="pw-search-confirm-summary-line">
                <strong>Sort:</strong> {roundTripSortModeLabel(sortMode)}
                <span className="muted tiny">
                  {' '}
                  ({sortMode === 'both' ? '2 queries per date pair' : '1 query per date pair'})
                </span>
              </p>
              <fieldset className="pw-search-confirm-pair-filters">
                <legend className="pw-search-confirm-modes-legend">Date pair filters</legend>
                <PriceWindowPairFiltersFields
                  filters={pairFilters}
                  onChange={setPairFilters}
                  statsLine={pairFilterStatsLineLive}
                  compact
                />
              </fieldset>
              {replaceOutbound && (
                <p className="pw-search-confirm-warn error-inline">
                  Warning: replace clears outbound summaries, tokens, and return combos for this window.
                </p>
              )}
            </>
          )}

          {tripType === 'oneway' && (
            <p className="muted tiny">
              One-way price window runs price + duration SerpApi queries for each outbound date.
            </p>
          )}

          <div className="pw-search-confirm-estimate">
            <strong>Estimated SerpApi usage</strong>
            <p>{estimate.summary}</p>
            {tripType === 'round' && estimate.datePairs > 0 && (
              <p className="muted tiny">
                {estimate.datePairs} valid date pair{estimate.datePairs === 1 ? '' : 's'} ·{' '}
                {estimate.outboundDays} outbound × {estimate.returnDays} return days in range
              </p>
            )}
            {hourUsed != null && (
              <p className="muted tiny">
                Serp account this hour: {hourUsed}/{hourLimit} used before this search
              </p>
            )}
          </div>

          {dateGridError && <p className="error-inline pw-search-confirm-error">{dateGridError}</p>}
          {!dateGridError && hourWarning && (
            <p className="pw-search-confirm-warn muted tiny">{hourWarning}</p>
          )}
          {!dateGridError && !hourWarning && (
            <p className="muted tiny">
              Search may pause if the hourly Serp limit is reached; partial results are kept. Remaining
              hour budget is available for manual cell fetches.
            </p>
          )}
        </div>
        <footer className="modal-foot pw-search-confirm-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!!dateGridError}
            onClick={() => onProceed({ sortMode, pairFilters })}
          >
            Proceed
          </button>
        </footer>
      </div>
    </div>
  )
}
