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
  await app.close()
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
})
