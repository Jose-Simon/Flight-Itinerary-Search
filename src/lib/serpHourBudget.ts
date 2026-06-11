import { isSerpThrottleMessage } from './serpQueryEstimate'

export const SERP_HOURLY_LIMIT_DEFAULT = 200

export type SerpBudgetCallKind = 'scan' | 'autoDeepen' | 'clickDeepen'

export type SerpHourSnapshot = {
  usedThisHour: number
  hourLimit: number
  sessionCalls: number
  remaining: number
  /** Calls held back for user click-to-deepen (Balanced mode). */
  clickReserve: number
  /** Unused portion of click reserve this session. */
  clickReserveRemaining: number
  /** Calls auto-deepen may still spend this session (remaining − clickReserve). */
  remainingForAutoDeepen: number
  autoDeepenCalls: number
  clickDeepenCalls: number
}

export class SerpSearchPausedError extends Error {
  readonly kind: 'hour_budget' | 'api_throttle' | 'user_cancelled'

  constructor(kind: 'hour_budget' | 'api_throttle' | 'user_cancelled', message?: string) {
    super(
      message ??
        (kind === 'hour_budget'
          ? 'Hourly SerpApi search limit reached for this run.'
          : kind === 'user_cancelled'
            ? 'Stopped by user — partial results shown.'
            : 'SerpApi hourly search limit reached.'),
    )
    this.name = 'SerpSearchPausedError'
    this.kind = kind
  }
}

/** Set when the user clicks Stop; cleared when a new search/refresh run starts. */
let userStopRequested = false

export function requestSerpSearchStop(): void {
  userStopRequested = true
}

export function clearSerpSearchStop(): void {
  userStopRequested = false
}

export function isSerpSearchStopRequested(): boolean {
  return userStopRequested
}

/** Throws {@link SerpSearchPausedError} with kind `user_cancelled` when stop was requested. */
export function throwIfSerpSearchStopRequested(): void {
  if (userStopRequested) {
    throw new SerpSearchPausedError('user_cancelled')
  }
}

export function isSerpSearchPausedError(e: unknown): e is SerpSearchPausedError {
  return e instanceof SerpSearchPausedError
}

/** Throw pause error on throttle messages; otherwise a normal Error. */
export function throwSerpResponseError(errMsg: string, httpStatus?: number): never {
  const msg = errMsg || (httpStatus != null ? `Request failed (${httpStatus})` : 'SerpApi search error')
  if (isSerpThrottleMessage(msg)) {
    throw new SerpSearchPausedError('api_throttle', msg)
  }
  throw new Error(msg)
}

export class SerpHourBudget {
  readonly hourLimit: number
  private sessionCalls = 0
  private autoDeepenCalls = 0
  private clickDeepenCalls = 0
  private clickReserve = 0
  private readonly baseline: number
  private readonly onChange?: (snap: SerpHourSnapshot) => void

  constructor(opts: {
    hourLimit: number
    baselineUsed: number
    onChange?: (snap: SerpHourSnapshot) => void
  }) {
    this.hourLimit = Math.max(1, opts.hourLimit)
    this.baseline = Math.max(0, opts.baselineUsed)
    this.onChange = opts.onChange
    this.onChange?.(this.snapshot())
  }

  /** Reserve headroom for click-to-deepen (Balanced). Auto-deepen will not consume these calls. */
  setClickReserve(calls: number): void {
    this.clickReserve = Math.max(0, Math.floor(calls))
    this.onChange?.(this.snapshot())
  }

  get clickReserveRemaining(): number {
    return Math.max(0, this.clickReserve - this.clickDeepenCalls)
  }

  get usedThisHour(): number {
    return this.baseline + this.sessionCalls
  }

  get remaining(): number {
    return Math.max(0, this.hourLimit - this.usedThisHour)
  }

  /** Budget available to priority auto-deepen (excludes click reserve). */
  get remainingForAutoDeepen(): number {
    return Math.max(0, this.remaining - this.clickReserveRemaining)
  }

  snapshot(): SerpHourSnapshot {
    return {
      usedThisHour: this.usedThisHour,
      hourLimit: this.hourLimit,
      sessionCalls: this.sessionCalls,
      remaining: this.remaining,
      clickReserve: this.clickReserve,
      clickReserveRemaining: this.clickReserveRemaining,
      remainingForAutoDeepen: this.remainingForAutoDeepen,
      autoDeepenCalls: this.autoDeepenCalls,
      clickDeepenCalls: this.clickDeepenCalls,
    }
  }

  assertCanCall(kind: SerpBudgetCallKind = 'scan'): void {
    throwIfSerpSearchStopRequested()
    if (this.remaining <= 0) {
      throw new SerpSearchPausedError(
        'hour_budget',
        `Hourly SerpApi limit reached (${this.usedThisHour}/${this.hourLimit} this hour). Search paused — results below are partial.`,
      )
    }
    if (kind === 'autoDeepen' && this.remainingForAutoDeepen <= 0) {
      throw new SerpSearchPausedError(
        'hour_budget',
        `Auto-deepen budget exhausted (${this.clickReserveRemaining} call(s) reserved for cell clicks).`,
      )
    }
  }

  recordCall(kind: SerpBudgetCallKind = 'scan'): void {
    this.sessionCalls++
    if (kind === 'autoDeepen') this.autoDeepenCalls++
    if (kind === 'clickDeepen') this.clickDeepenCalls++
    this.onChange?.(this.snapshot())
  }
}

let activeBudget: SerpHourBudget | null = null

export function setActiveSerpHourBudget(budget: SerpHourBudget | null): void {
  activeBudget = budget
}

export function getActiveSerpHourBudget(): SerpHourBudget | null {
  return activeBudget
}

export function createSerpHourBudget(opts: {
  hourLimit: number
  baselineUsed: number
  onChange?: (snap: SerpHourSnapshot) => void
}): SerpHourBudget {
  return new SerpHourBudget(opts)
}

export function formatSerpHourCounter(snap: SerpHourSnapshot): string {
  let s = `SerpApi ${snap.usedThisHour}/${snap.hourLimit} this hour (${snap.sessionCalls} this search)`
  if (snap.clickReserve > 0) {
    s += ` · ${snap.clickReserveRemaining} reserved for clicks`
    s += ` · ${snap.remainingForAutoDeepen} auto-deepen left`
  }
  return s
}
