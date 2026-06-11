/** Default planned SerpApi calls per clock hour (Settings → Price window). */
export const PW_HOURLY_SERP_CALLS_DEFAULT = 180

export type PwSearchTranche = 'initial' | 'continue'

export function splitReturnBudget(total: number): {
  tier1Calls: number
  tier2Calls: number
  tier3Calls: number
} {
  const tier1Calls = Math.floor(total * 0.5)
  const tier2Calls = Math.floor(total * 0.25)
  const tier3Calls = total - tier1Calls - tier2Calls
  return { tier1Calls, tier2Calls, tier3Calls }
}

export function resolvePwSearchTranche(
  replaceOutbound: boolean,
  hasExistingGrid: boolean,
): PwSearchTranche {
  if (replaceOutbound || !hasExistingGrid) return 'initial'
  return 'continue'
}

/** Cap planned hourly budget by Serp account limit when known. */
export function effectivePwHourLimit(
  accountLimitPerHour: number | undefined,
  plannedHourlySerpCalls: number,
): number {
  const planned = Math.max(1, Math.floor(plannedHourlySerpCalls))
  if (accountLimitPerHour != null && accountLimitPerHour > 0) {
    return Math.min(accountLimitPerHour, planned)
  }
  return planned
}

/** Hour 2+: return-token budget (50-25-25) for a continue run. */
export function returnBudgetForContinue(plannedHourlySerpCalls: number): number {
  return Math.max(0, Math.floor(plannedHourlySerpCalls))
}

/**
 * Hour 1: after the full date-pair grid scan, spend whatever is left in the
 * planned hour (e.g. 180 − 25 pairs = 155 return fetches).
 */
export function returnBudgetAfterInitialScan(
  plannedHourlySerpCalls: number,
  usedThisHour: number,
): number {
  const cap = Math.max(1, Math.floor(plannedHourlySerpCalls))
  return Math.max(0, cap - Math.max(0, usedThisHour))
}
