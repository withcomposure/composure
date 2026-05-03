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
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'login', provider: 'github', ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      })

      expect(callback.statusCode).toBe(302)
      expect(callback.headers.location === '/' || callback.headers.location === 'http://localhost/').toBe(true)
      const cookies = asCookieList(callback.headers['set-cookie'])
      expect(cookies.some((cookie) => cookie.startsWith('composure_access='))).toBe(true)
      expect(cookies.some((cookie) => cookie.startsWith('composure_refresh='))).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
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
      vi.stubGlobal('fetch', fetchMock)

      const state = signState({ intent: 'login', provider: 'github', ts: Date.now() })
      const callback = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/via/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      })

      expect(callback.statusCode).toBe(302)
      expect(callback.headers.location).toBe('/?auth_error=invite_required')
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
      expect(callback.headers.location === '/' || callback.headers.location === 'http://localhost/').toBe(true)
      const cookies = asCookieList(callback.headers['set-cookie'])
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
})
