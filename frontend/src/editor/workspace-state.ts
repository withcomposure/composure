import type { WorkspaceTab } from '@/types'

export type SplitOrientation = 'horizontal' | 'vertical'
export type SidebarTab = 'files' | 'review' | 'history'

export interface EditorPaneState {
  tabs: WorkspaceTab[]
  activePath: string
  showSnippetToolbar: boolean
}

export interface PaneLayoutNode {
  kind: 'pane'
  paneId: string
}

export interface SplitLayoutNode {
  kind: 'split'
  splitId: string
  orientation: SplitOrientation
  ratio: number
  first: EditorLayoutNode
  second: EditorLayoutNode
}

export type EditorLayoutNode = PaneLayoutNode | SplitLayoutNode

export interface PersistedWorkspaceState {
  version: 1
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  sidebarWidth: number
  previewOpen: boolean
  previewWidth: number
  activePaneId: string
  activeFile: string
  paneStateById: Record<string, EditorPaneState>
  editorLayout: EditorLayoutNode
}

export const ROOT_PANE_ID = 'pane-1'

const sidebarWidthMin = 180
const sidebarWidthMax = 420
const previewWidthMin = 300
const previewWidthMax = 2400
const splitRatioMin = 0.15
const splitRatioMax = 0.85

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeSidebarTab(value: unknown): SidebarTab {
  return value === 'review' || value === 'history' ? value : 'files'
}

function normalizeTabs(raw: unknown): WorkspaceTab[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const seen = new Set<string>()
  const tabs: WorkspaceTab[] = []

  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue
    }

    const path = asNonEmptyString(entry.path)
    if (!path || seen.has(path)) {
      continue
    }

    tabs.push({
      path,
      isEphemeral: Boolean(entry.isEphemeral),
    })
    seen.add(path)
  }

  return tabs
}

function normalizePaneState(raw: unknown): EditorPaneState {
  if (!isRecord(raw)) {
    return { tabs: [], activePath: '', showSnippetToolbar: true }
  }

  const tabs = normalizeTabs(raw.tabs)
  const activePathRaw = asNonEmptyString(raw.activePath) ?? ''
  const activePath = tabs.some((tab) => tab.path === activePathRaw)
    ? activePathRaw
    : (tabs[0]?.path ?? '')

  return {
    tabs,
    activePath,
    showSnippetToolbar: raw.showSnippetToolbar !== false,
  }
}

function normalizePaneStateById(raw: unknown): Record<string, EditorPaneState> {
  if (!isRecord(raw)) {
    return {}
  }

  const next: Record<string, EditorPaneState> = {}
  for (const [paneId, paneStateRaw] of Object.entries(raw)) {
    const normalizedPaneId = asNonEmptyString(paneId)
    if (!normalizedPaneId) {
      continue
    }
    next[normalizedPaneId] = normalizePaneState(paneStateRaw)
  }

  return next
}

function normalizeLayoutNode(
  raw: unknown,
  seenPaneIds: Set<string>,
  seenSplitIds: Set<string>,
): EditorLayoutNode | null {
  if (!isRecord(raw)) {
    return null
  }

  if (raw.kind === 'pane') {
    const paneId = asNonEmptyString(raw.paneId)
    if (!paneId || seenPaneIds.has(paneId)) {
      return null
    }
    seenPaneIds.add(paneId)
    return {
      kind: 'pane',
      paneId,
    }
  }

  if (raw.kind === 'split') {
    const splitId = asNonEmptyString(raw.splitId)
    if (!splitId || seenSplitIds.has(splitId)) {
      return null
    }

    const orientation: SplitOrientation = raw.orientation === 'vertical' ? 'vertical' : 'horizontal'
    const ratio = typeof raw.ratio === 'number' && Number.isFinite(raw.ratio)
      ? clamp(raw.ratio, splitRatioMin, splitRatioMax)
      : 0.5

    seenSplitIds.add(splitId)
    const first = normalizeLayoutNode(raw.first, seenPaneIds, seenSplitIds)
    const second = normalizeLayoutNode(raw.second, seenPaneIds, seenSplitIds)

    if (!first || !second) {
      return null
    }

    return {
      kind: 'split',
      splitId,
      orientation,
      ratio,
      first,
      second,
    }
  }

  return null
}

function normalizeSidebarWidth(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return 260
  }
  return clamp(Math.floor(raw), sidebarWidthMin, sidebarWidthMax)
}

function normalizePreviewWidth(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return 520
  }
  return clamp(Math.floor(raw), previewWidthMin, previewWidthMax)
}

export function collectPaneIds(node: EditorLayoutNode): string[] {
  if (node.kind === 'pane') {
    return [node.paneId]
  }

  return [...collectPaneIds(node.first), ...collectPaneIds(node.second)]
}

export function collectSplitIds(node: EditorLayoutNode): string[] {
  if (node.kind === 'pane') {
    return []
  }

  return [node.splitId, ...collectSplitIds(node.first), ...collectSplitIds(node.second)]
}

export function defaultPersistedWorkspaceState(): PersistedWorkspaceState {
  return {
    version: 1,
    sidebarOpen: true,
    sidebarTab: 'files',
    sidebarWidth: 260,
    previewOpen: true,
    previewWidth: 520,
    activePaneId: ROOT_PANE_ID,
    activeFile: '',
    paneStateById: {
      [ROOT_PANE_ID]: { tabs: [], activePath: '', showSnippetToolbar: true },
    },
    editorLayout: { kind: 'pane', paneId: ROOT_PANE_ID },
  }
}

export function parsePersistedWorkspaceState(raw: unknown): PersistedWorkspaceState | null {
  if (!isRecord(raw)) {
    return null
  }

  const seenPaneIds = new Set<string>()
  const seenSplitIds = new Set<string>()
  const normalizedLayout = normalizeLayoutNode(raw.editorLayout, seenPaneIds, seenSplitIds)
    ?? { kind: 'pane', paneId: ROOT_PANE_ID }
  const paneIds = collectPaneIds(normalizedLayout)
  const normalizedPaneStateByIdInput = normalizePaneStateById(raw.paneStateById)

  const paneStateById: Record<string, EditorPaneState> = {}
  for (const paneId of paneIds) {
    paneStateById[paneId] = normalizePaneState(normalizedPaneStateByIdInput[paneId])
  }

  const requestedActivePaneId = asNonEmptyString(raw.activePaneId)
  const activePaneId = requestedActivePaneId && paneStateById[requestedActivePaneId]
    ? requestedActivePaneId
    : (paneIds[0] ?? ROOT_PANE_ID)

  const requestedActiveFile = asNonEmptyString(raw.activeFile) ?? ''
  const activeFile = requestedActiveFile || paneStateById[activePaneId]?.activePath || ''

  return {
    version: 1,
    sidebarOpen: raw.sidebarOpen !== false,
    sidebarTab: normalizeSidebarTab(raw.sidebarTab),
    sidebarWidth: normalizeSidebarWidth(raw.sidebarWidth),
    previewOpen: raw.previewOpen !== false,
    previewWidth: normalizePreviewWidth(raw.previewWidth),
    activePaneId,
    activeFile,
    paneStateById,
    editorLayout: normalizedLayout,
  }
}

export function buildPersistedWorkspaceState(
  input: Omit<PersistedWorkspaceState, 'version'>,
): PersistedWorkspaceState {
  return parsePersistedWorkspaceState({ version: 1, ...input }) ?? defaultPersistedWorkspaceState()
}

function parseIdSuffix(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) {
    return null
  }

  const suffix = id.slice(prefix.length)
  if (!/^\d+$/.test(suffix)) {
    return null
  }

  const parsed = Number.parseInt(suffix, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function getNextPaneIdCounter(
  layout: EditorLayoutNode,
  paneStateById: Record<string, EditorPaneState>,
): number {
  let maxId = 1

  const paneIds = new Set<string>([...collectPaneIds(layout), ...Object.keys(paneStateById)])
  for (const paneId of paneIds) {
    const parsed = parseIdSuffix(paneId, 'pane-')
    if (parsed != null) {
      maxId = Math.max(maxId, parsed)
    }
  }

  return maxId + 1
}

export function getNextSplitIdCounter(layout: EditorLayoutNode): number {
  let maxId = 0

  for (const splitId of collectSplitIds(layout)) {
    const parsed = parseIdSuffix(splitId, 'split-')
    if (parsed != null) {
      maxId = Math.max(maxId, parsed)
    }
  }

  return maxId + 1
}

export function shouldResetWorkspaceForProjectChange(
  previousProjectId: string,
  nextProjectId: string,
): boolean {
  return previousProjectId !== nextProjectId
}

export function shouldReconcileWorkspaceFromFileMap(
  initialSyncDone: boolean,
  connectionState: 'connecting' | 'connected' | 'disconnected',
): boolean {
  return initialSyncDone && connectionState === 'connected'
}

export function shouldEnableWorkspaceStatePersistence(
  loadSucceeded: boolean,
  cancelled: boolean,
): boolean {
  return loadSucceeded && !cancelled
}
