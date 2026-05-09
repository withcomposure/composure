import { ChevronDown, Eye, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Play, Link, LibraryBig, Timer, Trash2, type LucideIcon } from 'lucide-react'
import { ExportMenu } from '@/sidebar/ExportMenu'
import { ProfileMenu } from './ProfileMenu'
import { CollaboratorStrip } from '@/components/CollaboratorStrip'
import { IconDropdown, type DropdownOption } from '@/components/IconDropdown'
import { VersionsDropdown } from './VersionsDropdown'
import type { DiffWorkspaceTab } from '@/types'

export interface ActiveEditor {
  clientId: number
  name: string
  color: string
  userId: string | null
  profileImageUrl: string | null
  hasCursor: boolean
}

interface ToolbarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
  onLogout: () => void
  onLogin: () => void
  accountLabel: string
  accountEmail: string | null
  accountImageUrl: string | null
  accountIsGuest: boolean
  canEdit: boolean
  canComment: boolean
  mode: 'view' | 'comment' | 'edit'
  onModeChange: (mode: 'view' | 'comment' | 'edit') => void
  onOpenShare: () => void
  onCompile: () => void
  onCompileCurrentFile: () => void
  canCompileCurrentFile: boolean
  compileCurrentFilePath: string
  onClearCompileOutput: () => void
  hasCompiledOutput: boolean
  clearingCompileOutput: boolean
  autoCompileEnabled: boolean
  autoCompileTimeoutSeconds: number
  onAutoCompileChange: (enabled: boolean) => void
  onSave: () => void
  saving: boolean
  connectionState: 'connecting' | 'connected' | 'disconnected'
  compiling: boolean
  activeFile: string
  activeEditors: ActiveEditor[]
  onFocusCollaborator: (clientId: number) => void
  onOpenReferenceLookup: () => void
  projectFormat: 'latex' | 'typst' | 'markdown' | 'asciidoc'
  onExport: (format: string) => void
  exporting: boolean
  previewOpen: boolean
  onTogglePreview: () => void
  projectId: string
  onViewDiff: (sha: string, filePath: string) => void
  activeDiffTab: DiffWorkspaceTab | null
}

// Maximum number of visible avatars before showing the overflow button
const maxVisibleEditors = 4

const modeOptions = [
  { value: 'view'    as const, icon: Eye,           label: 'Viewing',    description: 'Read only'        },
  { value: 'comment' as const, icon: MessageSquare, label: 'Commenting', description: 'Suggest changes'  },
  { value: 'edit'    as const, icon: Pencil,        label: 'Editing',    description: 'Full access'      },
] satisfies Array<{ value: 'view' | 'comment' | 'edit', icon: LucideIcon, label: string, description: string }>

type CompileDropdownValue = 'compile-current-file' | 'clear-compile-output'

export function Toolbar({
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  onLogout,
  onLogin,
  accountLabel,
  accountEmail,
  accountImageUrl,
  accountIsGuest,
  canEdit,
  canComment,
  mode,
  onModeChange,
  onOpenShare,
  onCompile,
  onCompileCurrentFile,
  canCompileCurrentFile,
  compileCurrentFilePath,
  onClearCompileOutput,
  hasCompiledOutput,
  clearingCompileOutput,
  autoCompileEnabled,
  autoCompileTimeoutSeconds,
  onAutoCompileChange,
  onSave,
  saving,
  connectionState,
  compiling,
  activeFile,
  activeEditors,
  onFocusCollaborator,
  onOpenReferenceLookup,
  projectFormat,
  onExport,
  exporting,
  previewOpen,
  onTogglePreview,
  projectId,
  onViewDiff,
  activeDiffTab,
}: ToolbarProps) {
  const inDiffMode = activeDiffTab !== null
  const displayFileName = activeDiffTab?.filePath ?? activeFile
  const showCompileButton = projectFormat !== 'markdown' && projectFormat !== 'asciidoc'
  const connectionDotClass = connectionState === 'connected'
    ? 'bg-emerald-500'
    : connectionState === 'disconnected'
      ? 'bg-red-500'
      : 'bg-gray-400'
  const connectionLabel = connectionState === 'connected'
    ? 'Connected'
    : connectionState === 'disconnected'
      ? 'No Connection'
      : 'Connecting'
  const showConnectionLabel = connectionState !== 'connected'
  const canClearCompileOutput = canEdit && hasCompiledOutput && !compiling && !clearingCompileOutput
  const compileCurrentFileName = compileCurrentFilePath
    ? compileCurrentFilePath.split('/').pop() ?? compileCurrentFilePath
    : ''
  const compileCurrentFileLabel = canCompileCurrentFile
    ? `Compile "${compileCurrentFileName}"`
    : 'Compile This File'
  const compileCurrentFileTitle = canCompileCurrentFile
    ? compileCurrentFileLabel
    : 'Open or select a file to enable'
  const clearCompileOutputTitle = hasCompiledOutput ? 'Clear compile output' : 'No compile output to clear'

  const compileMenuOptions: Array<DropdownOption<CompileDropdownValue>> = [
    {
      type: 'toggle',
      id: 'auto-compile',
      icon: Timer,
      label: 'Auto-Compile',
      description: `Run after ${autoCompileTimeoutSeconds}s of editor inactivity`,
      checked: autoCompileEnabled,
      onToggle: onAutoCompileChange,
      switchAriaLabel: 'Toggle Auto-Compile',
    },
    {
      type: 'action',
      id: 'compile-current-file',
      icon: Play,
      label: compileCurrentFileLabel,
      disabled: !canCompileCurrentFile || compiling,
      onSelect: onCompileCurrentFile,
      title: compileCurrentFileTitle,
      ariaLabel: compileCurrentFileLabel,
    },
    {
      type: 'action',
      id: 'clear-compile-output',
      icon: Trash2,
      label: 'Clear Compile Output',
      disabled: !canClearCompileOutput,
      onSelect: onClearCompileOutput,
      title: clearCompileOutputTitle,
      ariaLabel: 'Clear compile output',
      trailing: clearingCompileOutput
        ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        : null,
    },
  ]

  return (
    <div
      className="flex items-center justify-between border-b border-cz-border bg-cz-surface px-3"
      style={{ height: 'var(--toolbar-height)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded p-1 text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text transition-colors"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {sidebarOpen ? <PanelLeftClose size={16} strokeWidth={1.7} /> : <PanelLeftOpen size={16} strokeWidth={1.7} />}
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenReferenceLookup}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-cz-border text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
            aria-label="Open reference lookup"
            title="Reference lookup"
          >
            <LibraryBig size={12} />
          </button>

          <button
            onClick={onSave}
            disabled={saving || !canEdit}
            className={`inline-flex items-center gap-2 rounded-md px-2 py-2 text-xs text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-60 ${saving ? 'cursor-wait' : ''}`}
            title={`${connectionLabel}${saving ? '. Saving...' : ''}`}
            aria-label={`${connectionLabel}${saving ? ', saving' : ''}`}
          >
            <span className={`h-2 w-2 rounded-full ${connectionDotClass}`} />
          </button>
          {showConnectionLabel && (
            <span className="text-xs text-cz-text-muted">{connectionLabel}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <CollaboratorStrip
          collaborators={activeEditors}
          maxVisible={maxVisibleEditors}
          getKey={(e) => e.clientId}
          isInteractive={(e) => e.hasCursor}
          getAvatarTitle={(e) =>
            e.hasCursor ? `Jump to ${e.name}` : `${e.name} is inactive`
          }
          getRowSubtitle={(e) =>
            e.hasCursor ? (e.userId ? 'Signed in' : 'Guest') : 'Inactive'
          }
          onCollaboratorClick={(e) => onFocusCollaborator(e.clientId)}
        />

        {showCompileButton && (
        <div>
          <div className="flex items-stretch">
            <button
              onClick={onCompile}
              disabled={compiling}
              className={`flex items-center gap-1.5 rounded-l-md h-7 px-2.5 text-xs font-medium transition-all ${
                compiling
                  ? 'bg-cz-accent/40 text-cz-accent cursor-wait'
                  : 'bg-cz-accent text-white hover:bg-cz-accent-hover shadow-sm shadow-cz-accent/20'
              }`}
              title={compiling ? 'Compiling...' : 'Compile'}
              aria-label={compiling ? 'Compiling...' : 'Compile'}
            >
              {compiling ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Play size={12} fill="currentColor" />
              )}
            </button>
            <IconDropdown<CompileDropdownValue>
              disabled={compiling}
              options={compileMenuOptions}
              unstyledButton
              fallbackWidth={256}
              menuRole="menu"
              menuClassName="w-64 p-1.5"
              trigger={{
                icon: ChevronDown,
                iconOnly: true,
                showChevron: false,
                title: 'Compile options',
                ariaLabel: 'Compile options',
                className: `rounded-r-md rounded-l-none border-l border-white/20 px-2 text-xs transition-all ${
                  compiling
                    ? 'border-0 bg-cz-accent/40 text-cz-accent cursor-wait disabled:opacity-100'
                    : 'border-0 bg-cz-accent text-white hover:bg-cz-accent-hover shadow-sm shadow-cz-accent/20 disabled:opacity-100'
                }`,
              }}
            />
          </div>
        </div>
        )}

        <ExportMenu projectFormat={projectFormat} onExport={onExport} exporting={exporting} />

        <VersionsDropdown projectId={projectId} activeFile={displayFileName} onViewDiff={onViewDiff} />

        <IconDropdown
          value={mode}
          disabled={inDiffMode}
          iconOnly
          options={[
            modeOptions[0],
            { ...modeOptions[1], disabled: !canComment },
            { ...modeOptions[2], disabled: !canEdit },
          ]}
          onChange={onModeChange}
          // className="block"
        />

        <button
          onClick={onOpenShare}
          className="rounded-md h-7 px-2.5 text-xs font-medium border border-cz-border text-cz-text hover:bg-cz-surface-hover transition-all"
          title="Share project"
        >
          <Link size={12} />
        </button>


        <div className="ml-1">
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

        <button
          type="button"
          onClick={onTogglePreview}
          className="rounded p-1 text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text"
          title={previewOpen ? 'Hide preview' : 'Show preview'}
          aria-label={previewOpen ? 'Hide preview' : 'Show preview'}
        >
          {previewOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </div>
  )
}
