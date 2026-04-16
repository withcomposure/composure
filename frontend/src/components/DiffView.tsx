import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileX2, GitCompareArrows, RotateCcw } from 'lucide-react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { unifiedMergeView } from '@codemirror/merge'
import type { FileDiff } from '../types'
import { fetchFileDiff, restoreFile } from '../pages/utils'
import { getErrorMessage } from '../utils/fetch'

interface DiffViewProps {
  projectId: string
  commitSha: string
  filePath: string
  diffMode: 'side-by-side' | 'inline'
  onDiffModeChange: (mode: 'side-by-side' | 'inline') => void
  canRestore: boolean
  onRestore: () => void
  onExitHistory: () => void
  onPopupAlert: (message: string, title?: string) => void
}

export function DiffView({
  projectId,
  commitSha,
  filePath,
  diffMode,
  onDiffModeChange,
  canRestore,
  onRestore,
  onExitHistory,
  onPopupAlert,
}: DiffViewProps) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [diffBase, setDiffBase] = useState<'parent' | 'current'>('parent')
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MergeView | EditorView | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    void fetchFileDiff(projectId, commitSha, filePath, diffBase)
      .then(setDiff)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [projectId, commitSha, filePath, diffBase])

  useEffect(() => {
    if (!containerRef.current || !diff) return

    // Clean up previous view
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    containerRef.current.innerHTML = ''

    // Binary files can't be diffed as text
    if (diff.isBinary) return

    const oldText = diff.oldContent ?? ''
    const newText = diff.newContent ?? ''

    if (diffMode === 'side-by-side') {
      const mv = new MergeView({
        parent: containerRef.current,
        a: {
          doc: oldText,
          extensions: [
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            lineNumbers(),
            EditorView.theme({
              '&': { height: '100%' },
              '.cm-scroller': { overflow: 'auto' },
            }),
          ],
        },
        b: {
          doc: newText,
          extensions: [
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            lineNumbers(),
            EditorView.theme({
              '&': { height: '100%' },
              '.cm-scroller': { overflow: 'auto' },
            }),
          ],
        },
      })
      viewRef.current = mv
    } else {
      const view = new EditorView({
        parent: containerRef.current,
        state: EditorState.create({
          doc: newText,
          extensions: [
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            lineNumbers(),
            unifiedMergeView({ original: oldText, mergeControls: false }),
            EditorView.theme({
              '&': { height: '100%' },
              '.cm-scroller': { overflow: 'auto' },
            }),
          ],
        }),
      })
      viewRef.current = view
    }

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [diff, diffMode])

  const handleRestore = async () => {
    setRestoring(true)
    try {
      await restoreFile(projectId, commitSha, filePath)
      onRestore()
    } catch (err) {
      onPopupAlert(getErrorMessage(err), 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-cz-text-muted">
          <span className="cz-spinner" aria-hidden="true" />
          Loading diff...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-300">
        {error}
      </div>
    )
  }

  if (!diff) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-cz-text-muted">
        <div className="flex flex-col items-center gap-2">
          <GitCompareArrows size={32} className="opacity-30" />
          <span>No diff available</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-cz-border px-3 py-1.5">
        <div className="flex items-center gap-3">
          <button
            onClick={onExitHistory}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-cz-accent hover:bg-cz-accent-muted"
          >
            <ArrowLeft size={12} />
            Exit diff
          </button>
          <span className={`text-[10px] font-bold uppercase ${
            diff.changeType === 'added'
              ? 'text-emerald-400'
              : diff.changeType === 'deleted'
                ? 'text-red-400'
                : diff.changeType === 'unchanged'
                  ? 'text-cz-text-muted'
                  : 'text-amber-400'
          }`}>
            {diff.changeType}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-cz-border bg-cz-bg p-0.5">
            <button
              onClick={() => setDiffBase('parent')}
              className={`rounded px-2 py-0.5 text-[10px] ${diffBase === 'parent' ? 'bg-cz-accent text-white' : 'text-cz-text-muted hover:text-cz-text'}`}
              title="Compare against preceding commit"
            >
              Preceding
            </button>
            <button
              onClick={() => setDiffBase('current')}
              className={`rounded px-2 py-0.5 text-[10px] ${diffBase === 'current' ? 'bg-cz-accent text-white' : 'text-cz-text-muted hover:text-cz-text'}`}
              title="Compare against current version"
            >
              Current
            </button>
          </div>
          <div className="flex items-center rounded-md border border-cz-border bg-cz-bg p-0.5">
            <button
              onClick={() => onDiffModeChange('side-by-side')}
              className={`rounded px-2 py-0.5 text-[10px] ${diffMode === 'side-by-side' ? 'bg-cz-accent text-white' : 'text-cz-text-muted hover:text-cz-text'}`}
            >
              Side by side
            </button>
            <button
              onClick={() => onDiffModeChange('inline')}
              className={`rounded px-2 py-0.5 text-[10px] ${diffMode === 'inline' ? 'bg-cz-accent text-white' : 'text-cz-text-muted hover:text-cz-text'}`}
            >
              Inline
            </button>
          </div>
          {canRestore && (
            <button
              onClick={() => void handleRestore()}
              disabled={restoring}
              className="flex items-center gap-1 rounded-md border border-cz-accent/40 bg-cz-accent/10 px-2 py-1 text-[11px] text-cz-accent hover:bg-cz-accent/20 disabled:opacity-50"
            >
              <RotateCcw size={11} />
              {restoring ? 'Restoring...' : 'Restore this file'}
            </button>
          )}
        </div>
      </div>
      {diff.isBinary ? (
        <div className="flex flex-1 items-center justify-center text-sm text-cz-text-muted">
          <div className="flex flex-col items-center gap-2">
            <FileX2 size={32} className="opacity-30" />
            <span>Binary file — no text diff available</span>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden" />
      )}
    </div>
  )
}
