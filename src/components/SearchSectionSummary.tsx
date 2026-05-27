import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  onReset?: () => void
  resetLabel?: string
}

export function SearchSectionSummary({ children, onReset, resetLabel = 'Reset section' }: Props) {
  return (
    <summary className="search-section-summary search-section-summary--row">
      <span className="search-section-summary-text">{children}</span>
      {onReset ? (
        <button
          type="button"
          className="search-section-reset"
          aria-label={resetLabel}
          title={resetLabel}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onReset()
          }}
        >
          ↺
        </button>
      ) : null}
    </summary>
  )
}
