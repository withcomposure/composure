import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  createTestApp,
  createTestProject,
  createTestSession,
  createTestUser,
  guestCookie,
  sessionCookie,
} from './helpers/setup.js'
import { sql } from '../src/db/connection.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('project workspace state', () => {
  it('stores isolated workspace state per user for the same project', async () => {
    const owner = await createTestUser({ email: 'owner-workspace@test.com' })
    const member = await createTestUser({ email: 'member-workspace@test.com' })
    const ownerSession = await createTestSession(owner.id)
    const memberSession = await createTestSession(member.id)
    const projectId = await createTestProject(owner.id)

    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${member.id}, 'view', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const ownerState = {
      version: 1,
      sidebarOpen: false,
      paneStateById: {
        'pane-1': {
          tabs: [{ path: 'main.tex', isEphemeral: false }],
          activePath: 'main.tex',
        },
      },
    }

    const memberState = {
      version: 1,
      sidebarOpen: true,
      paneStateById: {
        'pane-1': {
          tabs: [{ path: 'notes.md', isEphemeral: true }],
          activePath: 'notes.md',
        },
      },
    }

    const ownerPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { state: ownerState },
    })

    expect(ownerPatch.statusCode).toBe(200)

    const memberPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: { cookie: sessionCookie(memberSession) },
      payload: { state: memberState },
    })

    expect(memberPatch.statusCode).toBe(200)

    const ownerGet = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: { cookie: sessionCookie(ownerSession) },
    })

    const memberGet = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: { cookie: sessionCookie(memberSession) },
    })

    expect(ownerGet.statusCode).toBe(200)
    expect(memberGet.statusCode).toBe(200)
    expect(ownerGet.json()).toEqual({ state: ownerState })
    expect(memberGet.json()).toEqual({ state: memberState })
  })

  it('returns 400 when patching with a non-object state payload', async () => {
    const owner = await createTestUser({ email: 'owner-invalid-state@test.com' })
    const ownerSession = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { state: ['not', 'an', 'object'] },
    })

    expect(res.statusCode).toBe(400)
    expect(String(res.json().error ?? '')).toContain('Bad Request')
  })

  it('returns 403 for users without project access', async () => {
    const owner = await createTestUser({ email: 'owner-access@test.com' })
    const stranger = await createTestUser({ email: 'stranger-access@test.com' })
    const strangerSession = await createTestSession(stranger.id)
    const projectId = await createTestProject(owner.id)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: { cookie: sessionCookie(strangerSession) },
    })

    expect(res.statusCode).toBe(403)
  })

  it('stores state separately per guest principal when using link sharing', async () => {
    const owner = await createTestUser({ email: 'owner-link-workspace@test.com' })
    const ownerSession = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const linkSharing = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/link-sharing`,
      headers: { cookie: sessionCookie(ownerSession) },
      payload: { enabled: true, role: 'view' },
    })

    expect(linkSharing.statusCode).toBe(200)
    const token = (linkSharing.json() as { token: string }).token

    const guestA = '11111111111111111111111111111111'
    const guestB = '22222222222222222222222222222222'

    const guestAState = {
      version: 1,
      previewOpen: false,
      activeFile: 'draft.tex',
    }

    const patchA = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: {
        cookie: guestCookie(guestA),
        'x-share-token': token,
      },
      payload: { state: guestAState },
    })

    expect(patchA.statusCode).toBe(200)

    const getA = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: {
        cookie: guestCookie(guestA),
        'x-share-token': token,
      },
    })

    const getB = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/workspace-state`,
      headers: {
        cookie: guestCookie(guestB),
        'x-share-token': token,
      },
    })

    expect(getA.statusCode).toBe(200)
    expect(getA.json()).toEqual({ state: guestAState })
    expect(getB.statusCode).toBe(200)
    expect(getB.json()).toEqual({ state: null })
  })
})
