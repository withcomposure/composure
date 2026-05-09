import type {
  DiffBase,
  DiffMode,
  DiffWorkspaceTab,
  FileWorkspaceTab,
  WorkspaceTab,
} from '@/types'

function fileNameFromPath(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] || path
}

const diffTabPathPrefix = 'diff:'

export function createFileWorkspaceTab(
  path: string,
  isEphemeral: boolean,
): FileWorkspaceTab {
  return {
    kind: 'file',
    path,
    isEphemeral,
  }
}

export function buildDiffWorkspaceTabPath(
  commitSha: string,
  filePath: string,
): string {
  return `${diffTabPathPrefix}${commitSha}:${filePath}`
}

export function isDiffWorkspaceTabPath(path: string): boolean {
  return path.startsWith(diffTabPathPrefix)
}

export function createDiffWorkspaceTab(input: {
  filePath: string
  commitSha: string
  diffMode?: DiffMode
  diffBase?: DiffBase
}): DiffWorkspaceTab {
  return {
    kind: 'diff',
    path: buildDiffWorkspaceTabPath(input.commitSha, input.filePath),
    filePath: input.filePath,
    commitSha: input.commitSha,
    diffMode: input.diffMode ?? 'side-by-side',
    diffBase: input.diffBase ?? 'parent',
  }
}

export function isDiffWorkspaceTab(
  tab: WorkspaceTab | null | undefined,
): tab is DiffWorkspaceTab {
  if (!tab) {
    return false
  }
  return tab.kind === 'diff'
}

export function isFileWorkspaceTab(
  tab: WorkspaceTab | null | undefined,
): tab is FileWorkspaceTab {
  if (!tab) {
    return false
  }
  return tab.kind === 'file'
}

export function findWorkspaceTabByPath(
  tabs: WorkspaceTab[],
  tabPath: string,
): WorkspaceTab | null {
  return tabs.find((tab) => tab.path === tabPath) ?? null
}

export function workspaceTabFilePath(tab: WorkspaceTab): string {
  return tab.kind === 'diff' ? tab.filePath : tab.path
}

export function workspaceTabLabel(tab: WorkspaceTab): string {
  const fileName = fileNameFromPath(workspaceTabFilePath(tab))
  if (tab.kind === 'diff') {
    return `${fileName} @ ${tab.commitSha.slice(0, 7)}`
  }
  return fileName
}

export function workspaceTabTitle(tab: WorkspaceTab): string {
  if (tab.kind === 'diff') {
    return `${tab.filePath} @ ${tab.commitSha.slice(0, 7)}`
  }
  return tab.path
}

export function workspaceTabReferencesFile(
  tab: WorkspaceTab,
  filePath: string,
): boolean {
  return workspaceTabFilePath(tab) === filePath
}

export function renameWorkspaceTabFilePath(
  tab: WorkspaceTab,
  oldPath: string,
  newPath: string,
): WorkspaceTab {
  if (!workspaceTabReferencesFile(tab, oldPath)) {
    return tab
  }

  if (tab.kind === 'diff') {
    return createDiffWorkspaceTab({
      filePath: newPath,
      commitSha: tab.commitSha,
      diffMode: tab.diffMode,
      diffBase: tab.diffBase,
    })
  }

  return {
    ...tab,
    path: newPath,
  }
}
