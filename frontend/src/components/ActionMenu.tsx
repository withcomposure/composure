import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis, type LucideIcon } from 'lucide-react'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useEscapeKey } from '@/hooks/use-escape-key'
import { useMenuPosition } from '@/hooks/use-menu-position'

interface ActionMenuItem {
  id: string
  label: string
  icon: LucideIcon
  danger?: boolean
  onSelect: () => void
}

interface ActionMenuProps {
  items: ActionMenuItem[]
  ariaLabel: string
}

export function ActionMenu({ items, ariaLabel }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => {
    setOpen(false)
  }, [])
  const menuPosition = useMenuPosition(buttonRef, menuRef, {
    enabled: open,
    fallbackWidth: 192,
    trackMinWidth: true,
  })

  useClickOutside([rootRef, menuRef], closeMenu, open)
  useEscapeKey(closeMenu, open)

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="rounded-md border border-transparent p-1.5 text-cz-text-muted hover:border-cz-border hover:bg-cz-surface-hover hover:text-cz-text"
      >
        <Ellipsis size={16} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[100] overflow-hidden rounded-lg border border-cz-border bg-cz-surface p-1 shadow-xl"
            style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px`, minWidth: `${menuPosition.minWidth}px` }}
          >
            {items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpen(false)
                    item.onSelect()
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${item.danger ? 'text-red-300 hover:bg-red-500/15' : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'}`}
                >
                  <Icon size={14} />
                  {item.label}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
