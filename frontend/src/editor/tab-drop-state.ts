import type { EditorPaneState } from './workspace-state'
import type { WorkspaceTab } from '@/types'
import {
  createFileWorkspaceTab,
  promoteWorkspaceTab,
} from './workspace-tabs'

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

function normalizeMovedTab(tab: WorkspaceTab): WorkspaceTab {
  return promoteWorkspaceTab(tab)
}

function resolveTabsForDrop(
  paneStateById: Record<string, EditorPaneState>,
  paths: string[],
  options: ApplyDroppedPathsOptions,
): WorkspaceTab[] {
  if (!options.fromTabBar) {
    return paths.map((path) => createFileWorkspaceTab(path, false))
  }

  const sourcePaneId = options.sourcePaneId ?? null
  if (!sourcePaneId || !paneStateById[sourcePaneId]) {
    return paths.map((path) => createFileWorkspaceTab(path, false))
  }

  const sourceTabsByPath = new Map(
    paneStateById[sourcePaneId].tabs.map((tab) => [tab.path, tab]),
  )
  const movedTabs = paths
    .map((path) => sourceTabsByPath.get(path))
    .filter((tab): tab is WorkspaceTab => Boolean(tab))
    .map(normalizeMovedTab)

  if (movedTabs.length !== paths.length) {
    return paths.map((path) => createFileWorkspaceTab(path, false))
  }

  return movedTabs
}

function insertTabsIntoPane(
  pane: EditorPaneState,
  insertedTabs: WorkspaceTab[],
  targetIndex: number | null,
): EditorPaneState {
  const insertedPaths = insertedTabs.map((tab) => tab.path)
  const pathSet = new Set(insertedPaths)
  const tabsWithoutPaths = pane.tabs.filter((tab) => !pathSet.has(tab.path))

  const nextTabs = targetIndex === null
    ? [...tabsWithoutPaths, ...insertedTabs]
    : [
        ...tabsWithoutPaths.slice(0, targetIndex),
        ...insertedTabs,
        ...tabsWithoutPaths.slice(targetIndex),
      ]

  return {
    tabs: nextTabs,
    activePath: insertedTabs[insertedTabs.length - 1]?.path ?? pane.activePath,
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

  const insertedTabs = resolveTabsForDrop(paneStateById, paths, options)
  const shouldAppend = requestedIndex === null || (options.fromTabBar && targetHadPathBeforeDrop)
  const nextTargetPane = insertTabsIntoPane(
    targetPane,
    insertedTabs,
    shouldAppend ? null : requestedIndex,
  )

  return {
    ...baseState,
    [targetPaneId]: nextTargetPane,
  }
}
