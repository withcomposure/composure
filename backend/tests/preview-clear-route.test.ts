import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { sql } from '../src/db/connection.js'
import {
  createTestApp,
  createTestProject,
  createTestSession,
  createTestUser,
  sessionCookie,
} from './helpers/setup.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete process.env.COMPILERS
  await app.close()
})

describe('DELETE /api/v1/projects/:projectId/preview.pdf', () => {
  it('clears preview output via compiler dispatch for editors', async () => {
    process.env.COMPILERS = 'http://compiler.test'
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const owner = await createTestUser()
    const sessionId = await createTestSession(owner.id)
    const projectId = await createTestProject(owner.id)

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/preview.pdf`,
      headers: {
        cookie: sessionCookie(sessionId),
      },
    })

    expect(response.statusCode).toBe(204)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      `http://compiler.test/projects/${encodeURIComponent(projectId)}/preview.pdf`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('rejects users without edit access', async () => {
    process.env.COMPILERS = 'http://compiler.test'
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const owner = await createTestUser({ email: 'owner@test.com' })
    const projectId = await createTestProject(owner.id)

    const viewer = await createTestUser({ email: 'viewer@test.com' })
    const viewerSessionId = await createTestSession(viewer.id)
    await sql`INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
       VALUES (${projectId}, ${viewer.id}, 'view', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)`

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/preview.pdf`,
      headers: {
        cookie: sessionCookie(viewerSessionId),
      },
    })

    expect(response.statusCode).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
