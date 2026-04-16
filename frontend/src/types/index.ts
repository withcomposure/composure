import type { AccessPerson, ShareRole } from '../workspace/ShareModal'

export interface ProjectSummary {
  id: string
  title: string
  rootFile: string
  createdAt: number
  lastActiveAt: number
  topLevelCommentCount: number
  ownerType: 'user' | 'guest'
  ownerDisplayName: string
  ownerProfileImageUrl: string | null
  shareToken?: string
}

export interface RecentProjectSummary extends ProjectSummary {
  openedAt: number
  shareToken?: string
}

export interface TrashedProjectSummary {
  id: string
  title: string
  createdAt: number
  deletedAt: number
}

export interface SessionSummary {
  id: string
  createdAt: number
  expiresAt: number
  isCurrent: boolean
}

export type SortBy = 'last-active' | 'created' | 'title'
export type DashboardLayout = 'grid' | 'list'

export interface UserPreferences {
  appearance: 'light' | 'dark' | 'system'
  recentItemsLimit: number
  autoCompileDefault: boolean
  autoCompileTimeoutSeconds: number
  editorBraceMatching: boolean
  editorHighlightSelectionMatches: boolean
  editorInEditorFind: boolean
  editorAutocomplete: boolean
  editorAutoCloseLatexBeginEnd: boolean
  dashboardSortBy: SortBy
  dashboardLayout: DashboardLayout
  pinnedProjectIds: string[]
  quickAccessPinnedLimit: number
  autoVersionIntervalMinutes: number
  autoSaveOnCompile: boolean
  autoSaveOnExport: boolean
}

export interface SessionUser {
  id: string
  email: string
  displayName: string
  profileImageUrl: string | null
  role: 'user' | 'admin'
}

export interface DashboardPreferencesState {
  sortBy: SortBy
  layout: DashboardLayout
  pinnedProjectIds: string[]
}

export interface AuthSession {
  authenticated: boolean
  user: SessionUser | null
  principal: {
    userId: string | null
    guestId: string | null
  }
  guestRetentionDays: number
  userCount: number
  signupMode: 'open' | 'invite-only'
  guestSignupsEnabled: boolean
}

export type RouteState =
  | { kind: 'projects' }
  | { kind: 'settings' }
  | { kind: 'admin' }
  | { kind: 'reset-password'; token: string }
  | { kind: 'invite'; token: string }
  | { kind: 'not-found'; path: string }
  | { kind: 'project'; projectId: string; shareToken?: string }

export type EditorMode = 'view' | 'comment' | 'edit'
export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface ProjectAccessResponse {
  people: AccessPerson[]
  linkSharing: {
    enabled: boolean
    role: ShareRole | null
    token: string | null
  }
  currentRole: ShareRole | 'owner' | null
  maxTextFileSizeBytes: number | 'unlimited'
  largeFileThresholdChars: number
}

export interface ActiveCollaborator {
  clientId: number
  name: string
  color: string
  userId: string | null
  profileImageUrl: string | null
  hasCursor: boolean
}

export type AppPopupState =
  | {
    kind: 'alert'
    title: string
    message: string
  }
  | {
    kind: 'confirm'
    title: string
    message: string
    confirmLabel: string
    confirmVariant?: 'primary' | 'danger'
    onConfirm: () => Promise<void> | void
  }
  | {
    kind: 'prompt'
    title: string
    message: string
    initialValue: string
    inputType?: 'text' | 'password'
    confirmLabel: string
    confirmVariant?: 'primary' | 'danger'
    onConfirm: (value: string) => Promise<void> | void
  }

export interface CommitEntry {
  sha: string
  message: string
  timestamp: number
  tag: string | null
}

export interface ChangedFile {
  path: string
  changeType: 'added' | 'modified' | 'deleted'
}

export interface SnapshotEntry {
  name: string
  sha: string
  timestamp: number
}

export interface FileDiff {
  oldContent: string | null
  newContent: string | null
  changeType: 'added' | 'modified' | 'deleted' | 'unchanged'
  isBinary: boolean
}

export interface HistoryState {
  commitSha: string
  filePath: string
  diffMode: 'side-by-side' | 'inline'
}

export interface ProjectComment {
  id: string
  projectId: string
  filePath: string
  startLine: number | null
  endLine: number | null
  parentCommentId: string | null
  body: string
  authorUserId: string | null
  authorGuestId: string | null
  authorDisplayName: string
  authorProfileImageUrl: string | null
  createdAt: number
  updatedAt: number
}

export interface WorkspaceTab {
  path: string
  isEphemeral: boolean
}

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  engine: 'typst' | 'latex' | 'markdown' | 'asciidoc'
  category: string
  tags: string[]
  entrypoint: string
  isBlank: boolean
}
