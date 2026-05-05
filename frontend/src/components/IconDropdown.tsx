import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useEscapeKey } from '@/hooks/use-escape-key'
import { useMenuPosition } from '@/hooks/use-menu-position'

interface DropdownOption<T extends string> {
  value: T
  label: string
  icon: LucideIcon
  iconColor?: string
  description?: string
  disabled?: boolean
}

interface IconDropdownProps<T extends string> {
  value: T
  options: Array<DropdownOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
  iconOnly?: boolean
  className?: string
  menuClassName?: string
}

export function IconDropdown<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  iconOnly = false,
  className = '',
  menuClassName = '',
}: IconDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const closeMenu = useCallback(() => setOpen(false), [])

  const menuPosition = useMenuPosition(buttonRef, menuRef, {
    enabled: open,
    fallbackWidth: 176,
  })

  const selected = options.find((o) => o.value === value) ?? options[0]

  useClickOutside([rootRef, menuRef], closeMenu, open)
  useEscapeKey(closeMenu, open)

  if (!selected) return null
  const SelectedIcon = selected.icon
  const buttonTitle = selected.label

  return (
    <div ref={rootRef} className={`relative ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center h-7 px-2 gap-1.5 whitespace-nowrap rounded-md border border-cz-border bg-cz-surface text-xs text-cz-text outline-none hover:bg-cz-surface-hover disabled:cursor-not-allowed disabled:opacity-50`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={buttonTitle}
        title={buttonTitle}
      >
        <SelectedIcon
          size={12}
          className="shrink-0 text-cz-text"
          style={selected.iconColor ? { color: selected.iconColor } : undefined}
        />
        {!iconOnly && <span>{selected.label}</span>}
        <ChevronDown size={12} className="shrink-0 text-cz-text" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className={`fixed z-[100] min-w-44 overflow-hidden rounded-lg border border-cz-border bg-cz-surface p-1 shadow-xl ${menuClassName}`.trim()}
            style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
          >
            {options.map((option) => {
              const OptionIcon = option.icon
              const active = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={option.disabled}
                  onClick={() => {
                    if (!option.disabled) {
                      onChange(option.value)
                      closeMenu()
                    }
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? 'bg-cz-accent-muted text-cz-text'
                      : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'
                  }`}
                >
                  <OptionIcon
                    size={14}
                    className="shrink-0"
                    style={option.iconColor ? { color: option.iconColor } : undefined}
                  />
                  <span className="flex-1">
                    {option.label}
                    {option.description && (
                      <span className="block text-[10px] text-cz-text-muted">{option.description}</span>
                    )}
                  </span>
                  {active && <Check size={13} className="shrink-0 text-cz-accent" />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
