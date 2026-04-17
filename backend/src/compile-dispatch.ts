import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'

interface CompileDispatchPayload {
  projectId: string
  rootFile: string
  documentUpdateBase64?: string
  responseMode?: 'pdf' | 'metadata'
}

interface DispatchInput {
  projectId: string
  payload: CompileDispatchPayload
  reply: FastifyReply
  onSlotAcquired?: () => void | Promise<void>
}

interface CompilerErrorBody {
  error?: string
  log?: string
}

interface PreviewDispatchInput {
  projectId: string
  reply: FastifyReply
  rangeHeader?: string
  ifNoneMatchHeader?: string
  ifModifiedSinceHeader?: string
  cacheVersion?: string
}

interface ClearPreviewDispatchInput {
  projectId: string
  reply: FastifyReply
}

const compilerTimeoutMs = Number.parseInt(process.env.COMPILER_TIMEOUT_MS ?? '45000', 10)

// ---------------------------------------------------------------------------
// Per-compiler semaphore for concurrency limiting
// ---------------------------------------------------------------------------

interface SemaphoreWaiter {
  resolve: () => void
}

interface CompilerSemaphore {
  active: number
  queue: SemaphoreWaiter[]
}

const compilerSemaphores = new Map<string, CompilerSemaphore>()
let maxConcurrentPerCompiler = 3

export function setMaxConcurrentPerCompiler(limit: number): void {
  maxConcurrentPerCompiler = Math.max(1, limit)

  // Drain queued waiters that can now run under the new (higher) limit
  for (const sem of compilerSemaphores.values()) {
    while (sem.active < maxConcurrentPerCompiler && sem.queue.length > 0) {
      const waiter = sem.queue.shift()!
      sem.active++
      waiter.resolve()
    }
  }
}

function acquireCompilerSlot(compiler: string): Promise<void> {
  let sem = compilerSemaphores.get(compiler)
  if (!sem) {
    sem = { active: 0, queue: [] }
    compilerSemaphores.set(compiler, sem)
  }

  if (sem.active < maxConcurrentPerCompiler) {
    sem.active++
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    sem!.queue.push({ resolve })
  })
}

function releaseCompilerSlot(compiler: string): void {
  const sem = compilerSemaphores.get(compiler)
  if (!sem) return

  const next = sem.queue.shift()
  if (next) {
    next.resolve()
    return
  }

  sem.active = Math.max(0, sem.active - 1)
  if (sem.active === 0 && sem.queue.length === 0) {
    compilerSemaphores.delete(compiler)
  }
}

export function getCompilerQueueLength(compiler: string): number {
  return compilerSemaphores.get(compiler)?.queue.length ?? 0
}

function parseCompilerList(raw: string | undefined): string[] {
  const configured = String(raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (configured.length > 0) {
    return configured
  }

  return ['http://127.0.0.1:4000']
}

function projectCompilerIndex(projectId: string, compilerCount: number): number {
  let sum = 0
  for (const ch of projectId) {
    sum += ch.charCodeAt(0)
  }
  return sum % compilerCount
}

function selectedCompiler(projectId: string): string {
  const compilers = parseCompilerList(process.env.COMPILERS)
  return compilers[projectCompilerIndex(projectId, compilers.length)]
}

function withOptionalQuery(url: string, entries: Array<[string, string | undefined]>): string {
  const parsed = new URL(url)
  for (const [key, value] of entries) {
    if (typeof value === 'string' && value.length > 0) {
      parsed.searchParams.set(key, value)
    }
  }
  return parsed.toString()
}

function preserveQueuedReplyHeaders(reply: FastifyReply): void {
  const queuedHeaders = reply.getHeaders()
  for (const [name, value] of Object.entries(queuedHeaders)) {
    if (value == null) {
      continue
    }
    if (reply.raw.hasHeader(name)) {
      continue
    }
    reply.raw.setHeader(name, value as number | string | readonly string[])
  }
}

async function readCompilerErrorBody(response: Response): Promise<CompilerErrorBody | null> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    try {
      const parsed = (await response.json()) as CompilerErrorBody
      return parsed
    } catch {
      return null
    }
  }

  try {
    const text = await response.text()
    return { error: text }
  } catch {
    return null
  }
}

export async function dispatchCompile(input: DispatchInput): Promise<void> {
  const compiler = selectedCompiler(input.projectId)
  const target = `${compiler.replace(/\/$/, '')}/compile`

  await acquireCompilerSlot(compiler)
  try {
    try {
      await input.onSlotAcquired?.()
    } catch (error) {
      console.warn(`[compile-dispatch] on-slot-acquired hook failed projectId=${input.projectId} error=${String(error)}`)
    }

    let response: Response
    try {
      response = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.payload),
        signal: AbortSignal.timeout(compilerTimeoutMs),
      })
    } catch (err) {
      console.error(
        `[compile-dispatch] unreachable compiler=${compiler} projectId=${input.projectId} error=${err instanceof Error ? err.message : String(err)}`,
      )
      input.reply.status(503).send({ error: 'Compiler unavailable' })
      return
    }

    if (!response.ok) {
      const errBody = await readCompilerErrorBody(response)
      input.reply.status(response.status).send({
        error: errBody?.error ?? `Compile failed on compiler (${response.status})`,
        log: errBody?.log,
      })
      return
    }

    if (!response.body) {
      input.reply.status(502).send({ error: 'Compiler returned an empty response body' })
      return
    }

    const contentType = response.headers.get('content-type') ?? 'application/pdf'
    const compileId = response.headers.get('x-compile-id')

    input.reply.hijack()
    input.reply.raw.statusCode = response.status
    preserveQueuedReplyHeaders(input.reply)
    input.reply.raw.setHeader('Content-Type', contentType)
    input.reply.raw.setHeader('X-Content-Type-Options', 'nosniff')
    if (compileId) {
      input.reply.raw.setHeader('X-Compile-Id', compileId)
    }

    const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    try {
      await pipeline(nodeStream, input.reply.raw)
    } catch (err) {
      console.error(
        `[compile-dispatch] stream-failed compiler=${compiler} projectId=${input.projectId} error=${err instanceof Error ? err.message : String(err)}`,
      )
      if (!input.reply.raw.destroyed) {
        input.reply.raw.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    }
  } finally {
    releaseCompilerSlot(compiler)
  }
}

export async function dispatchPreview(input: PreviewDispatchInput): Promise<void> {
  const compiler = selectedCompiler(input.projectId)
  const base = `${compiler.replace(/\/$/, '')}/projects/${encodeURIComponent(input.projectId)}/preview.pdf`
  const target = withOptionalQuery(base, [['v', input.cacheVersion]])

  let response: Response
  try {
    response = await fetch(target, {
      method: 'GET',
      headers: {
        ...(input.rangeHeader ? { Range: input.rangeHeader } : {}),
        ...(input.ifNoneMatchHeader ? { 'If-None-Match': input.ifNoneMatchHeader } : {}),
        ...(input.ifModifiedSinceHeader ? { 'If-Modified-Since': input.ifModifiedSinceHeader } : {}),
      },
      signal: AbortSignal.timeout(compilerTimeoutMs),
    })
  } catch (err) {
    console.error(
      `[preview-dispatch] unreachable compiler=${compiler} projectId=${input.projectId} error=${err instanceof Error ? err.message : String(err)}`,
    )
    input.reply.status(503).send({ error: 'Compiler unavailable' })
    return
  }

  if (response.status === 304) {
    input.reply.status(304)
    const etag = response.headers.get('etag')
    const lastModified = response.headers.get('last-modified')
    const cacheControl = response.headers.get('cache-control')
    const vary = response.headers.get('vary')
    if (etag) input.reply.header('ETag', etag)
    if (lastModified) input.reply.header('Last-Modified', lastModified)
    if (cacheControl) input.reply.header('Cache-Control', cacheControl)
    if (vary) input.reply.header('Vary', vary)
    input.reply.send()
    return
  }

  if (!response.ok) {
    const errBody = await readCompilerErrorBody(response)
    input.reply.status(response.status).send({
      error: errBody?.error ?? `Preview unavailable on compiler (${response.status})`,
    })
    return
  }

  if (!response.body) {
    input.reply.status(502).send({ error: 'Compiler returned an empty preview body' })
    return
  }

  input.reply.hijack()
  input.reply.raw.statusCode = response.status
  preserveQueuedReplyHeaders(input.reply)

  const passthroughHeaders = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
    'cache-control',
    'vary',
  ]
  for (const header of passthroughHeaders) {
    const value = response.headers.get(header)
    if (!value) continue
    input.reply.raw.setHeader(header, value)
  }
  input.reply.raw.setHeader('X-Content-Type-Options', 'nosniff')

  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  try {
    await pipeline(nodeStream, input.reply.raw)
  } catch (err) {
    console.error(
      `[preview-dispatch] stream-failed compiler=${compiler} projectId=${input.projectId} error=${err instanceof Error ? err.message : String(err)}`,
    )
    if (!input.reply.raw.destroyed) {
      input.reply.raw.destroy(err instanceof Error ? err : new Error(String(err)))
    }
  }
}

export async function dispatchClearPreview(input: ClearPreviewDispatchInput): Promise<void> {
  const compiler = selectedCompiler(input.projectId)
  const target = `${compiler.replace(/\/$/, '')}/projects/${encodeURIComponent(input.projectId)}/preview.pdf`

  let response: Response
  try {
    response = await fetch(target, {
      method: 'DELETE',
      signal: AbortSignal.timeout(compilerTimeoutMs),
    })
  } catch (err) {
    console.error(
      `[preview-clear-dispatch] unreachable compiler=${compiler} projectId=${input.projectId} error=${err instanceof Error ? err.message : String(err)}`,
    )
    input.reply.status(503).send({ error: 'Compiler unavailable' })
    return
  }

  if (!response.ok) {
    const errBody = await readCompilerErrorBody(response)
    input.reply.status(response.status).send({
      error: errBody?.error ?? `Failed to clear preview on compiler (${response.status})`,
    })
    return
  }

  input.reply.status(204).send()
}

interface ExportDispatchInput {
  projectId: string
  rootFile: string
  outputFormat: string
  reply: FastifyReply
  req: FastifyRequest
  documentUpdateBase64?: string
}

export async function dispatchExport(input: ExportDispatchInput): Promise<void> {
  const compiler = selectedCompiler(input.projectId)
  const target = `${compiler.replace(/\/$/, '')}/export`

  let documentUpdateBase64 = input.documentUpdateBase64
  if (!documentUpdateBase64) {
    // Build Yjs snapshot from stored doc
    const { loadDocument } = await import('./db/index.js')
    const stored = await loadDocument(input.projectId)
    documentUpdateBase64 = stored ? Buffer.from(stored).toString('base64') : undefined
  }

  await acquireCompilerSlot(compiler)
  try {
    let response: Response
    try {
      response = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: input.projectId,
          rootFile: input.rootFile,
          documentUpdateBase64,
          outputFormat: input.outputFormat,
        }),
        signal: AbortSignal.timeout(compilerTimeoutMs),
      })
    } catch (err) {
      console.error(
        `[export-dispatch] unreachable compiler=${compiler} projectId=${input.projectId} error=${err instanceof Error ? err.message : String(err)}`,
      )
      input.reply.status(503).send({ error: 'Compiler unavailable' })
      return
    }

    if (!response.ok) {
      const errBody = await readCompilerErrorBody(response)
      input.reply.status(response.status).send({
        error: errBody?.error ?? `Export failed on compiler (${response.status})`,
        log: errBody?.log,
      })
      return
    }

    if (!response.body) {
      input.reply.status(502).send({ error: 'Compiler returned an empty response body' })
      return
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition')

    input.reply.hijack()
    input.reply.raw.statusCode = response.status
    preserveQueuedReplyHeaders(input.reply)
    input.reply.raw.setHeader('Content-Type', contentType)
    input.reply.raw.setHeader('X-Content-Type-Options', 'nosniff')
    if (contentDisposition) {
      input.reply.raw.setHeader('Content-Disposition', contentDisposition)
    }

    const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    try {
      await pipeline(nodeStream, input.reply.raw)
    } catch (err) {
      console.error(
        `[export-dispatch] stream-failed compiler=${compiler} projectId=${input.projectId} error=${err instanceof Error ? err.message : String(err)}`,
      )
      if (!input.reply.raw.destroyed) {
        input.reply.raw.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    }
  } finally {
    releaseCompilerSlot(compiler)
  }
}
