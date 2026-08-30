import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Principal, SessionUser } from './db/index.js'
import {
  countUsers,
  createUser,
  countUserAuthMethods,
  deleteUserAccount,
  disableUserPasswordAuthMethod,
  findUserByEmail,
  findUserById,
  findOrCreateGuestUserByCookieId,
  findGuestUserByCookieId,
  getEnabledOAuthProviders,
  getGuestSignupsEnabled,
  getPasskeyLoginEnabled,
  getInviteTokenState,
  getPasswordLoginEnabled,
  getPasswordResetTokenState,
  getSignupMode,
  getUserExcalidrawLibrary,
  getUserPreferences,
  listRefreshTokensForUser,
  markInviteTokenUsed,
  markPasswordResetTokenUsed,
  markUserLoggedIn,
  migrateGuestProjectsToUser,
  migrateGuestRecentsToUser,
  migrateGuestWorkspaceStatesToUser,
  parseExcalidrawLibraryBody,
  redeemShareTokenForUser,
  revokeAllUserRefreshTokens,
  revokeRefreshTokenByRawToken,
  revokeUserRefreshToken,
  findActiveRefreshTokenId,
  rotateRefreshToken,
  issueRefreshToken,
  softDeleteProjectsOwnedByUser,
  updatePendingInvitesForUser,
  updateUserPasswordHash,
  upsertUserExcalidrawLibrary,
  updateUserPreferences,
  updateUserDisplayName,
  updateUserEmail,
  updateUserProfileImage,
  setRequestIdentity,
  runWithIdentityContext,
} from './db/index.js'
import {
  areOriginsSameSite,
  inferRequestOrigin,
  isProductionEnv,
  isTrustedRequestOrigin,
  parseTrustedOrigins,
  parseUrlEnv,
} from './env.js'
import { createUid } from './ids.js'
import { hashPassword, verifyPassword } from './auth/password.js'
import { isValidEmail } from './security.js'
import {
  getRefreshTokenTtlSeconds,
  signAccessToken,
  verifyAccessToken,
  tokenExpiresInSeconds,
} from './auth/jwt.js'
import { pathnameFromRawUrl } from './routing.js'
import { getShareTokenFromRequest } from './sharing.js'

const isProd = isProductionEnv(process.env.NODE_ENV)

export const GUEST_COOKIE_NAME = 'guest_id'
export const ACCESS_COOKIE_NAME = 'composure_access'
export const REFRESH_COOKIE_NAME = 'composure_refresh'

const guestCookieMaxAgeSeconds = 90 * 24 * 60 * 60
const maxAvatarImageBytes = Number.parseInt(process.env.MAX_AVATAR_IMAGE_BYTES ?? '262144', 10)
let warnedAuthNoneWithoutSecure = false
let warnedGuestNoneWithoutSecure = false

type CookieSameSite = 'strict' | 'lax' | 'none'

function isLocalHostname(hostname: string | undefined): boolean {
  if (!hostname) return false
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

export function shouldUseSecureCookies(req: FastifyRequest): boolean {
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

function parseCookieSameSiteEnv(value: string | undefined, envName: string): CookieSameSite | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  const normalized = trimmed.toLowerCase()
  if (normalized === 'strict' || normalized === 'lax' || normalized === 'none') {
    return normalized
  }

  throw new Error(`Invalid ${envName}: "${value}". Expected one of strict, lax, none.`)
}

function shouldUseCrossSiteCookies(req: FastifyRequest): boolean {
  const frontendOrigin = parseUrlEnv(process.env.FRONTEND_URL)
  if (!frontendOrigin) {
    return false
  }

  const backendOrigin = parseUrlEnv(process.env.BACKEND_URL)
    ?? inferRequestOrigin({
      hostHeader: req.headers['x-forwarded-host'] ?? req.headers.host,
      forwardedProtoHeader: req.headers['x-forwarded-proto'],
    })

  if (!backendOrigin) {
    return false
  }

  return !areOriginsSameSite(frontendOrigin, backendOrigin)
}

function normalizeSameSiteForRequest(
  req: FastifyRequest,
  value: CookieSameSite,
  kind: 'auth' | 'guest',
): CookieSameSite {
  if (value !== 'none') {
    return value
  }

  if (!isProd || shouldUseSecureCookies(req)) {
    return value
  }

  if (kind === 'auth' && !warnedAuthNoneWithoutSecure) {
    console.warn('[auth] SESSION_COOKIE_SAME_SITE=none requires HTTPS in production; falling back to SameSite=lax.')
    warnedAuthNoneWithoutSecure = true
  }

  if (kind === 'guest' && !warnedGuestNoneWithoutSecure) {
    console.warn('[auth] GUEST_COOKIE_SAME_SITE=none requires HTTPS in production; falling back to SameSite=lax.')
    warnedGuestNoneWithoutSecure = true
  }

  return 'lax'
}

function resolveCookieSameSite(req: FastifyRequest, kind: 'auth' | 'guest'): CookieSameSite {
  const envName = kind === 'auth' ? 'SESSION_COOKIE_SAME_SITE' : 'GUEST_COOKIE_SAME_SITE'
  const override = parseCookieSameSiteEnv(process.env[envName], envName)

  const defaultValue: CookieSameSite = kind === 'auth' ? 'lax' : 'strict'
  const autoValue = shouldUseCrossSiteCookies(req) ? 'none' : defaultValue
  return normalizeSameSiteForRequest(req, override ?? autoValue, kind)
}

export function getAuthCookieSameSite(req: FastifyRequest): CookieSameSite {
  return resolveCookieSameSite(req, 'auth')
}

function getGuestCookieSameSite(req: FastifyRequest): CookieSameSite {
  return resolveCookieSameSite(req, 'guest')
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
    currentRefreshTokenId?: string | null
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
    sameSite: getGuestCookieSameSite(req),
    maxAge: guestCookieMaxAgeSeconds,
    secure: shouldUseSecureCookies(req),
    path: '/',
  })

  return guestId
}

function parseBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization
  if (!header) {
    return null
  }

  const value = Array.isArray(header) ? header[0] : header
  if (!value) {
    return null
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1]?.trim() || null
}

function getAccessTokenFromRequest(req: FastifyRequest): { token: string | null; source: 'cookie' | 'header' | null } {
  const cookieToken = getCookieValue(req, ACCESS_COOKIE_NAME)?.trim()
  if (cookieToken) {
    return { token: cookieToken, source: 'cookie' }
  }

  const bearer = parseBearerToken(req)
  if (bearer) {
    return { token: bearer, source: 'header' }
  }

  return { token: null, source: null }
}

function isIdentityRequiredRoute(req: FastifyRequest): boolean {
  const path = pathnameFromRawUrl(req.url)
  if (path === '/health') {
    return false
  }

  if (
    path.endsWith('/auth/session')
    || path.endsWith('/auth/login')
    || path.endsWith('/auth/signup')
    || path.endsWith('/auth/providers')
    || path.endsWith('/auth/oauth/confirm')
    || path.endsWith('/auth/oauth/complete-profile')
    || path.includes('/auth/password-reset/')
    || path.includes('/auth/passkey/')
    || path.includes('/auth/via/')
    || path.endsWith('/templates')
  ) {
    return false
  }

  return true
}

function isAnonymousSideEffectFreeRoute(req: FastifyRequest): boolean {
  const path = pathnameFromRawUrl(req.url)
  return path === '/health' || path === '/.well-known/jwks.json'
}

function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE_NAME, { path: '/' })
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/' })
}

function setAuthCookies(
  req: FastifyRequest,
  reply: FastifyReply,
  input: {
    accessToken: string
    accessExpiresAt: number
    refreshToken: string
    refreshExpiresAt: number
  },
): void {
  const sameSite = getAuthCookieSameSite(req)
  const secure = shouldUseSecureCookies(req)

  reply.setCookie(ACCESS_COOKIE_NAME, input.accessToken, {
    httpOnly: true,
    sameSite,
    maxAge: tokenExpiresInSeconds(input.accessExpiresAt),
    secure,
    path: '/',
  })

  reply.setCookie(REFRESH_COOKIE_NAME, input.refreshToken, {
    httpOnly: true,
    sameSite,
    maxAge: tokenExpiresInSeconds(input.refreshExpiresAt),
    secure,
    path: '/',
  })
}

export async function issueAuthCookies(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  const access = await signAccessToken(userId)
  const refresh = await runWithIdentityContext(
    null,
    'system',
    async () => await issueRefreshToken(userId, getRefreshTokenTtlSeconds()),
  )
  setAuthCookies(req, reply, {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  })
}

function shouldEnforceCsrf(req: FastifyRequest): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return false
  }
  return Boolean(getCookieValue(req, ACCESS_COOKIE_NAME) || getCookieValue(req, REFRESH_COOKIE_NAME))
}

function isCsrfOriginAllowed(req: FastifyRequest): boolean {
  const trustedOrigins = new Set(parseTrustedOrigins(process.env.CORS_ORIGIN, process.env.NODE_ENV))
  return isTrustedRequestOrigin({
    originHeader: req.headers.origin,
    hostHeader: req.headers.host,
    forwardedProtoHeader: req.headers['x-forwarded-proto'],
    trustedOrigins,
  })
}

async function resolveAccessUser(req: FastifyRequest): Promise<{ user: SessionUser | null; source: 'cookie' | 'header' | null }> {
  const { token, source } = getAccessTokenFromRequest(req)
  if (!token) {
    return { user: null, source: null }
  }

  const payload = await verifyAccessToken(token)
  if (!payload?.sub || typeof payload.sub !== 'string') {
    return { user: null, source }
  }

  const user = await findUserById(payload.sub)
  if (!user) {
    return { user: null, source }
  }

  return { user, source }
}

export async function resolvePrincipalFromCookieHeader(cookieHeader: string | undefined): Promise<Principal> {
  const cookies = parseCookieHeader(cookieHeader)
  const guestId = cookies[GUEST_COOKIE_NAME] ?? null

  const accessToken = cookies[ACCESS_COOKIE_NAME]
  if (accessToken) {
    const payload = await verifyAccessToken(accessToken)
    if (payload?.sub && typeof payload.sub === 'string') {
      const user = await findUserById(payload.sub)
      if (user) {
        return { userId: user.id, guestId }
      }
    }
  }

  if (guestId) {
    const guestUser = await findGuestUserByCookieId(guestId)
    if (guestUser) {
      return { userId: guestUser.id, guestId }
    }
  }

  return { userId: null, guestId }
}

export const authHook: preHandlerHookHandler = async (req, reply) => {
  if (isAnonymousSideEffectFreeRoute(req)) {
    req.principal = { userId: null, guestId: null }
    req.authUser = null
    req.currentRefreshTokenId = null
    setRequestIdentity(null, null)
    return
  }

  const guestSignupsEnabled = await getGuestSignupsEnabled()
  const guestId = maybeSetGuestCookie(req, reply, guestSignupsEnabled)

  const refreshRaw = getCookieValue(req, REFRESH_COOKIE_NAME)?.trim() ?? ''
  let currentRefreshTokenId: string | null = null

  if (shouldEnforceCsrf(req) && !isCsrfOriginAllowed(req)) {
    reply.status(403).send({ error: 'Forbidden (CSRF origin check failed)' })
    return
  }

  const accessResolved = await runWithIdentityContext(null, 'system', async () => await resolveAccessUser(req))
  let user = accessResolved.user

  if (!user && refreshRaw) {
    const rotated = await runWithIdentityContext(
      null,
      'system',
      async () => await rotateRefreshToken(refreshRaw, getRefreshTokenTtlSeconds()),
    )
    if (rotated.status === 'ok') {
      const access = await signAccessToken(rotated.user.id)
      setAuthCookies(req, reply, {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt,
        refreshToken: rotated.token.token,
        refreshExpiresAt: rotated.token.expiresAt,
      })
      user = rotated.user
      currentRefreshTokenId = rotated.token.id
    } else {
      clearAuthCookies(reply)
      user = null
    }
  } else if (refreshRaw) {
    currentRefreshTokenId = await runWithIdentityContext(
      null,
      'system',
      async () => await findActiveRefreshTokenId(refreshRaw),
    )
  }

  if (!user && guestId) {
    user = await runWithIdentityContext(null, 'system', async () => await findGuestUserByCookieId(guestId))
  }

  if (!user && guestId && isIdentityRequiredRoute(req) && guestSignupsEnabled) {
    const guestUser = await runWithIdentityContext(null, 'system', async () => await findOrCreateGuestUserByCookieId(guestId))
    user = guestUser
    await issueAuthCookies(req, reply, guestUser.id)
    currentRefreshTokenId = null
  }

  const principalUserId = user?.id ?? null
  req.principal = {
    userId: principalUserId,
    guestId,
  }

  req.authUser = user && !user.isGuest ? user : null

  const role = req.authUser?.role ?? (user?.isGuest ? 'guest' : null)
  setRequestIdentity(principalUserId, role)

  const shareToken = getShareTokenFromRequest(req)
  if (shareToken && principalUserId) {
    await redeemShareTokenForUser(shareToken, principalUserId)
  }

  req.currentRefreshTokenId = currentRefreshTokenId
}

export async function makeSessionPayload(req: FastifyRequest): Promise<AuthSessionResponse> {
  const enabledProviders = await getEnabledOAuthProviders()
  const enabledLoginProviders = enabledProviders.map((p) => p.provider)
  if (await getPasskeyLoginEnabled()) {
    enabledLoginProviders.unshift('passkey')
  }
  return {
    authenticated: Boolean(req.authUser),
    user: req.authUser,
    principal: req.principal,
    guestRetentionDays: Math.round(guestCookieMaxAgeSeconds / (24 * 60 * 60)),
    userCount: await runWithIdentityContext(null, 'system', async () => await countUsers()),
    signupMode: await getSignupMode(),
    guestSignupsEnabled: await getGuestSignupsEnabled(),
    enabledLoginProviders,
  }
}

export async function authSessionRoute(req: FastifyRequest): Promise<AuthSessionResponse> {
  return await makeSessionPayload(req)
}

export interface AuthBody {
  email?: string
  password?: string
  displayName?: string
  inviteToken?: string
}

export interface InviteOnlySignupGateInput {
  email: string
  inviteToken?: string | null
}

export interface InviteOnlySignupGateResult {
  ok: boolean
  inviteToken: string | null
  error?: string
}

export async function enforceInviteOnlySignupGate(
  input: InviteOnlySignupGateInput,
): Promise<InviteOnlySignupGateResult> {
  const email = input.email.trim().toLowerCase()
  const inviteToken = input.inviteToken ? String(input.inviteToken).trim() : null

  const userCount = await runWithIdentityContext(null, 'system', async () => await countUsers())
  if (userCount === 0 || (await getSignupMode()) !== 'invite-only') {
    return { ok: true, inviteToken }
  }

  if (!inviteToken) {
    return { ok: false, inviteToken: null, error: 'Signups are currently invite-only.' }
  }

  const tokenState = await runWithIdentityContext(null, 'system', async () => await getInviteTokenState(inviteToken))
  if (!tokenState || tokenState.usedAt != null || tokenState.expiresAt <= Math.floor(Date.now() / 1000)) {
    return { ok: false, inviteToken: null, error: 'Invalid or expired invite token.' }
  }

  if (tokenState.email && tokenState.email !== email) {
    return { ok: false, inviteToken: null, error: 'This invite was issued for a different email address.' }
  }

  return { ok: true, inviteToken }
}

export async function signupRoute(req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply): Promise<void> {
  if (!(await getPasswordLoginEnabled())) {
    reply.status(403).send({ error: 'Password signup is disabled.' })
    return
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const displayName = String(req.body?.displayName ?? '').trim()
  const inviteGate = await enforceInviteOnlySignupGate({
    email,
    inviteToken: req.body?.inviteToken,
  })
  if (!inviteGate.ok) {
    reply.status(403).send({ error: inviteGate.error ?? 'Signups are currently invite-only.' })
    return
  }
  const inviteToken = inviteGate.inviteToken

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

  const passwordHash = await hashPassword(password)
  const created = await runWithIdentityContext(null, 'system', async () => await createUser({
    email,
    passwordHash,
    displayName,
  }))

  if (!created) {
    reply.status(409).send({ error: 'Email is already registered' })
    return
  }

  // Consume invite token after successful account creation
  if (inviteToken) {
    await runWithIdentityContext(null, 'system', async () => await markInviteTokenUsed(inviteToken))
  }

  await issueAuthCookies(req, reply, created.id)
  await runWithIdentityContext(null, 'system', async () => await markUserLoggedIn(created.id))

  const principalUserId = req.principal.userId
  if (principalUserId && principalUserId !== created.id) {
    const moved = await runWithIdentityContext(null, 'system', async () => await migrateGuestProjectsToUser(principalUserId, created.id))
    const movedRecents = await runWithIdentityContext(null, 'system', async () => await migrateGuestRecentsToUser(principalUserId, created.id))
    const movedWorkspaceStates = await runWithIdentityContext(null, 'system', async () => await migrateGuestWorkspaceStatesToUser(principalUserId, created.id))
    console.info(`[auth] migrated guest projects userId=${principalUserId} targetUserId=${created.id} count=${moved}`)
    console.info(`[auth] migrated guest recents userId=${principalUserId} targetUserId=${created.id} count=${movedRecents}`)
    console.info(`[auth] migrated guest workspace states userId=${principalUserId} targetUserId=${created.id} count=${movedWorkspaceStates}`)
    await runWithIdentityContext(null, 'system', async () => await deleteUserAccount(principalUserId))
  }

  const acceptedInvites = await runWithIdentityContext(null, 'system', async () => await updatePendingInvitesForUser(created.id, created.email))
  if (acceptedInvites > 0) {
    console.info(`[auth] accepted pending invites userId=${created.id} count=${acceptedInvites}`)
  }

  req.authUser = created
  req.principal.userId = created.id
  setRequestIdentity(created.id, created.role)
  req.currentRefreshTokenId = await runWithIdentityContext(
    null,
    'system',
    async () => await findActiveRefreshTokenId(getCookieValue(req, REFRESH_COOKIE_NAME) ?? ''),
  )

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

  const user = await runWithIdentityContext(null, 'system', async () => await findUserByEmail(email))
  if (user?.is_suspended === true) {
    reply.status(403).send({ error: 'Credentials expired. Contact a server administrator.' })
    return
  }

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    reply.status(401).send({ error: 'Invalid credentials' })
    return
  }

  await issueAuthCookies(req, reply, user.id)
  await runWithIdentityContext(null, 'system', async () => await markUserLoggedIn(user.id))

  const principalUserId = req.principal.userId
  if (principalUserId && principalUserId !== user.id) {
    const moved = await runWithIdentityContext(null, 'system', async () => await migrateGuestProjectsToUser(principalUserId, user.id))
    const movedRecents = await runWithIdentityContext(null, 'system', async () => await migrateGuestRecentsToUser(principalUserId, user.id))
    const movedWorkspaceStates = await runWithIdentityContext(null, 'system', async () => await migrateGuestWorkspaceStatesToUser(principalUserId, user.id))
    console.info(`[auth] migrated guest projects on-login userId=${principalUserId} targetUserId=${user.id} count=${moved}`)
    console.info(`[auth] migrated guest recents on-login userId=${principalUserId} targetUserId=${user.id} count=${movedRecents}`)
    console.info(`[auth] migrated guest workspace states on-login userId=${principalUserId} targetUserId=${user.id} count=${movedWorkspaceStates}`)
    await runWithIdentityContext(null, 'system', async () => await deleteUserAccount(principalUserId))
  }

  const acceptedInvites = await runWithIdentityContext(null, 'system', async () => await updatePendingInvitesForUser(user.id, user.email))
  if (acceptedInvites > 0) {
    console.info(`[auth] accepted pending invites on-login userId=${user.id} count=${acceptedInvites}`)
  }

  req.authUser = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    role: user.role,
    isGuest: false,
  }
  req.principal.userId = user.id
  setRequestIdentity(user.id, user.role)
  req.currentRefreshTokenId = await runWithIdentityContext(
    null,
    'system',
    async () => await findActiveRefreshTokenId(getCookieValue(req, REFRESH_COOKIE_NAME) ?? ''),
  )

  reply.send(await makeSessionPayload(req))
}

export async function logoutRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const refreshToken = getCookieValue(req, REFRESH_COOKIE_NAME) ?? ''
  if (refreshToken) {
    await runWithIdentityContext(null, 'system', async () => await revokeRefreshTokenByRawToken(refreshToken))
  }

  clearAuthCookies(reply)
  req.authUser = null
  req.principal.userId = null
  req.currentRefreshTokenId = null
  setRequestIdentity(null, null)

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
  const authUser = req.authUser

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

  const existing = await runWithIdentityContext(null, 'system', async () => await findUserByEmail(email))
  if (existing && existing.id !== authUser.id) {
    reply.status(409).send({ error: 'Email is already registered' })
    return
  }

  const updated = await updateUserDisplayName(authUser.id, displayName)
  if (!updated) {
    reply.status(404).send({ error: 'User not found' })
    return
  }

  await updateUserEmail(authUser.id, email)

  // Update profile image if field was explicitly included in the request body
  const profileImageExplicit = req.body != null && Object.prototype.hasOwnProperty.call(req.body, 'profileImageUrl')
  if (profileImageExplicit) {
    await updateUserProfileImage(authUser.id, profileImageUrl)
  }

  const acceptedInvites = await runWithIdentityContext(null, 'system', async () => await updatePendingInvitesForUser(authUser.id, email))
  if (acceptedInvites > 0) {
    console.info(`[auth] accepted pending invites on-profile-update userId=${authUser.id} count=${acceptedInvites}`)
  }

  req.authUser = {
    ...authUser,
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
    if (!currentPassword || !(await verifyPassword(currentPassword, user.password_hash))) {
      reply.status(401).send({ error: 'Current password is incorrect' })
      return
    }
  }

  const nextPasswordHash = await hashPassword(newPassword)
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

  const currentSessionId = req.currentRefreshTokenId
    ?? await findActiveRefreshTokenId(getCookieValue(req, REFRESH_COOKIE_NAME) ?? '')
  const sessions = await listRefreshTokensForUser(req.authUser.id, currentSessionId)
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

  const currentSessionId = req.currentRefreshTokenId
    ?? await findActiveRefreshTokenId(getCookieValue(req, REFRESH_COOKIE_NAME) ?? '')
  if (sessionId === currentSessionId) {
    reply.status(400).send({ error: 'Use log out to end the current session' })
    return
  }

  const removed = await revokeUserRefreshToken(req.authUser.id, sessionId)
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

export async function getExcalidrawLibraryRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = req.principal.userId
  if (!userId) {
    reply.send({ library: null })
    return
  }

  const stored = await getUserExcalidrawLibrary(userId)
  reply.send({ library: stored?.library ?? null })
}

export async function putExcalidrawLibraryRoute(
  req: FastifyRequest<{ Body: unknown }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = req.principal.userId
  if (!userId) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  const parsed = parseExcalidrawLibraryBody(req.body)
  if (!parsed) {
    reply.status(400).send({ error: 'Invalid library payload' })
    return
  }

  try {
    await upsertUserExcalidrawLibrary(userId, parsed)
  } catch (err) {
    if (err instanceof Error && err.message === 'invalid-library') {
      reply.status(400).send({ error: 'Invalid library payload' })
      return
    }
    if (err instanceof Error && err.message === 'library-too-large') {
      reply.status(413).send({ error: 'Library too large' })
      return
    }
    throw err
  }

  reply.send({ ok: true })
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

  const user = await findUserByEmail(req.authUser.email)
  if (!user) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }

  // OAuth-only accounts have no password hash and can never supply one, so
  // deletion for them rests on the authenticated session alone.
  if (user.password_hash) {
    const password = String(req.body?.password ?? '')
    if (!password) {
      reply.status(400).send({ error: 'Password is required' })
      return
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      reply.status(401).send({ error: 'Current password is incorrect' })
      return
    }
  }

  await softDeleteProjectsOwnedByUser(req.authUser.id)
  const removed = await deleteUserAccount(req.authUser.id)
  if (!removed) {
    reply.status(500).send({ error: 'Failed to delete account' })
    return
  }

  await revokeAllUserRefreshTokens(req.authUser.id)
  clearAuthCookies(reply)
  req.authUser = null
  req.principal.userId = null
  req.currentRefreshTokenId = null
  setRequestIdentity(null, null)
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

  const reset = await runWithIdentityContext(
    null,
    'system',
    async () => await getPasswordResetTokenState(token),
  )
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

export interface ResetPasswordBody {
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

  const reset = await runWithIdentityContext(
    null,
    'system',
    async () => await getPasswordResetTokenState(token),
  )
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
  const marked = await runWithIdentityContext(
    null,
    'system',
    async () => await markPasswordResetTokenUsed(token),
  )
  if (!marked) {
    reply.status(409).send({ error: 'Password reset token has already been used' })
    return
  }

  const updated = await runWithIdentityContext(
    null,
    'system',
    async () => await updateUserPasswordHash(reset.userId, await hashPassword(newPassword)),
  )
  if (!updated) {
    reply.status(500).send({ error: 'Failed to update password' })
    return
  }

  await runWithIdentityContext(null, 'system', async () => await markUserLoggedIn(reset.userId))
  const user = await runWithIdentityContext(null, 'system', async () => await findUserByEmail(reset.email))
  if (!user) {
    reply.status(500).send({ error: 'User not found' })
    return
  }

  await issueAuthCookies(req, reply, user.id)

  req.authUser = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    role: user.role,
    isGuest: false,
  }
  req.principal.userId = user.id
  setRequestIdentity(user.id, user.role)
  req.currentRefreshTokenId = await runWithIdentityContext(
    null,
    'system',
    async () => await findActiveRefreshTokenId(getCookieValue(req, REFRESH_COOKIE_NAME) ?? ''),
  )

  reply.send(await makeSessionPayload(req))
}
