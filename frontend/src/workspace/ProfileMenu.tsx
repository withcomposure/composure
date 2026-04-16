import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogIn, LogOut, User } from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { useClickOutside } from '../hooks/useClickOutside'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useMenuPosition } from '../hooks/useMenuPosition'

interface ProfileMenuProps {
  name: string
  email?: string | null
  imageUrl: string | null
  isGuest?: boolean
  onOpenSettings?: () => void
  onLogout?: () => void
  onLogin?: () => void
}

export function ProfileMenu({
  name,
  email,
  imageUrl,
  isGuest = false,
  onOpenSettings,
  onLogout,
  onLogin,
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => {
    setOpen(false)
  }, [])
  const menuPosition = useMenuPosition(buttonRef, menuRef, {
    enabled: open,
    fallbackWidth: 256,
  })

  useClickOutside([rootRef, menuRef], closeMenu, open)
  useEscapeKey(closeMenu, open)

  if (isGuest) {
    return (
      <button
        type="button"
        onClick={() => onLogin?.()}
        className="inline-flex items-center gap-2 rounded-md border border-cz-border px-2.5 py-1.5 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
      >
        <LogIn size={13} />
        Log in
      </button>
    )
  }

  return (
    <div ref={rootRef} className="inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-full p-0.5 transition-colors hover:bg-cz-surface-hover"
        title={`Open account menu for ${name}`}
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={name} imageUrl={imageUrl} size={30} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[100] w-64 rounded-xl border border-cz-border bg-cz-surface p-4 shadow-2xl"
          style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
        >
          <div className="mb-4 flex flex-col items-center">
            <Avatar name={name} imageUrl={imageUrl} size={52} />
            <div className="mt-2 text-sm font-medium text-cz-text text-center">{name}</div>
            {email && <div className="mt-0.5 text-xs text-cz-text-muted text-center break-all">{email}</div>}
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                closeMenu()
                onOpenSettings?.()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
            >
              <User size={14} />
              Profile
            </button>
            <button
              type="button"
              onClick={() => {
                closeMenu()
                onLogout?.()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-red-300 hover:bg-red-500/10"
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
