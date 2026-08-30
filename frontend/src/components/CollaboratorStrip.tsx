import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from '@/components/Avatar'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useEscapeKey } from '@/hooks/use-escape-key'
import { useMenuPosition } from '@/hooks/use-menu-position'

const avatarPx = 24

export interface CollaboratorStripPerson {
  name: string
  profileImageUrl: string | null
  isGuest?: boolean
}

export interface CollaboratorStripProps<T extends CollaboratorStripPerson> {
  collaborators: readonly T[]
  /** Number of avatars shown before the "+#" overflow control. */
  maxVisible: number
  getKey: (person: T) => string | number
  onCollaboratorClick: (person: T) => void
  isInteractive?: (person: T) => boolean
  /** When provided, the matching collaborator gets the "active" ring (presence / follow mode). */
  isActive?: (person: T) => boolean
  /**
   * `workspace`: outline ring like the main editor toolbar.
   * `presence`: `ring-2` follow / selection styling for surfaces like the whiteboard toolbar.
   */
  variant?: 'workspace' | 'presence'
  activeRingClassName?: string
  inactiveRingClassName?: string
  getRowSubtitle?: (person: T) => string | undefined
  getAvatarTitle?: (person: T) => string
  className?: string
}

function defaultInteractive(): boolean {
  return true
}

function defaultAvatarTitle<T extends CollaboratorStripPerson>(person: T): string {
  return person.name
}

export function CollaboratorStrip<T extends CollaboratorStripPerson>({
  collaborators,
  maxVisible,
  getKey,
  onCollaboratorClick,
  isInteractive = defaultInteractive,
  isActive,
  variant = 'workspace',
  activeRingClassName = 'ring-amber-400',
  inactiveRingClassName = 'ring-cz-surface',
  getRowSubtitle,
  getAvatarTitle = defaultAvatarTitle,
  className = '',
}: CollaboratorStripProps<T>) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const overflowTriggerRef = useRef<HTMLButtonElement>(null)
  const overflowMenuRef = useRef<HTMLDivElement>(null)

  const closeOverflow = useCallback(() => {
    setOverflowOpen(false)
  }, [])

  const menuPosition = useMenuPosition(overflowTriggerRef, overflowMenuRef, {
    enabled: overflowOpen,
    fallbackWidth: 208,
    offsetY: 8,
  })

  useClickOutside([rootRef, overflowMenuRef], closeOverflow, overflowOpen)
  useEscapeKey(closeOverflow, overflowOpen)

  if (collaborators.length === 0) {
    return null
  }

  const safeMax = Math.max(0, maxVisible)
  const visible = collaborators.slice(0, safeMax)
  const overflowCount = Math.max(0, collaborators.length - safeMax)
  const hasOverflow = overflowCount > 0

  const avatarButtonClass = (person: T): string => {
    const interactive = isInteractive(person)
    const base =
      'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cz-accent'

    if (variant === 'presence') {
      const following = isActive?.(person) ?? false
      const ring = following ? activeRingClassName : inactiveRingClassName
      return [
        base,
        'ring-2 transition-shadow',
        ring,
        interactive ? 'cursor-pointer' : 'cursor-default opacity-45 grayscale',
      ].join(' ')
    }

    return [
      base,
      'outline-2 -outline-offset-1 outline-cz-surface',
      interactive ? 'cursor-pointer' : 'cursor-default opacity-45 grayscale',
    ].join(' ')
  }

  const handleAvatarClick = (person: T) => {
    if (!isInteractive(person)) return
    onCollaboratorClick(person)
  }

  const handleRowClick = (person: T) => {
    if (!isInteractive(person)) return
    onCollaboratorClick(person)
    closeOverflow()
  }

  return (
    <div className={`relative flex items-center mx-1 ${className}`.trim()} ref={rootRef}>
      <div className="flex items-center -space-x-1.5">
        {visible.map((person) => (
          <div key={getKey(person)} className="group relative">
            <button
              type="button"
              onClick={() => handleAvatarClick(person)}
              className={avatarButtonClass(person)}
              title={getAvatarTitle(person)}
              aria-label={getAvatarTitle(person)}
            >
              <Avatar
                name={person.name}
                imageUrl={person.profileImageUrl}
                isGuest={person.isGuest}
                size={avatarPx}
              />
            </button>
            <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-4 -translate-x-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-cz-border bg-cz-surface p-3 shadow-xl whitespace-nowrap">
                <Avatar
                  name={person.name}
                  imageUrl={person.profileImageUrl}
                  isGuest={person.isGuest}
                  size={40}
                />
                <div className="text-xs font-medium text-cz-text">{person.name}</div>
              </div>
            </div>
          </div>
        ))}

        {hasOverflow && (
          <button
            ref={overflowTriggerRef}
            type="button"
            onClick={() => setOverflowOpen((prev) => !prev)}
            className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cz-border bg-cz-surface text-[10px] font-medium text-cz-text-muted ring-2 ring-cz-surface hover:bg-cz-surface-hover"
            title={`${overflowCount} more`}
            aria-label={`${overflowCount} more collaborators`}
            aria-expanded={overflowOpen}
            aria-haspopup="menu"
          >
            +{overflowCount}
          </button>
        )}
      </div>

      {overflowOpen &&
        createPortal(
          <div
            ref={overflowMenuRef}
            role="menu"
            className="fixed z-[100] w-52 rounded-lg border border-cz-border bg-cz-surface p-1.5 shadow-xl"
            style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
          >
            {collaborators.map((person) => {
              const interactive = isInteractive(person)
              const subtitle = getRowSubtitle?.(person)
              return (
                <button
                  key={getKey(person)}
                  type="button"
                  role="menuitem"
                  onClick={() => handleRowClick(person)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    interactive ? 'hover:bg-cz-surface-hover' : 'cursor-default opacity-45 grayscale'
                  }`}
                  title={getAvatarTitle(person)}
                >
                  <Avatar
                    name={person.name}
                    imageUrl={person.profileImageUrl}
                    isGuest={person.isGuest}
                    size={avatarPx}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-cz-text">{person.name}</div>
                    {subtitle !== undefined && (
                      <div className="text-[10px] text-cz-text-muted">{subtitle}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
