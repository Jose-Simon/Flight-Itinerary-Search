export type RoundTripSortMode = 'price' | 'duration' | 'both'

const STORAGE_KEY = 'flight-itinerary-discovery-pw-rt-sort-mode'
const LEGACY_KEY = 'flight-itinerary-discovery-pw-rt-price-only'

export function loadRoundTripSortMode(): RoundTripSortMode {
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === 'price' || v === 'duration' || v === 'both') return v
  return localStorage.getItem(LEGACY_KEY) !== '0' ? 'price' : 'both'
}

export function saveRoundTripSortMode(mode: RoundTripSortMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}

export function roundTripInitialQueriesPerPair(mode: RoundTripSortMode): number {
  return mode === 'both' ? 2 : 1
}

export function sortModeFromFlags(price: boolean, duration: boolean): RoundTripSortMode {
  if (price && duration) return 'both'
  if (price) return 'price'
  if (duration) return 'duration'
  return 'price'
}

export function sortModeToFlags(mode: RoundTripSortMode): { price: boolean; duration: boolean } {
  return {
    price: mode === 'price' || mode === 'both',
    duration: mode === 'duration' || mode === 'both',
  }
}

export function roundTripSortModeLabel(mode: RoundTripSortMode): string {
  switch (mode) {
    case 'price':
      return 'Price'
    case 'duration':
      return 'Duration'
    case 'both':
      return 'Price + duration'
  }
}

export function isSingleSortMode(mode: RoundTripSortMode): boolean {
  return mode === 'price' || mode === 'duration'
}
