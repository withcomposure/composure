import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Eye, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Play, Link, Timer, Trash2, type LucideIcon } from 'lucide-react'
import { ExportMenu } from '@/sidebar/ExportMenu'
import { ProfileMenu } from './ProfileMenu'
import { CollaboratorStrip } from '@/components/CollaboratorStrip'
import { CustomDropdown } from '@/components/CustomDropdown'
import { ToggleSwitch } from '@/components/ToggleSwitch'
import { VersionsDropdown } from './VersionsDropdown'
import type { HistoryState } from '@/types'

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
  historyState: HistoryState | null
}

// Maximum number of visible avatars before showing the overflow button
const maxVisibleEditors = 4

const modeOptions = [
  { value: 'view'    as const, icon: Eye,           label: 'Viewing',    description: 'Read only'        },
  { value: 'comment' as const, icon: MessageSquare, label: 'Commenting', description: 'Suggest changes'  },
  { value: 'edit'    as const, icon: Pencil,        label: 'Editing',    description: 'Full access'      },
] satisfies Array<{ value: 'view' | 'comment' | 'edit', icon: LucideIcon, label: string, description: string }>

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
  historyState,
}: ToolbarProps) {
  const inDiffMode = historyState !== null
  const displayFileName = historyState?.filePath ?? activeFile
  const showCompileButton = projectFormat !== 'markdown' && projectFormat !== 'asciidoc'
  const [showCompileMenu, setShowCompileMenu] = useState(false)
  const compileMenuRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!showCompileMenu) return
    const handle = (e: PointerEvent) => {
      if (compileMenuRef.current && !compileMenuRef.current.contains(e.target as Node)) {
        setShowCompileMenu(false)
      }
    }
    window.addEventListener('pointerdown', handle, true)
    return () => window.removeEventListener('pointerdown', handle, true)
  }, [showCompileMenu])

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
            className="rounded-md border border-cz-border px-2.5 py-1.5 text-xs font-medium text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
            aria-label="Open reference lookup"
            title="Reference lookup"
          >
            Reference Lookup
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
        <div className="relative" ref={compileMenuRef}>
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
            <button
              type="button"
              onClick={() => setShowCompileMenu((prev) => !prev)}
              disabled={compiling}
              className={`rounded-r-md border-l border-white/20 px-2 text-xs transition-all ${
                compiling
                  ? 'bg-cz-accent/40 text-cz-accent cursor-wait'
                  : 'bg-cz-accent text-white hover:bg-cz-accent-hover shadow-sm shadow-cz-accent/20'
              }`}
              aria-label="Compile options"
              title="Compile options"
            >
              <ChevronDown size={12} />
            </button>
          </div>

          {showCompileMenu && (
            <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-cz-border bg-cz-surface p-1.5 shadow-xl">
              <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-cz-surface-hover">
                <div className="flex min-w-0 items-center gap-2">
                  <Timer size={14} className="text-cz-text-muted" />
                  <div className="min-w-0">
                    <div className="text-xs text-cz-text">Auto-Compile</div>
                    <div className="text-[10px] text-cz-text-muted">Run after {autoCompileTimeoutSeconds}s of editor inactivity</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={autoCompileEnabled}
                  onChange={onAutoCompileChange}
                  ariaLabel="Toggle Auto-Compile"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!canCompileCurrentFile) {
                    return
                  }
                  onCompileCurrentFile()
                  setShowCompileMenu(false)
                }}
                disabled={!canCompileCurrentFile || compiling}
                className={`mt-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors ${canCompileCurrentFile && !compiling ? 'text-cz-text hover:bg-cz-surface-hover' : 'cursor-not-allowed text-cz-text-muted opacity-60'}`}
                title={canCompileCurrentFile ? 'Compile from the last editor tab that had cursor focus' : 'Focus an editor tab to enable compile-current-file'}
                aria-label="Compile current file"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Play size={14} className={'text-cz-text-muted'} />
                  <span>Compile Current File</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canClearCompileOutput) {
                    return
                  }
                  onClearCompileOutput()
                  setShowCompileMenu(false)
                }}
                disabled={!canClearCompileOutput}
                className={`mt-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors ${canClearCompileOutput ? 'text-cz-text hover:bg-cz-surface-hover' : 'cursor-not-allowed text-cz-text-muted opacity-60'}`}
                title={hasCompiledOutput ? 'Clear compile output' : 'No compile output to clear'}
                aria-label="Clear compile output"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Trash2 size={14} className={'text-cz-text-muted'} />
                  <span>Clear Compile Output</span>
                </span>
                {clearingCompileOutput && (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
              </button>

            </div>
          )}
        </div>
        )}

        <ExportMenu projectFormat={projectFormat} onExport={onExport} exporting={exporting} />

        <VersionsDropdown projectId={projectId} activeFile={displayFileName} onViewDiff={onViewDiff} />

        <CustomDropdown
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
