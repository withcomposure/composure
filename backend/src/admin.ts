import crypto from 'crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import nodemailer from 'nodemailer'
import { setMaxConcurrentPerCompiler } from './compile.dispatch.js'
import {
  countAdminUsers,
  createInviteToken,
  createPasswordResetToken,
  createUser,
  deleteAllUserSessions,
  deleteUserAccount,
  expirePasswordResetTokenEarly,
  findUserById,
  findUserForAdmin,
  getHealthStatus,
  getInviteExpiryHours,
  getJobQueueSummary,
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
} from './db/index.js'
import { isValidEmail, isValidUserId } from './security.js'

const SESSION_COOKIE_NAME = 'pressmark_session'

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
  const originHeader = req.headers.origin
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader
  if (typeof origin === 'string' && origin.trim().length > 0) {
    return origin.trim()
  }

  const forwardedProtoRaw = req.headers['x-forwarded-proto']
  const forwardedProto = Array.isArray(forwardedProtoRaw) ? forwardedProtoRaw[0] : forwardedProtoRaw
  const proto = typeof forwardedProto === 'string' && forwardedProto.trim().length > 0
    ? forwardedProto.split(',')[0].trim()
    : req.protocol

  const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  return `${proto}://${String(host)}`
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
    await deleteAllUserSessions(userId)
    forceRelogin = req.authUser?.id === userId
    if (forceRelogin) {
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
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
  const url = `${getRequestOrigin(req)}/#/reset-password?token=${encodeURIComponent(token.token)}`

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
  const url = `${getRequestOrigin(req)}/#/invite?token=${encodeURIComponent(result.token)}`

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
        ? `${smtp.senderName || 'Pressmark'} <${smtp.senderAddress}>`
        : undefined,
      to,
      subject: 'Pressmark Test Email',
      text: 'This is a test email sent from your Pressmark server to verify the SMTP configuration.',
      html: '<p>This is a test email sent from your <strong>Pressmark</strong> server to verify the SMTP configuration.</p>',
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
