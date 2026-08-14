import type {
  ChangedFile,
  CommitEntry,
  FileDiff,
  SnapshotEntry,
} from '@/types'
import { fetchJson } from '@/utils/fetch'

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
    `/projects/${projectId}/history${qs ? `?${qs}` : ''}`,
  )
  return body.commits
}

export async function fetchChangedFiles(
  projectId: string,
  sha: string,
): Promise<ChangedFile[]> {
  const body = await fetchJson<{ files: ChangedFile[] }>(
    `/projects/${projectId}/history/${sha}/files`,
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
    `/projects/${projectId}/history/${sha}/diff?${params.toString()}`,
  )
}

export async function createSnapshotApi(
  projectId: string,
  name: string,
): Promise<SnapshotEntry> {
  const body = await fetchJson<{ snapshot: SnapshotEntry }>(
    `/projects/${projectId}/history/snapshot`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  return body.snapshot
}

export async function restoreVersion(
  projectId: string,
  commitSha: string,
): Promise<CommitEntry> {
  const body = await fetchJson<{ commit: CommitEntry }>(
    `/projects/${projectId}/history/restore`,
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
    `/projects/${projectId}/history/restore-file`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitSha, filePath }),
    },
  )
}
