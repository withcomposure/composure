import type {
  ChangedFile,
  CommitEntry,
  FileDiff,
  SnapshotEntry,
} from '../types'
import { fetchJson } from '../utils/fetch'

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK_SIZE = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function hasAwarenessCursor(cursor: unknown): cursor is { anchor: unknown; head: unknown } {
  if (!cursor || typeof cursor !== 'object') return false
  const maybeCursor = cursor as { anchor?: unknown; head?: unknown }
  return maybeCursor.anchor != null && maybeCursor.head != null
}
export const AVATAR_MAX_BYTES = 256 * 1024

export function dataUrlPayloadBytes(dataUrl: string): number {
  const separator = dataUrl.indexOf(',')
  if (separator < 0) return 0
  const payload = dataUrl.slice(separator + 1)
  const paddingMatch = payload.match(/=+$/)
  const padding = paddingMatch ? paddingMatch[0].length : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
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