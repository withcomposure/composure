import type { EditorPaneState } from './workspace-state'

interface ApplyDroppedPathsOptions {
  fromTabBar: boolean
  sourcePaneId?: string | null
  targetIndex?: number
}

export function removePathsFromPane(pane: EditorPaneState, removedPaths: string[]): EditorPaneState {
  const removedPathSet = new Set(removedPaths)
  const nextTabs = pane.tabs.filter((tab) => !removedPathSet.has(tab.path))
  const nextActivePath = removedPathSet.has(pane.activePath)
    ? (nextTabs[0]?.path ?? '')
    : pane.activePath
  return {
    tabs: nextTabs,
    activePath: nextActivePath,
    showSnippetToolbar: pane.showSnippetToolbar,
  }
}

export function removeDroppedTabPathsFromSource(
  paneStateById: Record<string, EditorPaneState>,
  movedPaths: string[],
  sourcePaneId: string | null,
): Record<string, EditorPaneState> {
  if (sourcePaneId && paneStateById[sourcePaneId]) {
    return {
      ...paneStateById,
      [sourcePaneId]: removePathsFromPane(paneStateById[sourcePaneId], movedPaths),
    }
  }

  // Fallback for malformed payloads: avoid destructive cross-pane removals.
  return { ...paneStateById }
}

function insertPersistentPathsIntoPane(
  pane: EditorPaneState,
  paths: string[],
  targetIndex: number | null,
): EditorPaneState {
  const pathSet = new Set(paths)
  const tabsWithoutPaths = pane.tabs.filter((tab) => !pathSet.has(tab.path))
  const insertedTabs = paths.map((path) => ({ path, isEphemeral: false }))

  const nextTabs = targetIndex === null
    ? [...tabsWithoutPaths, ...insertedTabs]
    : [
        ...tabsWithoutPaths.slice(0, targetIndex),
        ...insertedTabs,
        ...tabsWithoutPaths.slice(targetIndex),
      ]

  return {
    tabs: nextTabs,
    activePath: paths[paths.length - 1],
    showSnippetToolbar: pane.showSnippetToolbar,
  }
}

export function applyDroppedPathsToPaneState(
  paneStateById: Record<string, EditorPaneState>,
  targetPaneId: string,
  paths: string[],
  options: ApplyDroppedPathsOptions,
): Record<string, EditorPaneState> {
  const targetHadPathBeforeDrop = paneStateById[targetPaneId]?.tabs.some((tab) => paths.includes(tab.path)) ?? false

  const baseState = options.fromTabBar
    ? removeDroppedTabPathsFromSource(paneStateById, paths, options.sourcePaneId ?? null)
    : { ...paneStateById }

  const targetPane = baseState[targetPaneId] ?? { tabs: [], activePath: '', showSnippetToolbar: true }

  const requestedIndex = options.targetIndex == null
    ? null
    : Math.max(0, Math.min(options.targetIndex, targetPane.tabs.length))

  const shouldAppend = requestedIndex === null || (options.fromTabBar && targetHadPathBeforeDrop)
  const nextTargetPane = insertPersistentPathsIntoPane(
    targetPane,
    paths,
    shouldAppend ? null : requestedIndex,
  )

  return {
    ...baseState,
    [targetPaneId]: nextTargetPane,
  }
}
