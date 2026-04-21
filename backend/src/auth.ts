import crypto from 'crypto'
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Principal, SessionUser } from './db/index.js'
import {
  countUsers,
  createSession,
  createUser,
  countUserAuthMethods,
  deleteUserAccount,
  deleteSession,
  deleteUserSession,
  disableUserPasswordAuthMethod,
  findUserByEmail,
  getEnabledOAuthProviders,
  getGuestSignupsEnabled,
  getInviteTokenState,
  getPasswordLoginEnabled,
  getPasswordResetTokenState,
  getSignupMode,
  getUserPreferences,
  listSessionsForUser,
  markInviteTokenUsed,
  markPasswordResetTokenUsed,
  markUserLoggedIn,
  migrateGuestProjectsToUser,
  migrateGuestRecentsToUser,
  migrateGuestWorkspaceStatesToUser,
  resolveSession,
  softDeleteProjectsOwnedByUser,
  updatePendingInvitesForUser,
  updateUserPasswordHash,
  updateUserPreferences,
  updateUserDisplayName,
  updateUserEmail,
  updateUserProfileImage,
} from './db/index.js'
import { isProductionEnv } from './env.js'
import { createUid } from './ids.js'
import { isValidEmail } from './security.js'

const isProd = isProductionEnv(process.env.NODE_ENV)

export const GUEST_COOKIE_NAME = 'guest_id'
export const SESSION_COOKIE_NAME = 'composure_session'

const guestCookieMaxAgeSeconds = 90 * 24 * 60 * 60
const sessionMaxAgeSeconds = 30 * 24 * 60 * 60
const maxAvatarImageBytes = Number.parseInt(process.env.MAX_AVATAR_IMAGE_BYTES ?? '262144', 10)

function isLocalHostname(hostname: string | undefined): boolean {
  if (!hostname) return false
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

function shouldUseSecureCookies(req: FastifyRequest): boolean {
  if (!isProd) return false

  const forwardedProto = req.headers['x-forwarded-proto']
  const protoHeader = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto
  if (typeof protoHeader === 'string' && protoHeader.split(',')[0].trim().toLowerCase() === 'https') {
    return true
  }

  const hostHeader = req.headers.host
  const host = typeof hostHeader === 'string' ? hostHeader.split(':')[0] : undefined
  if (isLocalHostname(host)) {
    return false
  }

  return req.protocol === 'https'
}

export interface AuthSessionResponse {
  authenticated: boolean
  user: SessionUser | null
  principal: Principal
  guestRetentionDays: number
  userCount: number
  signupMode: 'open' | 'invite-only'
  guestSignupsEnabled: boolean
  enabledLoginProviders: string[]
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: SessionUser | null
    principal: Principal
  }
}

function parseCookieHeader(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  const cookies: Record<string, string> = {}

  for (const segment of raw.split(';')) {
    const [key, ...rest] = segment.trim().split('=')
    if (!key) continue
    cookies[key] = decodeURIComponent(rest.join('='))
  }

  return cookies
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, passwordHash: string | null | undefined): boolean {
  if (!passwordHash) return false
  const [salt, expectedHash] = passwordHash.split(':')
  if (!salt || !expectedHash) return false

  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(expectedHash, 'hex')

  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function getCookieValue(req: FastifyRequest, name: string): string | undefined {
  const value = req.cookies?.[name]
  return typeof value === 'string' ? value : undefined
}

function base64PayloadBytes(encoded: string): number {
  const paddingMatch = encoded.match(/=+$/)
  const padding = paddingMatch ? paddingMatch[0].length : 0
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding)
}

function validateProfileImageUrl(value: string): { ok: true } | { ok: false; error: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(value)
  if (!match) {
    return { ok: false, error: 'Profile photo must be a PNG, JPEG, or WEBP data URL.' }
  }

  const payload = match[2]
  if (!payload) {
    return { ok: false, error: 'Profile photo payload is empty.' }
  }

  const bytes = base64PayloadBytes(payload)
  if (bytes > maxAvatarImageBytes) {
    return {
      ok: false,
      error: `Profile photo exceeds the ${Math.floor(maxAvatarImageBytes / 1024)}KB size limit.`,
    }
  }

  return { ok: true }
}

export function maybeSetGuestCookie(req: FastifyRequest, reply: FastifyReply, allowNew = true): string | null {
  const existing = getCookieValue(req, GUEST_COOKIE_NAME)?.trim()
  if (existing) return existing

  if (!allowNew) return null

  const guestId = createUid()
  reply.setCookie(GUEST_COOKIE_NAME, guestId, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: guestCookieMaxAgeSeconds,
    secure: shouldUseSecureCookies(req),
    path: '/',
  })

  return guestId
}

export async function resolvePrincipalFromCookieHeader(cookieHeader: string | undefined): Promise<Principal> {
  const cookies = parseCookieHeader(cookieHeader)
  const guestId = cookies[GUEST_COOKIE_NAME] ?? null
  const sessionId = cookies[SESSION_COOKIE_NAME]

  if (sessionId) {
    const user = await resolveSession(sessionId)
    if (user) {
      return { userId: user.id, guestId }
    }
  }

  return { userId: null, guestId }
}

export const authHook: preHandlerHookHandler = async (req, reply) => {
  const guestSignupsEnabled = await getGuestSignupsEnabled()
  const guestId = maybeSetGuestCookie(req, reply, guestSignupsEnabled)
  const sessionId = getCookieValue(req, SESSION_COOKIE_NAME) ?? ''

  let authUser: SessionUser | null = null
  if (sessionId) {
    authUser = await resolveSession(sessionId)
  }

  req.authUser = authUser
  req.principal = {
    userId: authUser?.id ?? null,
    guestId,
  }
}

async function makeSessionPayload(req: FastifyRequest): Promise<AuthSessionResponse> {
  const enabledProviders = await getEnabledOAuthProviders()
  return {
    authenticated: Boolean(req.authUser),
    user: req.authUser,
    principal: req.principal,
    guestRetentionDays: Math.round(guestCookieMaxAgeSeconds / (24 * 60 * 60)),
    userCount: await countUsers(),
    signupMode: await getSignupMode(),
    guestSignupsEnabled: await getGuestSignupsEnabled(),
    enabledLoginProviders: enabledProviders.map((p) => p.provider),
  }
}

export async function authSessionRoute(req: FastifyRequest): Promise<AuthSessionResponse> {
  return await makeSessionPayload(req)
}

interface AuthBody {
  email?: string
  password?: string
  displayName?: string
  inviteToken?: string
}

export async function signupRoute(req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply): Promise<void> {
  if (!(await getPasswordLoginEnabled())) {
    reply.status(403).send({ error: 'Password signup is disabled.' })
    return
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const displayName = String(req.body?.displayName ?? '').trim()
  const inviteToken = req.body?.inviteToken ? String(req.body.inviteToken).trim() : null

  // Enforce invite-only mode (skip for first-ever user bootstrap)
  const userCount = await countUsers()
  if (userCount > 0 && (await getSignupMode()) === 'invite-only') {
    if (!inviteToken) {
      reply.status(403).send({ error: 'Signups are currently invite-only.' })
      return
    }
    const tokenState = await getInviteTokenState(inviteToken)
    if (!tokenState || tokenState.usedAt != null || tokenState.expiresAt <= Math.floor(Date.now() / 1000)) {
      reply.status(403).send({ error: 'Invalid or expired invite token.' })
      return
    }
    if (tokenState.email && tokenState.email !== email) {
      reply.status(403).send({ error: 'This invite was issued for a different email address.' })
      return
    }
  }

  if (!email || !isValidEmail(email)) {
    reply.status(400).send({ error: 'Valid email is required' })
    return
  }

  if (password.length < 8) {
    reply.status(400).send({ error: 'Password must be at least 8 characters' })
    return
  }

  if (displayName.length < 2) {
    reply.status(400).send({ error: 'Display name must be at least 2 characters' })
    return
  }

  const passwordHash = hashPassword(password)
  const created = await createUser({
    email,
    passwordHash,
    displayName,
  })

  if (!created) {
    reply.status(409).send({ error: 'Email is already registered' })
    return
  }

  // Consume invite token after successful account creation
  if (inviteToken) {
    await markInviteTokenUsed(inviteToken)
  }

  const session = await createSession(created.id, sessionMaxAgeSeconds)
  await markUserLoggedIn(created.id)
  reply.setCookie(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: sessionMaxAgeSeconds,
    secure: shouldUseSecureCookies(req),
    path: '/',
  })

  const guestId = req.principal.guestId
  if (guestId) {
    const moved = await migrateGuestProjectsToUser(guestId, created.id)
    const movedRecents = await migrateGuestRecentsToUser(guestId, created.id)
    const movedWorkspaceStates = await migrateGuestWorkspaceStatesToUser(guestId, created.id)
    console.info(`[auth] migrated guest projects guestId=${guestId} userId=${created.id} count=${moved}`)
    console.info(`[auth] migrated guest recents guestId=${guestId} userId=${created.id} count=${movedRecents}`)
    console.info(`[auth] migrated guest workspace states guestId=${guestId} userId=${created.id} count=${movedWorkspaceStates}`)
    reply.clearCookie(GUEST_COOKIE_NAME, { path: '/' })
    req.principal.guestId = null
  }

  const acceptedInvites = await updatePendingInvitesForUser(created.id, created.email)
  if (acceptedInvites > 0) {
    console.info(`[auth] accepted pending invites userId=${created.id} count=${acceptedInvites}`)
  }

  req.authUser = created
  req.principal.userId = created.id

  reply.status(201).send(await makeSessionPayload(req))
}

export async function loginRoute(req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply): Promise<void> {
  if (!(await getPasswordLoginEnabled())) {
    reply.status(403).send({ error: 'Password login is disabled.' })
    return
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')

  if (!email || !password) {
    reply.status(400).send({ error: 'Email and password are required' })
    return
  }

  const user = await findUserByEmail(email)
  if (user?.is_suspended === true) {
    reply.status(403).send({ error: 'Credentials expired. Contact a server administrator.' })
    return
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    reply.status(401).send({ error: 'Invalid credentials' })
    return
  }

  const session = await createSession(user.id, sessionMaxAgeSeconds)
  await markUserLoggedIn(user.id)
  reply.setCookie(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: sessionMaxAgeSeconds,
    secure: shouldUseSecureCookies(req),
    path: '/',
  })

  const guestId = req.principal.guestId
  if (guestId) {
    const moved = await migrateGuestProjectsToUser(guestId, user.id)
    const movedRecents = await migrateGuestRecentsToUser(guestId, user.id)
    const movedWorkspaceStates = await migrateGuestWorkspaceStatesToUser(guestId, user.id)
    console.info(`[auth] migrated guest projects on-login guestId=${guestId} userId=${user.id} count=${moved}`)
    console.info(`[auth] migrated guest recents on-login guestId=${guestId} userId=${user.id} count=${movedRecents}`)
    console.info(`[auth] migrated guest workspace states on-login guestId=${guestId} userId=${user.id} count=${movedWorkspaceStates}`)
    reply.clearCookie(GUEST_COOKIE_NAME, { path: '/' })
    req.principal.guestId = null
  }

  const acceptedInvites = await updatePendingInvitesForUser(user.id, user.email)
  if (acceptedInvites > 0) {
    console.info(`[auth] accepted pending invites on-login userId=${user.id} count=${acceptedInvites}`)
  }

  req.authUser = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    role: user.role,
  }
  req.principal.userId = user.id

  reply.send(await makeSessionPayload(req))
}

export async function logoutRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessionId = getCookieValue(req, SESSION_COOKIE_NAME) ?? ''
  if (sessionId) {
    await deleteSession(sessionId)
  }

  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
  req.authUser = null
  req.principal.userId = null

  // Keep/refresh guest identity after logout so guest dashboards keep working.
  const guestSignupsEnabled = await getGuestSignupsEnabled()
  req.principal.guestId = maybeSetGuestCookie(req, reply, guestSignupsEnabled)

  reply.send(await makeSessionPayload(req))
}

interface UpdateProfileBody {
  email?: string
  displayName?: string
  profileImageUrl?: string | null
}

export async function updateProfileRoute(
  req: FastifyRequest<{ Body: UpdateProfileBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!req.authUser) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const displayName = String(req.body?.displayName ?? '').trim()
  const profileImageUrlRaw = req.body?.profileImageUrl
  let profileImageUrl: string | null = null

  if (typeof profileImageUrlRaw === 'string' && profileImageUrlRaw.trim().length > 0) {
    profileImageUrl = profileImageUrlRaw.trim()
    const validation = validateProfileImageUrl(profileImageUrl)
    if (!validation.ok) {
      reply.status(400).send({ error: validation.error })
      return
    }
  }

  if (!email || !isValidEmail(email)) {
    reply.status(400).send({ error: 'Valid email is required' })
    return
  }

  if (displayName.length < 2) {
    reply.status(400).send({ error: 'Display name must be at least 2 characters' })
    return
  }

  const existing = await findUserByEmail(email)
  if (existing && existing.id !== req.authUser.id) {
    reply.status(409).send({ error: 'Email is already registered' })
    return
  }

  const updated = await updateUserDisplayName(req.authUser.id, displayName)
  if (!updated) {
    reply.status(404).send({ error: 'User not found' })
    return
  }

  await updateUserEmail(req.authUser.id, email)

  // Update profile image if field was explicitly included in the request body
  const profileImageExplicit = req.body != null && Object.prototype.hasOwnProperty.call(req.body, 'profileImageUrl')
  if (profileImageExplicit) {
    await updateUserProfileImage(req.authUser.id, profileImageUrl)
  }

  const acceptedInvites = await updatePendingInvitesForUser(req.authUser.id, email)
  if (acceptedInvites > 0) {
    console.info(`[auth] accepted pending invites on-profile-update userId=${req.authUser.id} count=${acceptedInvites}`)
  }

  req.authUser = {
    ...req.authUser,
    email,
    displayName,
    profileImageUrl: profileImageExplicit ? profileImageUrl : req.authUser.profileImageUrl,
  }

  reply.send(await makeSessionPayload(req))
}

interface ChangePasswordBody {
  currentPassword?: string
  newPassword?: string
}

export async function changePasswordRoute(
  req: FastifyRequest<{ Body: ChangePasswordBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!req.authUser) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  if (!(await getPasswordLoginEnabled())) {
    reply.status(403).send({ error: 'Password login is disabled.' })
    return
  }

  const currentPassword = String(req.body?.currentPassword ?? '')
  const newPassword = String(req.body?.newPassword ?? '')

  if (newPassword.length < 8) {
    reply.status(400).send({ error: 'New password must be at least 8 characters' })
    return
  }

  const user = await findUserByEmail(req.authUser.email)
  if (!user) {
    reply.status(404).send({ error: 'User not found' })
    return
  }

  if (user.password_hash != null) {
    if (!currentPassword || !verifyPassword(currentPassword, user.password_hash)) {
      reply.status(401).send({ error: 'Current password is incorrect' })
      return
    }
  }

  const nextPasswordHash = hashPassword(newPassword)
  const updated = await updateUserPasswordHash(req.authUser.id, nextPasswordHash)
  if (!updated) {
    reply.status(500).send({ error: 'Failed to update password' })
    return
  }

  reply.send({ ok: true })
}

export async function disablePasswordRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.authUser) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  const methodCount = await countUserAuthMethods(req.authUser.id)
  if (methodCount <= 1) {
    reply.status(400).send({ error: 'Cannot disable your only login method. Link another provider first.' })
    return
  }

  const disabled = await disableUserPasswordAuthMethod(req.authUser.id)
  if (!disabled) {
    reply.status(404).send({ error: 'Password login is already disabled for this account.' })
    return
  }

  reply.send({ ok: true })
}

export async function listSessionsRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.authUser) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  const currentSessionId = getCookieValue(req, SESSION_COOKIE_NAME) ?? null
  const sessions = await listSessionsForUser(req.authUser.id, currentSessionId)
  reply.send({ sessions })
}

export async function revokeSessionRoute(
  req: FastifyRequest<{ Params: { sessionId?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!req.authUser) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  const sessionId = String(req.params?.sessionId ?? '').trim()
  if (!sessionId) {
    reply.status(400).send({ error: 'Invalid session id' })
    return
  }

  const currentSessionId = getCookieValue(req, SESSION_COOKIE_NAME) ?? ''
  if (sessionId === currentSessionId) {
    reply.status(400).send({ error: 'Use log out to end the current session' })
    return
  }

  const removed = await deleteUserSession(req.authUser.id, sessionId)
  if (!removed) {
    reply.status(404).send({ error: 'Session not found' })
    return
  }

  reply.send({ ok: true })
}

export async function getPreferencesRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.authUser) {
    reply.send(await getUserPreferences(null))
    return
  }

  reply.send(await getUserPreferences(req.authUser.id))
}

interface UpdatePreferencesBody {
  appearance?: 'light' | 'dark' | 'system'
  theme?: string
  recentItemsLimit?: number
  autoCompileDefault?: boolean
  autoCompileTimeoutSeconds?: number
  editorBraceMatching?: boolean
  editorHighlightSelectionMatches?: boolean
  editorInEditorFind?: boolean
  editorAutocomplete?: boolean
  editorAutoCloseLatexBeginEnd?: boolean
  dashboardSortBy?: 'last-active' | 'created' | 'title'
  dashboardLayout?: 'grid' | 'list'
  pinnedProjectIds?: string[]
  quickAccessPinnedLimit?: number
  autoVersionIntervalMinutes?: number
  autoSaveOnCompile?: boolean
  autoSaveOnExport?: boolean
}

export async function updatePreferencesRoute(
  req: FastifyRequest<{ Body: UpdatePreferencesBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!req.authUser) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  const patch: UpdatePreferencesBody = {}
  if (req.body?.appearance === 'light' || req.body?.appearance === 'dark' || req.body?.appearance === 'system') {
    patch.appearance = req.body.appearance
  }
  if (typeof req.body?.theme === 'string') {
    patch.theme = req.body.theme
  }
  if (typeof req.body?.recentItemsLimit === 'number' && Number.isFinite(req.body.recentItemsLimit)) {
    patch.recentItemsLimit = req.body.recentItemsLimit
  }
  if (typeof req.body?.autoCompileDefault === 'boolean') {
    patch.autoCompileDefault = req.body.autoCompileDefault
  }
  if (req.body?.dashboardSortBy === 'last-active' || req.body?.dashboardSortBy === 'created' || req.body?.dashboardSortBy === 'title') {
    patch.dashboardSortBy = req.body.dashboardSortBy
  }
  if (req.body?.dashboardLayout === 'grid' || req.body?.dashboardLayout === 'list') {
    patch.dashboardLayout = req.body.dashboardLayout
  }
  if (Array.isArray(req.body?.pinnedProjectIds)) {
    patch.pinnedProjectIds = req.body.pinnedProjectIds
  }
  if (typeof req.body?.quickAccessPinnedLimit === 'number' && Number.isFinite(req.body.quickAccessPinnedLimit)) {
    patch.quickAccessPinnedLimit = req.body.quickAccessPinnedLimit
  }
  if (typeof req.body?.autoCompileTimeoutSeconds === 'number' && Number.isFinite(req.body.autoCompileTimeoutSeconds)) {
    patch.autoCompileTimeoutSeconds = req.body.autoCompileTimeoutSeconds
  }
  if (typeof req.body?.editorBraceMatching === 'boolean') {
    patch.editorBraceMatching = req.body.editorBraceMatching
  }
  if (typeof req.body?.editorHighlightSelectionMatches === 'boolean') {
    patch.editorHighlightSelectionMatches = req.body.editorHighlightSelectionMatches
  }
  if (typeof req.body?.editorInEditorFind === 'boolean') {
    patch.editorInEditorFind = req.body.editorInEditorFind
  }
  if (typeof req.body?.editorAutocomplete === 'boolean') {
    patch.editorAutocomplete = req.body.editorAutocomplete
  }
  if (typeof req.body?.editorAutoCloseLatexBeginEnd === 'boolean') {
    patch.editorAutoCloseLatexBeginEnd = req.body.editorAutoCloseLatexBeginEnd
  }
  if (typeof req.body?.autoVersionIntervalMinutes === 'number' && Number.isFinite(req.body.autoVersionIntervalMinutes)) {
    patch.autoVersionIntervalMinutes = req.body.autoVersionIntervalMinutes
  }
  if (typeof req.body?.autoSaveOnCompile === 'boolean') {
    patch.autoSaveOnCompile = req.body.autoSaveOnCompile
  }
  if (typeof req.body?.autoSaveOnExport === 'boolean') {
    patch.autoSaveOnExport = req.body.autoSaveOnExport
  }

  const next = await updateUserPreferences(req.authUser.id, patch)
  reply.send(next)
}

interface DeleteAccountBody {
  password?: string
}

export async function deleteAccountRoute(
  req: FastifyRequest<{ Body: DeleteAccountBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!req.authUser) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  const password = String(req.body?.password ?? '')
  if (!password) {
    reply.status(400).send({ error: 'Password is required' })
    return
  }

  const user = await findUserByEmail(req.authUser.email)
  if (!user || !verifyPassword(password, user.password_hash)) {
    reply.status(401).send({ error: 'Current password is incorrect' })
    return
  }

  await softDeleteProjectsOwnedByUser(req.authUser.id)
  const removed = await deleteUserAccount(req.authUser.id)
  if (!removed) {
    reply.status(500).send({ error: 'Failed to delete account' })
    return
  }

  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
  req.authUser = null
  req.principal.userId = null
  const guestEnabled = await getGuestSignupsEnabled()
  req.principal.guestId = maybeSetGuestCookie(req, reply, guestEnabled)
  reply.send(await makeSessionPayload(req))
}

export async function getPasswordResetTokenRoute(
  req: FastifyRequest<{ Params: { token?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const token = String(req.params?.token ?? '').trim()
  if (!token) {
    reply.status(400).send({ error: 'Invalid reset token' })
    return
  }

  const reset = await getPasswordResetTokenState(token)
  if (!reset) {
    reply.status(404).send({ error: 'Password reset token not found' })
    return
  }

  if (reset.isSuspended) {
    reply.status(403).send({ error: 'Account is suspended. Contact a server administrator.' })
    return
  }

  reply.send({ email: reset.email, expiresAt: reset.expiresAt })
}

interface ResetPasswordBody {
  newPassword?: string
}

export async function applyPasswordResetRoute(
  req: FastifyRequest<{ Params: { token?: string }; Body: ResetPasswordBody }>,
  reply: FastifyReply,
): Promise<void> {
  const token = String(req.params?.token ?? '').trim()
  const newPassword = String(req.body?.newPassword ?? '')

  if (!token) {
    reply.status(400).send({ error: 'Invalid reset token' })
    return
  }

  if (newPassword.length < 8) {
    reply.status(400).send({ error: 'New password must be at least 8 characters' })
    return
  }

  const reset = await getPasswordResetTokenState(token)
  if (!reset) {
    reply.status(404).send({ error: 'Password reset token not found' })
    return
  }

  const now = Math.floor(Date.now() / 1000)
  if (reset.usedAt != null || reset.expiredEarlyAt != null || reset.expiresAt <= now) {
    reply.status(410).send({ error: 'Password reset token is expired or already used' })
    return
  }

  if (reset.isSuspended) {
    reply.status(403).send({ error: 'Account is suspended. Contact a server administrator.' })
    return
  }

  // Mark token used first to prevent race conditions with concurrent requests
  const marked = await markPasswordResetTokenUsed(token)
  if (!marked) {
    reply.status(409).send({ error: 'Password reset token has already been used' })
    return
  }

  const updated = await updateUserPasswordHash(reset.userId, hashPassword(newPassword))
  if (!updated) {
    reply.status(500).send({ error: 'Failed to update password' })
    return
  }

  await markUserLoggedIn(reset.userId)
  const user = await findUserByEmail(reset.email)
  if (!user) {
    reply.status(500).send({ error: 'User not found' })
    return
  }

  const session = await createSession(user.id, sessionMaxAgeSeconds)
  reply.setCookie(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: sessionMaxAgeSeconds,
    secure: shouldUseSecureCookies(req),
    path: '/',
  })

  req.authUser = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    role: user.role,
  }
  req.principal.userId = user.id

  reply.send(await makeSessionPayload(req))
}
