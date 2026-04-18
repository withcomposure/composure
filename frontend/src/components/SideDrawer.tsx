import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface SideDrawerProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  widthClass?: string
  zIndexClass?: string
}

export function SideDrawer({
  open,
  title,
  onClose,
  children,
  widthClass = 'w-[min(20rem,calc(100vw-2rem))]',
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

  if (!open) return null

  return (
    <div className={`fixed inset-0 ${zIndexClass} lg:hidden`}>
      <button
        type="button"
        aria-label="Close navigation drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute inset-y-0 left-0 flex h-full max-w-[calc(100vw-2rem)] ${widthClass} flex-col border-r border-cz-border bg-cz-surface shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-cz-border px-4 py-3">
          <h2 className="text-sm font-semibold text-cz-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
}
