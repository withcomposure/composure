import crypto from 'crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import nodemailer from 'nodemailer'
import { setMaxConcurrentPerCompiler } from './compile-dispatch.js'
import {
  countAdminUsers,
  createInviteToken,
  createPasswordResetToken,
  createUser,
  revokeAllUserRefreshTokens,
  deleteUserAccount,
  expirePasswordResetTokenEarly,
  findUserById,
  findUserForAdmin,
  getHealthStatus,
  getInviteExpiryHours,
  getJobQueueSummary,
  getChatHistoryRetentionDays,
  getLargeFileThresholdChars,
  getMaxConcurrentJobs,
  getMaxFilesPerProject,
  getMaxProjectsPerUser,
  getTrashRetentionDays,
  getMaxTextFileSize,
  getMaxUploadFileSize,
  getPasswordResetExpirySeconds,
  getGuestSignupsEnabled,
  getSignupMode,
  getSmtpSettings,
  getSmtpSettingsMasked,
  listActiveInviteTokens,
  listPasswordResetLinksForUser,
  listRecentJobs,
  listUsersForAdmin,
  revokeInviteToken,
  setInviteExpiryHours,
  setChatHistoryRetentionDays,
  setLargeFileThresholdChars,
  setMaxConcurrentJobs,
  setMaxFilesPerProject,
  setGuestSignupsEnabled,
  setMaxProjectsPerUser,
  setTrashRetentionDays,
  setMaxTextFileSize,
  setMaxUploadFileSize,
  setPasswordResetExpirySeconds,
  setSignupMode,
  updateSmtpSettings,
  updateUserDisplayName,
  updateUserMaxProjects,
  updateUserPasswordHash,
  updateUserRole,
  updateUserSuspended,
  listOAuthProviders,
  upsertOAuthProvider,
  getPasswordLoginEnabled,
  setPasswordLoginEnabled,
  getStrandedUserCounts,
  getStrandedUserDetails,
} from './db/index.js'
import { isValidEmail, isValidUserId } from './security.js'
import { inferRequestOrigin, normalizeOriginHeader, parseTrustedOrigins, parseUrlEnv } from './env.js'

const accessCookieName = 'composure_access'
const refreshCookieName = 'composure_refresh'

function getConfiguredFrontendOrigin(): string | null {
  return parseUrlEnv(process.env.FRONTEND_URL)
}

function getTrustedFrontendOrigins(): Set<string> {
  const trusted = new Set(parseTrustedOrigins(process.env.CORS_ORIGIN, process.env.NODE_ENV))
  const configuredFrontendOrigin = getConfiguredFrontendOrigin()
  if (configuredFrontendOrigin) {
    trusted.add(configuredFrontendOrigin)
  }
  return trusted
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function ensureAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.authUser) {
    reply.status(401).send({ error: 'Authentication required' })
    return false
  }

  if (req.authUser.role !== 'admin') {
    reply.status(403).send({ error: 'Administrator access required' })
    return false
  }

  return true
}

function normalizeRole(value: unknown): 'user' | 'admin' | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'user' || normalized === 'admin') {
    return normalized
  }
  return null
}

function getRequestOrigin(req: FastifyRequest): string {
  const configuredFrontendOrigin = getConfiguredFrontendOrigin()
  if (configuredFrontendOrigin) {
    return configuredFrontendOrigin
  }

  const inferredRequestOrigin = inferRequestOrigin({
    hostHeader: req.headers['x-forwarded-host'] ?? req.headers.host,
    forwardedProtoHeader: req.headers['x-forwarded-proto'],
  })
    ?? `${req.protocol === 'https' ? 'https' : 'http'}://localhost`

  const normalizedOrigin = normalizeOriginHeader(req.headers.origin)
  if (!normalizedOrigin) {
    return inferredRequestOrigin
  }

  const trustedFrontendOrigins = getTrustedFrontendOrigins()
  if (trustedFrontendOrigins.has(normalizedOrigin) || normalizedOrigin === inferredRequestOrigin) {
    return normalizedOrigin
  }

  return inferredRequestOrigin
}

export async function listAdminUsersRoute(
  req: FastifyRequest<{ Querystring: { q?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const search = String(req.query?.q ?? '')
  reply.send({ users: await listUsersForAdmin(search) })
}

interface CreateAdminUserBody {
  email?: string
  displayName?: string
  password?: string
  role?: 'user' | 'admin'
  maxProjects?: number | null
}

export async function createAdminUserRoute(
  req: FastifyRequest<{ Body: CreateAdminUserBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const displayName = String(req.body?.displayName ?? '').trim()
  const password = String(req.body?.password ?? '')
  const role = normalizeRole(req.body?.role) ?? 'user'

  if (!isValidEmail(email)) {
    reply.status(400).send({ error: 'Enter a valid email address.' })
    return
  }

  if (displayName.length < 2) {
    reply.status(400).send({ error: 'Display name must be at least 2 characters.' })
    return
  }

  if (password.length < 8) {
    reply.status(400).send({ error: 'Temporary password must be at least 8 characters.' })
    return
  }

  const created = await createUser({
    email,
    displayName,
    passwordHash: hashPassword(password),
    role,
  })

  if (!created) {
    reply.status(409).send({ error: 'Email is already registered.' })
    return
  }

  if (req.body?.maxProjects !== undefined) {
    const mp = req.body.maxProjects
    await updateUserMaxProjects(created.id, typeof mp === 'number' && Number.isFinite(mp) && mp >= 0 ? mp : null)
  }

  reply.status(201).send({ user: await findUserForAdmin(created.id) })
}

interface UpdateAdminUserBody {
  displayName?: string
  role?: 'user' | 'admin'
  newPassword?: string
  suspended?: boolean
  maxProjects?: number | null
}

export async function updateAdminUserRoute(
  req: FastifyRequest<{ Params: { userId?: string }; Body: UpdateAdminUserBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const userId = String(req.params?.userId ?? '').trim()
  if (!isValidUserId(userId)) {
    reply.status(400).send({ error: 'Invalid user id.' })
    return
  }

  const existing = await findUserForAdmin(userId)
  if (!existing) {
    reply.status(404).send({ error: 'User not found.' })
    return
  }

  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'email')) {
    reply.status(400).send({ error: 'Email cannot be changed from this endpoint.' })
    return
  }

  let passwordChanged = false

  if (typeof req.body?.displayName === 'string') {
    const displayName = req.body.displayName.trim()
    if (displayName.length < 2) {
      reply.status(400).send({ error: 'Display name must be at least 2 characters.' })
      return
    }
    await updateUserDisplayName(userId, displayName)
  }

  if (req.body?.role != null) {
    const role = normalizeRole(req.body.role)
    if (!role) {
      reply.status(400).send({ error: 'Invalid role.' })
      return
    }

    if (existing.role === 'admin' && role !== 'admin' && (await countAdminUsers()) <= 1) {
      reply.status(400).send({ error: 'At least one administrator account must remain.' })
      return
    }

    if (req.authUser?.id === userId && role !== 'admin') {
      reply.status(400).send({ error: 'You cannot demote your own administrator account.' })
      return
    }

    await updateUserRole(userId, role)
  }

  if (typeof req.body?.newPassword === 'string' && req.body.newPassword.length > 0) {
    if (req.body.newPassword.length < 8) {
      reply.status(400).send({ error: 'New password must be at least 8 characters.' })
      return
    }
    await updateUserPasswordHash(userId, hashPassword(req.body.newPassword))
    passwordChanged = true
  }

  if (typeof req.body?.suspended === 'boolean') {
    if (existing.role === 'admin' && req.body.suspended && (await countAdminUsers()) <= 1) {
      reply.status(400).send({ error: 'At least one active administrator account must remain.' })
      return
    }

    if (req.authUser?.id === userId && req.body.suspended) {
      reply.status(400).send({ error: 'You cannot suspend your own account.' })
      return
    }

    await updateUserSuspended(userId, req.body.suspended)
  }

  if (req.body?.maxProjects !== undefined) {
    const mp = req.body.maxProjects
    await updateUserMaxProjects(userId, typeof mp === 'number' && Number.isFinite(mp) && mp >= 0 ? mp : null)
  }

  let forceRelogin = false
  if (passwordChanged) {
    await revokeAllUserRefreshTokens(userId)
    forceRelogin = req.authUser?.id === userId
    if (forceRelogin) {
      reply.clearCookie(accessCookieName, { path: '/' })
      reply.clearCookie(refreshCookieName, { path: '/' })
    }
  }

  const next = await findUserForAdmin(userId)
  reply.send({ user: next, forceRelogin })
}

interface DeleteAdminUserBody {
  confirmEmail?: string
}

export async function deleteAdminUserRoute(
  req: FastifyRequest<{ Params: { userId?: string }; Body: DeleteAdminUserBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const userId = String(req.params?.userId ?? '').trim()
  if (!isValidUserId(userId)) {
    reply.status(400).send({ error: 'Invalid user id.' })
    return
  }

  const existing = await findUserForAdmin(userId)
  if (!existing) {
    reply.status(404).send({ error: 'User not found.' })
    return
  }

  if (req.authUser?.id === userId) {
    reply.status(400).send({ error: 'Delete your own account from Settings.' })
    return
  }

  const confirmEmail = String(req.body?.confirmEmail ?? '').trim().toLowerCase()
  if (confirmEmail !== existing.email.toLowerCase()) {
    reply.status(400).send({ error: 'Confirmation email does not match.' })
    return
  }

  if (existing.role === 'admin' && (await countAdminUsers()) <= 1) {
    reply.status(400).send({ error: 'At least one administrator account must remain.' })
    return
  }

  const removed = await deleteUserAccount(userId)
  if (!removed) {
    reply.status(500).send({ error: 'Failed to delete user.' })
    return
  }

  reply.send({ ok: true, forceRelogin: req.authUser?.id === userId })
}

export async function getAdminServerSettingsRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const seconds = await getPasswordResetExpirySeconds()
  reply.send({
    passwordResetExpiryHours: Math.round((seconds / 3600) * 100) / 100,
    signupMode: await getSignupMode(),
    guestSignupsEnabled: await getGuestSignupsEnabled(),
    inviteExpiryHours: await getInviteExpiryHours(),
    maxProjectsPerUser: await getMaxProjectsPerUser(),
    maxConcurrentJobs: await getMaxConcurrentJobs(),
    maxUploadFileSizeBytes: await getMaxUploadFileSize(),
    maxTextFileSizeBytes: await getMaxTextFileSize(),
    maxFilesPerProject: await getMaxFilesPerProject(),
    trashRetentionDays: await getTrashRetentionDays(),
    largeFileThresholdChars: await getLargeFileThresholdChars(),
    chatHistoryRetentionDays: await getChatHistoryRetentionDays(),
  })
}

interface UpdateAdminServerSettingsBody {
  passwordResetExpiryHours?: number
  signupMode?: string
  guestSignupsEnabled?: boolean
  inviteExpiryHours?: number
  maxProjectsPerUser?: string
  maxConcurrentJobs?: number
  maxUploadFileSizeBytes?: number | 'unlimited'
  maxTextFileSizeBytes?: number | 'unlimited'
  maxFilesPerProject?: number | 'unlimited'
  trashRetentionDays?: number
  largeFileThresholdChars?: number
  chatHistoryRetentionDays?: number | 'unlimited' | 'off'
}

export async function updateAdminServerSettingsRoute(
  req: FastifyRequest<{ Body: UpdateAdminServerSettingsBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  if (req.body?.passwordResetExpiryHours != null) {
    const rawHours = Number(req.body.passwordResetExpiryHours)
    if (!Number.isFinite(rawHours)) {
      reply.status(400).send({ error: 'passwordResetExpiryHours must be a number.' })
      return
    }
    await setPasswordResetExpirySeconds(Math.round(rawHours * 3600))
  }

  if (req.body?.signupMode != null) {
    const mode = String(req.body.signupMode).trim()
    if (mode !== 'open' && mode !== 'invite-only') {
      reply.status(400).send({ error: 'signupMode must be "open" or "invite-only".' })
      return
    }
    await setSignupMode(mode)
  }

  if (req.body?.guestSignupsEnabled != null) {
    await setGuestSignupsEnabled(Boolean(req.body.guestSignupsEnabled))
  }

  if (req.body?.inviteExpiryHours != null) {
    const rawHours = Number(req.body.inviteExpiryHours)
    if (!Number.isFinite(rawHours) || rawHours < 1) {
      reply.status(400).send({ error: 'inviteExpiryHours must be a number >= 1.' })
      return
    }
    await setInviteExpiryHours(rawHours)
  }

  if (req.body?.maxProjectsPerUser != null) {
    await setMaxProjectsPerUser(String(req.body.maxProjectsPerUser))
  }

  if (req.body?.maxConcurrentJobs != null) {
    const raw = Number(req.body.maxConcurrentJobs)
    if (!Number.isFinite(raw) || raw < 1) {
      reply.status(400).send({ error: 'maxConcurrentJobs must be a number >= 1.' })
      return
    }
    const clamped = await setMaxConcurrentJobs(raw)
    setMaxConcurrentPerCompiler(clamped)
  }

  if (req.body?.maxUploadFileSizeBytes != null) {
    const raw = req.body.maxUploadFileSizeBytes
    if (raw !== 'unlimited' && (!Number.isFinite(Number(raw)) || Number(raw) < 1)) {
      reply.status(400).send({ error: 'maxUploadFileSizeBytes must be a positive number or "unlimited".' })
      return
    }
    await setMaxUploadFileSize(raw === 'unlimited' ? 'unlimited' : Number(raw))
  }

  if (req.body?.maxTextFileSizeBytes != null) {
    const raw = req.body.maxTextFileSizeBytes
    if (raw !== 'unlimited' && (!Number.isFinite(Number(raw)) || Number(raw) < 1)) {
      reply.status(400).send({ error: 'maxTextFileSizeBytes must be a positive number or "unlimited".' })
      return
    }
    await setMaxTextFileSize(raw === 'unlimited' ? 'unlimited' : Number(raw))
  }

  if (req.body?.maxFilesPerProject != null) {
    const raw = req.body.maxFilesPerProject
    if (raw !== 'unlimited' && (!Number.isFinite(Number(raw)) || Number(raw) < 1)) {
      reply.status(400).send({ error: 'maxFilesPerProject must be a positive number or "unlimited".' })
      return
    }
    await setMaxFilesPerProject(raw === 'unlimited' ? 'unlimited' : Number(raw))
  }

  if (req.body?.trashRetentionDays != null) {
    const raw = Number(req.body.trashRetentionDays)
    if (!Number.isFinite(raw) || raw < 1) {
      reply.status(400).send({ error: 'trashRetentionDays must be a number >= 1.' })
      return
    }
    await setTrashRetentionDays(raw)
  }

  if (req.body?.largeFileThresholdChars != null) {
    const raw = Number(req.body.largeFileThresholdChars)
    if (!Number.isFinite(raw) || raw < 100_000) {
      reply.status(400).send({ error: 'largeFileThresholdChars must be a number >= 100000.' })
      return
    }
    await setLargeFileThresholdChars(raw)
  }

  if (req.body?.chatHistoryRetentionDays != null) {
    const raw = req.body.chatHistoryRetentionDays
    if (raw !== 'unlimited' && raw !== 'off' && (!Number.isFinite(Number(raw)) || Number(raw) < 1)) {
      reply.status(400).send({ error: 'chatHistoryRetentionDays must be a positive number, "off", or "unlimited".' })
      return
    }
    await setChatHistoryRetentionDays(raw === 'unlimited' || raw === 'off' ? raw : Number(raw))
  }

  const seconds = await getPasswordResetExpirySeconds()
  reply.send({
    passwordResetExpiryHours: Math.round((seconds / 3600) * 100) / 100,
    signupMode: await getSignupMode(),
    guestSignupsEnabled: await getGuestSignupsEnabled(),
    inviteExpiryHours: await getInviteExpiryHours(),
    maxProjectsPerUser: await getMaxProjectsPerUser(),
    maxConcurrentJobs: await getMaxConcurrentJobs(),
    maxUploadFileSizeBytes: await getMaxUploadFileSize(),
    maxTextFileSizeBytes: await getMaxTextFileSize(),
    maxFilesPerProject: await getMaxFilesPerProject(),
    trashRetentionDays: await getTrashRetentionDays(),
    largeFileThresholdChars: await getLargeFileThresholdChars(),
    chatHistoryRetentionDays: await getChatHistoryRetentionDays(),
  })
}

export async function generatePasswordResetLinkRoute(
  req: FastifyRequest<{ Params: { userId?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const userId = String(req.params?.userId ?? '').trim()
  if (!isValidUserId(userId)) {
    reply.status(400).send({ error: 'Invalid user id.' })
    return
  }

  const user = await findUserById(userId)
  if (!user) {
    reply.status(404).send({ error: 'User not found.' })
    return
  }

  const expirySeconds = await getPasswordResetExpirySeconds()
  const token = await createPasswordResetToken(userId, expirySeconds)
  const url = `${getRequestOrigin(req)}/reset-password?token=${encodeURIComponent(token.token)}`

  reply.send({
    url,
    expiresAt: token.expiresAt,
  })
}

export async function listPasswordResetLinksRoute(
  req: FastifyRequest<{ Params: { userId?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const userId = String(req.params?.userId ?? '').trim()
  if (!isValidUserId(userId)) {
    reply.status(400).send({ error: 'Invalid user id.' })
    return
  }

  const user = await findUserById(userId)
  if (!user) {
    reply.status(404).send({ error: 'User not found.' })
    return
  }

  reply.send({ links: await listPasswordResetLinksForUser(userId) })
}

export async function expirePasswordResetLinkRoute(
  req: FastifyRequest<{ Params: { token?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const token = String(req.params?.token ?? '').trim()
  if (!token) {
    reply.status(400).send({ error: 'Invalid token.' })
    return
  }

  const expired = await expirePasswordResetTokenEarly(token)
  if (!expired) {
    reply.status(409).send({ error: 'Token is already used or expired.' })
    return
  }

  reply.send({ ok: true })
}

// ---------------------------------------------------------------------------
// Invite token routes
// ---------------------------------------------------------------------------

interface CreateInviteBody {
  email?: string
}

export async function createInviteTokenRoute(
  req: FastifyRequest<{ Body: CreateInviteBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null
  if (email && !isValidEmail(email)) {
    reply.status(400).send({ error: 'Invalid email address.' })
    return
  }

  const result = await createInviteToken(req.authUser!.id, email)
  const url = `${getRequestOrigin(req)}/invite?token=${encodeURIComponent(result.token)}`

  reply.status(201).send({
    url,
    token: result.token,
    expiresAt: result.expiresAt,
  })
}

export async function listInviteTokensRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!ensureAdmin(req, reply)) return
  reply.send({ invites: await listActiveInviteTokens() })
}

export async function revokeInviteTokenRoute(
  req: FastifyRequest<{ Params: { token?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const token = String(req.params?.token ?? '').trim()
  if (!token) {
    reply.status(400).send({ error: 'Invalid token.' })
    return
  }

  const revoked = await revokeInviteToken(token)
  if (!revoked) {
    reply.status(409).send({ error: 'Token is already used or does not exist.' })
    return
  }

  reply.send({ ok: true })
}

// ---------------------------------------------------------------------------
// SMTP settings routes
// ---------------------------------------------------------------------------

export async function getSmtpSettingsRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!ensureAdmin(req, reply)) return
  reply.send(await getSmtpSettingsMasked())
}

interface UpdateSmtpBody {
  host?: string
  port?: number
  username?: string
  password?: string
  senderName?: string
  senderAddress?: string
  encryption?: string
}

export async function updateSmtpSettingsRoute(
  req: FastifyRequest<{ Body: UpdateSmtpBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const body = req.body ?? {}
  await updateSmtpSettings({
    host: typeof body.host === 'string' ? body.host.trim() : undefined,
    port: typeof body.port === 'number' && Number.isFinite(body.port) ? body.port : undefined,
    username: typeof body.username === 'string' ? body.username : undefined,
    password: typeof body.password === 'string' ? body.password : undefined,
    senderName: typeof body.senderName === 'string' ? body.senderName.trim() : undefined,
    senderAddress: typeof body.senderAddress === 'string' ? body.senderAddress.trim().toLowerCase() : undefined,
    encryption: typeof body.encryption === 'string' ? body.encryption : undefined,
  })

  reply.send(await getSmtpSettingsMasked())
}

interface SendTestEmailBody {
  to?: string
}

export async function sendTestEmailRoute(
  req: FastifyRequest<{ Body: SendTestEmailBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const to = String(req.body?.to ?? '').trim().toLowerCase()
  if (!isValidEmail(to)) {
    reply.status(400).send({ error: 'Provide a valid recipient email address.' })
    return
  }

  const smtp = await getSmtpSettings()
  if (!smtp.host) {
    reply.status(400).send({ error: 'SMTP host is not configured.' })
    return
  }

  const transportOptions: nodemailer.TransportOptions & {
    host: string
    port: number
    secure: boolean
    auth?: { user: string; pass: string }
    tls?: { rejectUnauthorized: boolean }
  } = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.encryption === 'tls',
    tls: { rejectUnauthorized: true },
  }

  if (smtp.encryption === 'starttls') {
    transportOptions.secure = false
  }

  if (smtp.username || smtp.password) {
    transportOptions.auth = { user: smtp.username, pass: smtp.password }
  }

  const transporter = nodemailer.createTransport(transportOptions)

  try {
    await transporter.sendMail({
      from: smtp.senderAddress
        ? `${smtp.senderName || 'Composure'} <${smtp.senderAddress}>`
        : undefined,
      to,
      subject: 'Composure Test Email',
      text: 'This is a test email sent from your Composure server to verify the SMTP configuration.',
      html: '<p>This is a test email sent from your <strong>Composure</strong> server to verify the SMTP configuration.</p>',
    })
    reply.send({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    reply.status(502).send({ error: `Failed to send test email: ${message}` })
  }
}

// ---------------------------------------------------------------------------
// Monitoring routes
// ---------------------------------------------------------------------------

export async function getJobSummaryRoute(
  req: FastifyRequest<{ Querystring: { seconds?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return
  const seconds = Math.max(60, Math.min(86400, Number.parseInt(String(req.query?.seconds ?? '86400'), 10) || 86400))
  reply.send({
    summary: await getJobQueueSummary(seconds),
    health: await getHealthStatus(seconds),
  })
}

export async function listRecentJobsRoute(
  req: FastifyRequest<{ Querystring: { seconds?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return
  const seconds = Math.max(60, Math.min(86400, Number.parseInt(String(req.query?.seconds ?? '86400'), 10) || 86400))
  reply.send({ jobs: await listRecentJobs(seconds), health: await getHealthStatus(seconds) })
}

// ---------------------------------------------------------------------------
// Login providers routes (admin)
// ---------------------------------------------------------------------------

export async function getLoginProvidersRoute(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return
  const providers = await listOAuthProviders()
  const passwordEnabled = await getPasswordLoginEnabled()
  reply.send({
    providers: [
      { provider: 'password', enabled: passwordEnabled, hasCredentials: true },
      ...providers.map((p) => ({
        provider: p.provider,
        enabled: p.enabled,
        hasCredentials: Boolean(p.client_id && p.client_secret),
        clientId: p.client_id ?? '',
      })),
    ],
  })
}

interface UpdateLoginProvidersBody {
  providers: Array<{
    provider: string
    enabled: boolean
    clientId?: string
    clientSecret?: string
  }>
}

export async function updateLoginProvidersRoute(
  req: FastifyRequest<{ Body: UpdateLoginProvidersBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const items = req.body?.providers
  if (!Array.isArray(items)) {
    reply.status(400).send({ error: 'providers array is required' })
    return
  }

  const existingProviders = await listOAuthProviders()
  const nextOAuthEnabled = new Map(existingProviders.map((provider) => [provider.provider, provider.enabled]))
  let passwordEnabled = await getPasswordLoginEnabled()

  for (const item of items) {
    if (item.provider === 'password') {
      passwordEnabled = Boolean(item.enabled)
      continue
    }
    nextOAuthEnabled.set(item.provider, Boolean(item.enabled))
  }

  const enabledProviderCount =
    (passwordEnabled ? 1 : 0) + Array.from(nextOAuthEnabled.values()).filter((enabled) => enabled).length

  if (enabledProviderCount === 0) {
    reply.status(400).send({ error: 'At least one login provider must remain enabled.' })
    return
  }

  for (const item of items) {
    if (item.provider === 'password') {
      continue
    }

    await upsertOAuthProvider(
      item.provider,
      item.enabled,
      item.clientId ?? null,
      item.clientSecret ?? null,
    )
  }

  await setPasswordLoginEnabled(passwordEnabled)

  reply.send({ ok: true })
}

export async function checkStrandedUsersRoute(
  req: FastifyRequest<{ Body: { providersToDisable: string[] } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const providersToDisable = req.body?.providersToDisable
  if (!Array.isArray(providersToDisable)) {
    reply.status(400).send({ error: 'providersToDisable array is required' })
    return
  }

  const { strandedUserIds, totalUsers } = await getStrandedUserCounts(providersToDisable)

  // Check if admin themselves would be stranded
  const adminStranded = req.authUser ? strandedUserIds.includes(req.authUser.id) : false

  reply.send({
    strandedCount: strandedUserIds.length,
    totalUsers,
    adminStranded,
    allStranded: strandedUserIds.length === totalUsers,
    strandedUserIds,
  })
}

export async function getStrandedUsersCsvRoute(
  req: FastifyRequest<{ Body: { userIds: string[] } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const userIds = req.body?.userIds
  if (!Array.isArray(userIds)) {
    reply.status(400).send({ error: 'userIds array is required' })
    return
  }

  const details = await getStrandedUserDetails(userIds)
  const csv = ['id,email,displayName', ...details.map((d) => `${d.id},${d.email},"${d.displayName.replace(/"/g, '""')}"`)].join('\n')

  reply.header('Content-Type', 'text/csv')
  reply.header('Content-Disposition', 'attachment; filename="stranded-users.csv"')
  reply.send(csv)
}

interface TestProviderBody {
  provider: string
  clientId: string
  clientSecret: string
}

export async function testLoginProviderRoute(
  req: FastifyRequest<{ Body: TestProviderBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!ensureAdmin(req, reply)) return

  const provider = String(req.body?.provider ?? '').trim().toLowerCase()
  const clientId = String(req.body?.clientId ?? '').trim()
  const requestedClientSecret = String(req.body?.clientSecret ?? '')

  if (!provider || !clientId) {
    reply.status(400).send({ error: 'provider and clientId are required' })
    return
  }

  let clientSecret = requestedClientSecret
  if (clientSecret === '__keep__') {
    const existingProvider = (await listOAuthProviders()).find((item) => item.provider === provider)
    if (!existingProvider?.client_secret) {
      reply.status(400).send({ error: `Saved client secret not found for provider: ${provider}` })
      return
    }
    clientSecret = existingProvider.client_secret
  }

  if (!clientSecret) {
    reply.status(400).send({ error: 'clientSecret is required' })
    return
  }

  try {
    if (provider === 'github') {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: '__test__' }),
      })
      const body = (await res.json()) as { error?: string }
      if (body.error === 'bad_verification_code') {
        reply.send({ ok: true })
        return
      }
      reply.send({ ok: false, error: body.error ?? 'Unknown error from GitHub' })
      return
    }

    if (provider === 'google') {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: '__test__',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: 'https://localhost/callback',
          grant_type: 'authorization_code',
        }),
      })
      const body = (await res.json()) as { error?: string; error_description?: string }
      if (body.error === 'invalid_grant' || body.error === 'redirect_uri_mismatch') {
        reply.send({ ok: true })
        return
      }
      reply.send({ ok: false, error: body.error_description ?? body.error ?? 'Unknown error from Google' })
      return
    }

    if (provider === 'orcid') {
      const res = await fetch('https://orcid.org/oauth/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: '__test__',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: 'https://localhost/callback',
          grant_type: 'authorization_code',
        }).toString(),
      })
      const body = (await res.json()) as { error?: string; error_description?: string }
      if (body.error === 'invalid_grant') {
        reply.send({ ok: true })
        return
      }
      reply.send({ ok: false, error: body.error_description ?? body.error ?? 'Unknown error from ORCID' })
      return
    }

    reply.status(400).send({ error: `Unknown provider: ${provider}` })
  } catch (err) {
    reply.send({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' })
  }
}
