import type { PriceWindowSearchMode } from './priceWindowSearchMode'
import { routeKeysFromPairMeta, type RoundTripPairMeta } from './roundTripPairMeta'

export function formatPriceWindowRoundTripStatus(opts: {
  mode: PriceWindowSearchMode
  pairMeta: RoundTripPairMeta[]
  pairsTotal?: number
  pairsCompleted?: number
  combosCount: number
  autoDeepenedCells?: number
  pausedEarly?: boolean
  pauseReason?: string
  routesRemaining?: number
  filterLine?: string | null
}): string {
  const prefix = opts.filterLine ? `${opts.filterLine}. ` : ''
  const total = opts.pairsTotal ?? opts.pairMeta.length
  const completed = opts.pairsCompleted ?? opts.pairMeta.length
  const routeCount = routeKeysFromPairMeta(opts.pairMeta).length

  if (opts.pausedEarly) {
    const deepenNote =
      opts.routesRemaining != null && opts.routesRemaining > 0
        ? ` ~${opts.routesRemaining} outbound route(s) not yet deepened.`
        : ''
    return (
      `${prefix}Search paused at ${completed}/${total} date pairs` +
      (routeCount > 0 ? ` · ${routeCount} routes on heatmap` : '') +
      (opts.combosCount > 0 ? ` · ${opts.combosCount} combos` : '') +
      `.${deepenNote} ${opts.pauseReason ?? 'SerpApi hourly limit.'}`
    )
  }

  const pairsPhrase = `${completed}/${total} date pair${total === 1 ? '' : 's'} completed`
  const routesPhrase =
    routeCount > 0
      ? `${routeCount} route${routeCount === 1 ? '' : 's'} on heatmap`
      : 'no route prices in grid (check date filters or Serp response)'
  const combosPhrase =
    opts.combosCount > 0
      ? ` · ${opts.combosCount} round-trip combo${opts.combosCount === 1 ? '' : 's'}`
      : ''

  switch (opts.mode) {
    case 'tranche': {
      const allocNote =
        opts.autoDeepenedCells != null && opts.autoDeepenedCells > 0
          ? ` · ${opts.autoDeepenedCells} return fetch${opts.autoDeepenedCells === 1 ? '' : 'es'} (50-25-25)`
          : ''
      return `${prefix}Price window run complete · ${pairsPhrase} · ${routesPhrase}${combosPhrase}${allocNote}. Use cell actions for manual fetches.`
    }
    case 'fast':
      return `${prefix}Fast scan complete · ${pairsPhrase} · ${routesPhrase}${combosPhrase}. Click a cell to fetch return options.`
    case 'balanced': {
      const autoNote =
        opts.autoDeepenedCells != null && opts.autoDeepenedCells > 0
          ? ` · auto-deepened ${opts.autoDeepenedCells} cell${opts.autoDeepenedCells === 1 ? '' : 's'}`
          : ''
      return `${prefix}Balanced scan complete · ${pairsPhrase} · ${routesPhrase}${combosPhrase}${autoNote}. Click other cells to deepen.`
    }
    case 'exhaustive':
      return `${prefix}Exhaustive scan complete · ${pairsPhrase} · ${routesPhrase}${combosPhrase}.`
    default:
      return `${prefix}Scan complete · ${pairsPhrase} · ${routesPhrase}${combosPhrase}.`
  }
}
