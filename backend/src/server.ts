import { WebSocketServer } from 'ws'
import { Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import {
  initDatabase,
  loadDocument,
  storeDocument,
  touchProjectActivity,
  canAccessProjectWithRole,
  getMaxConcurrentJobs,
  getMaxTextFileSize,
  type Principal,
} from './db/index.js'
import { getUserPreferences } from './db/preferences.js'
import { resolvePrincipalFromCookieHeader } from './auth.js'
import { setMaxConcurrentPerCompiler } from './compile-dispatch.js'
import {
  isProductionEnv,
  isTrustedRequestOrigin,
  normalizeOriginHeader,
  parseNodeEnv,
  parseTrustedOrigins,
} from './env.js'
import { isValidProjectId } from './security.js'
import { buildApp } from './app.js'
import { commitSnapshot } from './history.js'
import { findTextSizeViolation, textSizeViolationMessage } from './text-size-limit.js'
import { pathnameFromRawUrl, resolveApiRouting } from './routing.js'

const port = Number.parseInt(process.env.PORT ?? '8080', 10)
const nodeEnv = parseNodeEnv(process.env.NODE_ENV)
const isProd = isProductionEnv(process.env.NODE_ENV)
const defaultWsMaxPayloadBytes = 100 * 1024 * 1024
const apiRouting = resolveApiRouting(process.env)

async function resolveWsMaxPayloadBytes(): Promise<number> {
  const maxTextSize = await getMaxTextFileSize()
  if (maxTextSize === 'unlimited') {
    return defaultWsMaxPayloadBytes
  }

  // Keep headroom for CRDT framing overhead while still rejecting obviously
  // pathological messages far above editable text limits.
  return Math.min(
    defaultWsMaxPayloadBytes,
    Math.max(8 * 1024 * 1024, maxTextSize + 4 * 1024 * 1024),
  )
}

function summarizeDocState(doc: Y.Doc): { filesMapCount: number; fileTextCount: number } {
  const filesMap = doc.getMap<string>('files')
  let fileTextCount = 0
  for (const key of doc.share.keys()) {
    if (key.startsWith('file:')) {
      fileTextCount++
    }
  }
  return { filesMapCount: filesMap.size, fileTextCount }
}

function getShareTokenFromUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined
  try {
    const parsed = new URL(rawUrl, 'http://localhost')
    return parsed.searchParams.get('share') ?? undefined
  } catch {
    return undefined
  }
}

async function resolveHocuspocusPrincipal(data: {
  request: { headers: { cookie?: string | string[] | undefined } }
  connection?: { request?: { headers?: { cookie?: string | string[] | undefined } } }
}): Promise<Principal> {
  const requestCookie = data.request.headers.cookie
  const connectionCookie = data.connection?.request?.headers?.cookie

  const rawCookie = Array.isArray(requestCookie)
    ? requestCookie.join(';')
    : Array.isArray(connectionCookie)
      ? connectionCookie.join(';')
      : (requestCookie ?? connectionCookie)

  return await resolvePrincipalFromCookieHeader(rawCookie)
}

interface HocuspocusAuthContext {
  principal: Principal
  documentName: string
  shareToken?: string
}

function readVarUint(buffer: Uint8Array, startOffset = 0): { value: number; nextOffset: number } | null {
  let value = 0
  let shift = 0
  let offset = startOffset

  while (offset < buffer.length) {
    const byte = buffer[offset]
    value |= (byte & 0x7f) << shift
    offset += 1
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: offset }
    }
    shift += 7
    if (shift > 35) {
      return null
    }
  }

  return null
}

function isIncomingYjsWriteSyncMessage(payload: Uint8Array): boolean {
  const messageType = readVarUint(payload, 0)
  if (!messageType || messageType.value !== 0) {
    return false
  }

  const syncType = readVarUint(payload, messageType.nextOffset)
  if (!syncType) {
    return false
  }

  return syncType.value === 1 || syncType.value === 2
}

async function assertHocuspocusContextAccess(documentName: string, context: unknown): Promise<Principal> {
  if (!isValidProjectId(documentName)) {
    throw new Error('Invalid project ID')
  }

  const authContext = context as HocuspocusAuthContext | undefined
  const principal = authContext?.principal
  if (!principal) {
    throw new Error('Unauthenticated')
  }

  const shareToken = authContext?.shareToken
  const access = await canAccessProjectWithRole(documentName, principal, 'view', shareToken)
  if (!access.ok) {
    console.warn(
      `[hocuspocus] denied document=${documentName} userId=${principal.userId ?? 'none'} guestId=${principal.guestId ?? 'none'}`,
    )
    throw new Error('Forbidden')
  }

  await touchProjectActivity(documentName)
  return principal
}

// Hocuspocus (Yjs WebSocket server)
const lastAutoCommitTimestamp = new Map<string, number>()

const hocuspocus = new Hocuspocus({
  debounce: 400,
  maxDebounce: 1500,
  async onAuthenticate(data) {
    if (!isValidProjectId(data.documentName)) {
      console.warn(`[hocuspocus] auth-rejected document=${data.documentName} reason=invalid-project-id`)
      throw new Error('Invalid project ID')
    }

    const principal = await resolveHocuspocusPrincipal(data)
    const shareToken = getShareTokenFromUrl(data.request.url)
    console.info(
      `[hocuspocus] authenticate document=${data.documentName} socket=${data.socketId} userId=${principal.userId ?? 'none'} guestId=${principal.guestId ?? 'none'} shareToken=${shareToken ? 'present' : 'none'} cookieLen=${String(data.request.headers.cookie ?? '').length}`,
    )

    const access = await canAccessProjectWithRole(data.documentName, principal, 'view', shareToken)
    if (!access.ok) {
      console.warn(
        `[hocuspocus] auth-denied document=${data.documentName} userId=${principal.userId ?? 'none'} guestId=${principal.guestId ?? 'none'} shareToken=${shareToken ? 'present' : 'none'}`,
      )
      throw new Error('Forbidden')
    }

    await touchProjectActivity(data.documentName)
    console.info(`[hocuspocus] auth-ok document=${data.documentName} role=${access.role ?? 'none'}`)
    return { principal, documentName: data.documentName, shareToken }
  },
  async onConnect(data) {
    console.info(
      `[hocuspocus] connect document=${data.documentName} socket=${data.socketId} url=${data.request.url ?? 'n/a'}`,
    )
  },
  async connected(data) {
    console.info(
      `[hocuspocus] connected document=${data.documentName} socket=${data.socketId} totalConnections=${data.connection.document.getConnectionsCount()}`,
    )
  },
  async onDisconnect(data) {
    console.info(
      `[hocuspocus] disconnect document=${data.documentName} socket=${data.socketId} remainingConnections=${data.clientsCount}`,
    )
  },
  async beforeHandleMessage(data) {
    const authContext = data.context as HocuspocusAuthContext | undefined
    try {
      await assertHocuspocusContextAccess(data.documentName, data.context)
    } catch (err) {
      console.error(
        `[hocuspocus] before-handle-DENIED document=${data.documentName} socket=${data.socketId} error=${String(err)} context=${JSON.stringify(data.context)}`,
      )
      throw err
    }

    const principal = authContext?.principal
    const shareToken = authContext?.shareToken
    const canEdit = principal
      ? (await canAccessProjectWithRole(data.documentName, principal, 'edit', shareToken)).ok
      : false

    if (!canEdit && isIncomingYjsWriteSyncMessage(data.update)) {
      console.warn(
        `[hocuspocus] write-denied document=${data.documentName} socket=${data.socketId} reason=insufficient-role`,
      )
      throw new Error('Forbidden')
    }

    // Enforce text file size limit on incoming write messages
    if (canEdit && isIncomingYjsWriteSyncMessage(data.update)) {
      const maxTextSize = await getMaxTextFileSize()
      if (maxTextSize !== 'unlimited') {
        const cloneDoc = new Y.Doc()
        try {
          Y.applyUpdate(cloneDoc, Y.encodeStateAsUpdate(data.document))
          Y.applyUpdate(cloneDoc, data.update)
          const violation = findTextSizeViolation(cloneDoc, maxTextSize)
          if (violation) {
            console.warn(
              `[hocuspocus] text-size-denied document=${data.documentName} file=${violation.filePath} size=${violation.sizeBytes} limit=${maxTextSize}`,
            )
            throw new Error(textSizeViolationMessage(violation))
          }
        } finally {
          cloneDoc.destroy()
        }
      }
    }

    console.info(
      `[hocuspocus] before-handle document=${data.documentName} socket=${data.socketId} updateBytes=${data.update.length}`,
    )
  },
  async beforeSync(data) {
    const ctx = data.context as HocuspocusAuthContext | undefined
    console.info(
      `[hocuspocus] before-sync document=${data.documentName} type=${data.type} payloadBytes=${data.payload.length} hasContext=${Boolean(ctx?.principal)}`,
    )
  },
  async onAwarenessUpdate(data) {
    console.info(
      `[hocuspocus] awareness-update document=${data.documentName} added=${data.added.length} updated=${data.updated.length} removed=${data.removed.length} states=${data.states.length}`,
    )
  },
  async onLoadDocument(data) {
    console.info(`[hocuspocus] load document=${data.documentName}`)
    const stored = await loadDocument(data.documentName)
    if (stored) {
      Y.applyUpdate(data.document, new Uint8Array(stored))
      const summary = summarizeDocState(data.document)
      console.info(
        `[hocuspocus] load-hit document=${data.documentName} bytes=${stored.length} sharedTypes=${data.document.share.size} filesMap=${summary.filesMapCount} fileTexts=${summary.fileTextCount}`,
      )
    } else {
      console.warn(`[hocuspocus] load-miss document=${data.documentName}`)
    }
    return data.document
  },
  async onChange(data) {
    await touchProjectActivity(data.documentName)
    console.info(
      `[hocuspocus] change document=${data.documentName} updateBytes=${data.update.length} sharedTypes=${data.document.share.size} connections=${data.document.getConnectionsCount()}`,
    )
  },
  async onStoreDocument(data) {
    const update = Y.encodeStateAsUpdate(data.document)
    await storeDocument(data.documentName, Buffer.from(update))
    await touchProjectActivity(data.documentName)
    console.info(
      `[hocuspocus] store document=${data.documentName} bytes=${update.length} sharedTypes=${data.document.share.size}`,
    )

    // Auto-commit to git history based on the project owner's interval setting
    const projectId = data.documentName
    const now = Date.now()
    const lastCommit = lastAutoCommitTimestamp.get(projectId) ?? 0

    // Look up the owner's auto-version interval. We use a default of 5 min.
    let intervalMinutes = 5
    try {
      // Resolve the owner from the first connected client's context
      const authContext = data.context as { principal?: Principal } | undefined
      const userId = authContext?.principal?.userId
      if (userId) {
        const prefs = await getUserPreferences(userId)
        intervalMinutes = prefs.autoVersionIntervalMinutes
      }
    } catch {
      // Fall back to default
    }

    if (intervalMinutes > 0 && now - lastCommit >= intervalMinutes * 60 * 1000) {
      lastAutoCommitTimestamp.set(projectId, now)
      // Fire async, don't block Hocuspocus
      void commitSnapshot(projectId, update, { skipEmpty: true }).then(() => {
        // Notify connected clients so the history panel can refresh
        const doc = hocuspocus.documents.get(projectId)
        if (doc) {
          doc.broadcastStateless(JSON.stringify({ type: 'history-updated' }))
        }
      }).catch((err) => {
        console.warn(`[history] auto-commit-failed projectId=${projectId} error=${String(err)}`)
      })
    }
  },
})

await initDatabase()

const app = await buildApp({ hocuspocus, isProduction: isProd, resetAutoCommitTimer: (projectId) => { lastAutoCommitTimestamp.set(projectId, Date.now()) } })
const trustedOrigins = new Set(parseTrustedOrigins(process.env.CORS_ORIGIN, process.env.NODE_ENV))

console.info(`[server] api-root=${apiRouting.apiRootPath} ws-collaboration=${apiRouting.wsCollaborationPath}`)

if (trustedOrigins.size > 0) {
  console.info(`[server] trusted-origins=${[...trustedOrigins].join(',')}`)
} else {
  console.info('[server] trusted-origins=none (cross-origin browser requests are blocked)')
}

const wsMaxPayloadBytes = await resolveWsMaxPayloadBytes()
console.info(`[ws] max-payload-bytes=${wsMaxPayloadBytes}`)
const collaborationWsPath = apiRouting.wsPath('collaborate')

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: wsMaxPayloadBytes,
})
app.server.on('upgrade', (request, socket, head) => {
  const requestPathname = pathnameFromRawUrl(request.url)
  if (requestPathname !== collaborationWsPath) {
    console.warn(`[ws] upgrade-rejected-path path=${requestPathname} expected=${collaborationWsPath}`)
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }

  const allowed = isTrustedRequestOrigin({
    originHeader: request.headers.origin,
    hostHeader: request.headers.host,
    forwardedProtoHeader: request.headers['x-forwarded-proto'],
    trustedOrigins,
  })

  if (!allowed) {
    const origin = normalizeOriginHeader(request.headers.origin) ?? String(request.headers.origin ?? 'missing')
    console.warn(`[ws] upgrade-denied origin=${origin} host=${request.headers.host ?? 'none'} url=${request.url ?? 'n/a'}`)
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }

  console.info(`[ws] upgrade url=${request.url ?? 'n/a'}`)
  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.on('error', (error) => {
      console.warn(`[ws] socket-error url=${request.url ?? 'n/a'} error=${String(error)}`)
    })
    hocuspocus.handleConnection(ws, request)
  })
})

// Configure per-compiler concurrency limit from server settings
setMaxConcurrentPerCompiler(await getMaxConcurrentJobs())

console.info(`[server] starting port=${port} env=${nodeEnv} dataDir=${process.env.DATA_DIR ?? 'data'}`)

await app.listen({ port: port, host: '0.0.0.0' })
console.log(`
  ╔══════════════════════════════════════╗
  ║   Composure server running           ║
  ║   http://localhost:${String(port).padEnd(6)}            ║
  ╚══════════════════════════════════════╝
  `)
