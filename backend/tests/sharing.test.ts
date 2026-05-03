import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestUser, createTestSession, createTestProject, sessionCookie } from './helpers/setup.js'
import { sql } from '../src/db/connection.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('project sharing — invite member', () => {
  it('owner can invite a member by email (pending)', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { email: 'newmember@test.com', role: 'edit' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('pending')
    expect(body.userId).toBeNull()
  })

  it('owner can invite a member by email (existing user)', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)
    const member = await createTestUser({ email: 'member@test.com' })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { email: 'member@test.com', role: 'edit' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('accepted')
    expect(body.userId).toBe(member.id)
  })

  it('shows existing invitee profile details to non-admin owners', async () => {
    await createTestUser({ email: 'admin-seed@test.com' })
    const owner = await createTestUser({
      email: 'owner-profile@test.com',
      displayName: 'Owner Profile',
      role: 'user',
    })
    const ownerSession = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)
    const member = await createTestUser({
      email: 'member-profile@test.com',
      displayName: 'Member Profile',
      profileImageUrl: 'https://example.test/member.png',
      role: 'user',
    })
    const memberSession = await createTestSession(member.id)

    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { email: member.email, role: 'edit' },
    })

    expect(inviteRes.statusCode).toBe(201)
    expect(inviteRes.json()).toMatchObject({
      ok: true,
      status: 'accepted',
      userId: member.id,
    })

    const ownerAccessRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/access`,
      headers: { cookie: sessionCookie(ownerSession) },
    })
    expect(ownerAccessRes.statusCode).toBe(200)
    const ownerAccessBody = ownerAccessRes.json() as { people: Array<Record<string, unknown>> }
    const memberPerson = ownerAccessBody.people.find((person) => person.userId === member.id)
    expect(memberPerson).toMatchObject({
      email: member.email,
      displayName: 'Member Profile',
      profileImageUrl: 'https://example.test/member.png',
      role: 'edit',
      status: 'accepted',
      isOwner: false,
    })
    expect(ownerAccessBody.people.find((person) => person.userId == null && person.email === member.email)).toBeUndefined()

    const memberAccessRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/access`,
      headers: { cookie: sessionCookie(memberSession) },
    })
    expect(memberAccessRes.statusCode).toBe(200)
    const memberAccessBody = memberAccessRes.json() as { people: Array<Record<string, unknown>> }
    expect(memberAccessBody.people.find((person) => person.userId === owner.id)).toMatchObject({
      email: owner.email,
      displayName: 'Owner Profile',
      isOwner: true,
    })
  })

  it('non-owner cannot invite members', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const projectId = await createTestProject(owner.id)

    const viewer = await createTestUser({ email: 'viewer@test.com' })
    const viewerSession = await createTestSession(viewer.id)

    // Add viewer as member with view role
    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${viewer.id}, 'view', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { cookie: sessionCookie(viewerSession) },
      payload: { email: 'someone@test.com', role: 'view' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('rejects invite with invalid email', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { email: 'not-an-email', role: 'view' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('project sharing — update/remove member', () => {
  it('owner can update member role', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)
    const member = await createTestUser({ email: 'member@test.com' })

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${member.id}, 'view', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/members/${member.id}`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { role: 'edit' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('does not allow changing or removing the project owner membership', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const changeRole = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/members/${owner.id}`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { role: 'view' },
    })
    expect(changeRole.statusCode).toBe(400)

    const remove = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/members/${owner.id}`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { remove: true },
    })
    expect(remove.statusCode).toBe(400)

    const [member] = await sql<[{ role: string; status: string }?]>`
      SELECT role, status
      FROM project_members
      WHERE project_id = ${projectId}
        AND user_id = ${owner.id}
    `
    expect(member).toMatchObject({ role: 'owner', status: 'accepted' })
  })

  it('owner can remove a member', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)
    const member = await createTestUser({ email: 'member@test.com' })

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${member.id}, 'edit', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/members/${member.id}`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { remove: true },
    })

    expect(res.statusCode).toBe(200)
  })

  it('does not demote the owner when invited by their own email', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { email: owner.email, role: 'view' },
    })

    expect(res.statusCode).toBe(201)
    const [member] = await sql<[{ role: string; status: string }?]>`
      SELECT role, status
      FROM project_members
      WHERE project_id = ${projectId}
        AND user_id = ${owner.id}
    `
    expect(member).toMatchObject({ role: 'owner', status: 'accepted' })
  })
})

describe('project sharing — link sharing', () => {
  it('enables link sharing', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { enabled: true, role: 'view' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.enabled).toBe(true)
    expect(body.token).toBeDefined()
  })

  it('disables link sharing', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    // Enable first
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { enabled: true, role: 'view' },
    })

    // Then disable
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { enabled: false },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(false)
  })

  it('updating only role does not disable link sharing', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    // Enable first
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { enabled: true, role: 'view' },
    })

    // PATCH only the role (no `enabled` field) should not disable sharing
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { role: 'edit' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.enabled).toBe(true)
    expect(body.role).toBe('edit')
    expect(body.token).toBeDefined()
  })
})

describe('shared-with-me', () => {
  it('lists projects shared with user', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const projectId = await createTestProject(owner.id, { title: 'Shared' })
    const member = await createTestUser({ email: 'member@test.com' })
    const memberSession = await createTestSession(member.id)

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${member.id}, 'edit', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/shared-with-me',
      headers: { cookie: sessionCookie(memberSession) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as unknown[]
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  it('returns share token for link-shared projects', async () => {
    const owner = await createTestUser({ email: 'owner-link@test.com' })
    const member = await createTestUser({ email: 'member-link@test.com' })
    const memberSession = await createTestSession(member.id)
    const projectId = await createTestProject(owner.id, { title: 'Link Shared' })
    const token = 'token-link-1'

    await sql`INSERT INTO share_tokens (id, project_id, token, role, created_by_user_id, created_at, updated_at)
       VALUES (${'share-token-link-1'}, ${projectId}, ${token}, 'view', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

     await sql`INSERT INTO project_recents (id, project_id, user_id, opened_at, share_token)
       VALUES (${'recent-link-1'}, ${projectId}, ${member.id}, extract(epoch from now())::integer, ${token})`

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/shared-with-me',
      headers: { cookie: sessionCookie(memberSession) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ id: string; shareToken?: string }>
    const item = body.find((project) => project.id === projectId)
    expect(item).toBeDefined()
    expect(item?.shareToken).toBe(token)
  })

  it('prefers member-shared entry when both member and link sharing exist', async () => {
    const owner = await createTestUser({ email: 'owner-both@test.com' })
    const member = await createTestUser({ email: 'member-both@test.com' })
    const memberSession = await createTestSession(member.id)
    const projectId = await createTestProject(owner.id, { title: 'Both Shared' })
    const token = 'token-link-2'

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${member.id}, 'edit', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    await sql`INSERT INTO share_tokens (id, project_id, token, role, created_by_user_id, created_at, updated_at)
       VALUES (${'share-token-link-2'}, ${projectId}, ${token}, 'view', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)`

     await sql`INSERT INTO project_recents (id, project_id, user_id, opened_at, share_token)
       VALUES (${'recent-link-2'}, ${projectId}, ${member.id}, extract(epoch from now())::integer, ${token})`

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/shared-with-me',
      headers: { cookie: sessionCookie(memberSession) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ id: string; shareToken?: string }>
    const matches = body.filter((project) => project.id === projectId)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.shareToken).toBeUndefined()
  })

  it('uses the latest valid token in recents/shared-with-me after explicit link rotation', async () => {
    const owner = await createTestUser({ email: 'owner-rotate@test.com' })
    const ownerSession = await createTestSession(owner.id)
    const member = await createTestUser({ email: 'member-rotate@test.com' })
    const memberSession = await createTestSession(member.id)
    const projectId = await createTestProject(owner.id, { title: 'Rotate Token Project' })

    const enableFirst = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: true, role: 'view' },
    })
    expect(enableFirst.statusCode).toBe(200)
    const token1 = (enableFirst.json() as { token: string }).token

    const openWithToken1 = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/open`,
      headers: {
        cookie: sessionCookie(memberSession),
        'x-share-token': token1,
      },
    })
    expect(openWithToken1.statusCode).toBe(200)

    const rotate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { invalidate: true },
    })
    expect(rotate.statusCode).toBe(200)
    const token2 = (rotate.json() as { token: string }).token
    expect(token2).not.toBe(token1)

    const openWithOldToken = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/open`,
      headers: {
        cookie: sessionCookie(memberSession),
        'x-share-token': token1,
      },
    })
    expect(openWithOldToken.statusCode).toBe(200)

    const openWithToken2 = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/open`,
      headers: {
        cookie: sessionCookie(memberSession),
        'x-share-token': token2,
      },
    })
    expect(openWithToken2.statusCode).toBe(200)

    const recentsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/recents',
      headers: { cookie: sessionCookie(memberSession) },
    })
    expect(recentsRes.statusCode).toBe(200)
    const recents = recentsRes.json() as Array<{ id: string; shareToken?: string }>
    const recentsMatch = recents.find((project) => project.id === projectId)
    expect(recentsMatch?.shareToken).toBe(token2)

    const sharedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/shared-with-me',
      headers: { cookie: sessionCookie(memberSession) },
    })
    expect(sharedRes.statusCode).toBe(200)
    const shared = sharedRes.json() as Array<{ id: string; shareToken?: string }>
    const sharedMatch = shared.find((project) => project.id === projectId)
    expect(sharedMatch?.shareToken).toBeUndefined()
  })

  it('preserves link token when sharing is toggled off then on', async () => {
    const owner = await createTestUser({ email: 'owner-toggle@test.com' })
    const ownerSession = await createTestSession(owner.id)
    const member = await createTestUser({ email: 'member-toggle@test.com' })
    const memberSession = await createTestSession(member.id)
    const projectId = await createTestProject(owner.id, { title: 'Toggle Link Project' })

    const enableFirst = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: true, role: 'view' },
    })
    expect(enableFirst.statusCode).toBe(200)
    const token1 = (enableFirst.json() as { token: string }).token

    const openWithToken1 = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/open`,
      headers: {
        cookie: sessionCookie(memberSession),
        'x-share-token': token1,
      },
    })
    expect(openWithToken1.statusCode).toBe(200)

    const disable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: false },
    })
    expect(disable.statusCode).toBe(200)

    const openWhileDisabled = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/open`,
      headers: {
        cookie: sessionCookie(memberSession),
        'x-share-token': token1,
      },
    })
    expect(openWhileDisabled.statusCode).toBe(200)

    const enableSecond = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: true, role: 'view' },
    })
    expect(enableSecond.statusCode).toBe(200)
    const token2 = (enableSecond.json() as { token: string }).token
    expect(token2).toBe(token1)

    const openAfterReEnable = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/open`,
      headers: {
        cookie: sessionCookie(memberSession),
        'x-share-token': token1,
      },
    })
    expect(openAfterReEnable.statusCode).toBe(200)
  })

  it('keeps edit access for collaborator after link is downgraded', async () => {
    const owner = await createTestUser({ email: 'owner-downgrade@test.com' })
    const ownerSession = await createTestSession(owner.id)
    const member = await createTestUser({ email: 'member-downgrade@test.com' })
    const memberSession = await createTestSession(member.id)
    const projectId = await createTestProject(owner.id, { title: 'Downgrade Project' })

    const enableEditLink = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: true, role: 'edit' },
    })
    expect(enableEditLink.statusCode).toBe(200)
    const linkToken = (enableEditLink.json() as { token: string }).token

    const openViaEditLink = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/open`,
      headers: {
        cookie: sessionCookie(memberSession),
        'x-share-token': linkToken,
      },
    })
    expect(openViaEditLink.statusCode).toBe(200)

    const inviteMember = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { email: member.email, role: 'edit' },
    })
    expect(inviteMember.statusCode).toBe(201)

    const downgradeLink = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { role: 'view' },
    })
    expect(downgradeLink.statusCode).toBe(200)

    const accessRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/access`,
      headers: { cookie: sessionCookie(memberSession) },
    })
    expect(accessRes.statusCode).toBe(200)
    const accessBody = accessRes.json() as { currentRole: string | null }
    expect(accessBody.currentRole).toBe('edit')
  })

  it('removes access when link is invalidated and collaborator is removed', async () => {
    const owner = await createTestUser({ email: 'owner-remove@test.com' })
    const ownerSession = await createTestSession(owner.id)
    const member = await createTestUser({ email: 'member-remove@test.com' })
    const memberSession = await createTestSession(member.id)
    const projectId = await createTestProject(owner.id, { title: 'Remove Access Project' })

    const enableEditLink = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: true, role: 'edit' },
    })
    expect(enableEditLink.statusCode).toBe(200)
    const linkToken = (enableEditLink.json() as { token: string }).token

    const inviteMember = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { email: member.email, role: 'edit' },
    })
    expect(inviteMember.statusCode).toBe(201)

    const disableLink = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: false },
    })
    expect(disableLink.statusCode).toBe(200)

    const removeMember = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/members/${member.id}`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { remove: true },
    })
    expect(removeMember.statusCode).toBe(200)

    const accessWithoutToken = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/access`,
      headers: { cookie: sessionCookie(memberSession) },
    })
    expect(accessWithoutToken.statusCode).toBe(403)

    const accessWithOldToken = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/access`,
      headers: {
        cookie: sessionCookie(memberSession),
        'x-share-token': linkToken,
      },
    })
    expect(accessWithOldToken.statusCode).toBe(403)
  })
})

describe('project access info', () => {
  it('owner can get access info', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/access`,
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.currentRole).toBe('owner')
    expect(body.people).toBeDefined()
    expect(body.people.filter((person: { userId: string | null }) => person.userId === owner.id)).toHaveLength(1)
    expect(body.linkSharing).toBeDefined()
  })

  it('uses owner_user_id as an access fallback if the owner membership row is missing', async () => {
    const owner = await createTestUser({ email: 'owner-fallback@test.com' })
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)
    await sql`
      DELETE FROM project_members
      WHERE project_id = ${projectId}
        AND user_id = ${owner.id}
    `

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/access`,
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.currentRole).toBe('owner')
    expect(body.people.filter((person: { userId: string | null }) => person.userId === owner.id)).toHaveLength(1)
  })

  it('accepts share token via share query alias', async () => {
    const owner = await createTestUser({ email: 'owner-query-alias@test.com' })
    const ownerSession = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const linkRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: true, role: 'view' },
    })
    expect(linkRes.statusCode).toBe(200)
    const token = (linkRes.json() as { token: string }).token

    const queryAliasUser = await createTestUser({ email: 'query-alias-user@test.com' })
    const guestSession = await createTestSession(queryAliasUser.id)
    const accessRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/access?share=${encodeURIComponent(token)}`,
      headers: { cookie: sessionCookie(guestSession) },
    })

    expect(accessRes.statusCode).toBe(200)
    expect((accessRes.json() as { currentRole: string | null }).currentRole).toBe('view')
  })
})
