import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface NumberStepperProps {
  /** Current value (controlled). */
  value: number
  /** Minimum allowed value (inclusive). */
  min: number
  /** Maximum allowed value (inclusive). */
  max: number
  /** Increment/decrement step size. Default: 1. */
  step?: number
  /** Called when the user commits a new value via buttons, keyboard, or blur. */
  onChange?: (next: number) => void
  /** Accessible label for the input. */
  ariaLabel: string
  /** Whether the control is disabled. */
  disabled?: boolean
  /** Optional suffix shown after the number (e.g. "s", "MB", "hrs"). */
  suffix?: string
  /** Width class override. Default: "w-20". */
  widthClass?: string
  /** Whether to allow fractional values. Default: false (integers only). */
  allowDecimals?: boolean
}

export function NumberStepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  disabled = false,
  suffix,
  widthClass = 'w-20',
  allowDecimals = false,
}: NumberStepperProps) {
  const [draft, setDraft] = useState(() => {
    if (allowDecimals) {
      return parseFloat(value.toFixed(2)).toString()
    }
    return String(Math.round(value))
  })
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function formatDisplay(n: number): string {
    if (allowDecimals) {
      // Show up to 2 decimal places, strip trailing zeros
      return parseFloat(n.toFixed(2)).toString()
    }
    return String(Math.round(n))
  }

  function clamp(n: number): number {
    const clamped = Math.min(max, Math.max(min, n))
    return allowDecimals ? parseFloat(clamped.toFixed(2)) : Math.round(clamped)
  }

  const commit = (raw: string) => {
    const parsed = allowDecimals ? parseFloat(raw) : parseInt(raw, 10)
    if (Number.isFinite(parsed)) {
      const clamped = clamp(parsed)
      setDraft(formatDisplay(clamped))
      if (clamped !== value) {
        onChange?.(clamped)
      }
    } else {
      // Revert to current value on invalid input.
      setDraft(formatDisplay(value))
    }
  }

  const nudge = (direction: 1 | -1) => {
    const next = clamp(value + step * direction)
    if (next !== value) {
      onChange?.(next)
    }
  }

  const stopHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current)
      holdIntervalRef.current = null
    }
  }

  const startHold = (direction: 1 | -1) => {
    nudge(direction)
    holdTimerRef.current = setTimeout(() => {
      holdIntervalRef.current = setInterval(() => nudge(direction), 80)
    }, 400)
  }

  // Clean up timers on unmount.
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
      if (holdIntervalRef.current) {
        clearInterval(holdIntervalRef.current)
        holdIntervalRef.current = null
      }
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      nudge(1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      nudge(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(draft)
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      setDraft(formatDisplay(value))
      inputRef.current?.blur()
    }
  }

  return (
    <div
      className={`${widthClass} flex h-8 items-stretch rounded-md border border-cz-border bg-cz-bg text-sm transition-colors focus-within:border-cz-accent ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode={allowDecimals ? 'decimal' : 'numeric'}
        value={editing
          ? draft
          : (suffix ? `${formatDisplay(value)}${suffix}` : formatDisplay(value))
        }
        aria-label={ariaLabel}
        disabled={disabled}
        onFocus={() => {
          setEditing(true)
          setDraft(formatDisplay(value))
          // Select all text on focus for quick replacement.
          requestAnimationFrame(() => inputRef.current?.select())
        }}
        onBlur={() => {
          setEditing(false)
          commit(draft)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        className="min-w-0 flex-1 bg-transparent px-2 text-cz-text outline-none tabular-nums"
      />
      <div className="flex flex-col border-l border-cz-border">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Increase ${ariaLabel}`}
          disabled={disabled || value >= max}
          onPointerDown={(e) => {
            e.preventDefault()
            startHold(1)
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          className="flex flex-1 items-center justify-center px-1.5 text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-30"
        >
          <ChevronUp size={12} strokeWidth={2} />
        </button>
        <div className="border-t border-cz-border" />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Decrease ${ariaLabel}`}
          disabled={disabled || value <= min}
          onPointerDown={(e) => {
            e.preventDefault()
            startHold(-1)
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          className="flex flex-1 items-center justify-center px-1.5 text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-30"
        >
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
