const STORAGE_KEY = 'flight-itinerary-discovery-pw-last-search-at'

export function recordPwLastSearchAt(iso = new Date().toISOString()): void {
  try {
    localStorage.setItem(STORAGE_KEY, iso)
  } catch {
    /* ignore quota */
  }
}

export function loadPwLastSearchAt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Human-readable “5m ago” / “2h ago” for header chip. */
export function formatTimeSinceSearch(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const sec = Math.max(0, Math.floor((now - t) / 1000))
  if (sec < 60) return sec <= 5 ? 'just now' : `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
