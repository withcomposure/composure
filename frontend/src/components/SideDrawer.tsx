import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface SideDrawerProps {
  open: boolean
  title: ReactNode
  ariaLabel?: string
  onClose: () => void
  children: ReactNode
  widthClass?: string
  zIndexClass?: string
}

export function SideDrawer({
  open,
  title,
  ariaLabel = 'Navigation drawer',
  onClose,
  children,
  widthClass = 'w-72',
  zIndexClass = 'z-[70]',
}: SideDrawerProps) {
  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const renderedTitle =
    typeof title === 'string'
      ? <h2 className="text-sm font-semibold text-cz-text">{title}</h2>
      : title

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 ${zIndexClass} transition-opacity duration-140 ease-out lg:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <button
        type="button"
        aria-label="Close navigation drawer"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-140 ease-out ${open ? 'opacity-100' : 'opacity-0'}`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`absolute inset-y-0 left-0 flex h-full max-w-[calc(100vw-2rem)] ${widthClass} flex-col border-r border-cz-border bg-cz-surface shadow-2xl transition-transform duration-140 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between border-b border-cz-border px-4 py-3">
          <div className="min-w-0 flex-1 pr-2">{renderedTitle}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            tabIndex={open ? 0 : -1}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </aside>
    </div>
  )
}
