import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import Fastify, { type FastifyRequest } from 'fastify'
import * as Y from 'yjs'
import { normalizeRelativePath, isPathWithin, hasLeadingDashSegment, sanitizeCompileLog as _sanitizeCompileLog, syncProjectSource } from './utils.js'
import { selectRenderer } from './renderers/index.js'
import { pandocRenderer, type PandocCompileContext } from './renderers/pandoc.js'
import { createUid } from './ids.js'

const port = Number.parseInt(process.env.PORT ?? '4000', 10)
const compileDir = process.env.COMPILE_DIR ?? '/var/composure/compiles'
const assetsDir = process.env.ASSETS_DIR ?? '/app/data/assets'
const tectonicCache = process.env.TECTONIC_CACHE ?? '/var/composure/caches/tectonic'
const typstCache = process.env.TYPST_CACHE ?? '/var/composure/caches/typst'
const defaultDocumentUpdateBase64 = process.env.DEFAULT_DOCUMENT_UPDATE_BASE64 ?? ''
const compileTimeoutMs = Number.parseInt(process.env.COMPILE_TIMEOUT_MS ?? '60000', 10)
const maxConcurrentProjects = Math.max(
  1,
  Number.parseInt(process.env.MAX_CONCURRENT_PROJECTS ?? String(Math.max(1, os.cpus().length)), 10),
)

// Shared secret the backend must present on every request. When set, all
// endpoints except /health require a matching X-Compiler-Secret header.
const sharedSecret = process.env.COMPILER_SHARED_SECRET ?? ''
// Default to loopback so an accidental deploy is never reachable off-host.
const bindHost = process.env.COMPILER_HOST ?? '127.0.0.1'

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

/** Constant-time string compare that also guards against length leaks. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Fail closed: reaching the compiler across a network without a shared secret
// means anything on that network can compile/export/preview in any workspace.
if (!isLoopbackHost(bindHost) && !sharedSecret) {
  console.error(
    `[compiler] refusing to start: COMPILER_HOST=${bindHost} is not loopback and COMPILER_SHARED_SECRET is unset. ` +
      'Set a shared secret (and configure the backend with the same value) or bind to 127.0.0.1.',
  )
  process.exit(1)
}

function sanitizeCompileLog(log: string | undefined, projectDir: string): string | undefined {
  return _sanitizeCompileLog(log, projectDir, compileDir, tectonicCache, typstCache)
}

interface CompileBody {
  projectId?: string
  rootFile?: string
  documentUpdateBase64?: string
  responseMode?: 'pdf' | 'metadata'
}

interface CompilePayload {
  projectId: string
  rootFile: string
  documentUpdateBase64?: string
  responseMode?: 'pdf' | 'metadata'
}

interface CompileResult {
  success: boolean
  pdf?: Buffer
  pdfName?: string
  compileId?: string
  error?: string
  log?: string
  statusCode?: number
}

interface PreviewState {
  projectId: string
  pdfName: string
  compileId: string
  updatedAt: number
}

interface Waiter {
  resolve: (result: CompileResult) => void
  reject: (reason: unknown) => void
}

interface PendingBatch {
  payload: CompilePayload
  waiters: Waiter[]
}

interface ProjectQueueState {
  running: boolean
  pending?: PendingBatch
}

const projectStates = new Map<string, ProjectQueueState>()

let activeProjects = 0
const globalProjectWaiters: Array<() => void> = []

function parseSnapshot(base64: string | undefined): Uint8Array | null | undefined {
  if (typeof base64 === 'string' && base64.length > 0) {
    try {
      return Uint8Array.from(Buffer.from(base64, 'base64'))
    } catch {
      return null
    }
  }

  if (defaultDocumentUpdateBase64.length > 0) {
    try {
      return Uint8Array.from(Buffer.from(defaultDocumentUpdateBase64, 'base64'))
    } catch {
      return null
    }
  }

  return undefined
}

interface FileMetadata {
  type: 'text' | 'asset' | 'folder'
  storageKey?: string
}

function parseFileMetadata(value: unknown): FileMetadata | null {
  if (typeof value === 'string') {
    // Legacy: plain string means text file (backward compat)
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        return parsed as FileMetadata
      }
    } catch {
      // Not JSON — treat as legacy text entry
    }
    return { type: 'text' }
  }
  return null
}

interface CollectedDoc {
  textFiles: Map<string, string>
  assetEntries: Array<{ displayPath: string; storageKey: string }>
}

const storageKeyPattern = /^[a-f0-9]{32,40}\.[a-zA-Z0-9]+$/

function collectDocFiles(snapshot: Uint8Array): CollectedDoc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, snapshot)

  const textFiles = new Map<string, string>()
  const assetEntries: Array<{ displayPath: string; storageKey: string }> = []
  const filesMap = doc.getMap('files')

  for (const [filePath, mapContent] of filesMap.entries()) {
    const normalized = normalizeRelativePath(filePath)
    if (!normalized) continue

    const meta = parseFileMetadata(mapContent)
    if (!meta) continue

    if (meta.type === 'text') {
      const textKey = `file:${normalized}`
      const hasText = doc.share.has(textKey)
      const content = hasText ? doc.getText(textKey).toString() : ''
      textFiles.set(normalized, content)
    } else if (meta.type === 'asset' && meta.storageKey && storageKeyPattern.test(meta.storageKey)) {
      assetEntries.push({ displayPath: normalized, storageKey: meta.storageKey })
    }
    // type === 'folder' → directories are created implicitly by mkdirSync in syncProjectSource
  }

  doc.destroy()
  return { textFiles, assetEntries }
}


function getProjectOutDir(projectId: string): string {
  return path.join(compileDir, projectId, 'out')
}

function getPreviewStatePath(projectId: string): string {
  return path.join(getProjectOutDir(projectId), 'preview.json')
}

function writePreviewState(state: PreviewState): void {
  const outDir = getProjectOutDir(state.projectId)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(getPreviewStatePath(state.projectId), JSON.stringify(state), 'utf8')
}

function readPreviewState(projectId: string): PreviewState | null {
  const statePath = getPreviewStatePath(projectId)
  if (!fs.existsSync(statePath)) {
    return null
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<PreviewState>
    if (
      parsed
      && parsed.projectId === projectId
      && typeof parsed.pdfName === 'string'
      && parsed.pdfName.length > 0
      && typeof parsed.compileId === 'string'
      && parsed.compileId.length > 0
      && typeof parsed.updatedAt === 'number'
      && Number.isFinite(parsed.updatedAt)
    ) {
      return {
        projectId,
        pdfName: parsed.pdfName,
        compileId: parsed.compileId,
        updatedAt: parsed.updatedAt,
      }
    }
  } catch {
    return null
  }

  return null
}

function clearPreviewOutput(projectId: string): void {
  const state = readPreviewState(projectId)
  const statePath = getPreviewStatePath(projectId)

  if (state) {
    const outDir = getProjectOutDir(projectId)
    const pdfPath = path.resolve(outDir, state.pdfName)
    if (!isPathWithin(outDir, pdfPath)) {
      throw new Error('Invalid preview path')
    }

    if (fs.existsSync(pdfPath)) {
      const stats = fs.statSync(pdfPath)
      if (!stats.isFile()) {
        throw new Error('Invalid preview file')
      }
      fs.rmSync(pdfPath, { force: true })
    }
  }

  if (fs.existsSync(statePath)) {
    const stats = fs.statSync(statePath)
    if (!stats.isFile()) {
      throw new Error('Invalid preview state')
    }
    fs.rmSync(statePath, { force: true })
  }
}

function parseByteRange(rangeHeader: string, totalSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null

  const startRaw = match[1]
  const endRaw = match[2]

  if (startRaw.length === 0 && endRaw.length === 0) {
    return null
  }

  if (startRaw.length === 0) {
    const suffixLength = Number.parseInt(endRaw, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    const clamped = Math.min(suffixLength, totalSize)
    return { start: totalSize - clamped, end: totalSize - 1 }
  }

  const start = Number.parseInt(startRaw, 10)
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) return null

  if (endRaw.length === 0) {
    return { start, end: totalSize - 1 }
  }

  const end = Number.parseInt(endRaw, 10)
  if (!Number.isFinite(end) || end < start) return null
  return { start, end: Math.min(end, totalSize - 1) }
}

async function acquireGlobalProjectSlot(): Promise<void> {
  if (activeProjects < maxConcurrentProjects) {
    activeProjects++
    return
  }

  await new Promise<void>((resolve) => {
    globalProjectWaiters.push(resolve)
  })
}

function releaseGlobalProjectSlot(): void {
  const next = globalProjectWaiters.shift()
  if (next) {
    next()
    return
  }

  activeProjects = Math.max(0, activeProjects - 1)
}

async function runWithGlobalProjectSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireGlobalProjectSlot()
  try {
    return await fn()
  } finally {
    releaseGlobalProjectSlot()
  }
}

async function executeCompile(payload: CompilePayload): Promise<CompileResult> {
  const projectDir = path.join(compileDir, payload.projectId)
  const srcDir = path.join(projectDir, 'src')
  const outDir = path.join(projectDir, 'out')
  const assetsProjectDir = path.join(assetsDir, payload.projectId)

  fs.rmSync(srcDir, { recursive: true, force: true })

  fs.mkdirSync(srcDir, { recursive: true })
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(tectonicCache, { recursive: true })
  fs.mkdirSync(typstCache, { recursive: true })

  const snapshot = parseSnapshot(payload.documentUpdateBase64)
  if (snapshot === null) {
    return {
      success: false,
      error: 'Invalid documentUpdateBase64 payload',
      statusCode: 422,
    }
  }

  if (!snapshot || snapshot.length === 0) {
    return {
      success: false,
      error: 'No document snapshot provided and no fallback snapshot configured',
      statusCode: 422,
    }
  }

  let collected: CollectedDoc
  try {
    collected = collectDocFiles(snapshot)
  } catch {
    return {
      success: false,
      error: 'Invalid Yjs snapshot',
      statusCode: 422,
    }
  }

  const sync = syncProjectSource(srcDir, collected.textFiles)

  // Copy assets from storage into srcDir at their display paths
  for (const { displayPath, storageKey } of collected.assetEntries) {
    const destPath = path.resolve(srcDir, displayPath)
    if (!isPathWithin(srcDir, destPath)) {
      console.warn(`[compile] skipping asset with invalid display path: ${displayPath}`)
      continue
    }
    const srcAssetPath = path.join(assetsProjectDir, storageKey)
    if (!fs.existsSync(srcAssetPath)) {
      console.warn(`[compile] asset file missing: ${storageKey} for ${displayPath}`)
      continue
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(srcAssetPath, destPath)
    // Verify no symlink was created (defense-in-depth)
    const stat = fs.lstatSync(destPath)
    if (!stat.isFile()) {
      fs.rmSync(destPath, { force: true })
      console.warn(`[compile] removed non-regular file after copy: ${displayPath}`)
    }
  }

  const rootPath = path.resolve(srcDir, payload.rootFile)
  if (!isPathWithin(srcDir, rootPath)) {
    return { success: false, error: 'Path traversal attempt blocked', statusCode: 400 }
  }
  if (!fs.existsSync(rootPath)) {
    return { success: false, error: `Root file not found: ${payload.rootFile}`, statusCode: 422 }
  }

  const renderer = selectRenderer(payload.rootFile)
  const output = await renderer.compile({
    rootFile: payload.rootFile,
    srcDir,
    outDir,
    timeoutMs: compileTimeoutMs,
  })

  const primaryOutput = output.success && output.outputs.length > 0 ? output.outputs[0] : undefined
  const result: CompileResult = primaryOutput
    ? { success: true, pdf: primaryOutput.data, pdfName: primaryOutput.filename, log: output.log }
    : { success: false, error: output.error, log: output.log, statusCode: 422 }
  const cleanedLog = sanitizeCompileLog(result.log, projectDir)

  const summary = `sync: written=${sync.written} unchanged=${sync.unchanged} removed=${sync.removed}`
  const combinedLog = cleanedLog ? `${summary}\n${cleanedLog}` : summary

  fs.writeFileSync(path.join(outDir, 'compile.log'), combinedLog, 'utf8')

  if (result.success && result.pdf && result.pdfName) {
    const compileId = createUid()
    writePreviewState({
      projectId: payload.projectId,
      pdfName: result.pdfName,
      compileId,
      updatedAt: Date.now(),
    })
    result.compileId = compileId
  }

  return {
    ...result,
    log: combinedLog,
    error: sanitizeCompileLog(result.error, projectDir),
  }
}

function queueCompile(payload: CompilePayload): Promise<CompileResult> {
  return new Promise<CompileResult>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject }

    let state = projectStates.get(payload.projectId)
    if (!state) {
      state = { running: false }
      projectStates.set(payload.projectId, state)
    }

    if (!state.running) {
      state.running = true
      // Intentionally fire-and-forget: waiters are resolved/rejected by the queue worker.
      void drainProjectQueue(payload.projectId, payload, [waiter])
      return
    }

    if (!state.pending) {
      state.pending = { payload, waiters: [waiter] }
      return
    }

    state.pending.payload = payload
    state.pending.waiters.push(waiter)
  })
}

async function drainProjectQueue(projectId: string, firstPayload: CompilePayload, firstWaiters: Waiter[]): Promise<void> {
  let currentPayload = firstPayload
  let currentWaiters = firstWaiters

  while (true) {
    let result: CompileResult
    try {
      result = await runWithGlobalProjectSlot(() => executeCompile(currentPayload))
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : 'Compilation failed',
        statusCode: 500,
      }
    }

    for (const waiter of currentWaiters) {
      waiter.resolve(result)
    }

    const state = projectStates.get(projectId)
    if (!state?.pending) {
      if (state) {
        state.running = false
        projectStates.delete(projectId)
      }
      return
    }

    currentPayload = state.pending.payload
    currentWaiters = state.pending.waiters
    state.pending = undefined
  }
}

const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 })

// Require the shared secret on every request except the health check.
app.addHook('onRequest', async (req, reply) => {
  if (!sharedSecret) return // loopback-only deployment; bind guard enforces this
  const requestPath = req.url.split('?', 1)[0]
  if (requestPath === '/health') return
  const provided = req.headers['x-compiler-secret']
  if (typeof provided !== 'string' || !secretMatches(provided, sharedSecret)) {
    reply.status(401).send({ error: 'unauthorized' })
  }
})

app.get('/health', async () => ({
  status: 'ok',
  uptime: process.uptime(),
  activeProjects,
  maxConcurrentProjects: maxConcurrentProjects,
}))

app.post('/compile', {
  schema: {
    body: {
      type: 'object',
      required: ['projectId', 'rootFile'],
      properties: {
        projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        rootFile: { type: 'string', minLength: 1, maxLength: 512 },
        documentUpdateBase64: { type: 'string' },
        responseMode: { type: 'string', enum: ['pdf', 'metadata'] },
      },
      additionalProperties: true,
    },
  },
}, async (req: FastifyRequest<{ Body: CompileBody }>, reply) => {
  const { projectId, rootFile, documentUpdateBase64, responseMode } = req.body ?? {}
  if (!projectId || !rootFile) {
    reply.status(400).send({ error: 'projectId and rootFile are required' })
    return
  }

  const safeRootFile = normalizeRelativePath(rootFile)
  if (!safeRootFile || hasLeadingDashSegment(safeRootFile)) {
    reply.status(400).send({ error: 'Invalid root file path' })
    return
  }

  const result = await queueCompile({
    projectId,
    rootFile: safeRootFile,
    documentUpdateBase64,
  })
  if (!result.success || !result.pdf) {
    reply.status(result.statusCode ?? 422).send({
      error: result.error ?? 'Compilation failed',
      log: result.log,
    })
    return
  }

  if (result.compileId) {
    reply.header('X-Compile-Id', result.compileId)
  }

  if (responseMode === 'metadata') {
    reply.send({
      ok: true,
      compileId: result.compileId,
      bytes: result.pdf.length,
    })
    return
  }

  reply.header('Content-Type', 'application/pdf')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.send(result.pdf)
})

app.post('/export', {
  schema: {
    body: {
      type: 'object',
      required: ['projectId', 'rootFile', 'outputFormat'],
      properties: {
        projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        rootFile: { type: 'string', minLength: 1, maxLength: 512 },
        documentUpdateBase64: { type: 'string' },
        outputFormat: { type: 'string', enum: ['pdf', 'docx', 'html', 'latex', 'typst'] },
      },
      additionalProperties: true,
    },
  },
}, async (req: FastifyRequest<{ Body: CompileBody & { outputFormat?: string } }>, reply) => {
  const { projectId, rootFile, documentUpdateBase64, outputFormat } = req.body ?? {}
  if (!projectId || !rootFile || !outputFormat) {
    reply.status(400).send({ error: 'projectId, rootFile, and outputFormat are required' })
    return
  }

  const safeRootFile = normalizeRelativePath(rootFile)
  if (!safeRootFile || hasLeadingDashSegment(safeRootFile)) {
    reply.status(400).send({ error: 'Invalid root file path' })
    return
  }

  // Reuse executeCompile infrastructure for file extraction, then run pandoc
  const projectDir = path.join(compileDir, projectId)
  const srcDir = path.join(projectDir, 'src')
  const outDir = path.join(projectDir, 'out')
  const assetsProjectDir = path.join(assetsDir, projectId)

  fs.rmSync(srcDir, { recursive: true, force: true })
  fs.mkdirSync(srcDir, { recursive: true })
  fs.mkdirSync(outDir, { recursive: true })

  const snapshot = parseSnapshot(documentUpdateBase64)
  if (snapshot === null) {
    reply.status(422).send({ error: 'Invalid documentUpdateBase64 payload' })
    return
  }
  if (!snapshot || snapshot.length === 0) {
    reply.status(422).send({ error: 'No document snapshot provided' })
    return
  }

  let collected: CollectedDoc
  try {
    collected = collectDocFiles(snapshot)
  } catch {
    reply.status(422).send({ error: 'Invalid Yjs snapshot' })
    return
  }

  syncProjectSource(srcDir, collected.textFiles)

  // Copy assets from storage into srcDir at their display paths
  for (const { displayPath, storageKey } of collected.assetEntries) {
    const destPath = path.resolve(srcDir, displayPath)
    if (!isPathWithin(srcDir, destPath)) continue
    const srcAssetPath = path.join(assetsProjectDir, storageKey)
    if (!fs.existsSync(srcAssetPath)) continue
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(srcAssetPath, destPath)
    const stat = fs.lstatSync(destPath)
    if (!stat.isFile()) {
      fs.rmSync(destPath, { force: true })
    }
  }

  const rootPath = path.resolve(srcDir, safeRootFile)
  if (!isPathWithin(srcDir, rootPath)) {
    reply.status(400).send({ error: 'Path traversal attempt blocked' })
    return
  }
  if (!fs.existsSync(rootPath)) {
    reply.status(422).send({ error: `Root file not found: ${safeRootFile}` })
    return
  }

  const ctx: PandocCompileContext = {
    rootFile: safeRootFile,
    srcDir,
    outDir,
    timeoutMs: compileTimeoutMs,
    outputFormat,
  }

  const result = await pandocRenderer.compile(ctx)

  if (!result.success || result.outputs.length === 0) {
    reply.status(422).send({
      error: result.error ?? 'Export failed',
      log: result.log,
    })
    return
  }

  const output = result.outputs[0]
  reply.header('Content-Type', output.mimeType)
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Content-Disposition', `attachment; filename="${output.filename}"`)
  reply.send(output.data)
})

app.get('/projects/:projectId/preview.pdf', {
  schema: {
    params: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
      },
    },
    querystring: {
      type: 'object',
      properties: {
        v: { type: 'string', minLength: 1, maxLength: 128 },
      },
      additionalProperties: true,
    },
  },
}, async (req: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
  const { projectId } = req.params
  const state = readPreviewState(projectId)
  if (!state) {
    reply.status(404).send({ error: 'Preview not found' })
    return
  }

  const outDir = getProjectOutDir(projectId)
  const pdfPath = path.resolve(outDir, state.pdfName)
  if (!isPathWithin(outDir, pdfPath)) {
    reply.status(400).send({ error: 'Invalid preview path' })
    return
  }
  if (!fs.existsSync(pdfPath) || !fs.statSync(pdfPath).isFile()) {
    reply.status(404).send({ error: 'Preview not found' })
    return
  }

  const etag = `"${state.compileId}"`
  const ifNoneMatch = req.headers['if-none-match']
  if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) {
    reply.status(304)
    reply.header('ETag', etag)
    reply.header('Cache-Control', 'private, max-age=31536000, immutable')
    reply.header('Vary', 'Cookie, X-Share-Token')
    reply.send()
    return
  }

  const stats = fs.statSync(pdfPath)
  const totalSize = stats.size
  const rangeHeader = req.headers.range

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': new Date(state.updatedAt).toUTCString(),
    'Cache-Control': 'private, max-age=31536000, immutable',
    Vary: 'Cookie, X-Share-Token',
    'X-Content-Type-Options': 'nosniff',
  }

  const streamPdf = async (start?: number, end?: number): Promise<void> => {
    reply.hijack()
    for (const [key, value] of Object.entries(baseHeaders)) {
      reply.raw.setHeader(key, value)
    }

    if (typeof start === 'number' && typeof end === 'number') {
      reply.raw.statusCode = 206
      reply.raw.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`)
      reply.raw.setHeader('Content-Length', String(end - start + 1))
    } else {
      reply.raw.statusCode = 200
      reply.raw.setHeader('Content-Length', String(totalSize))
    }

    try {
      await pipeline(fs.createReadStream(pdfPath, start !== undefined && end !== undefined ? { start, end } : undefined), reply.raw)
    } catch (err) {
      console.error(
        `[compiler] preview-stream-failed projectId=${projectId} path=${pdfPath} error=${err instanceof Error ? err.message : String(err)}`,
      )
      if (!reply.raw.destroyed) {
        reply.raw.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  if (typeof rangeHeader === 'string' && rangeHeader.length > 0) {
    const parsedRange = parseByteRange(rangeHeader, totalSize)
    if (!parsedRange) {
      reply.status(416)
      reply.header('Content-Range', `bytes */${totalSize}`)
      reply.send({ error: 'Invalid range' })
      return
    }

    await streamPdf(parsedRange.start, parsedRange.end)
    return
  }

  await streamPdf()
})

app.delete('/projects/:projectId/preview.pdf', {
  schema: {
    params: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
      },
    },
  },
}, async (req: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
  const { projectId } = req.params

  try {
    clearPreviewOutput(projectId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to clear preview'
    if (message.startsWith('Invalid preview')) {
      reply.status(400).send({ error: message })
      return
    }
    reply.status(500).send({ error: 'Failed to clear preview' })
    return
  }

  reply.status(204).send()
})

await app.listen({ host: bindHost, port: port })
console.info(
  `[compiler] listening port=${port} compileDir=${compileDir} tectonicCache=${tectonicCache} typstCache=${typstCache} maxConcurrentProjects=${maxConcurrentProjects}`,
)
