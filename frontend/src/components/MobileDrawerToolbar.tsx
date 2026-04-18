import { Menu } from 'lucide-react'

interface MobileDrawerToolbarProps {
  title: string
  onOpenDrawer: () => void
  openLabel: string
}

export function MobileDrawerToolbar({
  title,
  onOpenDrawer,
  openLabel,
}: MobileDrawerToolbarProps) {
  return (
    <div className="sticky top-0 z-30 border-b border-cz-border bg-cz-surface px-4 py-3 lg:hidden">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenDrawer}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text"
          aria-label={openLabel}
          title={openLabel}
        >
          <Menu size={16} />
        </button>
        <span className="text-sm font-medium text-cz-text">{title}</span>
      </div>
    </div>
  )
}
