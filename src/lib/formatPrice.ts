/** Compact currency for filter labels and histogram axis (no decimals). */
export function formatPriceAmount(amount: number, currency: string): string {
  const code = currency.trim() || 'USD'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${code} ${Math.round(amount)}`
  }
}

export function currencySuffixSymbol(currency: string): string {
  const code = currency.trim() || 'USD'
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? '$'
  } catch {
    return '$'
  }
}
