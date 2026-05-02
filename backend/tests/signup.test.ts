import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestInviteToken, setTestSignupMode, guestCookie } from './helpers/setup.js'
import { sql } from '../src/db/connection.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('signup — bootstrap (first user)', () => {
  it('first user becomes admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'admin@test.com', password: 'password123', displayName: 'Admin User' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.authenticated).toBe(true)
    expect(body.user.role).toBe('admin')
    expect(body.user.email).toBe('admin@test.com')
  })

  it('first user becomes admin even in invite-only mode', async () => {
    await setTestSignupMode('invite-only')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'admin@test.com', password: 'password123', displayName: 'Admin User' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().user.role).toBe('admin')
  })
})

describe('signup — second user', () => {
  beforeEach(async () => {
    await createTestUser({ email: 'existing@test.com' })
  })

  it('second user gets user role in open mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'new@test.com', password: 'password123', displayName: 'New User' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().user.role).toBe('user')
  })

  it('invite-only mode rejects signup without token', async () => {
    await setTestSignupMode('invite-only')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'new@test.com', password: 'password123', displayName: 'New User' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/invite/i)
  })

  it('invite-only mode accepts signup with valid token', async () => {
    await setTestSignupMode('invite-only')
    const token = await createTestInviteToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'invited@test.com',
        password: 'password123',
        displayName: 'Invited User',
        inviteToken: token,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().user.email).toBe('invited@test.com')
  })

  it('used invite token is rejected', async () => {
    await setTestSignupMode('invite-only')
    const token = await createTestInviteToken()
    // Mark token as used
    await sql`UPDATE invite_tokens SET used_at = extract(epoch from now())::integer WHERE token = ${token}`

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'user2@test.com',
        password: 'password123',
        displayName: 'User Two',
        inviteToken: token,
      },
    })

    expect(res.statusCode).toBe(403)
  })

  it('expired invite token is rejected', async () => {
    await setTestSignupMode('invite-only')
    const token = await createTestInviteToken({ expiresInSeconds: -3600 })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'user2@test.com',
        password: 'password123',
        displayName: 'User Two',
        inviteToken: token,
      },
    })

    expect(res.statusCode).toBe(403)
  })

  it('email-restricted token rejects wrong email', async () => {
    await setTestSignupMode('invite-only')
    const token = await createTestInviteToken({ email: 'specific@test.com' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'wrong@test.com',
        password: 'password123',
        displayName: 'Wrong Email',
        inviteToken: token,
      },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/different email/i)
  })
})

describe('signup — validation', () => {
  it('rejects invalid email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'not-an-email', password: 'password123', displayName: 'Test' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('rejects short password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'test@test.com', password: 'short', displayName: 'Test User' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('rejects short display name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'test@test.com', password: 'password123', displayName: 'A' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('rejects duplicate email', async () => {
    await createTestUser({ email: 'dupe@test.com' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'dupe@test.com', password: 'password123', displayName: 'Dupe User' },
    })

    expect(res.statusCode).toBe(409)
  })
})

describe('signup — guest migration', () => {
  it('migrates guest projects to new user on signup', async () => {
    const guestId = '550e8400e29b41d4a716446655440000'
   const guestUserId = 'guestsignup11111111111111111111111'

   await sql`INSERT INTO users (id, email, password_hash, display_name, role, is_guest, guest_cookie_id, created_at)
     VALUES (${guestUserId}, ${`guest+${guestId}@guest.local`}, ${null}, 'Guest Signup', 'user', true, ${guestId}, extract(epoch from now())::integer)`

    // Create a project owned by this guest
   await sql`INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at)
     VALUES (${'aaaaaaaabbbbccccddddeeeeeeeeeeee'}, 'Guest Project', 'main.tex', ${guestUserId}, extract(epoch from now())::integer, extract(epoch from now())::integer)`
   await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
     VALUES (${'aaaaaaaabbbbccccddddeeeeeeeeeeee'}, ${guestUserId}, 'owner', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'newuser@test.com', password: 'password123', displayName: 'New User' },
      headers: { cookie: guestCookie(guestId) },
    })

    expect(res.statusCode).toBe(201)
    const userId = res.json().user.id

    // Check that the project was migrated
    const [project] = await sql`SELECT owner_user_id FROM projects WHERE id = ${'aaaaaaaabbbbccccddddeeeeeeeeeeee'}` as unknown as [{ owner_user_id: string | null }]
    expect(project.owner_user_id).toBe(userId)
  })

  it('migrates guest recents (with share token) to new user on signup', async () => {
    const guestId = '650e8400e29b41d4a716446655440000'
    const guestUserId = 'guestsignup22222222222222222222222'
    const owner = await createTestUser({ email: 'owner-recents-signup@test.com' })
    const projectId = '11111111bbbbccccddddeeeeeeeeeeee'

    await sql`INSERT INTO users (id, email, password_hash, display_name, role, is_guest, guest_cookie_id, created_at)
       VALUES (${guestUserId}, ${`guest+${guestId}@guest.local`}, ${null}, 'Guest Signup Two', 'user', true, ${guestId}, extract(epoch from now())::integer)`

    await sql`INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at)
       VALUES (${projectId}, 'Shared Project', 'main.tex', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

    await sql`INSERT INTO share_tokens (id, project_id, token, role, created_by_user_id, created_at, updated_at)
       VALUES (${'signup-share-token-id'}, ${projectId}, ${'signup-share-token'}, 'view', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

     await sql`INSERT INTO project_recents (id, project_id, user_id, opened_at, share_token)
       VALUES (${'signup-recent-id'}, ${projectId}, ${guestUserId}, extract(epoch from now())::integer, ${'signup-share-token'})`

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'newuser2@test.com', password: 'password123', displayName: 'New User Two' },
      headers: { cookie: guestCookie(guestId) },
    })

    expect(res.statusCode).toBe(201)
    const userId = res.json().user.id as string

     const [migrated] = await sql`SELECT user_id, share_token
       FROM project_recents
       WHERE project_id = ${projectId} AND user_id = ${userId}` as unknown as [{ user_id: string | null; share_token: string | null } | undefined]

    expect(migrated).toBeDefined()
    expect(migrated?.user_id).toBe(userId)
    expect(migrated?.share_token).toBe('signup-share-token')
  })
})

describe('signup — pending invites', () => {
  it('accepts pending invites on matching email', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const projectId = 'ffffffff000011112222333333333333'

    await sql`INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at)
       VALUES (${projectId}, 'Shared Project', 'main.tex', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

    await sql`INSERT INTO project_members (project_id, invited_email, role, status, created_at, updated_at)
       VALUES (${projectId}, 'invited@test.com', 'edit', 'pending', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'invited@test.com', password: 'password123', displayName: 'Invited' },
    })

    expect(res.statusCode).toBe(201)
    const newUserId = res.json().user.id

    // Check that the project member record was accepted
    const [member] = await sql`SELECT user_id, status FROM project_members WHERE project_id = ${projectId} AND user_id = ${newUserId}` as unknown as [{ user_id: string; status: string } | undefined]
    expect(member).toBeDefined()
    expect(member!.status).toBe('accepted')
  })
})
