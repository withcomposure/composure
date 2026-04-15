import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestSession, sessionCookie, guestCookie, setTestGuestSignups } from './helpers/setup.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('auth hook — session resolution', () => {
  it('unauthenticated request gets no authUser', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/session' })
    const body = res.json()

    expect(res.statusCode).toBe(200)
    expect(body.authenticated).toBe(false)
    expect(body.user).toBeNull()
  })

  it('valid session cookie resolves to correct user', async () => {
    const user = await createTestUser({ email: 'alice@test.com', displayName: 'Alice' })
    const sessionId = await createTestSession(user.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: sessionCookie(sessionId) },
    })
    const body = res.json()

    expect(res.statusCode).toBe(200)
    expect(body.authenticated).toBe(true)
    expect(body.user.id).toBe(user.id)
    expect(body.user.email).toBe('alice@test.com')
    expect(body.user.displayName).toBe('Alice')
  })

  it('expired session is rejected', async () => {
    const user = await createTestUser()
    // Create session that expired 1 second ago
    const sessionId = await createTestSession(user.id, -1)

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: sessionCookie(sessionId) },
    })
    const body = res.json()

    expect(body.authenticated).toBe(false)
    expect(body.user).toBeNull()
  })

  it('invalid session cookie gets no authUser', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: sessionCookie('nonexistent-session-id') },
    })
    const body = res.json()

    expect(body.authenticated).toBe(false)
    expect(body.user).toBeNull()
  })

  it('guest cookie is preserved/returned in principal', async () => {
    const guestId = '550e8400e29b41d4a716446655440000'
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: guestCookie(guestId) },
    })
    const body = res.json()

    expect(body.authenticated).toBe(false)
    expect(body.principal.guestId).toBe(guestId)
  })

  it('sets guest cookie when none provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
    })

    const setCookieHeader = res.headers['set-cookie']
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
    const guestCookieSet = cookies.some((c) => c?.includes('guest_id='))
    expect(guestCookieSet).toBe(true)
  })

  it('guest cookie Max-Age is 90 days in seconds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
    })

    const setCookieHeader = res.headers['set-cookie']
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
    const guestCookie = cookies.find((c) => c?.includes('guest_id='))
    expect(guestCookie).toBeDefined()
    const maxAgeMatch = guestCookie!.match(/Max-Age=(\d+)/)
    expect(maxAgeMatch).not.toBeNull()
    const maxAge = Number(maxAgeMatch![1])
    // Should be exactly 90 days in seconds (7,776,000)
    expect(maxAge).toBe(90 * 24 * 60 * 60)
  })

  it('guestRetentionDays matches actual cookie lifetime', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/session' })
    const body = res.json()
    expect(body.guestRetentionDays).toBe(90)
  })

  it('returns correct userCount and signupMode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/session' })
    const body = res.json()

    expect(body.userCount).toBe(0)
    expect(body.signupMode).toBe('open')
  })

  it('session includes guestSignupsEnabled defaulting to true', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/session' })
    const body = res.json()
    expect(body.guestSignupsEnabled).toBe(true)
  })

  it('does not set guest cookie when guest signups are disabled', async () => {
    await setTestGuestSignups(false)
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
    })

    const setCookieHeader = res.headers['set-cookie']
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
    const guestCookieSet = cookies.some((c) => c?.includes('guest_id='))
    expect(guestCookieSet).toBe(false)
    expect(res.json().guestSignupsEnabled).toBe(false)
  })

  it('preserves existing guest cookie when guest signups are disabled', async () => {
    const existingGuestId = '550e8400e29b41d4a716446655440000'
    await setTestGuestSignups(false)
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: guestCookie(existingGuestId) },
    })

    const body = res.json()
    expect(body.principal.guestId).toBe(existingGuestId)
  })
})

describe('X-Content-Type-Options header', () => {
  it('adds nosniff header on all responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})
