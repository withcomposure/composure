import type { FastifyInstance } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { signState } from '../src/auth/oauth.js'
import { sql } from '../src/db/connection.js'
import {
  createTestApp,
  createTestInviteToken,
  createTestUser,
  setTestSignupMode,
} from './helpers/setup.js'

const mutableEnvKeys = ['API_BASE_PATH', 'BACKEND_URL', 'FRONTEND_URL', 'CORS_ORIGIN'] as const

type MutableEnvKey = (typeof mutableEnvKeys)[number]
type EnvSnapshot = Record<MutableEnvKey, string | undefined>

function applyEnv(overrides: Partial<Record<MutableEnvKey, string>>): EnvSnapshot {
  const snapshot = {} as EnvSnapshot
  for (const key of mutableEnvKeys) {
    snapshot[key] = process.env[key]
    delete process.env[key]
  }

  for (const key of mutableEnvKeys) {
    const value = overrides[key]
    if (typeof value === 'string') {
      process.env[key] = value
    }
  }

  return snapshot
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of mutableEnvKeys) {
    const value = snapshot[key]
    if (typeof value === 'string') {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }
}

async function enableGithubProvider(): Promise<void> {
  await sql`
    UPDATE oauth_providers
    SET enabled = true,
        client_id = 'github-client-id',
        client_secret = 'github-client-secret',
        updated_at = extract(epoch from now())::integer
    WHERE provider = 'github'
  `
}

async function enableOrcidProvider(): Promise<void> {
  await sql`
    UPDATE oauth_providers
    SET enabled = true,
        client_id = 'orcid-client-id',
        client_secret = 'orcid-client-secret',
        updated_at = extract(epoch from now())::integer
    WHERE provider = 'orcid'
  `
}

function extractStateFromAuthorizeRedirect(location: string | undefined): string {
  expect(location).toBeDefined()
  const authUrl = new URL(location as string)
  const state = authUrl.searchParams.get('state')
  expect(state).toBeTruthy()
  return state as string
}

function asCookieList(header: string | string[] | undefined): string[] {
  if (!header) return []
  return (Array.isArray(header) ? header : [header]).filter((cookie): cookie is string => typeof cookie === 'string')
}

function extractPendingTokenFromRedirect(location: string | undefined): string {
  expect(location).toBeDefined()
  const redirected = new URL(location as string, 'http://localhost')
  const token = redirected.searchParams.get('oauth_pending')
  expect(token).toBeTruthy()
  return token as string
}

describe('oauth redirect targets', () => {
  it('redirects callback errors to return_to origin in split deployments', async () => {
    const snapshot = applyEnv({
      API_BASE_PATH: '/',
      CORS_ORIGIN: 'https://withcomposure.app',
    })

    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()

      const start = await app.inject({
        method: 'GET',
        url: `/v1/auth/via/github/login?return_to=${encodeURIComponent('https://withcomposure.app/projects')}`,
        headers: {
          host: 'api.withcomposure.app',
          'x-forwarded-proto': 'https',
        },
      })

      expect(start.statusCode).toBe(302)
      const state = extractStateFromAuthorizeRedirect(start.headers.location)

      const callback = await app.inject({
        method: 'GET',
        url: `/v1/auth/via/github/callback?error=access_denied&state=${encodeURIComponent(state)}`,
        headers: {
          host: 'api.withcomposure.app',
          'x-forwarded-proto': 'https',
        },
      })

      expect(callback.statusCode).toBe(302)
      expect(callback.headers.location).toBe('https://withcomposure.app/?auth_error=access_denied')
    } finally {
      if (app) {
        await app.close()
      }
      restoreEnv(snapshot)
    }
  })

  it('uses referrer origin for callback redirects when FRONTEND_URL is unset', async () => {
    const snapshot = applyEnv({
      API_BASE_PATH: '/',
      CORS_ORIGIN: 'https://withcomposure.app',
    })

    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()

      const start = await app.inject({
        method: 'GET',
        url: '/v1/auth/via/github/login',
        headers: {
          host: 'api.withcomposure.app',
          'x-forwarded-proto': 'https',
          referer: 'https://withcomposure.app/settings',
        },
      })

      expect(start.statusCode).toBe(302)
      const state = extractStateFromAuthorizeRedirect(start.headers.location)

      const callback = await app.inject({
        method: 'GET',
        url: `/v1/auth/via/github/callback?error=access_denied&state=${encodeURIComponent(state)}`,
        headers: {
          host: 'api.withcomposure.app',
          'x-forwarded-proto': 'https',
        },
      })

      expect(callback.statusCode).toBe(302)
      expect(callback.headers.location).toBe('https://withcomposure.app/?auth_error=access_denied')
    } finally {
      if (app) {
        await app.close()
      }
      restoreEnv(snapshot)
    }
  })

  it('uses configured FRONTEND_URL as fallback callback target', async () => {
    const snapshot = applyEnv({
      API_BASE_PATH: '/',
      FRONTEND_URL: 'https://withcomposure.app',
    })

    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()

      const start = await app.inject({
        method: 'GET',
        url: '/v1/auth/via/github/login',
        headers: {
          host: 'api.withcomposure.app',
          'x-forwarded-proto': 'https',
        },
      })

      expect(start.statusCode).toBe(302)
      const state = extractStateFromAuthorizeRedirect(start.headers.location)

      const callback = await app.inject({
        method: 'GET',
        url: `/v1/auth/via/github/callback?error=access_denied&state=${encodeURIComponent(state)}`,
        headers: {
          host: 'api.withcomposure.app',
          'x-forwarded-proto': 'https',
        },
      })

      expect(callback.statusCode).toBe(302)
      expect(callback.headers.location).toBe('https://withcomposure.app/?auth_error=access_denied')
    } finally {
      if (app) {
        await app.close()
      }
      restoreEnv(snapshot)
    }
  })

  it('builds provider callback URL using BACKEND_URL and API_BASE_PATH', async () => {
    const snapshot = applyEnv({
      API_BASE_PATH: '/my/api',
      BACKEND_URL: 'https://api.withcomposure.app',
      CORS_ORIGIN: 'https://withcomposure.app',
    })

    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()

      const start = await app.inject({
        method: 'GET',
        url: `/my/api/v1/auth/via/github/login?return_to=${encodeURIComponent('https://withcomposure.app')}`,
      })

      expect(start.statusCode).toBe(302)
      const authUrl = new URL(start.headers.location as string)
      expect(authUrl.searchParams.get('redirect_uri')).toBe(
        'https://api.withcomposure.app/my/api/v1/auth/via/github/callback',
      )
    } finally {
      if (app) {
        await app.close()
      }
      restoreEnv(snapshot)
    }
  })

  it('routes provider callback errors to settings for link intent', async () => {
    const snapshot = applyEnv({
      API_BASE_PATH: '/',
      CORS_ORIGIN: 'https://withcomposure.app',
    })

    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()

      const state = signState({
        intent: 'link',
        provider: 'github',
        userId: 'user-1',
        frontendOrigin: 'https://withcomposure.app',
        ts: Date.now(),
      })

      const callback = await app.inject({
        method: 'GET',
        url: `/v1/auth/via/github/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      })

      expect(callback.statusCode).toBe(302)
      expect(callback.headers.location).toBe('https://withcomposure.app/settings?auth_error=access_denied')
    } finally {
      if (app) {
        await app.close()
      }
      restoreEnv(snapshot)
    }
  })

  it('sets auth cookies when an existing linked account completes the callback', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()
      const user = await createTestUser({ email: 'oauth-linked@test.com' })
      await sql`
        INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, linked_at)
        VALUES ('oauth-callback-linked-id', ${user.id}, 'github', '12345', ${user.email}, extract(epoch from now())::integer)
      `

      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 12345,
          login: 'oauth-linked',
          email: user.email,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { email: user.email, primary: true, verified: true },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'login', provider: 'github', ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      })

      expect(callback.statusCode).toBe(302)
      const pendingToken = extractPendingTokenFromRedirect(callback.headers.location)
      const callbackCookies = asCookieList(callback.headers['set-cookie'])
      expect(callbackCookies.some((cookie) => cookie.startsWith('composure_access='))).toBe(false)
      expect(callbackCookies.some((cookie) => cookie.startsWith('composure_refresh='))).toBe(false)

      const confirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/confirm',
        payload: { token: pendingToken },
      })
      expect(confirm.statusCode).toBe(200)
      const cookies = asCookieList(confirm.headers['set-cookie'])
      expect(cookies.some((cookie) => cookie.startsWith('composure_access='))).toBe(true)
      expect(cookies.some((cookie) => cookie.startsWith('composure_refresh='))).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
      if (app) {
        await app.close()
      }
    }
  })

  it('blocks OAuth new-account creation in invite-only mode without invite token', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()
      await createTestUser({ email: 'admin@test.com' })
      await setTestSignupMode('invite-only')

      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 7788,
          login: 'new-oauth-user',
          email: 'new-oauth@test.com',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { email: 'new-oauth@test.com', primary: true, verified: true },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'login', provider: 'github', ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      })

      expect(callback.statusCode).toBe(302)
      const pendingToken = extractPendingTokenFromRedirect(callback.headers.location)

      const confirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/confirm',
        payload: { token: pendingToken },
      })
      expect(confirm.statusCode).toBe(403)
      expect((confirm.json() as { error: string }).error).toMatch(/invite-only/i)

      const [{ count }] = await sql<[{ count: number }]>
        `SELECT COUNT(1)::integer AS count FROM users`
      expect(count).toBe(1)
    } finally {
      vi.unstubAllGlobals()
      if (app) {
        await app.close()
      }
    }
  })

  it('allows OAuth new-account creation with a valid invite token and consumes it', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()
      await createTestUser({ email: 'admin@test.com' })
      await setTestSignupMode('invite-only')
      const inviteToken = await createTestInviteToken({ email: 'invited-oauth@test.com' })

      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 8899,
          login: 'invited-oauth',
          email: 'invited-oauth@test.com',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { email: 'invited-oauth@test.com', primary: true, verified: true },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const start = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/login?invite_token=${encodeURIComponent(inviteToken)}`,
      })
      expect(start.statusCode).toBe(302)
      const state = extractStateFromAuthorizeRedirect(start.headers.location)

      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      })

      expect(callback.statusCode).toBe(302)
      const pendingToken = extractPendingTokenFromRedirect(callback.headers.location)

      const confirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/confirm',
        payload: { token: pendingToken },
      })
      expect(confirm.statusCode).toBe(200)
      const cookies = asCookieList(confirm.headers['set-cookie'])
      expect(cookies.some((cookie) => cookie.startsWith('composure_access='))).toBe(true)
      expect(cookies.some((cookie) => cookie.startsWith('composure_refresh='))).toBe(true)

      const [{ userCount }] = await sql<[{ userCount: number }]>
        `SELECT COUNT(1)::integer AS "userCount" FROM users`
      expect(userCount).toBe(2)

      const [inviteRow] = await sql<[{ used_at: number | null }]>
        `SELECT used_at FROM invite_tokens WHERE token = ${inviteToken}`
      expect(inviteRow?.used_at).not.toBeNull()
    } finally {
      vi.unstubAllGlobals()
      if (app) {
        await app.close()
      }
    }
  })

  it('blocks linking when provider email is not verified', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()

      const user = await createTestUser({ email: 'link-unverified@test.com' })
      const session = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: 'testpassword123' },
      })
      const loginCookies = asCookieList(session.headers['set-cookie'])
      const cookieHeader = loginCookies.map((cookie) => cookie.split(';')[0]).join('; ')

      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 654321, login: 'no-verified-email' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { email: 'unverified@test.com', primary: true, verified: false },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'link', provider: 'github', userId: user.id, ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
        headers: { cookie: cookieHeader },
      })
      expect(callback.statusCode).toBe(302)
      const pendingToken = extractPendingTokenFromRedirect(callback.headers.location)

      const confirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/confirm',
        headers: { cookie: cookieHeader },
        payload: { token: pendingToken },
      })
      expect(confirm.statusCode).toBe(400)
      expect((confirm.json() as { error: string }).error).toMatch(/not verified/i)

      const [{ count }] = await sql<[{ count: number }]>`
        SELECT COUNT(1)::integer AS count
        FROM oauth_accounts
        WHERE user_id = ${user.id} AND provider = 'github'
      `
      expect(count).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      if (app) {
        await app.close()
      }
    }
  })

  it('allows existing linked login even without a verified provider email', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()
      const user = await createTestUser({ email: 'existing-link-no-verified@test.com' })
      await sql`
        INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, linked_at)
        VALUES ('oauth-existing-no-verified', ${user.id}, 'github', '44444', ${user.email}, extract(epoch from now())::integer)
      `

      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 44444, login: 'existing-linked-user' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { email: user.email, primary: true, verified: false },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'login', provider: 'github', ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      })
      expect(callback.statusCode).toBe(302)
      const pendingToken = extractPendingTokenFromRedirect(callback.headers.location)

      const confirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/confirm',
        payload: { token: pendingToken },
      })
      expect(confirm.statusCode).toBe(200)
      const cookies = asCookieList(confirm.headers['set-cookie'])
      expect(cookies.some((cookie) => cookie.startsWith('composure_access='))).toBe(true)
      expect(cookies.some((cookie) => cookie.startsWith('composure_refresh='))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      if (app) {
        await app.close()
      }
    }
  })

  it('requires profile completion for ORCID logins without trusted email and creates account only after email submit', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableOrcidProvider()

      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({
          access_token: 'orcid-access-token',
          orcid: '0009-0005-2240-3745',
          name: 'Sebastian JH Seager',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          sub: '0009-0005-2240-3745',
          name: 'Sebastian JH Seager',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'login', provider: 'orcid', ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/orcid/callback?code=ok&state=${encodeURIComponent(state)}`,
      })

      expect(callback.statusCode).toBe(302)
      const pendingToken = extractPendingTokenFromRedirect(callback.headers.location)

      const confirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/confirm',
        payload: { token: pendingToken },
      })

      expect(confirm.statusCode).toBe(200)
      const confirmBody = confirm.json() as {
        ok: boolean
        requiresProfileCompletion?: boolean
        completionToken?: string
      }
      expect(confirmBody.ok).toBe(true)
      expect(confirmBody.requiresProfileCompletion).toBe(true)
      expect(confirmBody.completionToken).toBeTruthy()

      const confirmCookies = asCookieList(confirm.headers['set-cookie'])
      expect(confirmCookies.some((cookie) => cookie.startsWith('composure_access='))).toBe(false)
      expect(confirmCookies.some((cookie) => cookie.startsWith('composure_refresh='))).toBe(false)

      const complete = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/complete-profile',
        payload: {
          token: confirmBody.completionToken,
          email: 'orcid-user@test.com',
        },
      })

      expect(complete.statusCode).toBe(200)
      const cookies = asCookieList(complete.headers['set-cookie'])
      expect(cookies.some((cookie) => cookie.startsWith('composure_access='))).toBe(true)
      expect(cookies.some((cookie) => cookie.startsWith('composure_refresh='))).toBe(true)

      const [user] = await sql<[{ email: string; email_verified: boolean }]>
        `SELECT email, email_verified FROM users WHERE email = 'orcid-user@test.com' LIMIT 1`
      expect(user).toBeTruthy()
      expect(user?.email_verified).toBe(false)

      const [account] = await sql<[{ provider: string; provider_id: string; email: string | null }]>
        `SELECT provider, provider_id, email FROM oauth_accounts WHERE provider = 'orcid' AND provider_id = '0009-0005-2240-3745' LIMIT 1`
      expect(account).toBeTruthy()
      expect(account?.email).toBe('orcid-user@test.com')
    } finally {
      vi.unstubAllGlobals()
      if (app) {
        await app.close()
      }
    }
  })

  it('blocks automatic email-based merge when existing account email is unverified', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()
      const user = await createTestUser({ email: 'alice@example.com' })

      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 998877, login: 'alice' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { email: 'alice@example.com', primary: true, verified: true },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'login', provider: 'github', ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      })
      expect(callback.statusCode).toBe(302)
      const pendingToken = extractPendingTokenFromRedirect(callback.headers.location)

      const confirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/confirm',
        payload: { token: pendingToken },
      })
      expect(confirm.statusCode).toBe(409)
      expect((confirm.json() as { error: string }).error).toMatch(/already exists/i)

      const [{ count }] = await sql<[{ count: number }]>
        `SELECT COUNT(1)::integer AS count FROM oauth_accounts WHERE user_id = ${user.id} AND provider = 'github'`
      expect(count).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      if (app) {
        await app.close()
      }
    }
  })

  it('allows automatic email-based merge only when both sides are verified', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableGithubProvider()
      const user = await createTestUser({ email: 'verified@example.com' })
      await sql`UPDATE users SET email_verified = TRUE WHERE id = ${user.id}`

      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 112233, login: 'verified-user' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { email: 'verified@example.com', primary: true, verified: true },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'login', provider: 'github', ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      })
      expect(callback.statusCode).toBe(302)
      const pendingToken = extractPendingTokenFromRedirect(callback.headers.location)

      const confirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/confirm',
        payload: { token: pendingToken },
      })
      expect(confirm.statusCode).toBe(200)

      const [{ count }] = await sql<[{ count: number }]>
        `SELECT COUNT(1)::integer AS count FROM oauth_accounts WHERE user_id = ${user.id} AND provider = 'github'`
      expect(count).toBe(1)
    } finally {
      vi.unstubAllGlobals()
      if (app) {
        await app.close()
      }
    }
  })

  it('starts ORCID OAuth flow when provider is enabled', async () => {
    let app: FastifyInstance | null = null
    try {
      app = await createTestApp()
      await enableOrcidProvider()

      const start = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/via/orcid/login',
      })

      expect(start.statusCode).toBe(302)
      const authUrl = new URL(start.headers.location as string)
      expect(authUrl.origin).toBe('https://orcid.org')
      expect(authUrl.pathname).toBe('/oauth/authorize')
      expect(authUrl.searchParams.get('scope')).toBe('openid')
      expect(authUrl.searchParams.get('client_id')).toBe('orcid-client-id')
      expect(authUrl.searchParams.get('response_type')).toBe('code')
    } finally {
      if (app) {
        await app.close()
      }
    }
  })
})
