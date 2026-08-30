import path from 'path'
import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import Fastify, { type FastifyInstance, type FastifyRequest, type preHandlerHookHandler } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import type { Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import {
  loadDocument,
  storeDocument,
  touchProjectActivity,
  canAccessProjectWithRole,
  createJob,
  markJobRunning,
  markJobDone,
  markJobFailed,
  markJobInvalid,
  getMaxTextFileSize,
  findProjectById,
  type ProjectRole,
} from './db/index.js'
import {
  applyPasswordResetRoute,
  authHook,
  authSessionRoute,
  changePasswordRoute,
  disablePasswordRoute,
  deleteAccountRoute,
  getPasswordResetTokenRoute,
  getExcalidrawLibraryRoute,
  getPreferencesRoute,
  loginRoute,
  listSessionsRoute,
  logoutRoute,
  revokeSessionRoute,
  signupRoute,
  putExcalidrawLibraryRoute,
  updatePreferencesRoute,
  updateProfileRoute,
  type AuthBody,
  type ResetPasswordBody,
} from './auth.js'
import {
  createAdminUserRoute,
  createInviteTokenRoute,
  deleteAdminUserRoute,
  expirePasswordResetLinkRoute,
  generatePasswordResetLinkRoute,
  getAdminServerSettingsRoute,
  getJobSummaryRoute,
  getSmtpSettingsRoute,
  listInviteTokensRoute,
  listPasswordResetLinksRoute,
  listAdminUsersRoute,
  listRecentJobsRoute,
  revokeInviteTokenRoute,
  sendTestEmailRoute,
  updateAdminServerSettingsRoute,
  updateAdminUserRoute,
  updateSmtpSettingsRoute,
  getLoginProvidersRoute,
  updateLoginProvidersRoute,
  checkStrandedUsersRoute,
  getStrandedUsersCsvRoute,
  testLoginProviderRoute,
} from './admin.js'
import {
  clearRecentProjectsRoute,
  createProjectRoute,
  deleteProjectRoute,
  getProjectMetadataRoute,
  listProjectsRoute,
  listRecentProjectsRoute,
  listTemplatesRoute,
  patchProjectMetadataRoute,
  listTrashRoute,
  markProjectOpenedRoute,
  permanentDeleteProjectRoute,
  renameProjectRoute,
  restoreProjectRoute,
} from './projects.js'
import {
  getProjectWorkspaceStateRoute,
  patchProjectWorkspaceStateRoute,
} from './workspace-state.js'
import { dispatchClearPreview, dispatchCompile, dispatchPreview } from './compile-dispatch.js'
import { bibliographyRoute } from './bibliography.js'
import { referenceSearchRoute } from './references.js'
import { exportRoute } from './export.js'
import { uploadRoute, deleteAssetRoute, listAssetsRoute, assetStore, isValidStorageKey } from './storage.js'
import {
  addProjectCommentRoute,
  deleteProjectCommentRoute,
  getProjectAccessRoute,
  inviteProjectMemberRoute,
  listProjectCommentsRoute,
  patchProjectCommentRoute,
  patchProjectLinkSharingRoute,
  patchProjectMemberRoute,
  sharedWithMeRoute,
} from './sharing.js'
import { isProductionEnv, normalizeOriginHeader, parseBooleanEnv, parseTrustedOrigins, parseUrlEnv } from './env.js'
import { isValidProjectId, normalizeRelativePath } from './security.js'
import {
  FixedWindowRateLimiter,
  clientIpKey,
  normalizeEmailForKey,
  rateLimitPreHandler,
  resolveTrustProxy,
} from './rate-limit.js'
import {
  commitSnapshot,
  createSnapshot,
  getChangedFilesForCommit,
  getDocStateAtCommit,
  getFileDiff,
  getLog,
  listSnapshots,
  restoreSingleFile,
  restoreToCommit,
} from './history.js'
import { findTextSizeViolation, textSizeViolationMessage } from './text-size-limit.js'
import { summarizeDocState } from './files.js'
import {
  pathMatchesPrefix,
  pathnameFromRawUrl,
  resolveApiRouting,
} from './routing.js'
import { registerAllStrategies, registerOAuthRoutes } from './auth/oauth.js'
import { registerPasskeyRoutes } from './auth/passkeys.js'
import { beginRequestContext } from './db/request-context.js'
import { getJwksResponse } from './auth/jwt.js'

async function canAccessProjectForRequest(
  req: FastifyRequest,
  projectId: string,
  requiredRole: ProjectRole,
): Promise<boolean> {
  const roleAccess = await canAccessProjectWithRole(projectId, req.principal, requiredRole)
  if (!roleAccess.ok) {
    return false
  }

  await touchProjectActivity(projectId)
  return true
}

function requireProjectParamAccess(requiredRole: ProjectRole): preHandlerHookHandler {
  return async (req, reply) => {
    const params = req.params as { projectId?: string }
    const projectId = String(params.projectId ?? '')
    if (!isValidProjectId(projectId)) {
      reply.status(400).send({ error: 'Invalid project ID' })
      return
    }

    if (!(await canAccessProjectForRequest(req, projectId, requiredRole))) {
      reply.status(403).send({ error: 'Forbidden' })
      return
    }
  }
}

export interface BuildAppOptions {
  hocuspocus?: Hocuspocus | null
  isProduction?: boolean
  resetAutoCommitTimer?: (projectId: string) => void
}

// Enforcing CSP applied to all app responses (the SPA document included).
// 'unsafe-inline'/'unsafe-eval' are required: the app uses pervasive React
// inline styles plus runtime <style> injection for theming, and pdf.js needs
// eval. Everything else is locked down — no plugins, no framing, self-only base
// and form targets.
const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { hocuspocus = null, isProduction = isProductionEnv(process.env.NODE_ENV), resetAutoCommitTimer } = options
  const shouldServeFrontend = parseBooleanEnv(process.env.SERVE_FRONTEND, isProduction)
  const trustedOrigins = new Set(parseTrustedOrigins(process.env.CORS_ORIGIN, process.env.NODE_ENV))
  const corsMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  const apiRouting = resolveApiRouting(process.env)
  const apiPath = apiRouting.apiPath
  const backendUrl = parseUrlEnv(process.env.BACKEND_URL)
  const frontendUrl = parseUrlEnv(process.env.FRONTEND_URL)

  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
    // Resolve the real client IP for rate limiting. Configure TRUST_PROXY to
    // name your proxy hop(s); it defaults to trusting nothing.
    trustProxy: resolveTrustProxy(process.env.TRUST_PROXY),
  })

  // Per-process rate limiting for unauthenticated auth endpoints. See
  // rate-limit.ts for the single-instance caveat.
  const authRateLimiter = new FixedWindowRateLimiter()
  const RL_WINDOW_MS = 15 * 60 * 1000

  const loginRateLimit = rateLimitPreHandler(authRateLimiter, (req) => {
    const ip = clientIpKey(req.ip)
    const email = normalizeEmailForKey((req.body as { email?: unknown } | undefined)?.email)
    return [
      // Tight: one host guessing one account's password.
      { key: `login:ip+email:${ip}:${email}`, rule: { max: 10, windowMs: RL_WINDOW_MS } },
      // Looser email axis: a botnet spreading attempts on one account across many IPs.
      { key: `login:email:${email}`, rule: { max: 20, windowMs: RL_WINDOW_MS } },
      // IP axis: credential stuffing many accounts from one host.
      { key: `login:ip:${ip}`, rule: { max: 50, windowMs: RL_WINDOW_MS } },
    ]
  })

  const signupRateLimit = rateLimitPreHandler(authRateLimiter, (req) => {
    const ip = clientIpKey(req.ip)
    const email = normalizeEmailForKey((req.body as { email?: unknown } | undefined)?.email)
    return [
      { key: `signup:ip:${ip}`, rule: { max: 10, windowMs: RL_WINDOW_MS } },
      { key: `signup:email:${email}`, rule: { max: 5, windowMs: RL_WINDOW_MS } },
    ]
  })

  const passwordResetRateLimit = rateLimitPreHandler(authRateLimiter, (req) => {
    const ip = clientIpKey(req.ip)
    const token = String((req.params as { token?: string } | undefined)?.token ?? '')
    return [
      { key: `pwreset:ip:${ip}`, rule: { max: 20, windowMs: RL_WINDOW_MS } },
      { key: `pwreset:token:${token}`, rule: { max: 10, windowMs: RL_WINDOW_MS } },
    ]
  })

  // Looser than login: a provider hiccup can trigger legitimate confirm retries.
  const oauthConfirmRateLimit = rateLimitPreHandler(authRateLimiter, (req) => {
    const ip = clientIpKey(req.ip)
    return [{ key: `oauth-confirm:ip:${ip}`, rule: { max: 60, windowMs: RL_WINDOW_MS } }]
  })

  await app.register(fastifyCors, {
    credentials: true,
    methods: corsMethods,
    exposedHeaders: ['X-Compile-Id', 'Content-Disposition'],
    maxAge: 600,
    origin: (origin, callback) => {
      if (origin == null) {
        callback(null, true)
        return
      }

      const normalizedOrigin = normalizeOriginHeader(origin)
      callback(null, normalizedOrigin != null && trustedOrigins.has(normalizedOrigin))
    },
  })

  await app.register(fastifyCookie)
  await app.register(fastifyMultipart)
  app.addHook('onRequest', async () => {
    beginRequestContext()
  })
  app.addHook('preHandler', authHook)
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    // Routes that need a stricter policy (e.g. the sandboxed /assets responses)
    // set their own CSP; don't override it here.
    if (!reply.getHeader('content-security-policy')) {
      reply.header('Content-Security-Policy', APP_CONTENT_SECURITY_POLICY)
    }
    return payload
  })
  app.addHook('preHandler', async (req, reply) => {
    const requestPathname = pathnameFromRawUrl(req.url)
    if (!pathMatchesPrefix(requestPathname, apiRouting.adminApiPath)) {
      return
    }

    if (!req.authUser) {
      reply.status(401).send({ error: 'Authentication required' })
      return
    }

    if (req.authUser.role !== 'admin') {
      reply.status(403).send({ error: 'Administrator access required' })
      return
    }
  })

  // Health check
  app.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          required: ['status', 'uptime'],
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async () => ({ status: 'ok', uptime: process.uptime() }))

  app.get('/.well-known/jwks.json', async (_req, reply) => {
    reply.send(await getJwksResponse())
  })

  // Protected static asset serving for uploaded project files.
  app.get('/assets/:projectId(^[a-f0-9]{32}$)/*', {
    preHandler: requireProjectParamAccess('view'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId', '*'],
        properties: {
          projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
          '*': { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const params = req.params as { projectId: string; '*': string }
    const projectId = params.projectId
    const storageKey = params['*']

    if (!isValidStorageKey(storageKey)) {
      reply.status(400).send({ error: 'Invalid storage key' })
      return
    }

    const stream = assetStore.get(projectId, storageKey)
    if (!stream) {
      reply.status(404).send({ error: 'Asset not found' })
      return
    }

    const ext = storageKey.split('.').pop()?.toLowerCase() ?? ''
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
      pdf: 'application/pdf',
      csv: 'text/csv',
      json: 'application/json',
      txt: 'text/plain',
    }
    reply.type(mimeTypes[ext] ?? 'application/octet-stream')

    // Only raster images and PDFs are ever rendered inline by the frontend
    // (via <img> and pdf.js). Everything else — notably SVG, which can carry
    // <script> that would run in our origin if navigated to directly — is
    // forced to download. The sandbox CSP is defence-in-depth: it neutralises
    // script execution should any asset be opened as a top-level document.
    const inlineSafeExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf'])
    const disposition = inlineSafeExts.has(ext) ? 'inline' : 'attachment'
    reply.header('Content-Disposition', `${disposition}; filename="${storageKey}"`)
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'")

    // If you don't return reply.send(), Fastify resolves the async's undefined 
    // return and can finalize the response before the stream finishes piping
    return reply.send(stream)
  })

  // Auth routes
  app.get(apiPath('/auth/session'), authSessionRoute)
  app.post<{ Body: AuthBody }>(apiPath('/auth/signup'), {
    preHandler: signupRateLimit,
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', minLength: 3, maxLength: 320 },
          password: { type: 'string', minLength: 8, maxLength: 4096 },
          displayName: { type: 'string', minLength: 0, maxLength: 120 },
          inviteToken: { type: 'string', minLength: 0, maxLength: 200 },
        },
        additionalProperties: true,
      },
    },
  }, signupRoute)
  app.post<{ Body: AuthBody }>(apiPath('/auth/login'), {
    preHandler: loginRateLimit,
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', minLength: 3, maxLength: 320 },
          password: { type: 'string', minLength: 1, maxLength: 4096 },
        },
        additionalProperties: true,
      },
    },
  }, loginRoute)
  app.post(apiPath('/auth/logout'), logoutRoute)
  app.get(apiPath('/auth/password-reset/:token'), getPasswordResetTokenRoute)
  app.post<{ Params: { token?: string }; Body: ResetPasswordBody }>(
    apiPath('/auth/password-reset/:token'),
    { preHandler: passwordResetRateLimit },
    applyPasswordResetRoute,
  )
  app.patch(apiPath('/auth/profile'), {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'displayName'],
        properties: {
          email: { type: 'string', minLength: 3, maxLength: 320 },
          displayName: { type: 'string', minLength: 2, maxLength: 120 },
          profileImageUrl: { type: ['string', 'null'], maxLength: 500000 },
        },
        additionalProperties: true,
      },
    },
  }, updateProfileRoute)
  app.post(apiPath('/auth/password'), {
    schema: {
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 0, maxLength: 4096 },
          newPassword: { type: 'string', minLength: 8, maxLength: 4096 },
        },
        additionalProperties: true,
      },
    },
  }, changePasswordRoute)
  app.delete(apiPath('/auth/password'), disablePasswordRoute)
  app.post(apiPath('/auth/delete-account'), {
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', minLength: 1, maxLength: 4096 },
        },
        additionalProperties: false,
      },
    },
  }, deleteAccountRoute)
  app.get(apiPath('/auth/sessions'), listSessionsRoute)
  app.delete(apiPath('/auth/sessions/:sessionId'), revokeSessionRoute)
  app.get(apiPath('/preferences'), getPreferencesRoute)
  app.patch(apiPath('/preferences'), updatePreferencesRoute)
  app.get(apiPath('/excalidraw-library'), getExcalidrawLibraryRoute)
  app.put(apiPath('/excalidraw-library'), putExcalidrawLibraryRoute)

  app.get(apiPath('/admin/users'), listAdminUsersRoute)
  app.post(apiPath('/admin/users'), createAdminUserRoute)
  app.patch(apiPath('/admin/users/:userId'), updateAdminUserRoute)
  app.delete(apiPath('/admin/users/:userId'), deleteAdminUserRoute)
  app.post(apiPath('/admin/users/:userId/password-reset-link'), generatePasswordResetLinkRoute)
  app.get(apiPath('/admin/users/:userId/password-reset-links'), listPasswordResetLinksRoute)
  app.post(apiPath('/admin/password-reset-links/:token/expire'), expirePasswordResetLinkRoute)
  app.get(apiPath('/admin/server-settings'), getAdminServerSettingsRoute)
  app.patch(apiPath('/admin/server-settings'), updateAdminServerSettingsRoute)
  app.get(apiPath('/admin/invites'), listInviteTokensRoute)
  app.post(apiPath('/admin/invites'), createInviteTokenRoute)
  app.delete(apiPath('/admin/invites/:token'), revokeInviteTokenRoute)
  app.get(apiPath('/admin/smtp'), getSmtpSettingsRoute)
  app.patch(apiPath('/admin/smtp'), updateSmtpSettingsRoute)
  app.post(apiPath('/admin/smtp/test'), sendTestEmailRoute)
  app.get(apiPath('/admin/login-providers'), getLoginProvidersRoute)
  app.put(apiPath('/admin/login-providers'), updateLoginProvidersRoute)
  app.post(apiPath('/admin/login-providers/check-stranded'), checkStrandedUsersRoute)
  app.post(apiPath('/admin/login-providers/stranded-csv'), getStrandedUsersCsvRoute)
  app.post(apiPath('/admin/login-providers/test'), testLoginProviderRoute)
  app.get(apiPath('/admin/monitoring/summary'), getJobSummaryRoute)
  app.get(apiPath('/admin/monitoring/jobs'), listRecentJobsRoute)

  // OAuth routes
  registerAllStrategies()
  registerOAuthRoutes(app, apiPath, {
    backendUrl,
    frontendUrl,
    trustedFrontendOrigins: trustedOrigins,
    confirmRateLimit: oauthConfirmRateLimit,
  })

  // Passkey (WebAuthn) routes
  registerPasskeyRoutes(app, apiPath)

  // Project dashboard routes
  app.get(apiPath('/projects'), listProjectsRoute)
  app.get(apiPath('/projects/recents'), listRecentProjectsRoute)
  app.delete(apiPath('/projects/recents'), clearRecentProjectsRoute)
  app.get(apiPath('/projects/shared-with-me'), sharedWithMeRoute)
  app.get(apiPath('/templates'), listTemplatesRoute)
  app.post(apiPath('/projects'), {
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 120 },
          rootFile: { type: 'string', maxLength: 512 },
          defaultBibliographyFile: { type: 'string', maxLength: 512 },
          referenceLookupFormat: { type: 'string', enum: ['bibtex', 'biblatex'] },
          templateId: { type: 'string', maxLength: 120 },
        },
        additionalProperties: true,
      },
    },
  }, createProjectRoute)
  app.patch<{ Params: { projectId: string }; Body: { title: string } }>(apiPath('/projects/:projectId'), {
    preHandler: requireProjectParamAccess('edit'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        },
      },
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
        },
        additionalProperties: true,
      },
    },
  }, renameProjectRoute)
  app.post(apiPath('/projects/:projectId/open'), markProjectOpenedRoute)
  app.delete(apiPath('/projects/:projectId'), deleteProjectRoute)
  app.get(apiPath('/projects/trash'), listTrashRoute)
  app.post(apiPath('/projects/:projectId/restore'), restoreProjectRoute)
  app.delete(apiPath('/projects/:projectId/permanent'), permanentDeleteProjectRoute)
  app.get(apiPath('/projects/:projectId/metadata'), getProjectMetadataRoute)
  app.patch(apiPath('/projects/:projectId/metadata'), {
    preHandler: requireProjectParamAccess('edit'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        },
      },
      body: {
        type: 'object',
        properties: {
          rootFile: { type: ['string', 'null'], minLength: 1, maxLength: 512 },
          defaultBibliographyFile: { type: ['string', 'null'], minLength: 1, maxLength: 512 },
          referenceLookupFormat: { type: 'string', enum: ['bibtex', 'biblatex'] },
        },
        additionalProperties: false,
      },
    },
  }, patchProjectMetadataRoute)
  app.get(apiPath('/projects/:projectId/access'), getProjectAccessRoute)
  app.get(apiPath('/projects/:projectId/workspace-state'), getProjectWorkspaceStateRoute)
  app.patch(apiPath('/projects/:projectId/workspace-state'), {
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        },
      },
      body: {
        type: 'object',
        required: ['state'],
        properties: {
          state: {
            type: 'object',
            additionalProperties: true,
          },
        },
        additionalProperties: false,
      },
    },
  }, patchProjectWorkspaceStateRoute)
  app.post(apiPath('/projects/:projectId/members'), inviteProjectMemberRoute)
  app.patch(apiPath('/projects/:projectId/members/:userId'), patchProjectMemberRoute)
  app.patch(apiPath('/projects/:projectId/link-sharing'), patchProjectLinkSharingRoute)
  app.get(apiPath('/projects/:projectId/comments'), listProjectCommentsRoute)
  app.post(apiPath('/projects/:projectId/comments'), addProjectCommentRoute)
  app.patch(apiPath('/projects/:projectId/comments/:commentId'), patchProjectCommentRoute)
  app.delete(apiPath('/projects/:projectId/comments/:commentId'), deleteProjectCommentRoute)

  // Document routes
  app.get(apiPath('/document/:projectId'), {
    preHandler: requireProjectParamAccess('view'),
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId

    const state = await loadDocument(projectId)
    if (!state) {
      reply.status(404).send({ error: 'Not found' })
      return
    }

    const update = new Uint8Array(state)
    const decoded = new Y.Doc()
    Y.applyUpdate(decoded, update)
    const summary = summarizeDocState(decoded)
    decoded.destroy()

    console.info(
      `[document] fetch projectId=${projectId} bytes=${update.length} filesMap=${summary.filesMapCount} fileTexts=${summary.fileTextCount}`,
    )

    reply.send({
      documentUpdateBase64: Buffer.from(update).toString('base64'),
      bytes: update.length,
    })
  })

  app.post(apiPath('/save/:projectId'), {
    preHandler: requireProjectParamAccess('edit'),
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId
    const body = req.body as { documentUpdateBase64?: string; reason?: string } | null
    const { documentUpdateBase64, reason } = body ?? {}

    if (typeof documentUpdateBase64 !== 'string' || documentUpdateBase64.length === 0) {
      reply.status(400).send({ error: 'documentUpdateBase64 is required' })
      return
    }

    let clientUpdate: Uint8Array
    try {
      clientUpdate = Uint8Array.from(Buffer.from(documentUpdateBase64, 'base64'))
      // Validate the update against a scratch doc now, so any failure after
      // this point is a server-side problem, not a malformed payload.
      const probe = new Y.Doc()
      try {
        Y.applyUpdate(probe, clientUpdate)
      } finally {
        probe.destroy()
      }
    } catch {
      reply.status(400).send({ error: 'Invalid documentUpdateBase64 payload' })
      return
    }

    try {
      const liveDoc = hocuspocus?.documents.get(projectId)

      const maxTextSize = await getMaxTextFileSize()
      if (maxTextSize !== 'unlimited') {
        const validationDoc = new Y.Doc()
        try {
          if (liveDoc) {
            Y.applyUpdate(validationDoc, Y.encodeStateAsUpdate(liveDoc))
          }
          Y.applyUpdate(validationDoc, clientUpdate)
          const violation = findTextSizeViolation(validationDoc, maxTextSize)
          if (violation) {
            reply.status(413).send({ error: textSizeViolationMessage(violation) })
            return
          }
        } catch {
          reply.status(400).send({ error: 'Invalid documentUpdateBase64 payload' })
          return
        } finally {
          validationDoc.destroy()
        }
      }

      if (liveDoc) {
        Y.applyUpdate(liveDoc, clientUpdate)
        const merged = Y.encodeStateAsUpdate(liveDoc)
        await storeDocument(projectId, Buffer.from(merged))
        await touchProjectActivity(projectId)
        const summary = summarizeDocState(liveDoc)
        console.info(
          `[save] merged-live projectId=${projectId} bytes=${merged.length} reason=${String(reason ?? 'unspecified')} filesMap=${summary.filesMapCount} fileTexts=${summary.fileTextCount}`,
        )
        reply.send({ ok: true, bytes: merged.length })

        if (reason === 'compile' || reason === 'export') {
          // Intentionally fire-and-forget to avoid blocking save responses on git I/O.
          void commitSnapshot(projectId, merged, { skipEmpty: true }).then((sha) => {
            if (sha) {
              resetAutoCommitTimer?.(projectId)
              const doc = hocuspocus?.documents.get(projectId)
              if (doc) doc.broadcastStateless(JSON.stringify({ type: 'history-updated' }))
            }
          }).catch((err) => {
            console.warn(`[save] commit-on-${reason}-failed projectId=${projectId} error=${String(err)}`)
          })
        }
        return
      }

      await storeDocument(projectId, Buffer.from(clientUpdate))
      await touchProjectActivity(projectId)

      const decoded = new Y.Doc()
      Y.applyUpdate(decoded, clientUpdate)
      const summary = summarizeDocState(decoded)
      decoded.destroy()

      console.info(
        `[save] persisted projectId=${projectId} bytes=${clientUpdate.length} reason=${String(reason ?? 'unspecified')} filesMap=${summary.filesMapCount} fileTexts=${summary.fileTextCount}`,
      )
      reply.send({ ok: true, bytes: clientUpdate.length })

      if (reason === 'compile' || reason === 'export') {
        // Intentionally fire-and-forget to avoid blocking save responses on git I/O.
        void commitSnapshot(projectId, clientUpdate, { skipEmpty: true }).then((sha) => {
          if (sha) {
            resetAutoCommitTimer?.(projectId)
          }
        }).catch((err) => {
          console.warn(`[save] commit-on-${reason}-failed projectId=${projectId} error=${String(err)}`)
        })
      }
    } catch (err) {
      // The payload was validated above, so this is a persistence failure
      // (DB outage, disk, …) — log it and report a server error, not a 400.
      console.error(`[save] failed projectId=${projectId} error=${String(err)}`)
      reply.status(500).send({ error: 'Save failed' })
    }
  })

  app.post(apiPath('/compile'), {
    schema: {
      body: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
          rootFile: { type: 'string', minLength: 1, maxLength: 512 },
          documentUpdateBase64: { type: 'string' },
          responseMode: { type: 'string', enum: ['pdf', 'metadata'] },
          commitSha: { type: 'string', pattern: '^[a-f0-9]{4,64}$' },
        },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const body = (req.body as {
      projectId?: string
      rootFile?: string
      documentUpdateBase64?: string
      responseMode?: 'pdf' | 'metadata'
      commitSha?: string
    }) ?? {}
    const { projectId, rootFile, documentUpdateBase64, responseMode, commitSha } = body

    if (!isValidProjectId(String(projectId ?? ''))) {
      reply.status(400).send({ error: 'Invalid project ID' })
      return
    }

    if (!(await canAccessProjectForRequest(req, String(projectId), 'view'))) {
      reply.status(403).send({ error: 'Forbidden' })
      return
    }

    const safeRootFile = normalizeRelativePath(rootFile)
    if (!safeRootFile) {
      reply.status(400).send({ error: 'Invalid root file path' })
      return
    }

    const normalizedProjectId = String(projectId)
    const project = await findProjectById(normalizedProjectId)
    if (project?.engine === 'excalidraw') {
      reply.status(400).send({
        error: 'Whiteboard projects support PNG/SVG export from the canvas and cannot be compiled.',
      })
      return
    }

    const userId = req.authUser?.id ?? req.principal?.userId ?? null
    const jobId = await createJob('compile', userId, normalizedProjectId)
    let snapshot: Uint8Array | undefined

    if (commitSha) {
      // Compile from a historical commit — don't store to SQLite
      const docState = await getDocStateAtCommit(normalizedProjectId, commitSha)
      if (docState) {
        snapshot = docState
        console.info(`[compile] using-history-snapshot projectId=${normalizedProjectId} commitSha=${commitSha} bytes=${snapshot.length}`)
      } else {
        reply.status(400).send({ error: 'Could not read files from the specified commit' })
        return
      }
    } else if (typeof documentUpdateBase64 === 'string' && documentUpdateBase64.length > 0) {
      try {
        snapshot = Uint8Array.from(Buffer.from(documentUpdateBase64, 'base64'))

        const maxTextSize = await getMaxTextFileSize()
        if (maxTextSize !== 'unlimited') {
          const decodedDoc = new Y.Doc()
          try {
            Y.applyUpdate(decodedDoc, snapshot)
            const violation = findTextSizeViolation(decodedDoc, maxTextSize)
            if (violation) {
              reply.status(413).send({ error: textSizeViolationMessage(violation) })
              return
            }
          } finally {
            decodedDoc.destroy()
          }
        }

        if (snapshot.length > 0) {
          await storeDocument(normalizedProjectId, Buffer.from(snapshot))
        }
        console.info(`[compile] using-request-snapshot projectId=${normalizedProjectId} bytes=${snapshot.length}`)
      } catch {
        reply.status(400).send({ error: 'Invalid documentUpdateBase64 payload' })
        return
      }
    } else {
      const liveDoc = hocuspocus?.documents.get(normalizedProjectId)
      if (liveDoc) {
        snapshot = Y.encodeStateAsUpdate(liveDoc)
        await storeDocument(normalizedProjectId, Buffer.from(snapshot))
        console.info(
          `[compile] using-live-snapshot projectId=${normalizedProjectId} bytes=${snapshot.length} sharedTypes=${liveDoc.share.size} connections=${liveDoc.getConnectionsCount()}`,
        )
      } else {
        const stored = await loadDocument(normalizedProjectId)
        if (stored) {
          snapshot = Uint8Array.from(stored)
          console.info(`[compile] using-stored-snapshot projectId=${normalizedProjectId} bytes=${snapshot.length}`)
        } else {
          console.warn(`[compile] no-snapshot-available projectId=${normalizedProjectId}`)
        }
      }
    }

    await dispatchCompile({
      projectId: normalizedProjectId,
      payload: {
        projectId: normalizedProjectId,
        rootFile: safeRootFile,
        documentUpdateBase64: snapshot ? Buffer.from(snapshot).toString('base64') : undefined,
        responseMode: responseMode === 'metadata' ? 'metadata' : 'pdf',
      },
      reply,
      onSlotAcquired: async () => {
        await markJobRunning(jobId)
      },
    })

    const statusCode = reply.raw.statusCode
    if (statusCode >= 500) {
      await markJobFailed(jobId, `status ${statusCode}`)
    } else if (statusCode >= 400) {
      await markJobInvalid(jobId, `status ${statusCode}`)
    } else {
      await markJobDone(jobId)
    }
  })

  app.get(apiPath('/projects/:projectId/preview.pdf'), {
    preHandler: requireProjectParamAccess('view'),
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
  }, async (req, reply) => {
    const params = req.params as { projectId?: string }
    const query = req.query as { v?: string } | undefined
    const projectId = String(params.projectId ?? '')
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined
    const ifNoneMatchHeader = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined
    const ifModifiedSinceHeader = typeof req.headers['if-modified-since'] === 'string' ? req.headers['if-modified-since'] : undefined

    await dispatchPreview({
      projectId,
      reply,
      rangeHeader,
      ifNoneMatchHeader,
      ifModifiedSinceHeader,
      cacheVersion: query?.v,
    })
  })

  app.delete(apiPath('/projects/:projectId/preview.pdf'), {
    preHandler: requireProjectParamAccess('edit'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        },
      },
    },
  }, async (req, reply) => {
    const params = req.params as { projectId?: string }
    const projectId = String(params.projectId ?? '')

    await dispatchClearPreview({
      projectId,
      reply,
    })
  })

  app.get(apiPath('/bibliography/:projectId'), {
    preHandler: requireProjectParamAccess('view'),
  }, bibliographyRoute)
  app.get(apiPath('/references/search'), {
    schema: {
      querystring: {
        type: 'object',
        required: ['source', 'term'],
        properties: {
          source: { type: 'string', minLength: 1, maxLength: 32 },
          field: { type: 'string', minLength: 1, maxLength: 32 },
          term: { type: 'string', minLength: 1, maxLength: 512 },
          maxResults: { type: 'string', minLength: 1, maxLength: 3 },
        },
        additionalProperties: false,
      },
    },
  }, referenceSearchRoute)
  app.post(apiPath('/export/:projectId'), {
    preHandler: requireProjectParamAccess('view'),
  }, exportRoute)
  app.post(apiPath('/upload/:projectId'), {
    preHandler: requireProjectParamAccess('edit'),
  }, uploadRoute)
  app.delete(apiPath('/upload/:projectId/:storageKey'), {
    preHandler: requireProjectParamAccess('edit'),
  }, deleteAssetRoute)
  app.get(apiPath('/upload/:projectId'), {
    preHandler: requireProjectParamAccess('view'),
  }, listAssetsRoute)

  // History routes
  app.get(apiPath('/projects/:projectId/history'), {
    preHandler: requireProjectParamAccess('view'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
      },
      querystring: {
        type: 'object',
        properties: {
          file: { type: 'string', maxLength: 512 },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          before: { type: 'string', maxLength: 64 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string }
    const query = req.query as { file?: string; limit?: number; before?: string }
    const commits = await getLog(projectId, {
      file: query.file,
      limit: query.limit,
      before: query.before,
    })
    reply.send({ commits })
  })

  app.get(apiPath('/projects/:projectId/history/:sha/files'), {
    preHandler: requireProjectParamAccess('view'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId', 'sha'],
        properties: {
          projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
          sha: { type: 'string', pattern: '^[a-f0-9]{4,64}$' },
        },
      },
    },
  }, async (req, reply) => {
    const { projectId, sha } = req.params as { projectId: string; sha: string }
    const files = await getChangedFilesForCommit(projectId, sha)
    reply.send({ files })
  })

  app.get(apiPath('/projects/:projectId/history/:sha/diff'), {
    preHandler: requireProjectParamAccess('view'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId', 'sha'],
        properties: {
          projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
          sha: { type: 'string', pattern: '^[a-f0-9]{4,64}$' },
        },
      },
      querystring: {
        type: 'object',
        required: ['file'],
        properties: {
          file: { type: 'string', minLength: 1, maxLength: 512 },
          base: { type: 'string', enum: ['parent', 'current'] },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { projectId, sha } = req.params as { projectId: string; sha: string }
    const { file, base } = req.query as { file: string; base?: 'parent' | 'current' }
    const diff = await getFileDiff(projectId, sha, file, base ?? 'parent')
    if (!diff) {
      reply.status(404).send({ error: 'Diff not found' })
      return
    }
    reply.send(diff)
  })

  app.post(apiPath('/projects/:projectId/history/snapshot'), {
    preHandler: requireProjectParamAccess('edit'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
      },
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string }
    const { name } = req.body as { name: string }

    // Commit current state first
    await commitSnapshot(projectId)
    resetAutoCommitTimer?.(projectId)

    const snapshot = await createSnapshot(projectId, name)
    if (!snapshot) {
      reply.status(400).send({ error: 'Could not create snapshot. Make sure the project has content.' })
      return
    }
    reply.send({ snapshot })
  })

  app.get(apiPath('/projects/:projectId/history/snapshots'), {
    preHandler: requireProjectParamAccess('view'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string }
    const snapshots = await listSnapshots(projectId)
    reply.send({ snapshots })
  })

  app.post(apiPath('/projects/:projectId/history/restore'), {
    preHandler: requireProjectParamAccess('edit'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
      },
      body: {
        type: 'object',
        required: ['commitSha'],
        properties: { commitSha: { type: 'string', pattern: '^[a-f0-9]{4,64}$' } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string }
    const { commitSha } = req.body as { commitSha: string }

    // Auto-save current state before restoring so the user can undo the restore
    const liveDoc = hocuspocus?.documents.get(projectId)
    const yDocState = liveDoc ? Y.encodeStateAsUpdate(liveDoc) : undefined
    await commitSnapshot(projectId, yDocState, { skipEmpty: true })

    const maxTextSize = await getMaxTextFileSize()
    if (maxTextSize !== 'unlimited') {
      const targetState = await getDocStateAtCommit(projectId, commitSha)
      if (!targetState) {
        reply.status(400).send({ error: 'Restore failed. Could not read the target commit.' })
        return
      }

      const targetDoc = new Y.Doc()
      try {
        Y.applyUpdate(targetDoc, targetState)
        const violation = findTextSizeViolation(targetDoc, maxTextSize)
        if (violation) {
          reply.status(413).send({ error: textSizeViolationMessage(violation) })
          return
        }
      } finally {
        targetDoc.destroy()
      }
    }

    const result = await restoreToCommit(projectId, commitSha)
    if (!result) {
      reply.status(400).send({ error: 'Restore failed. Could not read the target commit.' })
      return
    }

    // Apply restored state to the Hocuspocus in-memory doc so connected
    // clients see the change immediately without a full reconnect.
    if (hocuspocus) {
      const liveDoc = hocuspocus.documents.get(projectId)
      if (liveDoc) {
        liveDoc.transact(() => {
          const filesMap = liveDoc.getMap<string>('files')

          // Remove all existing file entries
          const existingPaths = Array.from(filesMap.keys())
          for (const p of existingPaths) {
            filesMap.delete(p)
          }

          // Clear all existing file texts (use getText to correctly
          // promote AbstractType entries loaded from updates)
          const fileKeys = Array.from(liveDoc.share.keys()).filter(k => k.startsWith('file:'))
          for (const key of fileKeys) {
            const text = liveDoc.getText(key)
            text.delete(0, text.length)
          }

          // Add restored files
          for (const [filepath, data] of result.restoredFiles) {
            filesMap.set(filepath, data.meta)
            if (data.content != null) {
              const text = liveDoc.getText(`file:${filepath}`)
              text.insert(0, data.content)
            }
          }
        })
        console.info(`[restore] applied-to-live-doc projectId=${projectId} files=${result.restoredFiles.size}`)
      }
    }

    reply.send({ commit: result.commit })
  })

  app.post(apiPath('/projects/:projectId/history/restore-file'), {
    preHandler: requireProjectParamAccess('edit'),
    schema: {
      params: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
      },
      body: {
        type: 'object',
        required: ['commitSha', 'filePath'],
        properties: {
          commitSha: { type: 'string', pattern: '^[a-f0-9]{4,64}$' },
          filePath: { type: 'string', minLength: 1, maxLength: 512 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string }
    const { commitSha, filePath } = req.body as { commitSha: string; filePath: string }

    // Auto-save current state before restoring so the user can undo the restore
    const liveDoc = hocuspocus?.documents.get(projectId)
    const yDocState = liveDoc ? Y.encodeStateAsUpdate(liveDoc) : undefined
    await commitSnapshot(projectId, yDocState, { skipEmpty: true })

    const result = await restoreSingleFile(projectId, commitSha, filePath)
    if (!result) {
      reply.status(400).send({ error: 'Could not read the file from the specified commit.' })
      return
    }

    const maxTextSize = await getMaxTextFileSize()
    if (maxTextSize !== 'unlimited' && result.content != null) {
      const sizeBytes = Buffer.byteLength(result.content, 'utf8')
      if (sizeBytes > maxTextSize) {
        reply.status(413).send({
          error: textSizeViolationMessage({
            filePath,
            sizeBytes,
            limitBytes: maxTextSize,
          }),
        })
        return
      }
    }

    // Apply restored file to the Hocuspocus in-memory doc
    if (hocuspocus) {
      const liveDoc = hocuspocus.documents.get(projectId)
      if (liveDoc) {
        liveDoc.transact(() => {
          const filesMap = liveDoc.getMap<string>('files')
          const safePath = filePath

          // Clear previous text content for this file (use getText to
          // correctly promote AbstractType entries loaded from updates)
          const textKey = `file:${safePath}`
          if (liveDoc.share.has(textKey)) {
            const text = liveDoc.getText(textKey)
            text.delete(0, text.length)
          }

          filesMap.set(safePath, result.meta)
          if (result.content != null) {
            liveDoc.getText(textKey).insert(0, result.content)
          }
        })
        console.info(`[restore-file] applied projectId=${projectId} file=${filePath}`)
      }
    }

    reply.send({ ok: true })
  })

  if (shouldServeFrontend) {
    const frontendDist = path.resolve(import.meta.dirname, '../../frontend/dist')
    const frontendIndexPath = path.join(frontendDist, 'index.html')

    try {
      await access(frontendIndexPath, fsConstants.R_OK)
    } catch {
      console.warn(
        `[server] frontend static serving enabled, but no readable ${frontendIndexPath}. Set SERVE_FRONTEND=false for API-only deployments.`,
      )
      return app
    }

    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    })

    app.setNotFoundHandler(async (req, reply) => {
      const requestPathname = pathnameFromRawUrl(req.raw.url)
      const isApiPath = pathMatchesPrefix(requestPathname, apiRouting.apiRootPath)

      if (
        isApiPath
        || requestPathname === '/health'
        || pathMatchesPrefix(requestPathname, '/assets')
        || pathMatchesPrefix(requestPathname, apiRouting.wsCollaborationPath)
      ) {
        reply.status(404).send({ error: 'Not found' })
        return
      }

      const html = await readFile(frontendIndexPath, 'utf8')
      reply.type('text/html; charset=utf-8').send(html)
    })
  }

  return app
}
