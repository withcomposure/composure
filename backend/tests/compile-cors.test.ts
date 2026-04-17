import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
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
  await app?.close()
})

describe('compile cors', () => {
  it('returns CORS allow-origin header on successful compile metadata responses', async () => {
    process.env.COMPILERS = 'http://compiler.test'
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ compileId: 'abc123' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-compile-id': 'abc123',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    const origin = 'http://localhost:5173'
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compile',
      headers: {
        origin,
        cookie: sessionCookie(sessionId),
        'content-type': 'application/json',
      },
      payload: {
        projectId,
        rootFile: 'main.tex',
        responseMode: 'metadata',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe(origin)
    expect(response.headers['x-compile-id']).toBe('abc123')
  })

  it('returns CORS allow-origin header on successful export responses', async () => {
    process.env.COMPILERS = 'http://compiler.test'
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response('export-data', {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="export.pdf"',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await createTestUser({ email: 'exporter@test.com' })
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    const origin = 'http://localhost:5173'
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/export/${projectId}`,
      headers: {
        origin,
        cookie: sessionCookie(sessionId),
        'content-type': 'application/json',
      },
      payload: {
        format: 'pdf',
        rootFile: 'main.tex',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe(origin)
    expect(response.headers['content-disposition']).toContain('export.pdf')
  })

  it('returns CORS allow-origin header on successful preview responses', async () => {
    process.env.COMPILERS = 'http://compiler.test'
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response('pdf-bytes', {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': '9',
        'accept-ranges': 'bytes',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await createTestUser({ email: 'previewer@test.com' })
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    const origin = 'http://localhost:5173'
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/preview.pdf`,
      headers: {
        origin,
        cookie: sessionCookie(sessionId),
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe(origin)
    expect(response.headers['content-type']).toContain('application/pdf')
  })

  it('exposes X-Compile-Id and Content-Disposition headers to cross-origin clients', async () => {
    process.env.COMPILERS = 'http://compiler.test'
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response('export-data', {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="output.pdf"',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await createTestUser({ email: 'expose@test.com' })
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    const origin = 'http://localhost:5173'
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/export/${projectId}`,
      headers: {
        origin,
        cookie: sessionCookie(sessionId),
        'content-type': 'application/json',
      },
      payload: {
        format: 'pdf',
        rootFile: 'main.tex',
      },
    })

    expect(response.statusCode).toBe(200)
    const exposedHeaders = String(response.headers['access-control-expose-headers'] ?? '')
    expect(exposedHeaders).toContain('X-Compile-Id')
    expect(exposedHeaders).toContain('Content-Disposition')
  })

  it('does not return CORS allow-origin for untrusted origins', async () => {
    process.env.COMPILERS = 'http://compiler.test'
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ compileId: 'abc' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await createTestUser({ email: 'untrusted@test.com' })
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compile',
      headers: {
        origin: 'https://evil.example.com',
        cookie: sessionCookie(sessionId),
        'content-type': 'application/json',
      },
      payload: {
        projectId,
        rootFile: 'main.tex',
        responseMode: 'metadata',
      },
    })

    expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.example.com')
  })
})
