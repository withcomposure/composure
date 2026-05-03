import crypto from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestSession, sessionCookie, guestCookie } from './helpers/setup.js'
import { sql } from '../src/db/connection.js'
import { runWithIdentityContext } from '../src/db/request-context.js'
import { resolvePrincipalFromCookieHeader } from '../src/auth.js'
import {
  decodeAccessTokenUnsafe,
  resetJwtForTests,
  signAccessToken,
  verifyAccessToken,
} from '../src/auth/jwt.js'

let app: FastifyInstance
const originalJwtEnv = {
  privateKey: process.env.JWT_PRIVATE_KEY_PEM,
  publicKey: process.env.JWT_PUBLIC_KEY_PEM,
  issuer: process.env.JWT_ISSUER,
}

function asCookieList(setCookieHeader: string | string[] | undefined): string[] {
  if (!setCookieHeader) {
    return []
  }
  return Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
}

function restoreEnvValue(name: 'JWT_PRIVATE_KEY_PEM' | 'JWT_PUBLIC_KEY_PEM' | 'JWT_ISSUER', value: string | undefined): void {
  if (value == null) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

function getSetCookieValue(cookies: string[], name: string): string {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`))
  expect(match).toBeDefined()
  return match!.split(';')[0]!.slice(name.length + 1)
}

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(() => {
  restoreEnvValue('JWT_PRIVATE_KEY_PEM', originalJwtEnv.privateKey)
  restoreEnvValue('JWT_PUBLIC_KEY_PEM', originalJwtEnv.publicKey)
  restoreEnvValue('JWT_ISSUER', originalJwtEnv.issuer)
  resetJwtForTests()
})

describe('jwks endpoint', () => {
  it('is public and does not create guest identity side effects', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/jwks.json',
      headers: { cookie: guestCookie('550e8400e29b41d4a716446655440000') },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { keys?: Array<{ alg?: string; kid?: string; use?: string }> }
    expect(body.keys).toHaveLength(1)
    expect(body.keys?.[0]).toMatchObject({ alg: 'RS256', use: 'sig' })
    expect(typeof body.keys?.[0]?.kid).toBe('string')
    expect(body.keys?.[0]?.kid?.length).toBeGreaterThan(0)

    const cookies = asCookieList(res.headers['set-cookie'])
    expect(cookies.some((cookie) => cookie.startsWith('guest_id='))).toBe(false)
    expect(cookies.some((cookie) => cookie.startsWith('composure_access='))).toBe(false)
    expect(cookies.some((cookie) => cookie.startsWith('composure_refresh='))).toBe(false)

    const [guestCount] = await sql<[{ count: number }?]>`
      SELECT count(*)::integer AS count FROM users WHERE is_guest = true
    `
    expect(guestCount?.count).toBe(0)
  })
})

describe('jwt signing keys', () => {
  it('verifies cookie JWTs after restart when stable keys and issuer are configured', async () => {
    const user = await createTestUser({ email: 'stable-jwt@test.com' })
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const issuer = 'https://api.withcomposure.test'

    process.env.JWT_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.JWT_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.JWT_ISSUER = issuer
    resetJwtForTests()

    const { token } = await signAccessToken(user.id)
    expect((await decodeAccessTokenUnsafe(token))?.iss).toBe(issuer)
    expect((await verifyAccessToken(token))?.sub).toBe(user.id)

    resetJwtForTests()
    expect((await verifyAccessToken(token))?.sub).toBe(user.id)
    await expect(resolvePrincipalFromCookieHeader(`composure_access=${token}`))
      .resolves
      .toMatchObject({ userId: user.id })
  })
})

describe('login', () => {
  it('login with valid credentials succeeds', async () => {
    // Signup to create the user correctly (hashes password properly)
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.authenticated).toBe(true)
    expect(body.user.email).toBe('user@test.com')
  })

  it('refresh cookie Max-Age is 30 days in seconds', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@test.com', password: 'password123' },
    })

    const setCookieHeader = res.headers['set-cookie']
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
    const refreshCookieVal = cookies.find((c) => c?.includes('composure_refresh='))
    expect(refreshCookieVal).toBeDefined()
    const maxAgeMatch = refreshCookieVal!.match(/Max-Age=(\d+)/)
    expect(maxAgeMatch).not.toBeNull()
    const maxAge = Number(maxAgeMatch![1])
    // Should be exactly 30 days in seconds (2,592,000)
    expect(maxAge).toBe(30 * 24 * 60 * 60)
  })

  it('login with wrong password fails', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@test.com', password: 'wrongpassword' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toMatch(/invalid/i)
  })

  it('blocks password login when password provider is disabled', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'disabled-password@test.com', password: 'password123', displayName: 'Disabled Password' },
    })

    await sql`
      INSERT INTO server_settings (key, value, updated_at)
      VALUES ('password_login_enabled', 'false', extract(epoch from now())::integer)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'disabled-password@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/disabled/i)
  })

  it('login with non-existent email fails', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('login with suspended user fails', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'suspended@test.com', password: 'password123', displayName: 'Suspended User' },
    })

    // Suspend the user
    await runWithIdentityContext(null, 'system', async () => {
      await sql`UPDATE users SET is_suspended = true WHERE email = ${'suspended@test.com'}`
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'suspended@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('migrates guest recents (with share token) to user on login', async () => {
    const userEmail = 'migrate-login@test.com'
    const guestId = '750e8400e29b41d4a716446655440000'
    const owner = await createTestUser({ email: 'owner-recents-login@test.com' })
    const projectId = '22222222bbbbccccddddeeeeeeeeeeee'
    const guestUserId = 'guestlogin111111111111111111111111'

    await sql`INSERT INTO users (id, email, password_hash, display_name, role, is_guest, guest_cookie_id, created_at)
       VALUES (${guestUserId}, ${`guest+${guestId}@guest.local`}, ${null}, 'Guest Login', 'user', true, ${guestId}, extract(epoch from now())::integer)`

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: userEmail, password: 'password123', displayName: 'Migrate Login' },
    })

    await sql`INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at)
       VALUES (${projectId}, 'Shared Login Project', 'main.tex', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

    await sql`INSERT INTO share_tokens (id, project_id, token, role, created_by_user_id, created_at, updated_at)
       VALUES (${'login-share-token-id'}, ${projectId}, ${'login-share-token'}, 'view', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

     await sql`INSERT INTO project_recents (id, project_id, user_id, opened_at, share_token)
       VALUES (${'login-recent-id'}, ${projectId}, ${guestUserId}, extract(epoch from now())::integer, ${'login-share-token'})`

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: 'password123' },
      headers: { cookie: guestCookie(guestId) },
    })

    expect(res.statusCode).toBe(200)
    const userId = res.json().user.id as string

     const [migrated] = await sql`SELECT user_id, share_token
       FROM project_recents
       WHERE project_id = ${projectId} AND user_id = ${userId}` as unknown as [{ user_id: string | null; share_token: string | null } | undefined]

    expect(migrated).toBeDefined()
    expect(migrated?.user_id).toBe(userId)
    expect(migrated?.share_token).toBe('login-share-token')
  })
})

describe('logout', () => {
  it('logout clears session', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader },
    })

    expect(logoutRes.statusCode).toBe(200)
    expect(logoutRes.json().authenticated).toBe(false)
  })
})

describe('session listing and revocation', () => {
  it('rejects unsafe refresh-only cookie requests from untrusted origins', async () => {
    const user = await createTestUser({ email: 'csrf-refresh@test.com' })
    const sessionId = await createTestSession(user.id)
    const refreshOnlyCookie = sessionCookie(sessionId)
      .split('; ')
      .find((cookie) => cookie.startsWith('composure_refresh='))
    expect(refreshOnlyCookie).toBeDefined()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        cookie: refreshOnlyCookie ?? '',
        origin: 'https://evil.example.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.withcomposure.test',
      },
      payload: { title: 'Cross-site refresh' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/csrf/i)
  })

  it('revokes a refresh-token family when a rotated token is reused', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'reuse-detected@test.com', password: 'password123', displayName: 'Reuse Detected' },
    })
    const originalCookies = asCookieList(signupRes.headers['set-cookie'])
    const originalRefresh = getSetCookieValue(originalCookies, 'composure_refresh')

    const rotateRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `composure_refresh=${originalRefresh}` },
    })
    expect(rotateRes.statusCode).toBe(200)
    expect(rotateRes.json().authenticated).toBe(true)
    const rotatedRefresh = getSetCookieValue(asCookieList(rotateRes.headers['set-cookie']), 'composure_refresh')
    expect(rotatedRefresh).not.toBe(originalRefresh)

    const reuseRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `composure_refresh=${originalRefresh}` },
    })
    expect(reuseRes.statusCode).toBe(200)
    expect(reuseRes.json().authenticated).toBe(false)

    const familyRevokedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `composure_refresh=${rotatedRefresh}` },
    })
    expect(familyRevokedRes.statusCode).toBe(200)
    expect(familyRevokedRes.json().authenticated).toBe(false)

    const [active] = await sql<[{ count: number }?]>`
      SELECT count(*)::integer AS count
      FROM refresh_tokens
      WHERE revoked_at IS NULL
    `
    expect(active?.count).toBe(0)
  })

  it('lists sessions for authenticated user', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
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
      url: '/api/v1/auth/sessions',
    })

    expect(res.statusCode).toBe(401)
  })

  it('expired sessions are excluded from session list', async () => {
    const user = await createTestUser({ email: 'user@test.com' })
    const activeSession = await createTestSession(user.id, 3600) // 1 hour
    const expiredSession = await createTestSession(user.id, -1) // already expired

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
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
      url: '/api/v1/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { cookie: cookieHeader },
      payload: { currentPassword: 'password123', newPassword: 'newpassword456' },
    })

    expect(res.statusCode).toBe(200)

    // Verify new password works
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@test.com', password: 'newpassword456' },
    })
    expect(loginRes.statusCode).toBe(200)
  })

  it('rejects password change with wrong current password', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { cookie: cookieHeader },
      payload: { currentPassword: 'wrongcurrent', newPassword: 'newpassword456' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('password provider controls', () => {
  it('does not allow disabling password when it is the only enabled auth method', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'only-password@test.com', password: 'password123', displayName: 'Only Password' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/password',
      headers: { cookie: cookieHeader },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/only login method/i)
  })

  it('allows disabling password when another enabled provider is linked', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'multi-provider@test.com', password: 'password123', displayName: 'Multi Provider' },
    })

    const userId = signupRes.json().user.id as string
    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    await sql`
      INSERT INTO oauth_providers (provider, enabled, client_id, client_secret, updated_at)
      VALUES ('github', true, 'test-client-id', 'test-client-secret', extract(epoch from now())::integer)
      ON CONFLICT (provider) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        updated_at = EXCLUDED.updated_at
    `

    await sql`
      INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, linked_at)
      VALUES ('oauth-account-test-id', ${userId}, 'github', 'github-provider-id', 'multi-provider@test.com', extract(epoch from now())::integer)
    `

    const disableRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/password',
      headers: { cookie: cookieHeader },
    })

    expect(disableRes.statusCode).toBe(200)

    const [row] = await sql<[{ password_hash: string | null }?]>`
      SELECT password_hash FROM users WHERE id = ${userId}
    `
    expect(row?.password_hash).toBeNull()

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'multi-provider@test.com', password: 'password123' },
    })
    expect(loginRes.statusCode).toBe(401)
  })

  it('allows re-enabling password auth with a new password when password hash is missing', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 're-enable@test.com', password: 'password123', displayName: 'Re Enable' },
    })

    const userId = signupRes.json().user.id as string
    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    await sql`
      INSERT INTO oauth_providers (provider, enabled, client_id, client_secret, updated_at)
      VALUES ('github', true, 'test-client-id', 'test-client-secret', extract(epoch from now())::integer)
      ON CONFLICT (provider) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        updated_at = EXCLUDED.updated_at
    `

    await sql`
      INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, linked_at)
      VALUES ('oauth-account-re-enable-id', ${userId}, 'github', 'github-provider-id-re-enable', 're-enable@test.com', extract(epoch from now())::integer)
    `

    const disableRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/password',
      headers: { cookie: cookieHeader },
    })

    expect(disableRes.statusCode).toBe(200)

    const enableRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { cookie: cookieHeader },
      payload: { newPassword: 'newpassword456' },
    })

    expect(enableRes.statusCode).toBe(200)

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 're-enable@test.com', password: 'newpassword456' },
    })
    expect(loginRes.statusCode).toBe(200)
  })

  it('deletes linked oauth accounts when deleting the user account', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'delete-linked@test.com', password: 'password123', displayName: 'Delete Linked' },
    })

    const userId = signupRes.json().user.id as string
    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    await sql`
      INSERT INTO oauth_providers (provider, enabled, client_id, client_secret, updated_at)
      VALUES ('github', true, 'test-client-id', 'test-client-secret', extract(epoch from now())::integer)
      ON CONFLICT (provider) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        updated_at = EXCLUDED.updated_at
    `

    await sql`
      INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, linked_at)
      VALUES ('oauth-account-delete-user-id', ${userId}, 'github', 'github-provider-id-delete', 'delete-linked@test.com', extract(epoch from now())::integer)
    `

    const deleteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/delete-account',
      headers: { cookie: cookieHeader },
      payload: { password: 'password123' },
    })

    expect(deleteRes.statusCode).toBe(200)

    const [linked] = await sql<[{ count: number }?]>`
      SELECT count(*)::integer AS count FROM oauth_accounts WHERE user_id = ${userId}
    `
    expect(linked?.count ?? 0).toBe(0)
  })
})

describe('profile update', () => {
  it('updating display name does not clear profile image', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'user@test.com', password: 'password123', displayName: 'Test User' },
    })

    const cookies = signupRes.headers['set-cookie']
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies ?? '')

    // A minimal valid 1x1 PNG data URL
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

    // Set a profile image first
    const updateRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: { cookie: cookieHeader },
      payload: { email: 'user@test.com', displayName: 'Test User', profileImageUrl: dataUrl },
    })
    expect(updateRes.statusCode).toBe(200)
    expect(updateRes.json().user.profileImageUrl).toBe(dataUrl)

    // Now update only display name (no profileImageUrl in body)
    const nameOnlyRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: { cookie: cookieHeader },
      payload: { email: 'user@test.com', displayName: 'New Name' },
    })
    expect(nameOnlyRes.statusCode).toBe(200)
    // Profile image should be preserved, not cleared
    expect(nameOnlyRes.json().user.profileImageUrl).toBe(dataUrl)
  })
})
