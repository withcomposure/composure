import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from '../src/db/connection.js'
import { canAccessProjectWithRole, getProjectRoleForPrincipal, ensureProjectAccess } from '../src/db/access.js'
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
    const projectId = await createTestProject(guestId, { isGuest: true })
    const principal: Principal = { userId: null, guestId }

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

  it('share token grants the token role', async () => {
    const owner = await createTestUser()
    const projectId = await createTestProject(owner.id)
    const linkState = await setLinkSharingState({
      projectId,
      enabled: true,
      role: 'comment',
      actorUserId: owner.id,
    })
    const stranger: Principal = { userId: null, guestId: 'guest-stranger' }

    expect((await canAccessProjectWithRole(projectId, stranger, 'view', linkState.token!)).ok).toBe(true)
    expect((await canAccessProjectWithRole(projectId, stranger, 'comment', linkState.token!)).ok).toBe(true)
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
