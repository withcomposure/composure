import { useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  readComposureDragData,
  TAB_SINGLE_PATH_MIME,
  TAB_SOURCE_BAR_MIME,
  TAB_SOURCE_PANE_MIME,
  TREE_MULTI_PATHS_MIME,
  TREE_SINGLE_PATH_MIME,
  writeComposureDragPayload,
} from '../utils/drag-data'
import type { WorkspaceTab } from '../types'

export interface FileTabsDropPayload {
  paths: string[]
  targetIndex: number
  fromTabBar: boolean
  sourcePaneId: string | null
}

interface FileTabsProps {
  paneId: string
  tabs: WorkspaceTab[]
  activeFile: string
  isFocusedPane?: boolean
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onPromote: (path: string) => void
  onMove: (path: string, targetIndex: number) => void
  onDropPaths?: (payload: FileTabsDropPayload) => void
  snippetToolbarVisible?: boolean
  onToggleSnippetToolbar?: () => void
}

function labelForPath(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] || path
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter((path) => path.trim().length > 0)))
}

function parseExternalDropPayload(dataTransfer: DataTransfer): Omit<FileTabsDropPayload, 'targetIndex'> | null {
  const tabPath = readComposureDragData(dataTransfer, TAB_SINGLE_PATH_MIME)
  if (tabPath) {
    return {
      paths: [tabPath],
      fromTabBar: true,
      sourcePaneId: readComposureDragData(dataTransfer, TAB_SOURCE_PANE_MIME) || null,
    }
  }

  const multiRaw = readComposureDragData(dataTransfer, TREE_MULTI_PATHS_MIME)
  if (multiRaw) {
    try {
      const parsed = JSON.parse(multiRaw) as unknown
      if (Array.isArray(parsed)) {
        const paths = dedupePaths(parsed.filter((value): value is string => typeof value === 'string'))
        if (paths.length > 0) {
          return {
            paths,
            fromTabBar: false,
            sourcePaneId: null,
          }
        }
      }
    } catch {
      // Ignore malformed drag payloads.
    }
  }

  const singlePath = readComposureDragData(dataTransfer, TREE_SINGLE_PATH_MIME)
  if (singlePath) {
    return {
      paths: [singlePath],
      fromTabBar: false,
      sourcePaneId: null,
    }
  }

  return null
}

function isDragFromThisTabBar(dataTransfer: DataTransfer | null, sourceBarId: string): boolean {
  if (!dataTransfer) {
    return false
  }
  return readComposureDragData(dataTransfer, TAB_SOURCE_BAR_MIME) === sourceBarId
}

export function FileTabs({
  paneId,
  tabs,
  activeFile,
  isFocusedPane = true,
  onActivate,
  onClose,
  onPromote,
  onMove,
  onDropPaths,
  snippetToolbarVisible = true,
  onToggleSnippetToolbar,
}: FileTabsProps) {
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; left: number } | null>(null)
  const [isExternalDragOver, setIsExternalDragOver] = useState(false)
  const [isTabBarHovered, setIsTabBarHovered] = useState(false)
  const [isToggleFocused, setIsToggleFocused] = useState(false)
  const barRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const sourceBarId = useId()
  const toggleToolbar = onToggleSnippetToolbar ?? (() => undefined)
  const ToggleIcon = snippetToolbarVisible ? ChevronUp : ChevronDown
  const showToolbarToggle = isTabBarHovered || isToggleFocused

  const computeDropTarget = (clientX: number): { index: number; left: number } | null => {
    const bar = barRef.current
    if (!bar) {
      return null
    }

    const barRect = bar.getBoundingClientRect()
    const tabEntries = tabs
      .map((tab) => ({ path: tab.path, element: tabRefs.current.get(tab.path) }))
      .filter((entry): entry is { path: string; element: HTMLDivElement } => Boolean(entry.element))

    if (tabEntries.length === 0) {
      return {
        index: 0,
        left: bar.scrollLeft + 8,
      }
    }

    let index = tabEntries.length
    for (let i = 0; i < tabEntries.length; i += 1) {
      const rect = tabEntries[i].element.getBoundingClientRect()
      if (clientX < rect.left + rect.width / 2) {
        index = i
        break
      }
    }

    let left = 0
    if (index <= 0) {
      const firstRect = tabEntries[0].element.getBoundingClientRect()
      left = firstRect.left - barRect.left + bar.scrollLeft
    } else if (index >= tabEntries.length) {
      const lastRect = tabEntries[tabEntries.length - 1].element.getBoundingClientRect()
      left = lastRect.right - barRect.left + bar.scrollLeft
    } else {
      const targetRect = tabEntries[index].element.getBoundingClientRect()
      left = targetRect.left - barRect.left + bar.scrollLeft
    }

    return { index, left }
  }

  const clearDragState = () => {
    setDragPath(null)
    setDropTarget(null)
    setIsExternalDragOver(false)
  }

  return (
    <div
      className="flex items-center border-b border-cz-border bg-cz-surface px-2 py-1"
      onPointerEnter={() => setIsTabBarHovered(true)}
      onPointerLeave={() => setIsTabBarHovered(false)}
    >
      <div
        ref={barRef}
        data-testid="file-tabs-bar"
        className="relative flex min-w-0 flex-1 select-none items-center gap-1 overflow-x-auto"
        onWheel={(event) => {
          const bar = event.currentTarget
          if (bar.scrollWidth <= bar.clientWidth) {
            return
          }

          const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
            ? event.deltaY
            : event.deltaX

          if (dominantDelta === 0) {
            return
          }

          event.preventDefault()
          bar.scrollLeft += dominantDelta
        }}
        onDragOver={(event) => {
          const dataTransfer = event.dataTransfer
          const externalPayload = dataTransfer ? parseExternalDropPayload(dataTransfer) : null
          const isSameBarDrag = isDragFromThisTabBar(dataTransfer, sourceBarId)
            || (dragPath !== null && !externalPayload)
          if (!isSameBarDrag && !externalPayload) {
            return
          }
          event.preventDefault()
          if (dataTransfer) {
            dataTransfer.dropEffect = 'move'
          }
          const next = computeDropTarget(event.clientX)
          setDropTarget(next)
          setIsExternalDragOver(!isSameBarDrag && Boolean(externalPayload))
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
            return
          }
          setDropTarget(null)
          setIsExternalDragOver(false)
        }}
        onDrop={(event) => {
          const dataTransfer = event.dataTransfer
          const externalPayload = dataTransfer ? parseExternalDropPayload(dataTransfer) : null
          const isSameBarDrag = isDragFromThisTabBar(dataTransfer, sourceBarId)
            || (dragPath !== null && !externalPayload)
          if (!isSameBarDrag && !externalPayload) return
          event.preventDefault()
          const next = computeDropTarget(event.clientX)
          const targetIndex = next?.index ?? tabs.length
          if (isSameBarDrag) {
            const internalPath = dragPath ?? (externalPayload?.paths.length === 1 ? externalPayload.paths[0] : null)
            if (internalPath) {
              onMove(internalPath, targetIndex)
            }
            clearDragState()
            return
          }
          if (externalPayload && onDropPaths) {
            onDropPaths({ ...externalPayload, targetIndex })
          }
          setDropTarget(null)
          setIsExternalDragOver(false)
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.path === activeFile
          const tabLabel = labelForPath(tab.path)

          return (
            <div
              key={tab.path}
              ref={(element) => {
                if (element) {
                  tabRefs.current.set(tab.path, element)
                } else {
                  tabRefs.current.delete(tab.path)
                }
              }}
              data-testid={`file-tab-${tab.path}`}
              draggable
              onDragStart={(event) => {
                setDragPath(tab.path)
                const dataTransfer = event.dataTransfer
                if (dataTransfer) {
                  dataTransfer.effectAllowed = 'move'
                  writeComposureDragPayload(dataTransfer, {
                    [TAB_SINGLE_PATH_MIME]: tab.path,
                    [TAB_SOURCE_PANE_MIME]: paneId,
                    [TAB_SOURCE_BAR_MIME]: sourceBarId,
                  })
                }
              }}
              onDragEnd={clearDragState}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault()
                }
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) {
                  return
                }
                event.preventDefault()
                onClose(tab.path)
              }}
              onClick={() => {
                onActivate(tab.path)
              }}
              onDoubleClick={() => {
                onPromote(tab.path)
              }}
              title={tab.path}
              className={`group flex h-7 w-fit min-w-[4rem] max-w-[12rem] shrink-0 grow-0 items-center gap-1 rounded border px-2 text-xs select-none ${isActive
                ? `${isFocusedPane ? 'border-cz-accent' : 'border-transparent'} bg-cz-accent-muted text-cz-accent`
                : 'border-transparent text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'
              }`}
            >
              <span className={`min-w-0 flex-1 truncate pr-0.5 ${tab.isEphemeral ? 'italic' : ''}`}>{tabLabel}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.path)
                }}
                className="rounded opacity-0 pointer-events-none transition-opacity hover:bg-cz-surface-hover hover:text-cz-text group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto"
                aria-label={`Close ${tabLabel}`}
                title={`Close ${tabLabel}`}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        {dropTarget && (dragPath || isExternalDragOver) && (
          <div
            data-testid="file-tabs-drop-indicator"
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1 top-1 w-1 -translate-x-1/2 rounded-sm border border-cz-accent/70 bg-cz-accent/10"
            style={{
              left: `${dropTarget.left}px`,
              backgroundImage: 'repeating-linear-gradient(180deg, var(--cz-accent) 0 2px, transparent 2px 4px)',
            }}
          />
        )}
      </div>

      <div
        className={`shrink-0 overflow-hidden transition-[margin,width] duration-150 ${showToolbarToggle ? 'ml-1 w-6' : 'm-0 w-0'}`}
      >
        <button
          type="button"
          onClick={toggleToolbar}
          onFocus={() => setIsToggleFocused(true)}
          onBlur={() => setIsToggleFocused(false)}
          aria-label={snippetToolbarVisible ? 'Hide snippet toolbar' : 'Show snippet toolbar'}
          title={snippetToolbarVisible ? 'Hide snippet toolbar' : 'Show snippet toolbar'}
          data-testid={`file-tabs-toolbar-toggle-${paneId}`}
          className={`flex h-6 w-6 items-center justify-center rounded text-cz-text-muted transition-opacity hover:bg-cz-surface-hover hover:text-cz-text ${showToolbarToggle ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        >
          <ToggleIcon size={14} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  )
}
