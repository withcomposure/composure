import type {
  AuthSession,
  ChangedFile,
  CommitEntry,
  DashboardLayout,
  DashboardPreferencesState,
  FileDiff,
  RouteState,
  SnapshotEntry,
  SortBy,
} from './types'

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK_SIZE = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function isValidProjectId(id: string): boolean {
  return /^[a-f0-9]{32}$/.test(id)
}

export function hasAwarenessCursor(cursor: unknown): cursor is { anchor: unknown; head: unknown } {
  if (!cursor || typeof cursor !== 'object') return false
  const maybeCursor = cursor as { anchor?: unknown; head?: unknown }
  return maybeCursor.anchor != null && maybeCursor.head != null
}

export function parseRoute(): RouteState {
  const pathname = window.location.pathname || '/'
  const query = new URLSearchParams(window.location.search)

  if (pathname === '/' || pathname === '/index.html' || pathname === '/projects') {
    return { kind: 'projects' }
  }

  if (pathname === '/settings' || pathname === '/account') {
    return { kind: 'settings' }
  }

  if (pathname === '/admin') {
    return { kind: 'admin' }
  }

  if (pathname === '/reset-password') {
    const token = query.get('token') ?? undefined
    if (token) return { kind: 'reset-password', token }
  }

  if (pathname === '/invite') {
    const token = query.get('token') ?? undefined
    if (token) return { kind: 'invite', token }
  }

  const projectMatch = pathname.match(/^\/project\/([a-f0-9]{32})$/)
  if (projectMatch) {
    const shareToken = query.get('share') ?? undefined
    return { kind: 'project', projectId: projectMatch[1], shareToken }
  }

  return { kind: 'not-found', path: pathname }
}

function dispatchRouteChange(): void {
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function navigateToProjects(): void {
  history.pushState(null, '', '/')
  dispatchRouteChange()
}

export function navigateToSettings(): void {
  history.pushState(null, '', '/settings')
  dispatchRouteChange()
}

export function navigateToAdmin(): void {
  history.pushState(null, '', '/admin')
  dispatchRouteChange()
}

export function navigateToProject(projectId: string, shareToken?: string): void {
  history.pushState(null, '', makeProjectUrl(projectId, shareToken))
  dispatchRouteChange()
}

export function makeProjectUrl(projectId: string, shareToken?: string): string {
  if (!shareToken) {
    return `/project/${projectId}`
  }
  return `/project/${projectId}?share=${encodeURIComponent(shareToken)}`
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'Request failed' }))) as {
      error?: string
    }
    throw new Error(String(body.error ?? 'Request failed'))
  }

  return (await res.json()) as T
}

export function fmtTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString()
}

export function fmtRelativeTime(epochSeconds: number): string {
  const seconds = Math.max(1, Math.floor(Date.now() / 1000) - epochSeconds)
  if (seconds < 60) return 'Less than 1m ago'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const DASHBOARD_PREFS_STORAGE_KEY = 'composure.dashboard-preferences.v1'
export const AVATAR_MAX_BYTES = 256 * 1024

export function dataUrlPayloadBytes(dataUrl: string): number {
  const separator = dataUrl.indexOf(',')
  if (separator < 0) return 0
  const payload = dataUrl.slice(separator + 1)
  const paddingMatch = payload.match(/=+$/)
  const padding = paddingMatch ? paddingMatch[0].length : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

export function validateSortBy(input: unknown): SortBy {
  return input === 'created' || input === 'title' || input === 'last-active'
    ? input
    : 'last-active'
}

export function validateLayout(input: unknown): DashboardLayout {
  return input === 'list' || input === 'grid' ? input : 'grid'
}

export function loadDashboardPreferences(principalKey: string): DashboardPreferencesState {
  const defaults: DashboardPreferencesState = {
    sortBy: 'last-active',
    layout: 'grid',
    pinnedProjectIds: [],
  }

  try {
    const raw = window.localStorage.getItem(`${DASHBOARD_PREFS_STORAGE_KEY}:${principalKey}`)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<DashboardPreferencesState>
    const pinned = Array.isArray(parsed.pinnedProjectIds)
      ? parsed.pinnedProjectIds.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        )
      : []
    return {
      sortBy: validateSortBy(parsed.sortBy),
      layout: validateLayout(parsed.layout),
      pinnedProjectIds: pinned,
    }
  } catch {
    return defaults
  }
}

export function saveDashboardPreferences(
  principalKey: string,
  preferences: DashboardPreferencesState,
): void {
  window.localStorage.setItem(
    `${DASHBOARD_PREFS_STORAGE_KEY}:${principalKey}`,
    JSON.stringify(preferences),
  )
}

export function getDashboardPrincipalKey(session: AuthSession | null): string {
  if (session?.authenticated && session.user?.id) {
    return `user:${session.user.id}`
  }

  const guestId = session?.principal.guestId
  return guestId ? `guest:${guestId}` : 'guest:anonymous'
}

export async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Unable to read that image file.'))
      image.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function buildAvatarDataUrl(file: File): Promise<string> {
  const image = await loadImageElement(file)
  const shortestEdge = Math.min(image.naturalWidth, image.naturalHeight)
  if (shortestEdge <= 0) {
    throw new Error('Selected image is invalid.')
  }

  const sourceX = Math.floor((image.naturalWidth - shortestEdge) / 2)
  const sourceY = Math.floor((image.naturalHeight - shortestEdge) / 2)
  const targetSize = Math.min(256, shortestEdge)

  const canvas = document.createElement('canvas')
  canvas.width = targetSize
  canvas.height = targetSize
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Image processing is unavailable in this browser.')
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    shortestEdge,
    shortestEdge,
    0,
    0,
    targetSize,
    targetSize,
  )

  const attempts: Array<{ type: string; quality?: number }> = [
    { type: 'image/webp', quality: 0.82 },
    { type: 'image/jpeg', quality: 0.82 },
    { type: 'image/jpeg', quality: 0.7 },
    { type: 'image/jpeg', quality: 0.56 },
  ]

  for (const attempt of attempts) {
    const dataUrl = canvas.toDataURL(attempt.type, attempt.quality)
    if (dataUrlPayloadBytes(dataUrl) <= AVATAR_MAX_BYTES) {
      return dataUrl
    }
  }

  throw new Error('Avatar image is still too large after processing. Use a smaller source image.')
}

export function guestLabel(guestId: string | null | undefined): string {
  const normalized = String(guestId ?? '').trim()
  if (!normalized) return 'Guest'
  return `Guest ${normalized.slice(0, 8)}`
}

export function guestIdLabel(guestId: string | null | undefined): string {
  const normalized = String(guestId ?? '').trim()
  if (!normalized) return 'Guest ID: unknown'
  return `Guest ID: ${normalized}`
}

// History API helpers

export async function fetchHistory(
  projectId: string,
  opts: { file?: string; limit?: number; before?: string } = {},
): Promise<CommitEntry[]> {
  const params = new URLSearchParams()
  if (opts.file) params.set('file', opts.file)
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.before) params.set('before', opts.before)
  const qs = params.toString()
  const body = await fetchJson<{ commits: CommitEntry[] }>(
    `/api/projects/${projectId}/history${qs ? `?${qs}` : ''}`,
  )
  return body.commits
}

export async function fetchChangedFiles(
  projectId: string,
  sha: string,
): Promise<ChangedFile[]> {
  const body = await fetchJson<{ files: ChangedFile[] }>(
    `/api/projects/${projectId}/history/${sha}/files`,
  )
  return body.files
}

export async function fetchFileDiff(
  projectId: string,
  sha: string,
  filePath: string,
  base: 'parent' | 'current' = 'parent',
): Promise<FileDiff> {
  const params = new URLSearchParams({ file: filePath, base })
  return fetchJson<FileDiff>(
    `/api/projects/${projectId}/history/${sha}/diff?${params.toString()}`,
  )
}

export async function createSnapshotApi(
  projectId: string,
  name: string,
): Promise<SnapshotEntry> {
  const body = await fetchJson<{ snapshot: SnapshotEntry }>(
    `/api/projects/${projectId}/history/snapshot`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  return body.snapshot
}

export async function fetchSnapshots(projectId: string): Promise<SnapshotEntry[]> {
  const body = await fetchJson<{ snapshots: SnapshotEntry[] }>(
    `/api/projects/${projectId}/history/snapshots`,
  )
  return body.snapshots
}

export async function restoreVersion(
  projectId: string,
  commitSha: string,
): Promise<CommitEntry> {
  const body = await fetchJson<{ commit: CommitEntry }>(
    `/api/projects/${projectId}/history/restore`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitSha }),
    },
  )
  return body.commit
}

export async function restoreFile(
  projectId: string,
  commitSha: string,
  filePath: string,
): Promise<void> {
  await fetchJson<{ ok: boolean }>(
    `/api/projects/${projectId}/history/restore-file`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitSha, filePath }),
    },
  )
}