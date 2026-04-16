import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Tag, Plus, MoreHorizontal, RotateCcw } from 'lucide-react'
import type { ChangedFile, CommitEntry } from '../types'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import {
  createSnapshotApi,
  fetchChangedFiles,
  fetchHistory,
} from '../utils/page-utils'
import { getErrorMessage } from '../utils/fetch'
import { fmtRelativeTime } from '../utils/format-time'

interface HistoryPanelProps {
  projectId: string
  canEdit: boolean
  refreshKey: number
  onViewDiff: (sha: string, filePath: string) => void
  onRestoreVersion: (sha: string) => void
}

interface SessionGroup {
  kind: 'session'
  label: string
  commits: CommitEntry[]
}

interface SnapshotGroup {
  kind: 'snapshot'
  tag: string
  commit: CommitEntry
}

type HistoryGroup = SessionGroup | SnapshotGroup

function HistoryCollapse({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  const [renderChildren, setRenderChildren] = useState(open)

  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-100 ease-out ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
      onTransitionStart={() => {
        if (open && !renderChildren) {
          setRenderChildren(true)
        }
      }}
      onTransitionEnd={() => {
        if (!open) {
          setRenderChildren(false)
        }
      }}
    >
      <div className="min-h-0 overflow-hidden">
        {open || renderChildren ? children : null}
      </div>
    </div>
  )
}

function groupCommits(commits: CommitEntry[]): HistoryGroup[] {
  const groups: HistoryGroup[] = []
  let currentSession: CommitEntry[] = []

  const flushSession = () => {
    if (currentSession.length > 0) {
      const first = currentSession[0]
      const last = currentSession[currentSession.length - 1]
      groups.push({
        kind: 'session',
        label: currentSession.length === 1
          ? fmtRelativeTime(first.timestamp)
          : `${fmtRelativeTime(first.timestamp)} — ${fmtRelativeTime(last.timestamp)}`,
        commits: [...currentSession],
      })
      currentSession = []
    }
  }

  for (const commit of commits) {
    if (commit.tag != null) {
      flushSession()
      groups.push({ kind: 'snapshot', tag: commit.tag, commit })
    } else {
      currentSession.push(commit)
    }
  }
  flushSession()

  return groups
}

function CommitFiles({
  projectId,
  sha,
  onViewDiff,
  cache,
  filesIndentClassName = 'pl-10',
  messageIndentClassName = 'pl-12',
}: {
  projectId: string
  sha: string
  onViewDiff: (sha: string, filePath: string) => void
  cache: React.RefObject<Map<string, ChangedFile[]>>
  filesIndentClassName?: string
  messageIndentClassName?: string
}) {
  const cachedFiles = cache.current?.get(sha) ?? null
  const [files, setFiles] = useState<ChangedFile[] | null>(cachedFiles)
  const [loading, setLoading] = useState(cachedFiles == null)

  useEffect(() => {
    if (cache.current?.has(sha)) {
      return
    }

    let cancelled = false
    void fetchChangedFiles(projectId, sha)
      .then((result) => {
        if (cancelled) return
        cache.current?.set(sha, result)
        setFiles(result)
      })
      .catch(() => {
        if (!cancelled) {
          setFiles([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectId, sha, cache])

  if (loading) {
    return <div className={`${messageIndentClassName} py-1.5 text-[10px] text-cz-text-muted`}>Loading files...</div>
  }
  if (!files || files.length === 0) {
    return <div className={`${messageIndentClassName} py-1.5 text-[10px] text-cz-text-muted`}>No file changes</div>
  }

  return (
    <div className={`${filesIndentClassName} pt-1 pb-1`}>
      {files.map((file) => (
        <button
          key={file.path}
          onClick={() => onViewDiff(sha, file.path)}
          className="mb-0.5 flex w-full items-center gap-2 rounded-sm border border-transparent px-2.5 py-1.5 text-left text-[11px] hover:border-cz-border hover:bg-cz-surface-hover last:mb-0"
        >
          <span className={`shrink-0 text-[9px] font-bold uppercase ${
            file.changeType === 'added' ? 'text-emerald-400' : file.changeType === 'deleted' ? 'text-red-400' : 'text-amber-400'
          }`}>
            {file.changeType === 'added' ? 'A' : file.changeType === 'deleted' ? 'D' : 'M'}
          </span>
          <span className="min-w-0 truncate text-cz-text">{file.path}</span>
        </button>
      ))}
    </div>
  )
}

export function HistoryPanel({ projectId, canEdit, refreshKey, onViewDiff, onRestoreVersion }: HistoryPanelProps) {
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedSha, setExpandedSha] = useState<string | null>(null)
  const [expandedSession, setExpandedSession] = useState<number | null>(null)
  const [showNewSnapshot, setShowNewSnapshot] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [creating, setCreating] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [menuSha, setMenuSha] = useState<string | null>(null)
  const commitFilesCache = useRef(new Map<string, ChangedFile[]>())

  const PAGE_SIZE = 200

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const commitList = await fetchHistory(projectId, { limit: PAGE_SIZE })
      setCommits(commitList)
      setHasMore(commitList.length === PAGE_SIZE)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadMore = useCallback(async () => {
    if (loadingMore || commits.length === 0) return
    setLoadingMore(true)
    try {
      const lastSha = commits[commits.length - 1].sha
      const more = await fetchHistory(projectId, { limit: PAGE_SIZE, before: lastSha })
      setCommits((prev) => [...prev, ...more])
      setHasMore(more.length === PAGE_SIZE)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }, [projectId, commits, loadingMore])

  useEffect(() => {
    void loadData()
  }, [loadData, refreshKey])

  const handleCreateSnapshot = useCallback(async () => {
    const name = snapshotName.trim()
    if (!name) return
    setCreating(true)
    try {
      await createSnapshotApi(projectId, name)
      setSnapshotName('')
      setShowNewSnapshot(false)
      await loadData()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreating(false)
    }
  }, [projectId, snapshotName, loadData])

  const openMenu = useCallback((sha: string, pos: { x: number; y: number }) => {
    setMenuSha(sha)
    setMenuPos(pos)
    setMenuOpen(true)
  }, [])

  const menuItems: ContextMenuItem[] = menuSha && canEdit
    ? [{ icon: RotateCcw, name: 'Restore version', action: () => { if (menuSha) onRestoreVersion(menuSha) } }]
    : []

  const groups = groupCommits(commits)

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-cz-surface/30">
      <div className="flex items-center justify-between border-b border-cz-border px-3 py-2.5">
        <div>
          <span className="block text-xs font-medium uppercase tracking-[0.12em] text-cz-text-muted">History</span>
          <span className="block text-[10px] text-cz-text-muted">Timeline of versions and snapshots</span>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowNewSnapshot((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-cz-accent/35 bg-cz-accent/10 px-2 py-1 text-[11px] text-cz-accent hover:bg-cz-accent-muted"
            title="Save snapshot"
          >
            <Plus size={12} /> Snapshot
          </button>
        )}
      </div>

      {showNewSnapshot && (
        <div className="border-b border-cz-border bg-cz-bg/40 px-3 py-2.5">
          <input
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateSnapshot() }}
            placeholder="Snapshot name..."
            className="w-full rounded border border-cz-border bg-cz-bg px-2 py-1.5 text-xs text-cz-text outline-none focus:border-cz-accent"
            autoFocus
          />
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={() => void handleCreateSnapshot()}
              disabled={creating || !snapshotName.trim()}
              className="rounded bg-cz-accent px-2 py-1 text-[11px] text-white hover:bg-cz-accent-hover disabled:opacity-50"
            >
              {creating ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setShowNewSnapshot(false); setSnapshotName('') }}
              className="rounded px-2 py-1 text-[11px] text-cz-text-muted hover:bg-cz-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-cz-text-muted">
            <span className="cz-spinner" aria-hidden="true" />
            Loading history...
          </div>
        )}

        {error && (
          <div className="px-3 py-3 text-xs text-red-300">{error}</div>
        )}

        {!loading && !error && groups.length === 0 && (
          <div className="px-3 py-4 text-xs text-cz-text-muted">
            No version history yet. Changes will appear here after auto-saves.
          </div>
        )}

        {!loading && !error && groups.length > 0 && (
          <div className="relative px-3 pb-2 pt-3">
            <div className="pointer-events-none absolute bottom-0 left-6 top-0 w-0.5 bg-cz-border" aria-hidden="true" />
            <div
              className="pointer-events-none absolute left-6 top-0 w-0.5 bg-gradient-to-b from-cz-accent via-cz-accent/35 to-cz-border"
              style={{ height: 'min(240px, 100%)' }}
              aria-hidden="true"
            />

            {groups.map((group, idx) => {
              if (group.kind === 'snapshot') {
                const expanded = expandedSha === group.commit.sha
                return (
                  <div key={group.commit.sha} className="relative pb-2">
                    <div className="relative">
                      <div className="absolute left-[5px] top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-cz-accent/80 bg-cz-surface">
                        <Tag size={9} className="text-cz-accent" />
                      </div>

                      <div
                        className="group ml-8 flex select-none items-center gap-2 rounded-lg border border-cz-border/80 bg-cz-surface/80 px-3 py-2 text-left hover:border-cz-accent/35 hover:bg-cz-surface-hover"
                        onClick={() => setExpandedSha(expanded ? null : group.commit.sha)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          if (canEdit) openMenu(group.commit.sha, { x: e.clientX, y: e.clientY })
                        }}
                      >
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-cz-text">{group.tag}</div>
                          <div className="text-[10px] text-cz-text-muted">Snapshot • {fmtRelativeTime(group.commit.timestamp)}</div>
                        </div>
                        {canEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const rect = e.currentTarget.getBoundingClientRect()
                              openMenu(group.commit.sha, { x: rect.right, y: rect.bottom })
                            }}
                            className="rounded p-0.5 text-cz-text-muted opacity-0 transition-opacity hover:bg-cz-surface-hover hover:text-cz-text group-hover:opacity-100"
                            title="Version actions"
                            aria-label="Version actions"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    <HistoryCollapse open={expanded}>
                      <CommitFiles projectId={projectId} sha={group.commit.sha} onViewDiff={onViewDiff} cache={commitFilesCache} />
                    </HistoryCollapse>
                  </div>
                )
              }

              const sessionExpanded = expandedSession === idx
              return (
                <div key={idx} className="relative pb-2">
                  <div className="relative">
                    <span className="absolute left-[6px] top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-cz-accent/70 bg-cz-surface" />

                    <button
                      onClick={() => setExpandedSession(sessionExpanded ? null : idx)}
                      className="ml-8 flex w-[calc(100%-2rem)] items-center gap-2 rounded-lg border border-cz-border/80 bg-cz-surface/80 px-3 py-2 text-left hover:border-cz-accent/25 hover:bg-cz-surface-hover"
                    >
                      {sessionExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-cz-text">
                          {group.commits.length === 1 ? '1 auto-save' : `${group.commits.length} auto-saves`}
                        </div>
                        <div className="text-[10px] text-cz-text-muted">{group.label}</div>
                      </div>
                    </button>
                  </div>

                  <HistoryCollapse open={sessionExpanded}>
                    <div className="ml-8 mt-1 space-y-1">
                      {group.commits.map((commit) => {
                        const commitExpanded = expandedSha === commit.sha
                        return (
                          <div key={commit.sha} className="relative">
                            <div className="relative">
                              <span className="absolute -left-6 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-cz-accent/70 bg-cz-surface" aria-hidden="true" />
                              <div
                                className="group flex w-full select-none items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-cz-border hover:bg-cz-surface-hover"
                                onClick={() => setExpandedSha(commitExpanded ? null : commit.sha)}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  if (canEdit) openMenu(commit.sha, { x: e.clientX, y: e.clientY })
                                }}
                              >
                                {commitExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] text-cz-text-muted">{fmtRelativeTime(commit.timestamp)}</div>
                                  <div className="text-[10px] font-mono text-cz-text-muted">{commit.sha.slice(0, 7)}</div>
                                </div>
                                {canEdit && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const rect = e.currentTarget.getBoundingClientRect()
                                      openMenu(commit.sha, { x: rect.right, y: rect.bottom })
                                    }}
                                    className="rounded p-0.5 text-cz-text-muted opacity-0 transition-opacity hover:bg-cz-surface-hover hover:text-cz-text group-hover:opacity-100"
                                    title="Version actions"
                                    aria-label="Version actions"
                                  >
                                    <MoreHorizontal size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <HistoryCollapse open={commitExpanded}>
                              <CommitFiles
                                projectId={projectId}
                                sha={commit.sha}
                                onViewDiff={onViewDiff}
                                cache={commitFilesCache}
                                filesIndentClassName="pl-2"
                                messageIndentClassName="pl-4"
                              />
                            </HistoryCollapse>
                          </div>
                        )
                      })}
                    </div>
                  </HistoryCollapse>
                </div>
              )
            })}
          </div>
        )}

        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full py-2 text-xs text-cz-accent hover:underline disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
      <ContextMenu
        open={menuOpen}
        position={menuPos}
        items={menuItems}
        onClose={() => setMenuOpen(false)}
      />
    </div>
  )
}
