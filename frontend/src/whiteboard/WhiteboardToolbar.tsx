import { Download, Eye, FileImage, FileType2, Pencil, Share2 } from 'lucide-react'
import type { SocketId } from '@excalidraw/excalidraw/types'
import { CollaboratorStrip } from '@/components/CollaboratorStrip'
import { WorkspaceProjectTitle } from '@/components/WorkspaceProjectTitle'
import { IconDropdown, type DropdownOption } from '@/components/IconDropdown'
import type { ConnectionState } from '@/types'
import { ProfileMenu } from '@/workspace/ProfileMenu'
import type { WhiteboardPresenceUser } from './use-whiteboard-collab'

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
  const exportOptions: Array<DropdownOption<'png' | 'svg'>> = [
    {
      type: 'action',
      id: 'export-png',
      icon: FileImage,
      label: 'PNG Image',
      disabled: exporting,
      onSelect: onExportPng,
    },
    {
      type: 'action',
      id: 'export-svg',
      icon: FileType2,
      label: 'SVG Vector',
      disabled: exporting,
      onSelect: onExportSvg,
    },
  ]

  return (
    <IconDropdown<'png' | 'svg'>
      size="sm"
      disabled={exporting}
      options={exportOptions}
      fallbackWidth={176}
      menuRole="menu"
      menuClassName="w-44 p-1.5"
      trigger={{
        icon: Download,
        label: 'Export',
        loading: exporting,
        title: exporting ? 'Exporting...' : 'Export',
        ariaLabel: exporting ? 'Exporting...' : 'Export',
        className: exporting
          ? 'bg-cz-surface-hover text-cz-text-muted cursor-wait'
          : 'border border-cz-border text-cz-text hover:bg-cz-surface-hover',
      }}
      className="inline-flex"
    />
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
          size="sm"
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

