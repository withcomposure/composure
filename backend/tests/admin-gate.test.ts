import { afterEach, describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestSession, sessionCookie } from './helpers/setup.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  await app?.close()
})

describe('admin gate', () => {
  it('allows CORS preflight for PATCH admin settings from trusted origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/admin/server-settings',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'content-type',
      },
    })

    expect([200, 204]).toContain(res.statusCode)

    const allowMethodsHeader = res.headers['access-control-allow-methods']
    const allowMethods = Array.isArray(allowMethodsHeader)
      ? allowMethodsHeader.join(',')
      : String(allowMethodsHeader ?? '')

    expect(allowMethods.toUpperCase()).toContain('PATCH')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('unauthenticated request to /api/v1/admin/* returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/users' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toMatch(/authentication/i)
  })

  it('non-admin user gets 403 on /api/v1/admin/*', async () => {
    // First user is admin; create a second user who is not
    await createTestUser({ email: 'admin@test.com' })
    const normalUser = await createTestUser({ email: 'normal@test.com' })
    const sessionId = await createTestSession(normalUser.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/administrator/i)
  })

  it('admin user can access /api/v1/admin/*', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().users).toBeDefined()
  })

  it('non-admin routes still accessible when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })

  it('non-admin routes still accessible by normal user', async () => {
    await createTestUser({ email: 'admin@test.com' })
    const normalUser = await createTestUser({ email: 'normal@test.com' })
    const sessionId = await createTestSession(normalUser.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().authenticated).toBe(true)
  })

  it('admin gate applies to POST endpoints too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      payload: { email: 'new@test.com', password: 'password123', displayName: 'New' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('admin gate applies to PATCH endpoints too', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/server-settings',
      payload: { signupMode: 'open' },
    })

    expect(res.statusCode).toBe(401)
  })
})
