export interface Principal {
  userId: string | null
  guestId: string | null
}

export interface ProjectRow {
  id: string
  title: string
  root_file: string
  engine: string | null
  owner_user_id: string
  created_at: number
  last_active_at: number
  deleted_at: number | null
}

export interface ProjectSummary {
  id: string
  title: string
  rootFile: string
  engine: string | null
  createdAt: number
  lastActiveAt: number
  topLevelCommentCount: number
  ownerType: 'user' | 'guest'
  ownerDisplayName: string
  ownerProfileImageUrl: string | null
  shareToken?: string
}

export interface SessionUser {
  id: string
  email: string
  displayName: string
  profileImageUrl: string | null
  role: 'user' | 'admin'
  isGuest?: boolean
}

export interface AdminUserSummary {
  id: string
  email: string
  displayName: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  maxProjects: number | null
  lastLoginAt: number | null
  createdAt: number
}

export interface UserPreferences {
  appearance: 'light' | 'dark' | 'system'
  theme: string
  recentItemsLimit: number
  autoCompileDefault: boolean
  autoCompileTimeoutSeconds: number
  editorBraceMatching: boolean
  editorHighlightSelectionMatches: boolean
  editorInEditorFind: boolean
  editorAutocomplete: boolean
  editorAutoCloseLatexBeginEnd: boolean
  dashboardSortBy: 'last-active' | 'created' | 'title'
  dashboardLayout: 'grid' | 'list'
  pinnedProjectIds: string[]
  quickAccessPinnedLimit: number
  autoVersionIntervalMinutes: number
  autoSaveOnCompile: boolean
  autoSaveOnExport: boolean
}

export interface RecentProjectSummary {
  id: string
  title: string
  rootFile: string
  engine: string | null
  createdAt: number
  lastActiveAt: number
  topLevelCommentCount: number
  ownerType: 'user' | 'guest'
  ownerDisplayName: string
  ownerProfileImageUrl: string | null
  openedAt: number
  shareToken?: string
}

export interface SessionSummary {
  id: string
  createdAt: number
  expiresAt: number
  lastUsedAt?: number
  isCurrent: boolean
}

export type ProjectRole = 'view' | 'comment' | 'edit' | 'owner'

export interface ProjectMemberSummary {
  userId: string | null
  email: string | null
  displayName: string
  role: ProjectRole
  status: 'pending' | 'accepted'
  profileImageUrl: string | null
  invitedAt: number
}

export interface ProjectAccessPerson {
  userId: string | null
  email: string | null
  displayName: string
  profileImageUrl: string | null
  role: ProjectRole
  status: 'accepted' | 'pending'
  isOwner: boolean
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

export interface LinkSharingState {
  enabled: boolean
  role: Exclude<ProjectRole, 'owner'> | null
  token: string | null
}
