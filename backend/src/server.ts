import { WebSocketServer } from 'ws'
import { Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import {
  initDatabase,
  loadDocument,
  storeDocument,
  touchProjectActivity,
  canAccessProjectWithRole,
  findProjectById,
  findUserById,
  getChatHistoryRetentionDays,
  getMaxConcurrentJobs,
  getMaxTextFileSize,
  redeemShareTokenForUser,
  runWithIdentityContext,
  type Principal,
  type RequestUserRole,
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

const chatDocumentSuffix = ':chat'

type CollaborationDocumentKind = 'project' | 'chat'

interface CollaborationDocumentRef {
  documentName: string
  projectId: string
  kind: CollaborationDocumentKind
}

function parseCollaborationDocumentName(documentName: string): CollaborationDocumentRef | null {
  if (isValidProjectId(documentName)) {
    return {
      documentName,
      projectId: documentName,
      kind: 'project',
    }
  }

  if (!documentName.endsWith(chatDocumentSuffix)) {
    return null
  }

  const projectId = documentName.slice(0, -chatDocumentSuffix.length)
  if (!isValidProjectId(projectId)) {
    return null
  }

  return {
    documentName,
    projectId,
    kind: 'chat',
  }
}

function readChatMessageCreatedAt(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const fromRecord = (raw as Record<string, unknown>).createdAt
  if (typeof fromRecord === 'number' && Number.isFinite(fromRecord)) {
    return fromRecord > 9_999_999_999 ? Math.floor(fromRecord / 1000) : Math.floor(fromRecord)
  }

  if (typeof fromRecord === 'string') {
    const parsed = Number.parseInt(fromRecord, 10)
    return Number.isFinite(parsed)
      ? (parsed > 9_999_999_999 ? Math.floor(parsed / 1000) : parsed)
      : null
  }

  if (raw instanceof Y.Map) {
    const value = raw.get('createdAt')
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 9_999_999_999 ? Math.floor(value / 1000) : Math.floor(value)
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10)
      return Number.isFinite(parsed)
        ? (parsed > 9_999_999_999 ? Math.floor(parsed / 1000) : parsed)
        : null
    }
  }

  return null
}

function pruneExpiredChatMessages(doc: Y.Doc, retentionDays: number | 'unlimited' | 'off'): number {
  if (retentionDays === 'unlimited' || retentionDays === 'off') {
    return 0
  }

  const cutoffEpochSeconds = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60)
  const messages = doc.getArray<unknown>('messages')
  const values = messages.toArray()
  const indicesToDelete: number[] = []

  for (let index = 0; index < values.length; index += 1) {
    const createdAt = readChatMessageCreatedAt(values[index])
    if (createdAt != null && createdAt < cutoffEpochSeconds) {
      indicesToDelete.push(index)
    }
  }

  if (indicesToDelete.length === 0) {
    return 0
  }

  doc.transact(() => {
    for (let cursor = indicesToDelete.length - 1; cursor >= 0; cursor -= 1) {
      messages.delete(indicesToDelete[cursor], 1)
    }
  }, 'composure:chat-retention-prune')

  return indicesToDelete.length
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
  userRole: RequestUserRole
  documentName: string
  projectId: string
  documentKind: CollaborationDocumentKind
  shareToken?: string
}

function identityForHocuspocusContext(context: unknown): { userId: string | null; userRole: RequestUserRole } {
  const authContext = context as HocuspocusAuthContext | undefined
  return {
    userId: authContext?.principal?.userId ?? null,
    userRole: authContext?.userRole ?? null,
  }
}

async function runWithHocuspocusIdentity<T>(context: unknown, fn: () => Promise<T>): Promise<T> {
  const identity = identityForHocuspocusContext(context)
  return await runWithIdentityContext(identity.userId, identity.userRole, fn)
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

async function assertHocuspocusContextAccess(
  documentName: string,
  context: unknown,
): Promise<{ principal: Principal; documentRef: CollaborationDocumentRef }> {
  const documentRef = parseCollaborationDocumentName(documentName)
  if (!documentRef) {
    throw new Error('Invalid project ID')
  }

  const authContext = context as HocuspocusAuthContext | undefined
  const principal = authContext?.principal
  if (!principal) {
    throw new Error('Unauthenticated')
  }

  await runWithHocuspocusIdentity(context, async () => {
    const shareToken = authContext?.shareToken
    const access = await canAccessProjectWithRole(documentRef.projectId, principal, 'view', shareToken)
    if (!access.ok) {
      console.warn(
        `[hocuspocus] denied document=${documentName} userId=${principal.userId ?? 'none'} guestId=${principal.guestId ?? 'none'}`,
      )
      throw new Error('Forbidden')
    }

    await touchProjectActivity(documentRef.projectId)
  })
  return { principal, documentRef }
}

// Hocuspocus (Yjs WebSocket server)
const lastAutoCommitTimestamp = new Map<string, number>()

const hocuspocus = new Hocuspocus({
  debounce: 400,
  maxDebounce: 1500,
  async onAuthenticate(data) {
    const documentRef = parseCollaborationDocumentName(data.documentName)
    if (!documentRef) {
      console.warn(`[hocuspocus] auth-rejected document=${data.documentName} reason=invalid-project-id`)
      throw new Error('Invalid project ID')
    }

    const principal = await runWithIdentityContext(null, 'system', async () => await resolveHocuspocusPrincipal(data))
    const shareToken = getShareTokenFromUrl(data.request.url)
    const resolvedUser = principal.userId
      ? await runWithIdentityContext(null, 'system', async () => await findUserById(principal.userId!))
      : null
    const userRole: RequestUserRole = resolvedUser?.isGuest ? 'guest' : (resolvedUser?.role ?? null)

    if (shareToken && principal.userId) {
      await runWithIdentityContext(null, 'system', async () => await redeemShareTokenForUser(shareToken, principal.userId!))
    }

    console.info(
      `[hocuspocus] authenticate document=${data.documentName} socket=${data.socketId} userId=${principal.userId ?? 'none'} guestId=${principal.guestId ?? 'none'} shareToken=${shareToken ? 'present' : 'none'} cookieLen=${String(data.request.headers.cookie ?? '').length}`,
    )

    const access = await runWithIdentityContext(
      principal.userId,
      userRole,
      async () => await canAccessProjectWithRole(documentRef.projectId, principal, 'view', shareToken),
    )
    if (!access.ok) {
      console.warn(
        `[hocuspocus] auth-denied document=${data.documentName} userId=${principal.userId ?? 'none'} guestId=${principal.guestId ?? 'none'} shareToken=${shareToken ? 'present' : 'none'}`,
      )
      throw new Error('Forbidden')
    }

    await runWithIdentityContext(principal.userId, userRole, async () => await touchProjectActivity(documentRef.projectId))
    console.info(`[hocuspocus] auth-ok document=${data.documentName} role=${access.role ?? 'none'}`)
    return {
      principal,
      userRole,
      documentName: data.documentName,
      projectId: documentRef.projectId,
      documentKind: documentRef.kind,
      shareToken,
    }
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
    let authContext: HocuspocusAuthContext | undefined
    let documentRef: CollaborationDocumentRef
    let principal: Principal

    try {
      const accessCheck = await assertHocuspocusContextAccess(data.documentName, data.context)
      authContext = data.context as HocuspocusAuthContext | undefined
      principal = accessCheck.principal
      documentRef = accessCheck.documentRef
    } catch (err) {
      console.error(
        `[hocuspocus] before-handle-DENIED document=${data.documentName} socket=${data.socketId} error=${String(err)} context=${JSON.stringify(data.context)}`,
      )
      throw err
    }

    const shareToken = authContext?.shareToken
    const requiredWriteRole = documentRef.kind === 'chat' ? 'comment' : 'edit'
    const canWrite = principal
      ? (await runWithHocuspocusIdentity(
        data.context,
        async () => await canAccessProjectWithRole(documentRef.projectId, principal, requiredWriteRole, shareToken),
      )).ok
      : false

    if (!canWrite && isIncomingYjsWriteSyncMessage(data.update)) {
      console.warn(
        `[hocuspocus] write-denied document=${data.documentName} socket=${data.socketId} reason=insufficient-role`,
      )
      throw new Error('Forbidden')
    }

    // Enforce text file size limit on incoming write messages
    if (documentRef.kind === 'project' && canWrite && isIncomingYjsWriteSyncMessage(data.update)) {
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
    const documentRef = parseCollaborationDocumentName(data.documentName)
    if (!documentRef) {
      throw new Error('Invalid project ID')
    }

    let chatRetentionDays: number | 'unlimited' | 'off' | null = null
    if (documentRef.kind === 'chat') {
      chatRetentionDays = await getChatHistoryRetentionDays()
      if (chatRetentionDays === 'off') {
        console.info(
          `[hocuspocus] chat-session-only-load document=${data.documentName} mode=off`,
        )
        return data.document
      }
    }

    const stored = await runWithHocuspocusIdentity(data.context, async () => await loadDocument(data.documentName))
    if (stored) {
      Y.applyUpdate(data.document, new Uint8Array(stored))

      if (documentRef.kind === 'chat' && chatRetentionDays != null) {
        const removedCount = pruneExpiredChatMessages(data.document, chatRetentionDays)
        if (removedCount > 0) {
          console.info(
            `[hocuspocus] chat-pruned-on-load document=${data.documentName} removed=${removedCount} retentionDays=${String(chatRetentionDays)}`,
          )
        }
      }

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
    const documentRef = parseCollaborationDocumentName(data.documentName)
    if (!documentRef) {
      throw new Error('Invalid project ID')
    }

    await runWithHocuspocusIdentity(data.context, async () => await touchProjectActivity(documentRef.projectId))
    console.info(
      `[hocuspocus] change document=${data.documentName} updateBytes=${data.update.length} sharedTypes=${data.document.share.size} connections=${data.document.getConnectionsCount()}`,
    )
  },
  async onStoreDocument(data) {
    const documentRef = parseCollaborationDocumentName(data.documentName)
    if (!documentRef) {
      throw new Error('Invalid project ID')
    }

    if (documentRef.kind === 'chat') {
      const retentionDays = await getChatHistoryRetentionDays()
      if (retentionDays === 'off') {
        console.info(
          `[hocuspocus] chat-session-only-store-skip document=${data.documentName} mode=off`,
        )
        return
      }

      const removedCount = pruneExpiredChatMessages(data.document, retentionDays)
      if (removedCount > 0) {
        console.info(
          `[hocuspocus] chat-pruned-on-store document=${data.documentName} removed=${removedCount} retentionDays=${String(retentionDays)}`,
        )
      }
    }

    const update = Y.encodeStateAsUpdate(data.document)
    await runWithHocuspocusIdentity(data.context, async () => {
      await storeDocument(data.documentName, Buffer.from(update))
      await touchProjectActivity(documentRef.projectId)
    })
    console.info(
      `[hocuspocus] store document=${data.documentName} bytes=${update.length} sharedTypes=${data.document.share.size}`,
    )

    if (documentRef.kind !== 'project') {
      return
    }

    // Auto-commit to git history based on the project owner's interval setting
    const projectId = documentRef.projectId
    const project = await runWithHocuspocusIdentity(data.context, async () => await findProjectById(projectId))
    if (project?.engine === 'excalidraw') {
      console.info(`[history] auto-commit-skipped projectId=${projectId} engine=excalidraw`)
      return
    }

    const now = Date.now()
    const lastCommit = lastAutoCommitTimestamp.get(projectId) ?? 0

    // Look up the owner's auto-version interval. We use a default of 5 min.
    let intervalMinutes = 5
    try {
      // Resolve the owner from the first connected client's context
      const authContext = data.context as { principal?: Principal } | undefined
      const userId = authContext?.principal?.userId
      if (userId) {
        const prefs = await runWithHocuspocusIdentity(data.context, async () => await getUserPreferences(userId))
        intervalMinutes = prefs.autoVersionIntervalMinutes
      }
    } catch {
      // Fall back to default
    }

    if (intervalMinutes > 0 && now - lastCommit >= intervalMinutes * 60 * 1000) {
      lastAutoCommitTimestamp.set(projectId, now)
      // Fire async, don't block Hocuspocus
      void runWithHocuspocusIdentity(
        data.context,
        async () => await commitSnapshot(projectId, update, { skipEmpty: true }),
      ).then(() => {
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

// Run Kysely migrations (additive only, safe to run on every startup)
const { runMigrations } = await import('./db/migrate.js')
await runMigrations()

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
