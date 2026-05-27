import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Props = {
  selected: boolean
  onClick: () => void
  children: ReactNode
  className?: string
  title?: string
  /** Use with parent `role="radiogroup"` for single-select chip rows. */
  radio?: boolean
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'id'>

export function FilterChip({ selected, onClick, children, className = '', title, radio, ...aria }: Props) {
  return (
    <button
      type="button"
      className={`filter-chip${selected ? ' filter-chip--selected' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? selected : undefined}
      aria-pressed={radio ? undefined : selected}
      title={title}
      {...aria}
    >
      {children}
    </button>
  )
}
