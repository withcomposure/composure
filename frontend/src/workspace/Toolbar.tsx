import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Eye, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Play, Link, Timer, Trash2 } from 'lucide-react'
import { ExportMenu } from '@/sidebar/ExportMenu'
import { ProfileMenu } from './ProfileMenu'
import { Avatar } from '@/components/Avatar'
import { CustomDropdown } from '@/components/CustomDropdown'
import { ToggleSwitch } from '@/components/ToggleSwitch'
import { VersionsDropdown } from './VersionsDropdown'
import type { HistoryState } from '@/types'
import {  } from 'lucide-react'

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
] satisfies Array<{ value: 'view' | 'comment' | 'edit', icon: any, label: string, description: string }>

function ActiveEditorsStrip({
  editors,
  onFocusCollaborator,
}: {
  editors: ActiveEditor[]
  onFocusCollaborator: (clientId: number) => void
}) {
  const [showList, setShowList] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showList) return
    const handle = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowList(false)
      }
    }
    window.addEventListener('pointerdown', handle, true)
    return () => window.removeEventListener('pointerdown', handle, true)
  }, [showList])

  if (editors.length === 0) return null

  const visible = editors.slice(0, maxVisibleEditors)
  const hasOverflow = editors.length > maxVisibleEditors

  return (
    <div className="relative flex items-center mx-1" ref={containerRef}>
      <div className="flex items-center -space-x-1.5">
        {visible.map((editor) => (
          <div key={editor.clientId} className="group relative">
            <button
              type="button"
              onClick={() => {
                if (!editor.hasCursor) return
                onFocusCollaborator(editor.clientId)
              }}
              className={`flex rounded-full outline-2 -outline-offset-1 outline-cz-surface transition-opacity ${editor.hasCursor ? 'cursor-pointer' : 'cursor-default opacity-45 grayscale'}`}
              title={editor.hasCursor ? `Jump to ${editor.name}` : `${editor.name} is inactive`}
              aria-label={editor.hasCursor ? `Jump to ${editor.name}` : `${editor.name} is inactive`}
            >
              <Avatar name={editor.name} imageUrl={editor.profileImageUrl} isGuest={!editor.userId} size={24} />
            </button>
            <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-4 -translate-x-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-cz-border bg-cz-surface p-3 shadow-xl whitespace-nowrap">
                <Avatar name={editor.name} imageUrl={editor.profileImageUrl} isGuest={!editor.userId} size={40} />
                <div className="text-xs font-medium text-cz-text">{editor.name}</div>
              </div>
            </div>
          </div>
        ))}
        {hasOverflow && (
          <button
            onClick={() => setShowList((prev) => !prev)}
            className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-cz-border bg-cz-surface text-[10px] font-medium text-cz-text-muted ring-2 ring-cz-surface hover:bg-cz-surface-hover"
          >
            +{editors.length - maxVisibleEditors}
          </button>
        )}
      </div>
      {showList && (
        <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-cz-border bg-cz-surface p-1.5 shadow-xl">
          {editors.map((editor) => (
            <button
              key={editor.clientId}
              type="button"
              onClick={() => {
                if (!editor.hasCursor) return
                onFocusCollaborator(editor.clientId)
                setShowList(false)
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${editor.hasCursor ? 'hover:bg-cz-surface-hover' : 'opacity-45 grayscale'}`}
              title={editor.hasCursor ? `Jump to ${editor.name}` : `${editor.name} is inactive`}
            >
              <Avatar name={editor.name} imageUrl={editor.profileImageUrl} isGuest={!editor.userId} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-cz-text">{editor.name}</div>
                <div className="text-[10px] text-cz-text-muted">
                  {editor.hasCursor ? (editor.userId ? 'Signed in' : 'Guest') : 'Inactive'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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

        <div className="flex min-w-0 items-center gap-4">
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
          {displayFileName ? displayFileName.split('/').map((segment, i, arr) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-cz-text-muted opacity-40">/</span>}
              <span className={i === arr.length - 1 ? 'text-cz-text font-medium' : 'text-cz-text-muted'}>
                {segment}
              </span>
            </span>
          )) : (
            <span className="italic text-cz-text-muted">No file selected</span>
          )}
          </div>

          <div className="flex items-center gap-2">
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
      </div>

      <div className="flex items-center gap-2">
        <ActiveEditorsStrip editors={activeEditors} onFocusCollaborator={onFocusCollaborator} />

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
