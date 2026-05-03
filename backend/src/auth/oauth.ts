import crypto from 'crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  countUserAuthMethods,
  deleteUserAccount,
  findOAuthAccount,
  findUserByOAuth,
  getPasswordLoginEnabled,
  getEnabledOAuthProviders,
  linkOAuthAccount,
  listOAuthAccountsForUser,
  markInviteTokenUsed,
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
  GUEST_COOKIE_NAME,
  enforceInviteOnlySignupGate,
  issueAuthCookies,
} from '../auth.js'
import { inferRequestOrigin } from '../env.js'
import { runWithIdentityContext } from '../db/index.js'

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

function parseInviteToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  return token.length > 0 ? token : null
}

function inviteGateErrorCode(error: string | undefined): string {
  if (error === 'Invalid or expired invite token.') return 'invalid_invite'
  if (error === 'This invite was issued for a different email address.') return 'invite_email_mismatch'
  return 'invite_required'
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
  ) => Promise<{ providerId: string; email: string | null; emailVerified: boolean; displayName: string | null }>
}

const strategies: Record<string, OAuthStrategyDef> = {}

const oauthPendingTtlMs = 10 * 60 * 1000

function normalizeProviderEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

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

      // GitHub only exposes verification status via /user/emails.
      let trustedEmail: string | null = null
      try {
        const emailRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/json' },
        })
        const emails = (await emailRes.json()) as Array<{ email?: string; primary?: boolean; verified?: boolean }>
        const primary = emails.find((e) => e.primary === true && e.verified === true)
        const anyVerified = emails.find((e) => e.verified === true)
        trustedEmail = normalizeProviderEmail(primary?.email ?? anyVerified?.email)
      } catch {
        trustedEmail = null
      }

      return {
        providerId: String(userBody.id),
        email: trustedEmail,
        emailVerified: trustedEmail != null,
        displayName: userBody.login ?? null,
      }
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

      const emailVerified = userBody.verified_email === true
      return {
        providerId: userBody.id,
        email: emailVerified ? normalizeProviderEmail(userBody.email) : null,
        emailVerified,
        displayName: userBody.name ?? null,
      }
    },
  }
}

function registerOrcidStrategy(): void {
  const baseUrl = (process.env.ORCID_BASE_URL ?? 'https://orcid.org').replace(/\/+$/, '')

  strategies['orcid'] = {
    authorizeUrl: (state, callbackUrl, clientId) => {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: 'openid',
        redirect_uri: callbackUrl,
        state,
      })
      return `${baseUrl}/oauth/authorize?${params.toString()}`
    },

    exchangeCode: async (code, callbackUrl, clientId, clientSecret) => {
      const tokenBodyPayload = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
      })
      const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenBodyPayload.toString(),
      })
      const tokenBody = (await tokenRes.json()) as {
        access_token?: string
        error?: string
        error_description?: string
        name?: string
        orcid?: string
      }
      if (!tokenBody.access_token) {
        throw new Error(tokenBody.error_description ?? tokenBody.error ?? 'ORCID token exchange failed')
      }

      const userRes = await fetch(`${baseUrl}/oauth/userinfo`, {
        headers: {
          Authorization: `Bearer ${tokenBody.access_token}`,
          Accept: 'application/json',
        },
      })
      const userBody = (await userRes.json()) as {
        sub?: string
        name?: string
        email?: string
        email_verified?: boolean
      }
      const providerId = typeof userBody.sub === 'string' && userBody.sub.trim().length > 0
        ? userBody.sub.trim()
        : (typeof tokenBody.orcid === 'string' ? tokenBody.orcid.trim() : '')
      if (!providerId) {
        throw new Error('Failed to fetch ORCID user profile')
      }

      const emailVerified = userBody.email_verified === true
      return {
        providerId,
        email: emailVerified ? normalizeProviderEmail(userBody.email) : null,
        emailVerified,
        displayName: userBody.name ?? tokenBody.name ?? null,
      }
    },
  }
}

/** Call on startup to register all built-in strategy definitions. */
export function registerAllStrategies(): void {
  registerGitHubStrategy()
  registerGoogleStrategy()
  registerOrcidStrategy()
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

async function issueOAuthAuthCookies(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  await issueAuthCookies(req, reply, userId)
  await runWithIdentityContext(null, 'system', async () => await markUserLoggedIn(userId))
}

async function migrateGuestData(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  const guestUserId = req.principal.userId
  if (guestUserId && guestUserId !== userId) {
    await runWithIdentityContext(null, 'system', async () => {
      await migrateGuestProjectsToUser(guestUserId, userId)
      await migrateGuestRecentsToUser(guestUserId, userId)
      await migrateGuestWorkspaceStatesToUser(guestUserId, userId)
      await deleteUserAccount(guestUserId)
    })
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

  function oauthErrorMessage(errorCode: string): string {
    if (errorCode === 'provider_email_unverified') {
      return 'This provider email is not verified. Verify your provider email before linking or creating an account.'
    }
    if (errorCode === 'link_session_mismatch') {
      return 'Linking could not be completed because your session was not recognized. Please try again.'
    }
    if (errorCode === 'provider_already_linked') {
      return 'This provider is already linked to another account.'
    }
    if (errorCode === 'invite_required') {
      return 'Signups are currently invite-only. Use a valid invite link to create a new account.'
    }
    if (errorCode === 'invalid_invite') {
      return 'The invite link is invalid or has expired. Request a new invite and try again.'
    }
    if (errorCode === 'invite_email_mismatch') {
      return 'This invite was issued for a different email address.'
    }
    if (errorCode === 'account_suspended_or_conflict') {
      return 'Sign-in failed due to account conflict or suspension.'
    }
    return 'Authentication provider action failed. Please try again.'
  }

  function sendOAuthConfirmError(reply: FastifyReply, statusCode: number, errorCode: string): void {
    reply.status(statusCode).send({
      error: oauthErrorMessage(errorCode),
      code: errorCode,
    })
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

    const query = req.query as {
      invite_token?: string
      inviteToken?: string
    } | undefined
    const inviteToken = parseInviteToken(query?.invite_token ?? query?.inviteToken)
    const frontendOrigin = resolveFrontendOriginForInit(req)
    const state = signState({ intent: 'login', provider, frontendOrigin, inviteToken, ts: Date.now() })
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

    let profile: { providerId: string; email: string | null; emailVerified: boolean; displayName: string | null }
    try {
      profile = await strategy.exchangeCode(query.code, callbackUrl(req, provider), config.client_id, config.client_secret)
    } catch (err) {
      console.error(`[oauth] ${provider} code exchange failed:`, err)
      redirectWithAuthError(req, reply, statePayload, 'exchange_failed')
      return
    }

    const stateInviteToken = parseInviteToken(statePayload.inviteToken)
    const pendingPayload: Record<string, unknown> = {
      kind: 'oauth_pending',
      intent,
      provider,
      providerId: profile.providerId,
      email: profile.email,
      emailVerified: profile.emailVerified,
      displayName: profile.displayName,
      inviteToken: stateInviteToken,
      ts: Date.now(),
    }
    if (intent === 'link') {
      pendingPayload.userId = typeof statePayload.userId === 'string' ? statePayload.userId : null
    }

    const pendingToken = signState(pendingPayload)
    const queryParams = new URLSearchParams({
      oauth_pending: pendingToken,
      oauth_provider: provider,
      oauth_intent: intent,
    })
    const basePath = intent === 'link' ? '/settings' : '/'
    redirectWithStatePath(`${basePath}?${queryParams.toString()}`)
  })

  // POST /auth/oauth/confirm — finalize OAuth login or linking after explicit user confirmation
  app.post(apiPath('/auth/oauth/confirm'), async (req, reply) => {
    const body = req.body as { token?: string } | undefined
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!token) {
      sendOAuthConfirmError(reply, 400, 'invalid_state')
      return
    }

    const pendingPayload = verifyState(token)
    if (!pendingPayload || pendingPayload.kind !== 'oauth_pending') {
      sendOAuthConfirmError(reply, 400, 'invalid_state')
      return
    }

    const timestamp = typeof pendingPayload.ts === 'number' ? pendingPayload.ts : Number.NaN
    if (!Number.isFinite(timestamp) || (Date.now() - timestamp) > oauthPendingTtlMs) {
      sendOAuthConfirmError(reply, 400, 'state_expired')
      return
    }

    const intent = pendingPayload.intent
    const provider = typeof pendingPayload.provider === 'string' ? pendingPayload.provider : null
    const providerId = typeof pendingPayload.providerId === 'string' ? pendingPayload.providerId : null
    if ((intent !== 'login' && intent !== 'link') || !provider || !providerId) {
      sendOAuthConfirmError(reply, 400, 'invalid_state')
      return
    }

    const providerEmail = normalizeProviderEmail(pendingPayload.email)
    const providerEmailVerified = pendingPayload.emailVerified === true && providerEmail != null
    const trustedProviderEmail = providerEmailVerified ? providerEmail : null

    if (intent === 'link') {
      const userId = typeof pendingPayload.userId === 'string' ? pendingPayload.userId : null
      if (!userId || !req.authUser || req.authUser.id !== userId) {
        sendOAuthConfirmError(reply, 401, 'link_session_mismatch')
        return
      }

      const existing = await runWithIdentityContext(
        null,
        'system',
        async () => await findOAuthAccount(provider, providerId),
      )
      if (existing && existing.user_id !== userId) {
        sendOAuthConfirmError(reply, 409, 'provider_already_linked')
        return
      }

      if (!existing) {
        if (!trustedProviderEmail) {
          sendOAuthConfirmError(reply, 400, 'provider_email_unverified')
          return
        }
        try {
          await runWithIdentityContext(
            null,
            'system',
            async () => await linkOAuthAccount(userId, provider, providerId, trustedProviderEmail),
          )
        } catch {
          sendOAuthConfirmError(reply, 409, 'provider_already_linked')
          return
        }
      }

      reply.send({ ok: true, intent: 'link', provider })
      return
    }

    const result = await runWithIdentityContext(
      null,
      'system',
      async () => await findUserByOAuth(provider, providerId, trustedProviderEmail, { createIfMissing: false }),
    )

    const stateInviteToken = parseInviteToken(pendingPayload.inviteToken)

    let resolved = result
    if (!resolved) {
      if (!trustedProviderEmail) {
        sendOAuthConfirmError(reply, 400, 'provider_email_unverified')
        return
      }

      const inviteGate = await enforceInviteOnlySignupGate({
        email: trustedProviderEmail,
        inviteToken: stateInviteToken,
      })
      if (!inviteGate.ok) {
        sendOAuthConfirmError(reply, 403, inviteGateErrorCode(inviteGate.error))
        return
      }

      resolved = await runWithIdentityContext(
        null,
        'system',
        async () => await findUserByOAuth(provider, providerId, trustedProviderEmail, { createIfMissing: true }),
      )
    }
    if (!resolved) {
      sendOAuthConfirmError(reply, 403, 'account_suspended_or_conflict')
      return
    }

    if (resolved.isNew && stateInviteToken) {
      await runWithIdentityContext(null, 'system', async () => await markInviteTokenUsed(stateInviteToken))
    }

    await issueOAuthAuthCookies(req, reply, resolved.user.id)
    await migrateGuestData(req, reply, resolved.user.id)

    const acceptedInvites = await runWithIdentityContext(
      null,
      'system',
      async () => await updatePendingInvitesForUser(resolved.user.id, resolved.user.email),
    )
    if (acceptedInvites > 0) {
      console.info(`[oauth] accepted pending invites userId=${resolved.user.id} count=${acceptedInvites}`)
    }

    reply.send({ ok: true, intent: 'login', provider })
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
