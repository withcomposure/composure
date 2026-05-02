import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { signState } from '../src/auth/oauth.js'
import { sql } from '../src/db/connection.js'
import { createTestApp } from './helpers/setup.js'

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
})
