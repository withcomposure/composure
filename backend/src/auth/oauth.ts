import crypto from 'crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  countUserAuthMethods,
  createSession,
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
import { SESSION_COOKIE_NAME, GUEST_COOKIE_NAME } from '../auth.js'
import { isProductionEnv } from '../env.js'

const isProd = isProductionEnv(process.env.NODE_ENV)
const sessionMaxAgeSeconds = 30 * 24 * 60 * 60

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

function shouldUseSecureCookies(req: FastifyRequest): boolean {
  if (!isProd) return false
  const forwardedProto = req.headers['x-forwarded-proto']
  const protoHeader = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto
  if (typeof protoHeader === 'string' && protoHeader.split(',')[0].trim().toLowerCase() === 'https') {
    return true
  }
  return req.protocol === 'https'
}

function inferOriginFromRequest(req: FastifyRequest): string {
  const proto = isProd
    ? (Array.isArray(req.headers['x-forwarded-proto'])
        ? req.headers['x-forwarded-proto'][0]
        : req.headers['x-forwarded-proto']) ?? req.protocol
    : req.protocol
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'
  return `${proto}://${host}`
}

async function getProviderConfig(provider: string): Promise<OAuthProviderRow | null> {
  const enabled = await getEnabledOAuthProviders()
  return enabled.find((p) => p.provider === provider) ?? null
}

async function setSessionCookie(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  const session = await createSession(userId, sessionMaxAgeSeconds)
  await markUserLoggedIn(userId)
  reply.setCookie(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: sessionMaxAgeSeconds,
    secure: shouldUseSecureCookies(req),
    path: '/',
  })
}

async function migrateGuestData(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  const guestId = req.principal.guestId
  if (guestId) {
    await migrateGuestProjectsToUser(guestId, userId)
    await migrateGuestRecentsToUser(guestId, userId)
    await migrateGuestWorkspaceStatesToUser(guestId, userId)
    reply.clearCookie(GUEST_COOKIE_NAME, { path: '/' })
  }
}

// ---------------------------------------------------------------------------
// Register routes on the Fastify instance
// ---------------------------------------------------------------------------

export interface OAuthRoutesOptions {
  backendUrl: string | null
  frontendUrl: string | null
}

export function registerOAuthRoutes(
  app: FastifyInstance,
  apiPath: (p: string) => string,
  opts: OAuthRoutesOptions = { backendUrl: null, frontendUrl: null },
): void {
  const { backendUrl, frontendUrl } = opts

  function callbackUrl(req: FastifyRequest, provider: string): string {
    const path = apiPath(`/auth/via/${provider}/callback`)
    const origin = backendUrl ?? inferOriginFromRequest(req)
    return `${origin}${path}`
  }

  function frontendRedirect(path: string): string {
    if (frontendUrl) return `${frontendUrl}${path}`
    return path
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

    const state = signState({ intent: 'login', provider, ts: Date.now() })
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

    const state = signState({ intent: 'link', provider, userId: req.authUser.id, ts: Date.now() })
    const url = strategy.authorizeUrl(state, callbackUrl(req, provider), config.client_id)
    reply.redirect(url)
  })

  // GET /auth/via/:provider/callback — OAuth callback from the provider
  app.get(apiPath('/auth/via/:provider/callback'), async (req, reply) => {
    const provider = (req.params as { provider: string }).provider
    const query = req.query as { code?: string; state?: string; error?: string }

    if (query.error) {
      reply.redirect(frontendRedirect(`/?auth_error=${encodeURIComponent(query.error)}`))
      return
    }

    if (!query.code || !query.state) {
      reply.redirect(frontendRedirect('/?auth_error=missing_code_or_state'))
      return
    }

    const statePayload = verifyState(query.state)
    if (!statePayload || statePayload.provider !== provider) {
      reply.redirect(frontendRedirect('/?auth_error=invalid_state'))
      return
    }

    // Check if state is stale (10 minute window)
    const stateAge = Date.now() - (statePayload.ts as number)
    if (stateAge > 10 * 60 * 1000) {
      reply.redirect(frontendRedirect('/?auth_error=state_expired'))
      return
    }

    const strategy = strategies[provider]
    if (!strategy) {
      reply.redirect(frontendRedirect('/?auth_error=unknown_provider'))
      return
    }

    const config = await getProviderConfig(provider)
    if (!config || !config.client_id || !config.client_secret) {
      reply.redirect(frontendRedirect('/?auth_error=provider_not_configured'))
      return
    }

    let profile: { providerId: string; email: string | null; displayName: string | null }
    try {
      profile = await strategy.exchangeCode(query.code, callbackUrl(req, provider), config.client_id, config.client_secret)
    } catch (err) {
      console.error(`[oauth] ${provider} code exchange failed:`, err)
      reply.redirect(frontendRedirect('/?auth_error=exchange_failed'))
      return
    }

    const intent = statePayload.intent as string

    // ---- Link flow ----
    if (intent === 'link') {
      const userId = statePayload.userId as string
      if (!userId) {
        reply.redirect(frontendRedirect('/settings?auth_error=link_session_mismatch'))
        return
      }

      if (req.authUser && req.authUser.id !== userId) {
        reply.redirect(frontendRedirect('/settings?auth_error=link_session_mismatch'))
        return
      }

      if (!req.authUser) {
        const linkTarget = await findUserById(userId)
        if (!linkTarget) {
          reply.redirect(frontendRedirect('/settings?auth_error=link_user_not_found'))
          return
        }
      }

      // Check if this provider profile is already claimed by another user
      const existing = await findOAuthAccount(provider, profile.providerId)
      if (existing && existing.user_id !== userId) {
        reply.redirect(frontendRedirect('/settings?auth_error=provider_already_linked'))
        return
      }

      if (!existing) {
        try {
          await linkOAuthAccount(userId, provider, profile.providerId, profile.email)
        } catch {
          reply.redirect(frontendRedirect('/settings?auth_error=provider_already_linked'))
          return
        }
      }

      reply.redirect(frontendRedirect('/settings?oauth_linked=' + provider))
      return
    }

    // ---- Login flow ----
    const result = await findUserByOAuth(provider, profile.providerId, profile.email)
    if (!result) {
      reply.redirect(frontendRedirect('/?auth_error=account_suspended_or_conflict'))
      return
    }

    await setSessionCookie(req, reply, result.user.id)
    await migrateGuestData(req, reply, result.user.id)

    const acceptedInvites = await updatePendingInvitesForUser(result.user.id, result.user.email)
    if (acceptedInvites > 0) {
      console.info(`[oauth] accepted pending invites userId=${result.user.id} count=${acceptedInvites}`)
    }

    reply.redirect(frontendRedirect('/'))
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
