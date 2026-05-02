import crypto from 'crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  countUserAuthMethods,
  deleteUserAccount,
  findOAuthAccount,
  findUserById,
  findUserByOAuth,
  getPasswordLoginEnabled,
  getEnabledOAuthProviders,
  linkOAuthAccount,
  listOAuthAccountsForUser,
  markUserLoggedIn,
  migrateGuestProjectsToUser,
  migrateGuestRecentsToUser,
  migrateGuestWorkspaceStatesToUser,
  unlinkOAuthAccount,
  updatePendingInvitesForUser,
  type OAuthProviderRow,
  userHasPasswordAuthMethod,
} from '../db/index.js'
import {
  ACCESS_COOKIE_NAME,
  GUEST_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  getAuthCookieSameSite,
  shouldUseSecureCookies,
} from '../auth.js'
import { inferRequestOrigin } from '../env.js'
import { getRefreshTokenTtlSeconds, signAccessToken, tokenExpiresInSeconds } from './jwt.js'
import { issueRefreshToken } from '../db/index.js'

function firstHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return null
  const first = raw.split(',')[0]?.trim()
  return first || null
}

function normalizeHttpOrigin(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// State JWT helpers — lightweight signed JSON to pass intent through the
// OAuth redirect cycle. We use HMAC-SHA256 rather than a library to keep deps
// minimal.
// ---------------------------------------------------------------------------

const stateSecret = process.env.OAUTH_STATE_SECRET ?? crypto.randomBytes(32).toString('hex')

export function signState(payload: Record<string, unknown>): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyState(token: string): Record<string, unknown> | null {
  const [data, sig] = token.split('.')
  if (!data || !sig) return null
  const expected = crypto.createHmac('sha256', stateSecret).update(data).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString()) as Record<string, unknown>
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Strategy registry
// ---------------------------------------------------------------------------

interface OAuthStrategyDef {
  authorizeUrl: (state: string, callbackUrl: string, clientId: string) => string
  exchangeCode: (
    code: string,
    callbackUrl: string,
    clientId: string,
    clientSecret: string,
  ) => Promise<{ providerId: string; email: string | null; displayName: string | null }>
}

const strategies: Record<string, OAuthStrategyDef> = {}

function registerGitHubStrategy(): void {
  strategies['github'] = {
    authorizeUrl: (state, callbackUrl, clientId) =>
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=read:user%20user:email&state=${encodeURIComponent(state)}`,

    exchangeCode: async (code, callbackUrl, clientId, clientSecret) => {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl }),
      })
      const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string }
      if (!tokenBody.access_token) throw new Error(tokenBody.error ?? 'GitHub token exchange failed')

      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/json' },
      })
      const userBody = (await userRes.json()) as { id?: number; login?: string; email?: string }
      if (!userBody.id) throw new Error('Failed to fetch GitHub user profile')

      // Fetch primary verified email if not public
      let email = userBody.email ?? null
      if (!email) {
        const emailRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/json' },
        })
        const emails = (await emailRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>
        const primary = emails.find((e) => e.primary && e.verified)
        email = primary?.email ?? emails.find((e) => e.verified)?.email ?? null
      }

      return { providerId: String(userBody.id), email, displayName: userBody.login ?? null }
    },
  }
}

function registerGoogleStrategy(): void {
  strategies['google'] = {
    authorizeUrl: (state, callbackUrl, clientId) =>
      `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${encodeURIComponent('openid email profile')}&state=${encodeURIComponent(state)}&access_type=offline&prompt=consent`,

    exchangeCode: async (code, callbackUrl, clientId, clientSecret) => {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      })
      const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string }
      if (!tokenBody.access_token) throw new Error(tokenBody.error ?? 'Google token exchange failed')

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      })
      const userBody = (await userRes.json()) as { id?: string; email?: string; name?: string; verified_email?: boolean }
      if (!userBody.id) throw new Error('Failed to fetch Google user profile')

      return {
        providerId: userBody.id,
        email: userBody.verified_email ? (userBody.email ?? null) : null,
        displayName: userBody.name ?? null,
      }
    },
  }
}

/** Call on startup to register all built-in strategy definitions. */
export function registerAllStrategies(): void {
  registerGitHubStrategy()
  registerGoogleStrategy()
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

function inferOriginFromRequest(req: FastifyRequest): string {
  return inferRequestOrigin({
    hostHeader: req.headers['x-forwarded-host'] ?? req.headers.host,
    forwardedProtoHeader: req.headers['x-forwarded-proto'],
  })
    ?? `${req.protocol === 'https' ? 'https' : 'http'}://localhost`
}

async function getProviderConfig(provider: string): Promise<OAuthProviderRow | null> {
  const enabled = await getEnabledOAuthProviders()
  return enabled.find((p) => p.provider === provider) ?? null
}

async function setAuthCookies(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  const access = await signAccessToken(userId)
  const refresh = await issueRefreshToken(userId, getRefreshTokenTtlSeconds())
  await markUserLoggedIn(userId)

  reply.setCookie(ACCESS_COOKIE_NAME, access.token, {
    httpOnly: true,
    sameSite: getAuthCookieSameSite(req),
    maxAge: tokenExpiresInSeconds(access.expiresAt),
    secure: shouldUseSecureCookies(req),
    path: '/',
  })

  reply.setCookie(REFRESH_COOKIE_NAME, refresh.token, {
    httpOnly: true,
    sameSite: getAuthCookieSameSite(req),
    maxAge: tokenExpiresInSeconds(refresh.expiresAt),
    secure: shouldUseSecureCookies(req),
    path: '/',
  })
}

async function migrateGuestData(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  const guestUserId = req.principal.userId
  if (guestUserId && guestUserId !== userId) {
    await migrateGuestProjectsToUser(guestUserId, userId)
    await migrateGuestRecentsToUser(guestUserId, userId)
    await migrateGuestWorkspaceStatesToUser(guestUserId, userId)
    await deleteUserAccount(guestUserId)
    reply.clearCookie(GUEST_COOKIE_NAME, { path: '/' })
  }
}

// ---------------------------------------------------------------------------
// Register routes on the Fastify instance
// ---------------------------------------------------------------------------

export interface OAuthRoutesOptions {
  backendUrl: string | null
  frontendUrl: string | null
  trustedFrontendOrigins?: ReadonlySet<string>
}

export function registerOAuthRoutes(
  app: FastifyInstance,
  apiPath: (p: string) => string,
  opts: OAuthRoutesOptions = { backendUrl: null, frontendUrl: null },
): void {
  const {
    backendUrl,
    frontendUrl,
    trustedFrontendOrigins = new Set<string>(),
  } = opts
  const configuredFrontendOrigin = normalizeHttpOrigin(frontendUrl)

  function isAllowedFrontendOrigin(req: FastifyRequest, origin: string | null): origin is string {
    if (!origin) return false
    if (configuredFrontendOrigin && origin === configuredFrontendOrigin) {
      return true
    }
    if (trustedFrontendOrigins.has(origin)) {
      return true
    }
    return origin === inferOriginFromRequest(req)
  }

  function resolveFrontendOriginForInit(req: FastifyRequest): string | null {
    const query = req.query as {
      return_to?: string
      returnTo?: string
      frontend_origin?: string
      frontendOrigin?: string
    } | undefined

    const hintedOrigins: Array<string | null> = [
      normalizeHttpOrigin(query?.return_to ?? query?.returnTo),
      normalizeHttpOrigin(query?.frontend_origin ?? query?.frontendOrigin),
      normalizeHttpOrigin(firstHeaderValue(req.headers.origin)),
      normalizeHttpOrigin(firstHeaderValue(req.headers.referer)),
      configuredFrontendOrigin,
      normalizeHttpOrigin(inferOriginFromRequest(req)),
    ]

    for (const origin of hintedOrigins) {
      if (isAllowedFrontendOrigin(req, origin)) {
        return origin
      }
    }

    return null
  }

  function resolveFrontendOriginFromState(
    req: FastifyRequest,
    statePayload: Record<string, unknown> | null,
  ): string | null {
    const stateOrigin = typeof statePayload?.frontendOrigin === 'string'
      ? normalizeHttpOrigin(statePayload.frontendOrigin)
      : null
    if (!isAllowedFrontendOrigin(req, stateOrigin)) {
      return null
    }
    return stateOrigin
  }

  function callbackUrl(req: FastifyRequest, provider: string): string {
    const path = apiPath(`/auth/via/${provider}/callback`)
    const origin = backendUrl ?? inferOriginFromRequest(req)
    return `${origin}${path}`
  }

  function frontendRedirect(path: string, frontendOrigin: string | null): string {
    if (frontendOrigin) return `${frontendOrigin}${path}`
    if (configuredFrontendOrigin) return `${configuredFrontendOrigin}${path}`
    return path
  }

  function redirectWithAuthError(
    req: FastifyRequest,
    reply: FastifyReply,
    statePayload: Record<string, unknown> | null,
    errorCode: string,
  ): void {
    const intent = statePayload?.intent
    const basePath = intent === 'link' ? '/settings' : '/'
    const frontendOrigin = resolveFrontendOriginFromState(req, statePayload)
    reply.redirect(frontendRedirect(`${basePath}?auth_error=${encodeURIComponent(errorCode)}`, frontendOrigin))
  }
  // GET /auth/providers — list configured login providers and user's linked methods
  app.get(apiPath('/auth/providers'), async (req) => {
    const passwordEnabled = await getPasswordLoginEnabled()
    const oauthProviders = await getEnabledOAuthProviders()
    const providers: Array<{ provider: string; enabled: boolean }> = []
    if (passwordEnabled) {
      providers.push({ provider: 'password', enabled: true })
    }
    for (const p of oauthProviders) {
      providers.push({ provider: p.provider, enabled: true })
    }

    // If user is authenticated, include their linked accounts
    let linked: Array<{ provider: string; email: string | null }> = []
    if (req.authUser) {
      if (passwordEnabled && (await userHasPasswordAuthMethod(req.authUser.id))) {
        linked.push({ provider: 'password', email: req.authUser.email })
      }
      const accounts = await listOAuthAccountsForUser(req.authUser.id)
      linked = linked.concat(accounts.map((a) => ({ provider: a.provider, email: a.email })))
    }

    return { providers, linked }
  })

  // GET /auth/via/:provider/login — initiate OAuth login flow
  app.get(apiPath('/auth/via/:provider/login'), async (req, reply) => {
    const provider = (req.params as { provider: string }).provider
    const strategy = strategies[provider]
    if (!strategy) {
      reply.status(404).send({ error: `Unknown provider: ${provider}` })
      return
    }

    const config = await getProviderConfig(provider)
    if (!config || !config.client_id) {
      reply.status(400).send({ error: `Provider ${provider} is not configured` })
      return
    }

    const frontendOrigin = resolveFrontendOriginForInit(req)
    const state = signState({ intent: 'login', provider, frontendOrigin, ts: Date.now() })
    const url = strategy.authorizeUrl(state, callbackUrl(req, provider), config.client_id)
    reply.redirect(url)
  })

  // GET /auth/via/:provider/link — initiate OAuth linking flow (must be authenticated)
  app.get(apiPath('/auth/via/:provider/link'), async (req, reply) => {
    if (!req.authUser) {
      reply.status(401).send({ error: 'Authentication required' })
      return
    }

    const provider = (req.params as { provider: string }).provider
    const strategy = strategies[provider]
    if (!strategy) {
      reply.status(404).send({ error: `Unknown provider: ${provider}` })
      return
    }

    const config = await getProviderConfig(provider)
    if (!config || !config.client_id) {
      reply.status(400).send({ error: `Provider ${provider} is not configured` })
      return
    }

    const frontendOrigin = resolveFrontendOriginForInit(req)
    const state = signState({ intent: 'link', provider, userId: req.authUser.id, frontendOrigin, ts: Date.now() })
    const url = strategy.authorizeUrl(state, callbackUrl(req, provider), config.client_id)
    reply.redirect(url)
  })

  // GET /auth/via/:provider/callback — OAuth callback from the provider
  app.get(apiPath('/auth/via/:provider/callback'), async (req, reply) => {
    const provider = (req.params as { provider: string }).provider
    const query = req.query as { code?: string; state?: string; error?: string }
    const statePayload = query.state ? verifyState(query.state) : null

    const redirectWithStatePath = (path: string): void => {
      const frontendOrigin = resolveFrontendOriginFromState(req, statePayload)
      reply.redirect(frontendRedirect(path, frontendOrigin))
    }

    if (query.error) {
      redirectWithAuthError(req, reply, statePayload, query.error)
      return
    }

    if (!query.code || !query.state) {
      redirectWithAuthError(req, reply, statePayload, 'missing_code_or_state')
      return
    }

    if (!statePayload || statePayload.provider !== provider) {
      redirectWithAuthError(req, reply, statePayload, 'invalid_state')
      return
    }

    const stateTimestamp = typeof statePayload.ts === 'number' ? statePayload.ts : Number.NaN
    if (!Number.isFinite(stateTimestamp)) {
      redirectWithAuthError(req, reply, statePayload, 'invalid_state')
      return
    }

    // Check if state is stale (10 minute window)
    const stateAge = Date.now() - stateTimestamp
    if (stateAge > 10 * 60 * 1000) {
      redirectWithAuthError(req, reply, statePayload, 'state_expired')
      return
    }

    const intent = statePayload.intent
    if (intent !== 'login' && intent !== 'link') {
      redirectWithAuthError(req, reply, statePayload, 'invalid_state')
      return
    }

    const strategy = strategies[provider]
    if (!strategy) {
      redirectWithAuthError(req, reply, statePayload, 'unknown_provider')
      return
    }

    const config = await getProviderConfig(provider)
    if (!config || !config.client_id || !config.client_secret) {
      redirectWithAuthError(req, reply, statePayload, 'provider_not_configured')
      return
    }

    let profile: { providerId: string; email: string | null; displayName: string | null }
    try {
      profile = await strategy.exchangeCode(query.code, callbackUrl(req, provider), config.client_id, config.client_secret)
    } catch (err) {
      console.error(`[oauth] ${provider} code exchange failed:`, err)
      redirectWithAuthError(req, reply, statePayload, 'exchange_failed')
      return
    }

    // ---- Link flow ----
    if (intent === 'link') {
      const userId = typeof statePayload.userId === 'string' ? statePayload.userId : null
      if (!userId) {
        redirectWithAuthError(req, reply, statePayload, 'link_session_mismatch')
        return
      }

      if (req.authUser && req.authUser.id !== userId) {
        redirectWithAuthError(req, reply, statePayload, 'link_session_mismatch')
        return
      }

      if (!req.authUser) {
        const linkTarget = await findUserById(userId)
        if (!linkTarget) {
          redirectWithAuthError(req, reply, statePayload, 'link_user_not_found')
          return
        }
      }

      // Check if this provider profile is already claimed by another user
      const existing = await findOAuthAccount(provider, profile.providerId)
      if (existing && existing.user_id !== userId) {
        redirectWithAuthError(req, reply, statePayload, 'provider_already_linked')
        return
      }

      if (!existing) {
        try {
          await linkOAuthAccount(userId, provider, profile.providerId, profile.email)
        } catch {
          redirectWithAuthError(req, reply, statePayload, 'provider_already_linked')
          return
        }
      }

      redirectWithStatePath(`/settings?oauth_linked=${encodeURIComponent(provider)}`)
      return
    }

    // ---- Login flow ----
    const result = await findUserByOAuth(provider, profile.providerId, profile.email)
    if (!result) {
      redirectWithAuthError(req, reply, statePayload, 'account_suspended_or_conflict')
      return
    }

    await setAuthCookies(req, reply, result.user.id)
    await migrateGuestData(req, reply, result.user.id)

    const acceptedInvites = await updatePendingInvitesForUser(result.user.id, result.user.email)
    if (acceptedInvites > 0) {
      console.info(`[oauth] accepted pending invites userId=${result.user.id} count=${acceptedInvites}`)
    }

    redirectWithStatePath('/')
  })

  // DELETE /auth/via/:provider/unlink — unlink an OAuth provider from the current user
  app.delete(apiPath('/auth/via/:provider/unlink'), async (req, reply) => {
    if (!req.authUser) {
      reply.status(401).send({ error: 'Authentication required' })
      return
    }

    const provider = (req.params as { provider: string }).provider

    // Check that this wouldn't leave the user with zero auth methods
    const methodCount = await countUserAuthMethods(req.authUser.id)
    if (methodCount <= 1) {
      reply.status(400).send({ error: 'Cannot unlink your only login method. Add another provider or set a password first.' })
      return
    }

    const removed = await unlinkOAuthAccount(req.authUser.id, provider)
    if (!removed) {
      reply.status(404).send({ error: 'Provider not linked' })
      return
    }

    reply.send({ ok: true })
  })
}
