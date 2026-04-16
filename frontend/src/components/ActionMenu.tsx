import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis, type LucideIcon } from 'lucide-react'

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
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; minWidth: number }>({
    top: 0,
    left: 0,
    minWidth: 192,
  })

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      if (!buttonRef.current) return

      const rect = buttonRef.current.getBoundingClientRect()
      const viewportPadding = 8
      const fallbackWidth = 192
      const menuWidth = menuRef.current?.offsetWidth ?? fallbackWidth
      let left = rect.right - menuWidth
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - menuWidth - viewportPadding))

      let top = rect.bottom + 4
      const maxTop = window.innerHeight - viewportPadding
      if (top > maxTop) {
        top = maxTop
      }

      setMenuPosition({
        top,
        left,
        minWidth: Math.max(rect.width, fallbackWidth),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    // Capture scroll from any scroll container, not just window.
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const clickedInsideTrigger = rootRef.current?.contains(target)
      const clickedInsideMenu = menuRef.current?.contains(target)
      if (!clickedInsideTrigger && !clickedInsideMenu) {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open])

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
