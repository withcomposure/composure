import type { ReactNode } from 'react'

interface SegmentedControlOption<T extends string> {
  value: T
  label: ReactNode
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly (T | SegmentedControlOption<T>)[]
  onChange: (next: T) => void
  ariaLabel: string
}

export function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel }: SegmentedControlProps<T>) {
  return (
    <div className="inline-flex h-8 shrink-0 items-stretch rounded-md border border-cz-border bg-cz-bg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const normalized = typeof option === 'string'
          ? { value: option, label: option[0].toUpperCase() + option.slice(1) }
          : option

        return (
        <button
          key={normalized.value}
          type="button"
          role="radio"
          aria-checked={value === normalized.value}
          onClick={() => onChange(normalized.value)}
          className={`inline-flex items-center px-3 text-xs font-medium first:rounded-l-md last:rounded-r-md ${
            value === normalized.value
              ? 'bg-cz-accent text-white'
              : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'
          }`}
        >
          {normalized.label}
        </button>
        )
      })}
    </div>
  )
}
