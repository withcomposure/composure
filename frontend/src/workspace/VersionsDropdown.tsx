import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, History, Tag } from 'lucide-react'
import type { CommitEntry } from '@/types'
import { fetchHistory } from '@/sidebar/history-api'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useEscapeKey } from '@/hooks/use-escape-key'
import { useMenuPosition } from '@/hooks/use-menu-position'
import { fmtRelativeTime } from '@/utils/format-time'

interface VersionsDropdownProps {
  projectId: string
  activeFile: string
  onViewDiff: (sha: string, filePath: string) => void
}

export function VersionsDropdown({ projectId, activeFile, onViewDiff }: VersionsDropdownProps) {
  const [open, setOpen] = useState(false)
  const [commitsByTarget, setCommitsByTarget] = useState<Record<string, CommitEntry[]>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const targetKey = activeFile ? `${projectId}:${activeFile}` : null
  const commits = targetKey ? commitsByTarget[targetKey] : undefined
  const loading = open && targetKey != null && commits == null
  const closeDropdown = useCallback(() => {
    setOpen(false)
  }, [])
  const menuPosition = useMenuPosition(buttonRef, menuRef, {
    enabled: open,
    fallbackWidth: 288,
  })

  useEffect(() => {
    if (!open || !activeFile || !targetKey || commits != null) return

    let cancelled = false
    void fetchHistory(projectId, { file: activeFile, limit: 50 })
      .then((result) => {
        if (!cancelled) {
          setCommitsByTarget((prev) => ({ ...prev, [targetKey]: result }))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommitsByTarget((prev) => ({ ...prev, [targetKey]: [] }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, projectId, activeFile, targetKey, commits])

  useClickOutside([rootRef, menuRef], closeDropdown, open)
  useEscapeKey(closeDropdown, open)

  const handleSelect = useCallback((sha: string) => {
    closeDropdown()
    onViewDiff(sha, activeFile)
  }, [activeFile, closeDropdown, onViewDiff])

  if (!activeFile) return null

  return (
    <div className="inline-flex" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md h-7 px-2 text-xs font-medium border border-cz-border text-cz-text hover:bg-cz-surface-hover transition-all"
        title="File version history"
        aria-label="File version history"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <History size={12} />
        <ChevronDown size={10} />
      </button>
      {open &&
        createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[100] w-72 rounded-lg border border-cz-border bg-cz-surface shadow-xl"
          style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
        >
          <div className="max-h-80 overflow-y-auto p-1.5">
            {loading && (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-cz-text-muted">
                <span className="cz-spinner" aria-hidden="true" />
                Loading...
              </div>
            )}

            {!loading && (commits?.length ?? 0) === 0 && (
              <div className="px-2 py-3 text-xs text-cz-text-muted">
                No versions found for this file.
              </div>
            )}

            {!loading && (commits ?? []).map((commit) => (
              <button
                key={commit.sha}
                type="button"
                onClick={() => handleSelect(commit.sha)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-cz-surface-hover"
              >
                {commit.tag ? (
                  <Tag size={12} className="text-cz-accent shrink-0" />
                ) : (
                  <div className="w-3 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-cz-text">
                      {fmtRelativeTime(commit.timestamp)}
                    </span>
                    {commit.tag && (
                      <span className="truncate text-[10px] font-medium text-cz-accent">
                        {commit.tag}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-cz-text-muted">
                    {commit.sha.slice(0, 7)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
