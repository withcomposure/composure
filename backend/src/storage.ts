import path from 'path'
import fs from 'fs'
import { createReadStream, type ReadStream } from 'fs'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { createUid } from './ids.js'
import { isValidProjectId } from './security.js'
import { getMaxUploadFileSize, getMaxTextFileSize } from './db/index.js'
import { classifyBuffer } from './classify.js'

// ---------------------------------------------------------------------------
// AssetStore interface
// ---------------------------------------------------------------------------

export interface AssetStore {
  put(projectId: string, storageKey: string, stream: Readable): Promise<{ size: number }>
  get(projectId: string, storageKey: string): ReadStream | null
  delete(projectId: string, storageKey: string): void
  deleteProject(projectId: string): void
  list(projectId: string): string[]
}

// ---------------------------------------------------------------------------
// LocalAssetStore implementation
// ---------------------------------------------------------------------------

const dataDir = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data')
const assetsRoot = path.join(dataDir, 'assets')
fs.mkdirSync(assetsRoot, { recursive: true })

const storageKeyPattern = /^[a-f0-9]{32,40}\.[a-zA-Z0-9]+$/

export function isValidStorageKey(key: string): boolean {
  return storageKeyPattern.test(key)
}

class LocalAssetStore implements AssetStore {
  private projectDir(projectId: string): string {
    return path.join(assetsRoot, projectId)
  }

  async put(projectId: string, storageKey: string, stream: Readable): Promise<{ size: number }> {
    const dir = this.projectDir(projectId)
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, storageKey)
    await pipeline(stream, fs.createWriteStream(target))
    const stat = fs.statSync(target)
    return { size: stat.size }
  }

  get(projectId: string, storageKey: string): ReadStream | null {
    const filePath = path.join(this.projectDir(projectId), storageKey)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null
    return createReadStream(filePath)
  }

  delete(projectId: string, storageKey: string): void {
    const filePath = path.join(this.projectDir(projectId), storageKey)
    fs.rmSync(filePath, { force: true })
  }

  deleteProject(projectId: string): void {
    const dir = this.projectDir(projectId)
    fs.rmSync(dir, { recursive: true, force: true })
  }

  list(projectId: string): string[] {
    const dir = this.projectDir(projectId)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile())
  }
}

export const assetStore: AssetStore = new LocalAssetStore()

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------

function extensionFromFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 1) return '.bin'
  return name.slice(dot).toLowerCase()
}

export function generateStorageKey(originalFilename: string): string {
  const ext = extensionFromFilename(originalFilename)
  return `${createUid()}${ext}`
}

// ---------------------------------------------------------------------------
// Upload types & route
// ---------------------------------------------------------------------------

interface UploadParams {
  projectId: string
}

export interface UploadedAsset {
  kind: 'asset'
  originalName: string
  storageKey: string
  size: number
  mimeType: string
}

export interface UploadedText {
  kind: 'text'
  originalName: string
  content: string
  size: number
}

export type UploadedFile = UploadedText | UploadedAsset

async function persistPart(projectId: string, part: MultipartFile, maxBytes: number | null): Promise<UploadedFile> {
  // Buffer the full stream to classify content
  const chunks: Buffer[] = []
  for await (const chunk of part.file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (part.file.truncated) {
    const limitLabel = maxBytes ? `${Math.round(maxBytes / (1024 * 1024))} MB` : 'the'
    throw new Error(`File too large: ${part.filename} exceeds the ${limitLabel} upload limit`)
  }

  const buffer = Buffer.concat(chunks)
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const classification = classifyBuffer(bytes)

  if (classification === 'text') {
    // Check text size limit
    const maxTextSize = await getMaxTextFileSize()
    if (maxTextSize !== 'unlimited' && buffer.length > maxTextSize) {
      const limitMB = Math.round(maxTextSize / (1024 * 1024))
      throw new Error(`Text file too large: ${part.filename} exceeds the ${limitMB} MB text file limit`)
    }
    return {
      kind: 'text',
      originalName: part.filename,
      content: buffer.toString('utf-8'),
      size: buffer.length,
    }
  }

  // Binary file — write to asset store
  const storageKey = generateStorageKey(part.filename)
  const dir = path.join(assetsRoot, projectId)
  fs.mkdirSync(dir, { recursive: true })
  const targetPath = path.join(dir, storageKey)
  fs.writeFileSync(targetPath, buffer)

  return {
    kind: 'asset',
    originalName: part.filename,
    storageKey,
    size: buffer.length,
    mimeType: part.mimetype || 'application/octet-stream',
  }
}

/** Upload route: POST /api/upload/:projectId */
export async function uploadRoute(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = req.params as UploadParams
  const projectId = params.projectId
  if (!projectId || !isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const maxSize = await getMaxUploadFileSize()
  const fileSizeLimit = maxSize === 'unlimited' ? undefined : maxSize

  const parts = req.files({ limits: { files: 20, fileSize: fileSizeLimit } })
  const uploaded: UploadedFile[] = []

  try {
    for await (const part of parts) {
      uploaded.push(await persistPart(projectId, part, fileSizeLimit ?? null))
    }
  } catch (error) {
    reply.status(400).send({ error: error instanceof Error ? error.message : 'Upload failed' })
    return
  }

  reply.send({ uploaded })
}

/** Delete a single asset: DELETE /api/upload/:projectId/:storageKey */
export function deleteAssetRoute(
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  const params = req.params as { projectId: string; storageKey: string }
  const { projectId, storageKey } = params

  if (!projectId || !isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }
  if (!storageKey || !isValidStorageKey(storageKey)) {
    reply.status(400).send({ error: 'Invalid storage key' })
    return
  }

  assetStore.delete(projectId, storageKey)
  reply.send({ ok: true })
}

/** List assets for a project: GET /api/upload/:projectId */
export function listAssetsRoute(
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  const params = req.params as { projectId: string }
  const projectId = params.projectId

  if (!projectId || !isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  reply.send({ assets: assetStore.list(projectId) })
}

/** Get the asset directory path for a project */
export function getProjectAssetsDir(projectId: string): string {
  return path.join(assetsRoot, projectId)
}
