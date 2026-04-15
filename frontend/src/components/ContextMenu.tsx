import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'

export interface ContextMenuItem {
  icon: LucideIcon
  name: string
  action: () => void
  danger?: boolean
  disabled?: boolean
}

interface ContextMenuProps {
  open: boolean
  position: { x: number; y: number }
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ open, position, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 min-w-[150px] rounded-md border border-pm-border bg-pm-surface p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.name}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.action()
              onClose()
            }}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
              item.disabled
                ? 'text-pm-text-muted/40 cursor-not-allowed'
                : item.danger
                  ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                  : 'text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text'
            }`}
          >
            <Icon size={12} />
            {item.name}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
