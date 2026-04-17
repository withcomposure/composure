import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useEscapeKey } from '@/hooks/use-escape-key'

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

  useClickOutside([ref], onClose, open)
  useEscapeKey(onClose, open)

  if (!open) return null

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 min-w-[150px] rounded-md border border-cz-border bg-cz-surface p-1 shadow-lg"
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
                ? 'text-cz-text-muted/40 cursor-not-allowed'
                : item.danger
                  ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                  : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'
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
