import { ROUND_TRIP_DEEPEN_BATCH } from './roundTripSearchLimits'

/** How price-window RT search spends SerpApi calls after the initial grid scan. */
export type PriceWindowSearchMode = 'fast' | 'balanced' | 'exhaustive' | 'tranche'

export const PW_SEARCH_MODE_STORAGE_KEY = 'flight-itinerary-discovery-pw-search-mode'

/** Top date pairs to auto-deepen in Balanced mode. */
export const PW_BALANCED_TOP_CELLS = 25
/** Token calls per selected pair in Balanced auto-deepen (one batch). */
export const PW_BALANCED_TOKENS_PER_CELL = ROUND_TRIP_DEEPEN_BATCH
/** Headroom reserved for user click-to-deepen (not used by auto-deepen). */
export const PW_BALANCED_CLICK_RESERVE = 20

export const PW_BALANCED_AUTO_DEEPEN_MAX =
  PW_BALANCED_TOP_CELLS * PW_BALANCED_TOKENS_PER_CELL

export function loadPriceWindowSearchMode(): PriceWindowSearchMode {
  const v = localStorage.getItem(PW_SEARCH_MODE_STORAGE_KEY)
  if (v === 'fast' || v === 'balanced' || v === 'exhaustive') return v
  if (localStorage.getItem('flight-itinerary-discovery-pw-adaptive-deepen') === '1') {
    return 'exhaustive'
  }
  return 'balanced'
}

export function savePriceWindowSearchMode(mode: PriceWindowSearchMode): void {
  localStorage.setItem(PW_SEARCH_MODE_STORAGE_KEY, mode)
}

export function priceWindowSearchModeLabel(mode: PriceWindowSearchMode): string {
  switch (mode) {
    case 'fast':
      return 'Fast scan'
    case 'balanced':
      return 'Balanced'
    case 'exhaustive':
      return 'Exhaustive'
    case 'tranche':
      return 'Scheduled'
    default:
      return mode
  }
}

export function priceWindowSearchModeDescription(mode: PriceWindowSearchMode): string {
  switch (mode) {
    case 'fast':
      return 'Initial price per date pair only. Deepen individual cells on click.'
    case 'balanced':
      return `Initial scan, then auto-deepen top ${PW_BALANCED_TOP_CELLS} cells (≈${PW_BALANCED_AUTO_DEEPEN_MAX} calls), ${PW_BALANCED_CLICK_RESERVE} calls reserved for clicks.`
    case 'exhaustive':
      return 'Initial scan + adaptive deepen on all pairs while hourly budget allows (legacy).'
    case 'tranche':
      return 'Full date-pair grid, then remaining hourly budget for returns; later runs use Settings calls/hr.'
    default:
      return ''
  }
}
