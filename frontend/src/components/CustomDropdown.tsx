import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useMenuPosition } from '@/hooks/useMenuPosition'

interface DropdownOption<T extends string> {
  value: T
  label: string
  icon: LucideIcon
}

interface CustomDropdownProps<T extends string> {
  value: T
  options: Array<DropdownOption<T>>
  onChange: (value: T) => void
  className?: string
  menuClassName?: string
}

export function CustomDropdown<T extends string>({
  value,
  options,
  onChange,
  className = '',
  menuClassName = '',
}: CustomDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => {
    setOpen(false)
  }, [])
  const menuPosition = useMenuPosition(buttonRef, menuRef, {
    enabled: open,
    fallbackWidth: 176,
  })

  const selected = options.find((option) => option.value === value) ?? options[0]

  useClickOutside([rootRef, menuRef], closeMenu, open)
  useEscapeKey(closeMenu, open)

  if (!selected) return null

  const SelectedIcon = selected.icon

  return (
    <div ref={rootRef} className={`relative ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 whitespace-nowrap rounded-md border border-cz-border bg-cz-surface px-2 py-2 text-xs text-cz-text outline-none hover:bg-cz-surface-hover"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SelectedIcon size={14} className="text-cz-text-muted" />
        <span>{selected.label}</span>
        <ChevronDown size={14} className="text-cz-text-muted" />
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
                  onClick={() => {
                    onChange(option.value)
                    closeMenu()
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                    active ? 'bg-cz-accent-muted text-cz-text' : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'
                  }`}
                >
                  <OptionIcon size={14} />
                  <span className="flex-1">{option.label}</span>
                  {active && <Check size={13} className="text-cz-accent" />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
