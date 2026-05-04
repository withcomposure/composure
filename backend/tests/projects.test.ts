import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import * as Y from 'yjs'
import { createTestApp, createTestUser, createTestSession, createTestProject, sessionCookie, guestCookie, setTestGuestSignups } from './helpers/setup.js'
import { sql } from '../src/db/connection.js'
import { loadDocument } from '../src/db/documents.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('project CRUD', () => {
  it('creates a project for authenticated user', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { title: 'My Project' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.title).toBe('My Project')
    expect(body.id).toBeDefined()
  })

  it('stores template files as metadata in file map', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { title: 'Template Project', templateId: 'latex-blank' },
    })

    expect(res.statusCode).toBe(201)
    const projectId = (res.json() as { id: string }).id
    const [member] = await sql<[{ role: string; status: string }?]>`
      SELECT role, status
      FROM project_members
      WHERE project_id = ${projectId}
        AND user_id = ${user.id}
    `
    expect(member).toMatchObject({ role: 'owner', status: 'accepted' })

    const stored = await loadDocument(projectId)
    expect(stored).not.toBeNull()

    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, new Uint8Array(stored!))
      const filesMap = doc.getMap<string>('files')
      const mapValue = filesMap.get('main.tex')

      expect(typeof mapValue).toBe('string')
      const parsed = JSON.parse(mapValue ?? '') as { type?: string }
      expect(parsed.type).toBe('text')
      expect(doc.share.has('file:main.tex')).toBe(true)
      expect(doc.getText('file:main.tex').length).toBeGreaterThan(0)
    } finally {
      doc.destroy()
    }
  })

  it('propagates excalidraw engine metadata across project responses', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { title: 'Board', templateId: 'excalidraw-blank' },
    })

    expect(createRes.statusCode).toBe(201)
    const created = createRes.json() as { id: string; engine: string | null; rootFile: string }
    expect(created.engine).toBe('excalidraw')
    expect(created.rootFile).toBe('scene.excalidraw')

    const projectId = created.id

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { cookie: sessionCookie(sessionId) },
    })
    expect(listRes.statusCode).toBe(200)
    const listed = (listRes.json() as Array<{ id: string; engine: string | null }>).find((project) => project.id === projectId)
    expect(listed?.engine).toBe('excalidraw')

    const metadataRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/metadata`,
      headers: { cookie: sessionCookie(sessionId) },
    })
    expect(metadataRes.statusCode).toBe(200)
    expect(metadataRes.json()).toMatchObject({
      id: projectId,
      engine: 'excalidraw',
      rootFile: 'scene.excalidraw',
    })

    const markOpenedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/open`,
      headers: { cookie: sessionCookie(sessionId) },
    })
    expect(markOpenedRes.statusCode).toBe(200)

    const recentsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/recents',
      headers: { cookie: sessionCookie(sessionId) },
    })
    expect(recentsRes.statusCode).toBe(200)
    const recent = (recentsRes.json() as Array<{ id: string; engine: string | null }>).find((project) => project.id === projectId)
    expect(recent?.engine).toBe('excalidraw')

    const softDeleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: sessionCookie(sessionId) },
    })
    expect(softDeleteRes.statusCode).toBe(200)

    const trashRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/trash',
      headers: { cookie: sessionCookie(sessionId) },
    })
    expect(trashRes.statusCode).toBe(200)
    const trashed = ((trashRes.json() as { projects: Array<{ id: string; engine: string | null }> }).projects)
      .find((project) => project.id === projectId)
    expect(trashed?.engine).toBe('excalidraw')
  })

  it('creates a project for guest user', async () => {
    const guestId = '550e8400e29b41d4a716446655440000'

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: guestCookie(guestId) },
      payload: { title: 'Guest Project' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().title).toBe('Guest Project')
  })

  it('rejects project creation when guest signups are disabled and no guest cookie', async () => {
    await setTestGuestSignups(false)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { title: 'Should Fail' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('allows existing guest to create projects even when guest signups are disabled', async () => {
    const guestId = '550e8400e29b41d4a716446655440000'
    const guestUserId = 'guestprojects1111111111111111111111'
    await sql`INSERT INTO users (id, email, password_hash, display_name, role, is_guest, guest_cookie_id, created_at)
       VALUES (${guestUserId}, ${`guest+${guestId}@guest.local`}, ${null}, 'Existing Guest', 'user', true, ${guestId}, extract(epoch from now())::integer)`
    await setTestGuestSignups(false)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: guestCookie(guestId) },
      payload: { title: 'Existing Guest Project' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('lists projects for authenticated user', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)
    await createTestProject(user.id, { title: 'Project A' })
    await createTestProject(user.id, { title: 'Project B' })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)
    const projects = res.json()
    expect(projects.length).toBe(2)
  })

  it('renames a project', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id, { title: 'Original' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { title: 'Renamed' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('updates project metadata defaults', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id, { rootFile: 'main.tex' })

    const setRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/metadata`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: {
        rootFile: 'paper/main.tex',
        defaultBibliographyFile: 'paper/refs.bib',
        referenceLookupFormat: 'biblatex',
      },
    })

    expect(setRes.statusCode).toBe(200)
    expect(setRes.json()).toMatchObject({
      id: projectId,
      rootFile: 'paper/main.tex',
      defaultBibliographyFile: 'paper/refs.bib',
      referenceLookupFormat: 'biblatex',
    })

    const clearRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/metadata`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: {
        defaultBibliographyFile: null,
      },
    })

    expect(clearRes.statusCode).toBe(200)
    expect(clearRes.json()).toMatchObject({
      id: projectId,
      rootFile: 'paper/main.tex',
      defaultBibliographyFile: null,
      referenceLookupFormat: 'biblatex',
    })

    const [row] = await sql<[{ root_file: string; default_bibliography_file: string | null; reference_lookup_format: string }?]>`
      SELECT root_file, default_bibliography_file, reference_lookup_format
      FROM projects
      WHERE id = ${projectId}
    `
    expect(row).toMatchObject({
      root_file: 'paper/main.tex',
      default_bibliography_file: null,
      reference_lookup_format: 'biblatex',
    })
  })

  it('soft-deletes a project', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: sessionCookie(sessionId) },
    })

    expect(res.statusCode).toBe(200)

    // Project should be soft-deleted
    const [project] = await sql`SELECT deleted_at FROM projects WHERE id = ${projectId}` as unknown as [{ deleted_at: number | null }]
    expect(project.deleted_at).not.toBeNull()
  })

  it('rejects rename with empty title', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: sessionCookie(sessionId) },
      payload: { title: '' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('rejects operations with invalid project ID', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/projects/not-a-valid-uuid',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { title: 'Test' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('project limits', () => {
  it('enforces max projects per user', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)

    // Set a low limit for tests
    await sql`INSERT INTO server_settings (key, value, updated_at)
       VALUES ('max_projects_per_user', '2', extract(epoch from now())::integer)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`

    // Create 2 projects (at limit)
    await createTestProject(user.id)
    await createTestProject(user.id)

    // Third should be rejected
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: sessionCookie(sessionId) },
      payload: { title: 'Over Limit' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/limit/i)
  })
})
