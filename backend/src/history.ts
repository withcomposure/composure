import path from 'path'
import fs from 'fs'
import * as Y from 'yjs'
import git from 'isomorphic-git'
import { loadDocument } from './db/index.js'
import { extractFilesFromDoc } from './files.js'
import { normalizeRelativePath } from './security.js'
import { getProjectAssetsDir } from './storage.js'
import { classifyBuffer } from './classify.js'

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data')
const REPOS_ROOT = path.join(DATA_DIR, 'repos')

const AUTHOR = { name: 'Pressmark', email: 'pressmark@local' }

function repoDir(projectId: string): string {
  return path.join(REPOS_ROOT, projectId)
}

export async function ensureRepo(projectId: string): Promise<string> {
  const dir = repoDir(projectId)
  fs.mkdirSync(dir, { recursive: true })
  const gitDir = path.join(dir, '.git')
  if (!fs.existsSync(gitDir)) {
    await git.init({ fs, dir })
    await git.setConfig({ fs, dir, path: 'user.email', value: AUTHOR.email })
    await git.setConfig({ fs, dir, path: 'user.name', value: AUTHOR.name })
    console.info(`[history] init-repo projectId=${projectId}`)
  }
  return dir
}

/** List files in dir recursively, returning paths relative to base (skipping .git). */
function listFiles(dir: string, base: string = dir): string[] {
  const files: string[] = []
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.pressmark') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full, base))
    else files.push(path.relative(base, full))
  }
  return files
}

// ---------------------------------------------------------------------------
// Per-project serialization queue — prevents concurrent git operations
// ---------------------------------------------------------------------------

const projectQueue = new Map<string, Promise<unknown>>()

function enqueue<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectQueue.get(projectId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  projectQueue.set(projectId, next)
  // Clean up the entry once settled, but only if it's still the same promise
  // (prevents GC leak on idle projects)
  void next.finally(() => {
    if (projectQueue.get(projectId) === next) {
      projectQueue.delete(projectId)
    }
  })
  return next
}

/**
 * Commit current Yjs state to the project's git repo.
 * Returns the commit SHA, or null if the tree is clean (no changes).
 * Serialized per project to prevent concurrent git operations.
 */
export function commitSnapshot(projectId: string, yDocState?: Uint8Array, opts?: { skipEmpty?: boolean }): Promise<string | null> {
  return enqueue(projectId, () => doCommitSnapshot(projectId, yDocState, opts))
}

async function doCommitSnapshot(projectId: string, yDocState?: Uint8Array, opts?: { skipEmpty?: boolean }): Promise<string | null> {
  const dir = await ensureRepo(projectId)

  // Remove all tracked files (except .git) before extracting, so deletions are captured
  for (const file of listFiles(dir)) {
    fs.unlinkSync(path.join(dir, file))
  }
  // Clean up empty directories
  removeEmptyDirs(dir)

  // Extract current project files
  if (yDocState) {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, yDocState)
    extractFilesFromDoc(doc, projectId, dir)
    doc.destroy()
  } else {
    const stored = await loadDocument(projectId)
    if (stored) {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, new Uint8Array(stored))
      extractFilesFromDoc(doc, projectId, dir)
      doc.destroy()
    }
  }

  // Stage all files
  const currentFiles = listFiles(dir)
  if (currentFiles.length === 0) {
    return null
  }

  // Stage everything
  await git.add({ fs, dir, filepath: '.' })

  // Check for deleted files and remove them from index
  const statusMatrix = await git.statusMatrix({ fs, dir })
  for (const [filepath, , workdir] of statusMatrix) {
    if (workdir === 0) {
      // File deleted from workdir
      await git.remove({ fs, dir, filepath })
    }
  }

  // Check if there are actual changes
  const matrix = await git.statusMatrix({ fs, dir })
  const hasChanges = matrix.some(([, head, workdir, stage]) => head !== 1 || workdir !== 1 || stage !== 1)
  if (!hasChanges) {
    return null
  }

  // When skipEmpty is set, only proceed if there are user-visible changes
  // (i.e., not just .pressmark/ metadata changes)
  if (opts?.skipEmpty) {
    const hasVisibleChanges = matrix.some(([filepath, head, workdir, stage]) =>
      !filepath.startsWith('.pressmark/') && (head !== 1 || workdir !== 1 || stage !== 1),
    )
    if (!hasVisibleChanges) {
      return null
    }
  }

  const sha = await git.commit({
    fs,
    dir,
    author: AUTHOR,
    message: `Auto-save — ${new Date().toISOString()}`,
  })

  console.info(`[history] commit projectId=${projectId} sha=${sha}`)
  return sha
}

export interface CommitEntry {
  sha: string
  message: string
  timestamp: number
  tag: string | null
}

export async function getLog(
  projectId: string,
  opts: { file?: string; limit?: number; before?: string } = {},
): Promise<CommitEntry[]> {
  const dir = repoDir(projectId)
  if (!fs.existsSync(path.join(dir, '.git'))) return []

  const tags = await listSnapshotMap(projectId)

  try {
    let commits = await git.log({
      fs,
      dir,
      depth: opts.limit ?? 100,
      ref: opts.before ?? 'HEAD',
    })

    // If before is specified, skip the first commit (it's the before commit itself)
    if (opts.before) {
      commits = commits.slice(1)
    }

    let entries: CommitEntry[] = commits.map((c) => ({
      sha: c.oid,
      message: c.commit.message.trim(),
      timestamp: c.commit.author.timestamp,
      tag: tags.get(c.oid) ?? null,
    }))

    if (opts.file) {
      entries = await filterByFile(dir, entries, opts.file)
    }

    return entries
  } catch {
    return []
  }
}

async function filterByFile(dir: string, entries: CommitEntry[], filePath: string): Promise<CommitEntry[]> {
  const result: CommitEntry[] = []
  for (const entry of entries) {
    const changed = await getChangedFiles(dir, entry.sha)
    if (changed.some((f) => f.path === filePath)) {
      result.push(entry)
    }
  }
  return result
}

export interface ChangedFile {
  path: string
  changeType: 'added' | 'modified' | 'deleted'
}

async function readTreePaths(dir: string, ref: string): Promise<Map<string, string>> {
  const paths = new Map<string, string>()
  try {
    await git.walk({
      fs,
      dir,
      trees: [git.TREE({ ref })],
      map: async (filepath, [entry]) => {
        if (filepath === '.' || filepath.startsWith('.pressmark/')) return undefined
        if (!entry) return undefined
        const type = await entry.type()
        if (type === 'blob') {
          const oid = await entry.oid()
          paths.set(filepath, oid)
        }
        return undefined
      },
    })
  } catch {
    // Empty tree (e.g. initial commit with no parent)
  }
  return paths
}

async function getChangedFiles(dir: string, sha: string): Promise<ChangedFile[]> {
  // Get list of parent commits
  const commits = await git.log({ fs, dir, depth: 1, ref: sha })
  if (commits.length === 0) return []

  const commit = commits[0]
  const parentShas = commit.commit.parent

  const currentTree = await readTreePaths(dir, sha)

  if (parentShas.length === 0) {
    // Initial commit — all files are "added"
    return Array.from(currentTree.keys()).map((p) => ({ path: p, changeType: 'added' }))
  }

  const parentTree = await readTreePaths(dir, parentShas[0])
  const changed: ChangedFile[] = []

  // Files in current but not in parent → added
  // Files in both but different OID → modified
  for (const [filepath, oid] of currentTree) {
    const parentOid = parentTree.get(filepath)
    if (!parentOid) {
      changed.push({ path: filepath, changeType: 'added' })
    } else if (parentOid !== oid) {
      changed.push({ path: filepath, changeType: 'modified' })
    }
  }

  // Files in parent but not in current → deleted
  for (const filepath of parentTree.keys()) {
    if (!currentTree.has(filepath)) {
      changed.push({ path: filepath, changeType: 'deleted' })
    }
  }

  return changed
}

export async function getChangedFilesForCommit(
  projectId: string,
  sha: string,
): Promise<ChangedFile[]> {
  const dir = repoDir(projectId)
  if (!fs.existsSync(path.join(dir, '.git'))) return []
  return getChangedFiles(dir, sha)
}

export interface FileDiff {
  oldContent: string | null
  newContent: string | null
  changeType: 'added' | 'modified' | 'deleted' | 'unchanged'
  isBinary: boolean
}

export async function getFileDiff(
  projectId: string,
  sha: string,
  filePath: string,
  base: 'parent' | 'current' = 'parent',
): Promise<FileDiff | null> {
  const dir = repoDir(projectId)
  if (!fs.existsSync(path.join(dir, '.git'))) return null

  const safePath = normalizeRelativePath(filePath)
  if (!safePath) return null

  const commits = await git.log({ fs, dir, depth: 1, ref: sha })
  if (commits.length === 0) return null

  const commit = commits[0]
  const parentShas = commit.commit.parent

  const manifest = await readTypeManifest(dir, sha)

  if (base === 'current') {
    // Compare current HEAD (old) against selected commit (new)
    // Green = what restoring this commit would add, Red = what would be lost
    let headBytes: Uint8Array | null = null
    try {
      const headSha = await git.resolveRef({ fs, dir, ref: 'HEAD' })
      const blob = await git.readBlob({ fs, dir, oid: headSha, filepath: safePath })
      headBytes = new Uint8Array(blob.blob)
    } catch {
      // File doesn't exist in HEAD
    }

    let commitBytes: Uint8Array | null = null
    try {
      const blob = await git.readBlob({ fs, dir, oid: sha, filepath: safePath })
      commitBytes = new Uint8Array(blob.blob)
    } catch {
      // File doesn't exist in this commit
    }

    if (headBytes === null && commitBytes === null) return null

    const changeType = headBytes === null
      ? 'added'
      : commitBytes === null
        ? 'deleted'
        : Buffer.from(headBytes).equals(Buffer.from(commitBytes))
          ? 'unchanged'
          : 'modified'

    const headManifest = await readTypeManifest(dir, 'HEAD').catch(() => null)
    const headIsBinary = headBytes ? classifyBlobBytes(headBytes, safePath, headManifest ?? manifest) === 'asset' : false
    const commitIsBinary = commitBytes ? classifyBlobBytes(commitBytes, safePath, manifest) === 'asset' : false
    const isBinary = headIsBinary || commitIsBinary

    return {
      oldContent: headBytes && !isBinary ? Buffer.from(headBytes).toString('utf-8') : null,
      newContent: commitBytes && !isBinary ? Buffer.from(commitBytes).toString('utf-8') : null,
      changeType,
      isBinary,
    }
  }

  let newBytes: Uint8Array | null = null
  try {
    const blob = await git.readBlob({ fs, dir, oid: sha, filepath: safePath })
    newBytes = new Uint8Array(blob.blob)
  } catch {
    // File doesn't exist in this commit
  }

  let oldBytes: Uint8Array | null = null
  if (parentShas.length > 0) {
    try {
      const blob = await git.readBlob({ fs, dir, oid: parentShas[0], filepath: safePath })
      oldBytes = new Uint8Array(blob.blob)
    } catch {
      // File doesn't exist in parent
    }
  }

  if (newBytes === null && oldBytes === null) return null

  const changeType = oldBytes === null
    ? 'added'
    : newBytes === null
      ? 'deleted'
      : Buffer.from(oldBytes).equals(Buffer.from(newBytes))
        ? 'unchanged'
        : 'modified'

  // Determine if either side is binary
  const newIsBinary = newBytes ? classifyBlobBytes(newBytes, safePath, manifest) === 'asset' : false
  const oldIsBinary = oldBytes ? classifyBlobBytes(oldBytes, safePath, manifest) === 'asset' : false
  const isBinary = newIsBinary || oldIsBinary

  return {
    oldContent: oldBytes && !isBinary ? Buffer.from(oldBytes).toString('utf-8') : null,
    newContent: newBytes && !isBinary ? Buffer.from(newBytes).toString('utf-8') : null,
    changeType,
    isBinary,
  }
}

export interface SnapshotEntry {
  name: string
  sha: string
  timestamp: number
}

export function createSnapshot(projectId: string, name: string): Promise<SnapshotEntry | null> {
  return enqueue(projectId, () => doCreateSnapshot(projectId, name))
}

async function doCreateSnapshot(projectId: string, name: string): Promise<SnapshotEntry | null> {
  const dir = repoDir(projectId)
  if (!fs.existsSync(path.join(dir, '.git'))) return null

  const sanitizedName = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  if (!sanitizedName) return null

  // Ensure unique tag name
  const existing = await git.listTags({ fs, dir })
  let tagName = sanitizedName
  if (existing.includes(tagName)) {
    tagName = `${sanitizedName}-${Date.now()}`
  }

  try {
    await git.annotatedTag({
      fs,
      dir,
      ref: tagName,
      message: name,
      tagger: AUTHOR,
    })

    const commits = await git.log({ fs, dir, depth: 1 })
    if (commits.length === 0) return null

    return {
      name,
      sha: commits[0].oid,
      timestamp: commits[0].commit.author.timestamp,
    }
  } catch {
    return null
  }
}

async function listSnapshotMap(projectId: string): Promise<Map<string, string>> {
  const dir = repoDir(projectId)
  const result = new Map<string, string>()
  if (!fs.existsSync(path.join(dir, '.git'))) return result

  try {
    const tags = await git.listTags({ fs, dir })
    for (const tag of tags) {
      try {
        const ref = await git.resolveRef({ fs, dir, ref: `refs/tags/${tag}` })
        // Try to read as annotated tag first
        try {
          const tagObj = await git.readTag({ fs, dir, oid: ref })
          result.set(tagObj.tag.object, tag)
        } catch {
          // Lightweight tag — ref itself is the commit
          result.set(ref, tag)
        }
      } catch {
        // Skip unresolvable tags
      }
    }
  } catch {
    // No tags
  }

  return result
}

export async function listSnapshots(projectId: string): Promise<SnapshotEntry[]> {
  const dir = repoDir(projectId)
  if (!fs.existsSync(path.join(dir, '.git'))) return []

  try {
    const tags = await git.listTags({ fs, dir })
    const snapshots: SnapshotEntry[] = []

    for (const tag of tags) {
      try {
        const ref = await git.resolveRef({ fs, dir, ref: `refs/tags/${tag}` })
        let commitSha = ref
        let tagMessage = tag

        try {
          const tagObj = await git.readTag({ fs, dir, oid: ref })
          commitSha = tagObj.tag.object
          tagMessage = tagObj.tag.message?.trim() || tag
        } catch {
          // Lightweight tag
        }

        const commits = await git.log({ fs, dir, depth: 1, ref: commitSha })
        if (commits.length > 0) {
          snapshots.push({
            name: tagMessage,
            sha: commitSha,
            timestamp: commits[0].commit.author.timestamp,
          })
        }
      } catch {
        // Skip unresolvable tags
      }
    }

    return snapshots.sort((a, b) => b.timestamp - a.timestamp)
  } catch {
    return []
  }
}

/**
 * Read the type manifest sidecar from a git tree at a given SHA.
 * Returns empty map on any failure (handles old commits gracefully).
 */
async function readTypeManifest(dir: string, sha: string): Promise<Map<string, 'text' | 'asset'>> {
  const result = new Map<string, 'text' | 'asset'>()
  try {
    const blob = await git.readBlob({ fs, dir, oid: sha, filepath: '.pressmark/types.json' })
    const json = Buffer.from(blob.blob).toString('utf-8')
    const parsed = JSON.parse(json) as Record<string, string>
    for (const [filepath, type] of Object.entries(parsed)) {
      if (type === 'text' || type === 'asset') {
        result.set(filepath, type)
      }
    }
  } catch {
    // Old commit without manifest, or parse error — return empty map
  }
  return result
}

/**
 * Classify a blob's type using a three-tier fallback:
 * 1. Type manifest (authoritative, written at commit time)
 * 2. Content sniffing via classifyBuffer (null-byte + UTF-8 validation)
 * 3. Optimistic text for empty blobs
 */
function classifyBlobBytes(
  bytes: Uint8Array,
  filepath: string,
  manifest: Map<string, 'text' | 'asset'>,
): 'text' | 'asset' {
  const manifestType = manifest.get(filepath)
  if (manifestType) return manifestType
  return classifyBuffer(bytes) === 'text' ? 'text' : 'asset'
}

/**
 * Build a Yjs document state from the files at a specific git commit.
 * Returns the encoded Yjs state update, or null if the commit tree is empty.
 */
export async function getDocStateAtCommit(projectId: string, sha: string): Promise<Uint8Array | null> {
  const dir = repoDir(projectId)
  if (!fs.existsSync(path.join(dir, '.git'))) return null

  const tree = await readTreePaths(dir, sha)
  if (tree.size === 0) return null

  const manifest = await readTypeManifest(dir, sha)
  const doc = new Y.Doc()
  const filesMap = doc.getMap('files')
  const assetsDir = getProjectAssetsDir(projectId)

  for (const filepath of tree.keys()) {
    try {
      const blob = await git.readBlob({ fs, dir, oid: sha, filepath })
      const fileType = classifyBlobBytes(new Uint8Array(blob.blob), filepath, manifest)
      if (fileType === 'text') {
        const content = Buffer.from(blob.blob).toString('utf-8')
        filesMap.set(filepath, JSON.stringify({ type: 'text' }))
        doc.getText(`file:${filepath}`).insert(0, content)
      } else {
        // Binary file — write to assets dir and add as asset entry so the
        // compiler can find it. Use the git blob OID as a stable key.
        const blobOid = tree.get(filepath)!
        const ext = filepath.split('.').pop()?.toLowerCase() ?? 'bin'
        const storageKey = `${blobOid}.${ext}`
        const assetPath = path.join(assetsDir, storageKey)
        if (!fs.existsSync(assetPath)) {
          fs.mkdirSync(assetsDir, { recursive: true })
          fs.writeFileSync(assetPath, Buffer.from(blob.blob))
        }
        filesMap.set(filepath, JSON.stringify({ type: 'asset', storageKey }))
      }
    } catch { /* skip unreadable blobs */ }
  }

  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

export interface RestoredFile {
  meta: string
  content: string | null
}

export interface RestoreResult {
  commit: CommitEntry
  restoredFiles: Map<string, RestoredFile>
}

export interface SingleFileRestoreResult {
  meta: string
  content: string | null
}

/**
 * Restore a single file from a historical commit into the live project.
 * Returns the file metadata and content for applying to the live Yjs doc.
 */
export async function restoreSingleFile(
  projectId: string,
  sha: string,
  filePath: string,
): Promise<SingleFileRestoreResult | null> {
  const dir = repoDir(projectId)
  if (!fs.existsSync(path.join(dir, '.git'))) return null

  const safePath = normalizeRelativePath(filePath)
  if (!safePath) return null

  try {
    const manifest = await readTypeManifest(dir, sha)
    const blob = await git.readBlob({ fs, dir, oid: sha, filepath: safePath })
    const fileType = classifyBlobBytes(new Uint8Array(blob.blob), safePath, manifest)
    if (fileType === 'text') {
      return {
        meta: JSON.stringify({ type: 'text' }),
        content: Buffer.from(blob.blob).toString('utf-8'),
      }
    } else {
      // Binary asset — write to assets dir and return asset metadata
      const assetsDir = getProjectAssetsDir(projectId)
      const ext = safePath.split('.').pop()?.toLowerCase() ?? 'bin'
      const storageKey = `${blob.oid}.${ext}`
      const assetPath = path.join(assetsDir, storageKey)
      if (!fs.existsSync(assetPath)) {
        fs.mkdirSync(assetsDir, { recursive: true })
        fs.writeFileSync(assetPath, Buffer.from(blob.blob))
      }
      return {
        meta: JSON.stringify({ type: 'asset', storageKey }),
        content: null,
      }
    }
  } catch {
    return null
  }
}

/**
 * Restore project to the state at a given commit.
 * Creates a new commit on HEAD with the restored tree.
 * Returns the commit info and the restored file data for applying to the live Yjs doc.
 */
export async function restoreToCommit(projectId: string, sha: string): Promise<RestoreResult | null> {
  const dir = await ensureRepo(projectId)

  // Read the tree at the target commit
  const targetTree = await readTreePaths(dir, sha)
  if (targetTree.size === 0) return null

  const manifest = await readTypeManifest(dir, sha)

  // Remove all working directory files
  for (const file of listFiles(dir)) {
    fs.unlinkSync(path.join(dir, file))
  }
  removeEmptyDirs(dir)

  // Write files from the target commit and collect restored file data
  const restoredFiles = new Map<string, RestoredFile>()
  const assetsDir = getProjectAssetsDir(projectId)

  for (const [filepath, blobOid] of targetTree) {
    try {
      const blob = await git.readBlob({ fs, dir, oid: sha, filepath })
      const fullPath = path.join(dir, filepath)
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, Buffer.from(blob.blob))

      const fileType = classifyBlobBytes(new Uint8Array(blob.blob), filepath, manifest)
      if (fileType === 'text') {
        restoredFiles.set(filepath, {
          meta: JSON.stringify({ type: 'text' }),
          content: Buffer.from(blob.blob).toString('utf-8'),
        })
      } else {
        // Binary asset — write to assets dir so it can be served
        const ext = filepath.split('.').pop()?.toLowerCase() ?? 'bin'
        const storageKey = `${blobOid}.${ext}`
        const assetPath = path.join(assetsDir, storageKey)
        if (!fs.existsSync(assetPath)) {
          fs.mkdirSync(assetsDir, { recursive: true })
          fs.writeFileSync(assetPath, Buffer.from(blob.blob))
        }
        restoredFiles.set(filepath, {
          meta: JSON.stringify({ type: 'asset', storageKey }),
          content: null,
        })
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Stage and commit
  await git.add({ fs, dir, filepath: '.' })
  const statusMatrix = await git.statusMatrix({ fs, dir })
  for (const [filepath, , workdir] of statusMatrix) {
    if (workdir === 0) {
      await git.remove({ fs, dir, filepath })
    }
  }

  const commitSha = await git.commit({
    fs,
    dir,
    author: AUTHOR,
    message: `Restored to ${sha.slice(0, 8)} — ${new Date().toISOString()}`,
  })

  console.info(`[history] restore projectId=${projectId} targetSha=${sha} newCommitSha=${commitSha} files=${restoredFiles.size}`)

  return {
    commit: {
      sha: commitSha,
      message: `Restored to ${sha.slice(0, 8)}`,
      timestamp: Math.floor(Date.now() / 1000),
      tag: null,
    },
    restoredFiles,
  }
}

function removeEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      removeEmptyDirs(full)
      try {
        const remaining = fs.readdirSync(full)
        if (remaining.length === 0) fs.rmdirSync(full)
      } catch {
        // Ignore
      }
    }
  }
}
