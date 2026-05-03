import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createTestSession, createTestUser, sessionCookie } from './helpers/setup.js'
import { parseExcalidrawLibraryBody } from '../src/db/excalidraw-library.js'

function makeValidLibraryJson(): string {
  return JSON.stringify({
    type: 'excalidrawlib',
    version: 2,
    source: 'https://withcomposure.com',
    libraryItems: [
      {
        id: 'library-item-1',
        status: 'unpublished',
        created: 1714732800000,
        elements: [
          {
            id: 'element-1',
            type: 'rectangle',
            isDeleted: false,
          },
        ],
      },
    ],
  })
}

describe('excalidraw library parser', () => {
  it('accepts valid serialized excalidraw libraries', () => {
    const parsed = parseExcalidrawLibraryBody({
      library: makeValidLibraryJson(),
    })

    expect(parsed).not.toBeNull()
    const normalized = JSON.parse(parsed!.library) as {
      type: string
      version: number
      libraryItems: unknown[]
    }
    expect(normalized.type).toBe('excalidrawlib')
    expect(normalized.version).toBe(2)
    expect(Array.isArray(normalized.libraryItems)).toBe(true)
  })

  it('rejects library items that do not match LibraryItem shape', () => {
    const parsed = parseExcalidrawLibraryBody({
      library: JSON.stringify({
        type: 'excalidrawlib',
        version: 2,
        libraryItems: [
          {
            id: 'library-item-1',
            status: 'invalid-status',
            created: 1714732800000,
            elements: [{ id: 'element-1', type: 'rectangle', isDeleted: false }],
          },
        ],
      }),
    })

    expect(parsed).toBeNull()
  })

  it('accepts legacy libraryItems payload only when entries are valid', () => {
    const valid = parseExcalidrawLibraryBody({
      libraryItems: [
        {
          id: 'library-item-1',
          status: 'published',
          created: 1714732800000,
          elements: [{ id: 'element-1', type: 'rectangle', isDeleted: false }],
        },
      ],
    })

    const invalid = parseExcalidrawLibraryBody({
      libraryItems: [
        {
          id: 'library-item-1',
          status: 'published',
          created: 1714732800000,
          elements: [{ type: 'rectangle' }],
        },
      ],
    })

    expect(valid).not.toBeNull()
    expect(invalid).toBeNull()
  })
})

describe('excalidraw library routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await createTestApp()
  })

  it('rejects invalid library payloads with 400', async () => {
    const user = await createTestUser({ email: 'library-invalid@test.com' })
    const sessionId = await createTestSession(user.id)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/excalidraw-library',
      headers: {
        cookie: sessionCookie(sessionId),
      },
      payload: {
        libraryItems: [{ id: 'item-1', status: 'published', created: 1, elements: [{ type: 'rectangle' }] }],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'Invalid library payload' })
  })

  it('stores validated library and returns normalized string', async () => {
    const user = await createTestUser({ email: 'library-valid@test.com' })
    const sessionId = await createTestSession(user.id)

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/excalidraw-library',
      headers: {
        cookie: sessionCookie(sessionId),
      },
      payload: {
        library: makeValidLibraryJson(),
      },
    })

    expect(putRes.statusCode).toBe(200)
    expect(putRes.json()).toEqual({ ok: true })

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/excalidraw-library',
      headers: {
        cookie: sessionCookie(sessionId),
      },
    })

    expect(getRes.statusCode).toBe(200)
    const body = getRes.json() as { library: string | null }
    expect(typeof body.library).toBe('string')

    const stored = JSON.parse(body.library as string) as {
      type: string
      version: number
      libraryItems: Array<{
        id: string
        status: string
        created: number
        elements: Array<{ id: string; type: string }>
      }>
    }

    expect(stored.type).toBe('excalidrawlib')
    expect(stored.version).toBe(2)
    expect(stored.libraryItems[0]?.id).toBe('library-item-1')
    expect(stored.libraryItems[0]?.elements[0]?.id).toBe('element-1')
  })
})
