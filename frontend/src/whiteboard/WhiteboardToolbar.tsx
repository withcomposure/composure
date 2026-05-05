import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Download, Eye, FileImage, FileType2, Pencil, Share2 } from 'lucide-react'
import {
  exportToBlob,
  exportToSvg,
} from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  SocketId,
} from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { CollaboratorStrip } from '@/components/CollaboratorStrip'
import { WorkspaceProjectTitle } from '@/components/WorkspaceProjectTitle'
import { IconDropdown } from '@/components/IconDropdown'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useEscapeKey } from '@/hooks/use-escape-key'
import { useMenuPosition } from '@/hooks/use-menu-position'
import type { ConnectionState } from '@/types'
import { ProfileMenu } from '@/workspace/ProfileMenu'
import type { WhiteboardPresenceUser } from './useWhiteboardCollab'

interface WhiteboardToolbarProps {
  title: string
  canRenameProject: boolean
  onBackToProjects: () => void
  onRenameProject?: (nextTitle: string) => Promise<void>
  onRenameProjectError?: (message: string) => void
  canEdit: boolean
  canRoleEdit: boolean
  connectionState: ConnectionState
  activeCollaborators: WhiteboardPresenceUser[]
  followedSocketId: SocketId | null
  onFollowCollaborator: (socketId: SocketId, username: string) => void
  exporting: boolean
  accountLabel: string
  accountEmail: string | null
  accountImageUrl: string | null
  accountIsGuest: boolean
  onOpenSettings: () => void
  onLogout: () => void
  onLogin: () => void
  onOpenShare: () => void
  onToggleEditMode: (nextCanEdit: boolean) => void
  onExportPng: () => void
  onExportSvg: () => void
}

const modeOptions = [
  {
    value: 'view' as const,
    icon: Eye,
    label: 'View',
    description: 'Read only',
  },
  {
    value: 'edit' as const,
    icon: Pencil,
    label: 'Edit',
    description: 'Draw and change content',
  },
]

const maxVisibleCollaborators = 4

interface WhiteboardExportMenuProps {
  exporting: boolean
  onExportPng: () => void
  onExportSvg: () => void
}

function WhiteboardExportMenu({
  exporting,
  onExportPng,
  onExportSvg,
}: WhiteboardExportMenuProps) {
  const [showMenu, setShowMenu] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => {
    setShowMenu(false)
  }, [])

  const menuPosition = useMenuPosition(buttonRef, menuRef, {
    enabled: showMenu,
    fallbackWidth: 176,
  })

  useClickOutside([rootRef, menuRef], closeMenu, showMenu)
  useEscapeKey(closeMenu, showMenu)

  return (
    <div className="inline-flex" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setShowMenu((prev) => !prev)}
        disabled={exporting}
        title={exporting ? 'Exporting...' : 'Export'}
        aria-label={exporting ? 'Exporting...' : 'Export'}
        aria-haspopup="menu"
        aria-expanded={showMenu}
        className={`flex items-center gap-1 rounded-md h-7 px-2 text-xs font-medium transition-all ${
          exporting
            ? 'bg-cz-surface-hover text-cz-text-muted cursor-wait'
            : 'border border-cz-border text-cz-text hover:bg-cz-surface-hover'
        }`}
      >
        {exporting ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <>
            <Download size={12} />
            <span>Export</span>
            <ChevronDown size={10} />
          </>
        )}
      </button>

      {showMenu && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[100] w-44 rounded-lg border border-cz-border bg-cz-surface p-1.5 shadow-xl"
          style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu()
              onExportPng()
            }}
            disabled={exporting}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-cz-text hover:bg-cz-surface-hover disabled:opacity-50"
          >
            <FileImage size={14} className="text-cz-text-muted" />
            PNG Image
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu()
              onExportSvg()
            }}
            disabled={exporting}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-cz-text hover:bg-cz-surface-hover disabled:opacity-50"
          >
            <FileType2 size={14} className="text-cz-text-muted" />
            SVG Vector
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

function connectionLabel(connectionState: ConnectionState): string {
  if (connectionState === 'connected') {
    return 'Connected'
  }
  if (connectionState === 'connecting') {
    return 'Connecting'
  }
  return 'Disconnected'
}

export async function exportWhiteboardAsPng(api: ExcalidrawImperativeAPI, title: string): Promise<void> {
  const elements = api.getSceneElements()
  const files = api.getFiles()
  const appState = api.getAppState()

  if (elements.length === 0) {
    throw new Error('Add at least one element before exporting PNG.')
  }

  const blob = await exportToBlob({
    elements,
    files,
    appState,
    mimeType: 'image/png',
    exportPadding: 16,
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title || 'whiteboard'}.png`
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportWhiteboardAsSvg(api: ExcalidrawImperativeAPI, title: string): Promise<void> {
  const elements = api.getSceneElements()
  const files = api.getFiles()
  const appState = api.getAppState()

  if (elements.length === 0) {
    throw new Error('Add at least one element before exporting SVG.')
  }

  const svg = await exportToSvg({
    elements,
    files,
    appState,
    exportPadding: 16,
  })

  const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title || 'whiteboard'}.svg`
  link.click()
  URL.revokeObjectURL(url)
}

export function WhiteboardToolbar({
  title,
  canRenameProject,
  onBackToProjects,
  onRenameProject,
  onRenameProjectError,
  canEdit,
  canRoleEdit,
  connectionState,
  activeCollaborators,
  followedSocketId,
  onFollowCollaborator,
  exporting,
  accountLabel,
  accountEmail,
  accountImageUrl,
  accountIsGuest,
  onOpenSettings,
  onLogout,
  onLogin,
  onOpenShare,
  onToggleEditMode,
  onExportPng,
  onExportSvg,
}: WhiteboardToolbarProps) {
  const selectedMode = canEdit ? 'edit' : 'view'

  return (
    <header
      className="flex items-center justify-between gap-2 border-b border-cz-border bg-cz-surface px-3"
      style={{ height: 'var(--toolbar-height)' }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <WorkspaceProjectTitle
          className="min-w-0 flex-1 text-sm font-medium text-cz-text"
          title={title}
          canRename={canRenameProject}
          onBack={onBackToProjects}
          onRename={onRenameProject}
          onRenameError={onRenameProjectError}
        />
        <div className="inline-flex items-center gap-2 rounded-full border border-cz-border px-2 py-1 text-xs text-cz-text-muted">
          <span
            className={`inline-block h-2 w-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-500' : connectionState === 'connecting' ? 'bg-amber-500' : 'bg-red-500'}`}
          />
          {connectionLabel(connectionState)}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <CollaboratorStrip
          collaborators={activeCollaborators}
          maxVisible={maxVisibleCollaborators}
          getKey={(c) => c.socketId}
          variant="presence"
          isActive={(c) => followedSocketId === c.socketId}
          getAvatarTitle={(c) =>
            followedSocketId === c.socketId
              ? `Stop following ${c.name}`
              : `Follow ${c.name}'s view`
          }
          getRowSubtitle={(c) =>
            c.hasPointer ? undefined : 'Inactive'
          }
          onCollaboratorClick={(c) => onFollowCollaborator(c.socketId, c.name)}
        />

        <WhiteboardExportMenu
          exporting={exporting}
          onExportPng={onExportPng}
          onExportSvg={onExportSvg}
        />

        <IconDropdown
          value={selectedMode}
          options={modeOptions.map((option) => (
            option.value === 'edit' && !canRoleEdit
              ? { ...option, disabled: true }
              : option
          ))}
          onChange={(nextMode) => onToggleEditMode(nextMode === 'edit')}
        />

        <button
          type="button"
          onClick={onOpenShare}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-cz-border px-2 text-xs font-medium text-cz-text hover:bg-cz-surface-hover"
          title="Share"
        >
          <Share2 size={12} />
          Share
        </button>

        <ProfileMenu
          name={accountLabel}
          email={accountEmail}
          imageUrl={accountImageUrl}
          isGuest={accountIsGuest}
          onOpenSettings={onOpenSettings}
          onLogout={onLogout}
          onLogin={onLogin}
        />
      </div>
    </header>
  )
}

export function snapshotSceneFromApi(api: ExcalidrawImperativeAPI): {
  elements: readonly OrderedExcalidrawElement[]
  appState: AppState
  files: BinaryFiles
} {
  return {
    elements: api.getSceneElements(),
    appState: api.getAppState(),
    files: api.getFiles(),
  }
}
