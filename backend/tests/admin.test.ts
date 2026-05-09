import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestSession, sessionCookie } from './helpers/setup.js'
import { sql } from '../src/db/connection.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await app?.close()
})

describe('admin — user management', () => {
  it('lists users', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)
    await createTestUser({ email: 'user1@test.com' })
    await createTestUser({ email: 'user2@test.com' })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
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
      url: '/api/v1/admin/users',
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
      url: '/api/v1/admin/users',
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
      url: `/api/v1/admin/users/${user.id}`,
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
      url: `/api/v1/admin/users/${admin.id}`,
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
      url: '/api/v1/admin/server-settings',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.signupMode).toBeDefined()
    expect(body.guestSignupsEnabled).toBe(true)
    expect(body.chatHistoryRetentionDays).toBeDefined()
  })

  it('updates server settings', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/server-settings',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { signupMode: 'invite-only', chatHistoryRetentionDays: 14 },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.signupMode).toBe('invite-only')
    expect(body.chatHistoryRetentionDays).toBe(14)
  })

  it('supports session-only chat retention mode', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/server-settings',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { chatHistoryRetentionDays: 'off' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.chatHistoryRetentionDays).toBe('off')
  })

  it('toggles guest signups off and on', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const off = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/server-settings',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { guestSignupsEnabled: false },
    })

    expect(off.statusCode).toBe(200)
    expect(off.json().guestSignupsEnabled).toBe(false)

    const on = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/server-settings',
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
      url: '/api/v1/admin/invites',
      headers: { cookie: sessionCookie(sessionId) },
      payload: {},
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().token).toBeDefined()
  })

  it('creates invite URLs with path routes (not hash routes)', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invites',
      headers: {
        cookie: sessionCookie(sessionId),
        origin: 'http://localhost:5173',
      },
      payload: {},
    })

    expect(res.statusCode).toBe(201)
    const url = res.json().url as string
    expect(url).toContain('/invite?token=')
    expect(url).not.toContain('/#/invite')
  })

  it('rejects untrusted origin headers for cookie-auth invite creation', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invites',
      headers: {
        cookie: sessionCookie(sessionId),
        origin: 'https://evil.example.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.withcomposure.test',
      },
      payload: {},
    })

    expect(res.statusCode).toBe(403)
  })

  it('lists invite tokens', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/invites',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().invites).toBeDefined()
  })
})

describe('admin — password reset links', () => {
  it('creates password reset URLs with path routes (not hash routes)', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const user = await createTestUser({ email: 'member@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${user.id}/password-reset-link`,
      headers: {
        cookie: sessionCookie(sessionId),
        origin: 'http://localhost:5173',
      },
    })

    expect(res.statusCode).toBe(200)
    const url = res.json().url as string
    expect(url).toContain('/reset-password?token=')
    expect(url).not.toContain('/#/reset-password')
  })
})

describe('admin — login providers', () => {
  it('includes password provider in login provider list', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/login-providers',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    const passwordProvider = res.json().providers.find((p: { provider: string }) => p.provider === 'password')
    expect(passwordProvider).toBeDefined()
    expect(passwordProvider.enabled).toBe(true)
  })

  it('rejects updates that would disable all login providers', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/login-providers',
      headers: { cookie: sessionCookie(sessionId) },
      payload: {
        providers: [{ provider: 'password', enabled: false }],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/at least one login provider/i)
  })

  it('does not strand users with null password hash when disabling password provider', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)
    const passwordOnlyUser = await createTestUser({ email: 'password-only@test.com' })
    const oauthOnlyUser = await createTestUser({ email: 'oauth-only@test.com' })

    await sql`
      INSERT INTO oauth_providers (provider, enabled, client_id, client_secret, updated_at)
      VALUES ('github', true, 'test-client-id', 'test-client-secret', extract(epoch from now())::integer)
      ON CONFLICT (provider) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        updated_at = EXCLUDED.updated_at
    `

    await sql`UPDATE users SET password_hash = NULL WHERE id = ${oauthOnlyUser.id}`
    await sql`
      INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, linked_at)
      VALUES ('oauth-account-admin-stranded-id', ${oauthOnlyUser.id}, 'github', 'github-provider-id-admin-stranded', ${oauthOnlyUser.email}, extract(epoch from now())::integer)
    `

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login-providers/check-stranded',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { providersToDisable: ['password'] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { strandedUserIds: string[] }
    expect(body.strandedUserIds).toContain(passwordOnlyUser.id)
    expect(body.strandedUserIds).not.toContain(oauthOnlyUser.id)
  })

  it('tests provider credentials using saved client secret when keep-secret is requested', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    await sql`
      INSERT INTO oauth_providers (provider, enabled, client_id, client_secret, updated_at)
      VALUES ('github', true, 'stored-client-id', 'stored-client-secret', extract(epoch from now())::integer)
      ON CONFLICT (provider) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        updated_at = EXCLUDED.updated_at
    `

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'bad_verification_code' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login-providers/test',
      headers: { cookie: sessionCookie(sessionId) },
      payload: {
        provider: 'github',
        clientId: 'stored-client-id',
        clientSecret: '__keep__',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const sentBody = JSON.parse(String(requestOptions?.body ?? '{}')) as { client_secret?: string }
    expect(sentBody.client_secret).toBe('stored-client-secret')
  })

  it('returns 400 when keep-secret is requested but no saved secret exists', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const sessionId = await createTestSession(admin.id)

    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login-providers/test',
      headers: { cookie: sessionCookie(sessionId) },
      payload: {
        provider: 'github',
        clientId: 'missing-secret-client-id',
        clientSecret: '__keep__',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/saved client secret not found/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
