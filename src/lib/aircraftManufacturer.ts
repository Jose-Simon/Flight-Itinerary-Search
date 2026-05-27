/** Group aircraft type strings (from schedules) under a manufacturer for filter UI. */

export function inferAircraftManufacturer(aircraft: string): string {
  const t = aircraft.trim()
  if (!t) return 'Other'
  const lower = t.toLowerCase()
  if (lower.startsWith('boeing')) return 'Boeing'
  if (lower.startsWith('airbus')) return 'Airbus'
  if (lower.startsWith('embraer')) return 'Embraer'
  if (lower.startsWith('atr ') || lower.startsWith('atr-')) return 'ATR'
  if (lower.startsWith('bombardier') || lower.startsWith('canadair')) return 'Bombardier'
  if (lower.startsWith('de havilland')) return 'De Havilland'
  if (lower.startsWith('mcdonnell')) return 'McDonnell Douglas'
  if (lower.startsWith('comac')) return 'COMAC'
  if (lower.startsWith('mitsubishi')) return 'Mitsubishi'
  if (lower.startsWith('sukhoi')) return 'Sukhoi'
  if (lower.startsWith('tupolev')) return 'Tupolev'
  if (lower.startsWith('antonov')) return 'Antonov'
  if (lower.startsWith('fokker')) return 'Fokker'
  if (lower.startsWith('saab')) return 'Saab'
  return 'Other'
}

export function compareManufacturerNames(a: string, b: string): number {
  if (a === 'Other') return 1
  if (b === 'Other') return -1
  return a.localeCompare(b)
}
