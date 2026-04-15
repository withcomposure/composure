import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestSession, sessionCookie } from './helpers/setup.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('admin — user management', () => {
  it('lists users', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)
    await createTestUser({ email: 'user1@test.com' })
    await createTestUser({ email: 'user2@test.com' })

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().users.length).toBe(3) // admin + 2 users
  })

  it('creates a user from admin panel', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie: sessionCookie(sessionId) },
      payload: {
        email: 'newuser@test.com',
        displayName: 'New User',
        password: 'password123',
        role: 'user',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().user.email).toBe('newuser@test.com')
  })

  it('rejects duplicate email on admin create', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)
    await createTestUser({ email: 'existing@test.com' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie: sessionCookie(sessionId) },
      payload: {
        email: 'existing@test.com',
        displayName: 'Duplicate',
        password: 'password123',
        role: 'user',
      },
    })

    expect(res.statusCode).toBe(409)
  })

  it('updates a user role from admin panel', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)
    const user = await createTestUser({ email: 'user@test.com' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.id}`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { role: 'admin' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('prevents demoting last admin', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { role: 'user' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('admin — server settings', () => {
  it('retrieves server settings', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/server-settings',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.signupMode).toBeDefined()
    expect(body.guestSignupsEnabled).toBe(true)
  })

  it('updates server settings', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/server-settings',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { signupMode: 'invite-only' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('toggles guest signups off and on', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const off = await app.inject({
      method: 'PATCH',
      url: '/api/admin/server-settings',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { guestSignupsEnabled: false },
    })

    expect(off.statusCode).toBe(200)
    expect(off.json().guestSignupsEnabled).toBe(false)

    const on = await app.inject({
      method: 'PATCH',
      url: '/api/admin/server-settings',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { guestSignupsEnabled: true },
    })

    expect(on.statusCode).toBe(200)
    expect(on.json().guestSignupsEnabled).toBe(true)
  })
})

describe('admin — invite tokens', () => {
  it('creates an invite token', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/invites',
      headers: { cookie: sessionCookie(sessionId) },
      payload: {},
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().token).toBeDefined()
  })

  it('lists invite tokens', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/invites',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().invites).toBeDefined()
  })
})
