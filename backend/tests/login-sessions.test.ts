import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestSession, sessionCookie, guestCookie } from './helpers/setup.js'
import { sql } from '../src/db/connection.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('login', () => {
  it('login with valid credentials succeeds', async () => {
    // Signup to create the user correctly (hashes password properly)
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.authenticated).toBe(true)
    expect(body.user.email).toBe('user@test.com')
  })

  it('session cookie Max-Age is 30 days in seconds', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@test.com', password: 'password123' },
    })

    const setCookieHeader = res.headers['set-cookie']
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
    const sessionCookieVal = cookies.find((c) => c?.includes('composure_session='))
    expect(sessionCookieVal).toBeDefined()
    const maxAgeMatch = sessionCookieVal!.match(/Max-Age=(\d+)/)
    expect(maxAgeMatch).not.toBeNull()
    const maxAge = Number(maxAgeMatch![1])
    // Should be exactly 30 days in seconds (2,592,000)
    expect(maxAge).toBe(30 * 24 * 60 * 60)
  })

  it('login with wrong password fails', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@test.com', password: 'wrongpassword' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toMatch(/invalid/i)
  })

  it('login with non-existent email fails', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('login with suspended user fails', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'suspended@test.com', password: 'password123', displayName: 'Suspended User' },
    })

    // Suspend the user
    await sql`UPDATE users SET is_suspended = true WHERE email = ${'suspended@test.com'}`

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'suspended@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('migrates guest recents (with share token) to user on login', async () => {
    const userEmail = 'migrate-login@test.com'
    const guestId = '750e8400e29b41d4a716446655440000'
    const owner = await createTestUser({ email: 'owner-recents-login@test.com' })
    const projectId = '22222222bbbbccccddddeeeeeeeeeeee'

    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: userEmail, password: 'password123', displayName: 'Migrate Login' },
    })

    await sql`INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at)
       VALUES (${projectId}, 'Shared Login Project', 'main.tex', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

    await sql`INSERT INTO share_tokens (id, project_id, token, role, created_by_user_id, created_at, updated_at)
       VALUES (${'login-share-token-id'}, ${projectId}, ${'login-share-token'}, 'view', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

    await sql`INSERT INTO project_recents (id, project_id, user_id, guest_id, opened_at, share_token)
       VALUES (${'login-recent-id'}, ${projectId}, ${null}, ${guestId}, extract(epoch from now())::integer, ${'login-share-token'})`

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: userEmail, password: 'password123' },
      headers: { cookie: guestCookie(guestId) },
    })

    expect(res.statusCode).toBe(200)
    const userId = res.json().user.id as string

    const [migrated] = await sql`SELECT user_id, guest_id, share_token
       FROM project_recents
       WHERE project_id = ${projectId} AND user_id = ${userId}` as unknown as [{ user_id: string | null; guest_id: string | null; share_token: string | null } | undefined]

    expect(migrated).toBeDefined()
    expect(migrated?.user_id).toBe(userId)
    expect(migrated?.guest_id).toBeNull()
    expect(migrated?.share_token).toBe('login-share-token')
  })
})

describe('logout', () => {
  it('logout clears session', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookieHeader },
    })

    expect(logoutRes.statusCode).toBe(200)
    expect(logoutRes.json().authenticated).toBe(false)
  })
})

describe('session listing and revocation', () => {
  it('lists sessions for authenticated user', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: { cookie: cookieHeader },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sessions).toBeDefined()
    expect(body.sessions.length).toBeGreaterThanOrEqual(1)
  })

  it('unauthenticated session list returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
    })

    expect(res.statusCode).toBe(401)
  })

  it('expired sessions are excluded from session list', async () => {
    const user = await createTestUser({ email: 'user@test.com' })
    const activeSession = await createTestSession(user.id, 3600) // 1 hour
    const expiredSession = await createTestSession(user.id, -1) // already expired

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: { cookie: sessionCookie(activeSession) },
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().sessions.map((s: { id: string }) => s.id)
    expect(ids).toContain(activeSession)
    expect(ids).not.toContain(expiredSession)
  })
})

describe('password change', () => {
  it('changes password with correct current password', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: cookieHeader },
      payload: { currentPassword: 'password123', newPassword: 'newpassword456' },
    })

    expect(res.statusCode).toBe(200)

    // Verify new password works
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@test.com', password: 'newpassword456' },
    })
    expect(loginRes.statusCode).toBe(200)
  })

  it('rejects password change with wrong current password', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: cookieHeader },
      payload: { currentPassword: 'wrongcurrent', newPassword: 'newpassword456' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('profile update', () => {
  it('updating display name does not clear profile image', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    // A minimal valid 1x1 PNG data URL
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

    // Set a profile image first
    const updateRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { cookie: cookieHeader },
      payload: { email: 'user@test.com', displayName: 'Test User', profileImageUrl: dataUrl },
    })
    expect(updateRes.statusCode).toBe(200)
    expect(updateRes.json().user.profileImageUrl).toBe(dataUrl)

    // Now update only display name (no profileImageUrl in body)
    const nameOnlyRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { cookie: cookieHeader },
      payload: { email: 'user@test.com', displayName: 'New Name' },
    })
    expect(nameOnlyRes.statusCode).toBe(200)
    // Profile image should be preserved, not cleared
    expect(nameOnlyRes.json().user.profileImageUrl).toBe(dataUrl)
  })
})
