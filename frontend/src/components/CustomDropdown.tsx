import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'

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
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      const viewportPadding = 8
      const fallbackWidth = 176
      const menuWidth = menuRef.current?.offsetWidth ?? fallbackWidth
      let left = rect.right - menuWidth
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - menuWidth - viewportPadding))
      let top = rect.bottom + 4
      const maxTop = window.innerHeight - viewportPadding
      if (top > maxTop) top = maxTop
      setMenuPosition({ top, left })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const clickedInside = rootRef.current?.contains(target)
      const clickedMenu = menuRef.current?.contains(target)
      if (!clickedInside && !clickedMenu) {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [open])

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
                    setOpen(false)
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
