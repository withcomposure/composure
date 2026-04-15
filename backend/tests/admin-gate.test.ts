import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestSession, sessionCookie } from './helpers/setup.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('admin gate', () => {
  it('unauthenticated request to /api/admin/* returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toMatch(/authentication/i)
  })

  it('non-admin user gets 403 on /api/admin/*', async () => {
    // First user is admin; create a second user who is not
    await createTestUser({ email: 'admin@test.com' })
    const normalUser = await createTestUser({ email: 'normal@test.com' })
    const sessionId = await createTestSession(normalUser.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/administrator/i)
  })

  it('admin user can access /api/admin/*', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
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
      url: '/api/auth/session',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().authenticated).toBe(true)
  })

  it('admin gate applies to POST endpoints too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { email: 'new@test.com', password: 'password123', displayName: 'New' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('admin gate applies to PATCH endpoints too', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/server-settings',
      payload: { signupMode: 'open' },
    })

    expect(res.statusCode).toBe(401)
  })
})
