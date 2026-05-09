import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from '../src/db/connection.js'
import { runWithIdentityContext } from '../src/db/request-context.js'
import { canAccessProjectChat, canAccessProjectWithRole, getProjectRoleForPrincipal, ensureProjectAccess } from '../src/db/access.js'
import { setLinkSharingState } from '../src/db/sharing.js'
import type { Principal } from '../src/db/types.js'
import { createTestUser, createTestProject, resetTestDatabase } from './helpers/setup.js'

beforeEach(async () => {
  await resetTestDatabase()
})

describe('canAccessProjectWithRole', () => {
  it('owner can access at any role level', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const principal: Principal = { userId: owner.id, guestId: null }

    expect((await canAccessProjectWithRole(projectId, principal, 'view')).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, principal, 'comment')).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, principal, 'edit')).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, principal, 'owner')).ok).toBe(true)
  })

  it('guest owner can access their own project', async () => {
    const guestId = 'guest-1234'
    const guest = await createTestUser({ email: 'guest-owner@test.com' })
    await runWithIdentityContext(null, 'system', async () => {
      await sql`UPDATE users SET is_guest = true, guest_cookie_id = ${guestId} WHERE id = ${guest.id}`
    })
    const projectId = await createTestProject(guest.id, { isGuest: true })
    const principal: Principal = { userId: guest.id, guestId }

    expect((await canAccessProjectWithRole(projectId, principal, 'view')).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, principal, 'owner')).ok).toBe(true)
  })

  it('member with view can view but not edit', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const viewer = await createTestUser({ email: 'viewer@test.com' })

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${viewer.id}, 'view', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const principal: Principal = { userId: viewer.id, guestId: null }
    expect((await canAccessProjectWithRole(projectId, principal, 'view')).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, principal, 'comment')).ok).toBe(false)
    expect((await canAccessProjectWithRole(projectId, principal, 'edit')).ok).toBe(false)
    expect((await canAccessProjectWithRole(projectId, principal, 'owner')).ok).toBe(false)
  })

  it('member with edit can view, comment, and edit but not own', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const editor = await createTestUser({ email: 'editor@test.com' })

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${editor.id}, 'edit', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const principal: Principal = { userId: editor.id, guestId: null }
    expect((await canAccessProjectWithRole(projectId, principal, 'view')).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, principal, 'comment')).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, principal, 'edit')).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, principal, 'owner')).ok).toBe(false)
  })

  it('non-member without token is rejected', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const stranger = await createTestUser({ email: 'stranger@test.com' })

    const principal: Principal = { userId: stranger.id, guestId: null }
    expect((await canAccessProjectWithRole(projectId, principal, 'view')).ok).toBe(false)
  })

  it('share token alone does not grant access without user membership', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const linkState = await setLinkSharingState({
      projectId,
      enabled: true,
      role: 'comment',
      actorUserId: owner.id,
    })
    const stranger: Principal = { userId: null, guestId: 'guest-stranger' }

    expect((await canAccessProjectWithRole(projectId, stranger, 'view', linkState.token!)).ok).toBe(false)
    expect((await canAccessProjectWithRole(projectId, stranger, 'comment', linkState.token!)).ok).toBe(false)
    expect((await canAccessProjectWithRole(projectId, stranger, 'edit', linkState.token!)).ok).toBe(false)
  })

  it('non-existent project returns not ok', async () => {
    const principal: Principal = { userId: null, guestId: 'guest-1' }
    const result = await canAccessProjectWithRole('00000000000000000000000000000000', principal, 'view')
    expect(result.ok).toBe(false)
    expect(result.role).toBeNull()
  })
})

describe('getProjectRoleForPrincipal', () => {
  it('returns owner for project owner', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const role = await getProjectRoleForPrincipal(projectId, { userId: owner.id, guestId: null })
    expect(role).toBe('owner')
  })

  it('returns null for non-related principal', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const role = await getProjectRoleForPrincipal(projectId, { userId: null, guestId: 'other-guest' })
    expect(role).toBeNull()
  })

  it('returns member role for accepted member', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const member = await createTestUser({ email: 'member@test.com' })

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${member.id}, 'comment', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const role = await getProjectRoleForPrincipal(projectId, { userId: member.id, guestId: null })
    expect(role).toBe('comment')
  })

  it('returns null for pending member', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const member = await createTestUser({ email: 'pending@test.com' })

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${member.id}, 'edit', 'pending', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const role = await getProjectRoleForPrincipal(projectId, { userId: member.id, guestId: null })
    expect(role).toBeNull()
  })
})

describe('canAccessProjectChat', () => {
  it('allows invited viewers to view project chat', async () => {
    const owner = await createTestUser({ email: 'owner-chat-invite@test.com' })
    const projectId = await createTestProject(owner.id)
    const invitedViewer = await createTestUser({ email: 'invited-viewer-chat@test.com' })

    await sql`
      INSERT INTO project_members (project_id, user_id, role, status, invited_by_user_id, created_at, updated_at)
      VALUES (${projectId}, ${invitedViewer.id}, 'view', 'accepted', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)
    `

    const principal: Principal = { userId: invitedViewer.id, guestId: null }
    const access = await canAccessProjectChat(projectId, principal)
    expect(access.ok).toBe(true)
    expect(access.role).toBe('view')
  })

  it('denies link-only viewers from project chat', async () => {
    const owner = await createTestUser({ email: 'owner-chat-link@test.com' })
    const projectId = await createTestProject(owner.id)
    const linkViewer = await createTestUser({ email: 'link-viewer-chat@test.com' })

    await sql`
      INSERT INTO project_members (project_id, user_id, role, status, invited_by_user_id, created_at, updated_at)
      VALUES (${projectId}, ${linkViewer.id}, 'view', 'accepted', ${null}, extract(epoch from now())::integer, extract(epoch from now())::integer)
    `

    const principal: Principal = { userId: linkViewer.id, guestId: null }
    const access = await canAccessProjectChat(projectId, principal)
    expect(access.ok).toBe(false)
    expect(access.role).toBe('view')
  })

  it('allows link-only commenters to view project chat', async () => {
    const owner = await createTestUser({ email: 'owner-chat-commenter@test.com' })
    const projectId = await createTestProject(owner.id)
    const linkCommenter = await createTestUser({ email: 'link-commenter-chat@test.com' })

    await sql`
      INSERT INTO project_members (project_id, user_id, role, status, invited_by_user_id, created_at, updated_at)
      VALUES (${projectId}, ${linkCommenter.id}, 'comment', 'accepted', ${null}, extract(epoch from now())::integer, extract(epoch from now())::integer)
    `

    const principal: Principal = { userId: linkCommenter.id, guestId: null }
    const access = await canAccessProjectChat(projectId, principal)
    expect(access.ok).toBe(true)
    expect(access.role).toBe('comment')
  })
})

describe('ensureProjectAccess', () => {
  it('returns ok for project owner', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const access = await ensureProjectAccess(projectId, { userId: owner.id, guestId: null })
    expect(access.ok).toBe(true)
  })

  it('returns not ok for non-owner', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const stranger = await createTestUser({ email: 'stranger@test.com' })
    const access = await ensureProjectAccess(projectId, { userId: stranger.id, guestId: null })
    expect(access.ok).toBe(false)
  })
})
