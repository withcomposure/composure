import { Download, RefreshCw, Share2 } from 'lucide-react'
import {
  exportToBlob,
  exportToSvg,
} from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ConnectionState } from '@/types'
import type { WhiteboardPresenceUser } from './useWhiteboardCollab'

interface WhiteboardToolbarProps {
  title: string
  canEdit: boolean
  connectionState: ConnectionState
  activeCollaborators: WhiteboardPresenceUser[]
  exporting: boolean
  onOpenShare: () => void
  onToggleEditMode: (nextCanEdit: boolean) => void
  onExportPng: () => void
  onExportSvg: () => void
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
  canEdit,
  connectionState,
  activeCollaborators,
  exporting,
  onOpenShare,
  onToggleEditMode,
  onExportPng,
  onExportSvg,
}: WhiteboardToolbarProps) {
  return (
    <header className="flex h-12 items-center justify-between gap-2 border-b border-cz-border bg-cz-surface px-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="truncate text-sm font-medium text-cz-text">{title}</div>
        <div className="inline-flex items-center gap-2 rounded-full border border-cz-border px-2 py-1 text-xs text-cz-text-muted">
          <span
            className={`inline-block h-2 w-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-500' : connectionState === 'connecting' ? 'bg-amber-500' : 'bg-red-500'}`}
          />
          {connectionLabel(connectionState)}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenShare}
          className="inline-flex items-center gap-1 rounded-md border border-cz-border px-2 py-1 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
          title="Share"
        >
          <Share2 size={12} />
          Share
        </button>

        <div className="inline-flex items-center rounded-md border border-cz-border bg-cz-bg p-0.5">
          <button
            type="button"
            onClick={() => onToggleEditMode(false)}
            className={`rounded px-2 py-1 text-xs ${!canEdit ? 'bg-cz-accent text-white' : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'}`}
          >
            View
          </button>
          <button
            type="button"
            onClick={() => onToggleEditMode(true)}
            className={`rounded px-2 py-1 text-xs ${canEdit ? 'bg-cz-accent text-white' : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'}`}
          >
            Edit
          </button>
        </div>

        <div className="hidden items-center gap-1 text-xs text-cz-text-muted md:inline-flex">
          <span>{activeCollaborators.length}</span>
          <span>online</span>
        </div>

        <button
          type="button"
          disabled={exporting}
          onClick={onExportPng}
          className="inline-flex items-center gap-1 rounded-md border border-cz-border px-2 py-1 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:cursor-wait disabled:opacity-60"
          title="Export PNG"
        >
          {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
          PNG
        </button>

        <button
          type="button"
          disabled={exporting}
          onClick={onExportSvg}
          className="inline-flex items-center gap-1 rounded-md border border-cz-border px-2 py-1 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:cursor-wait disabled:opacity-60"
          title="Export SVG"
        >
          {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
          SVG
        </button>
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
