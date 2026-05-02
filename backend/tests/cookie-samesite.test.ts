import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/setup.js'

const envKeys = [
  'FRONTEND_URL',
  'BACKEND_URL',
  'SESSION_COOKIE_SAME_SITE',
  'GUEST_COOKIE_SAME_SITE',
] as const

const originalEnv = new Map<string, string | undefined>(
  envKeys.map((key) => [key, process.env[key]]),
)

function restoreEnv(): void {
  for (const key of envKeys) {
    const original = originalEnv.get(key)
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
}

function asCookieList(header: string | string[] | undefined): string[] {
  if (!header) return []
  return (Array.isArray(header) ? header : [header]).filter((cookie): cookie is string => typeof cookie === 'string')
}

function findCookie(cookies: string[], name: string): string {
  const cookie = cookies.find((value) => value.includes(`${name}=`))
  expect(cookie).toBeDefined()
  return cookie!
}

afterEach(() => {
  restoreEnv()
})

describe('cookie SameSite policy', () => {
  it('uses strict guest and lax auth cookies by default', async () => {
    const app = await createTestApp()
    try {
      const sessionRes = await app.inject({ method: 'GET', url: '/api/v1/auth/session' })
      const guestCookie = findCookie(asCookieList(sessionRes.headers['set-cookie']), 'guest_id')
      expect(guestCookie).toContain('SameSite=Strict')

      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: { email: 'default-cookie@test.com', password: 'password123', displayName: 'Default Cookie' },
      })
      const accessCookie = findCookie(asCookieList(signupRes.headers['set-cookie']), 'composure_access')
      const refreshCookie = findCookie(asCookieList(signupRes.headers['set-cookie']), 'composure_refresh')
      expect(accessCookie).toContain('SameSite=Lax')
      expect(refreshCookie).toContain('SameSite=Lax')
    } finally {
      await app.close()
    }
  })

  it('uses SameSite=None when configured frontend and backend are cross-site', async () => {
    process.env.FRONTEND_URL = 'https://app.pages.dev'
    process.env.BACKEND_URL = 'https://api.example.com'

    const app = await createTestApp()
    try {
      const sessionRes = await app.inject({ method: 'GET', url: '/api/v1/auth/session' })
      const guestCookie = findCookie(asCookieList(sessionRes.headers['set-cookie']), 'guest_id')
      expect(guestCookie).toContain('SameSite=None')

      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: { email: 'cross-site@test.com', password: 'password123', displayName: 'Cross Site' },
      })
      const accessCookie = findCookie(asCookieList(signupRes.headers['set-cookie']), 'composure_access')
      const refreshCookie = findCookie(asCookieList(signupRes.headers['set-cookie']), 'composure_refresh')
      expect(accessCookie).toContain('SameSite=None')
      expect(refreshCookie).toContain('SameSite=None')
    } finally {
      await app.close()
    }
  })

  it('respects explicit SameSite override env vars', async () => {
    process.env.FRONTEND_URL = 'https://app.pages.dev'
    process.env.BACKEND_URL = 'https://api.example.com'
    process.env.SESSION_COOKIE_SAME_SITE = 'lax'
    process.env.GUEST_COOKIE_SAME_SITE = 'strict'

    const app = await createTestApp()
    try {
      const sessionRes = await app.inject({ method: 'GET', url: '/api/v1/auth/session' })
      const guestCookie = findCookie(asCookieList(sessionRes.headers['set-cookie']), 'guest_id')
      expect(guestCookie).toContain('SameSite=Strict')

      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: { email: 'override@test.com', password: 'password123', displayName: 'Override' },
      })
      const accessCookie = findCookie(asCookieList(signupRes.headers['set-cookie']), 'composure_access')
      const refreshCookie = findCookie(asCookieList(signupRes.headers['set-cookie']), 'composure_refresh')
      expect(accessCookie).toContain('SameSite=Lax')
      expect(refreshCookie).toContain('SameSite=Lax')
    } finally {
      await app.close()
    }
  })
})
