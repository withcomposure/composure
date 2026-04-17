import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp } from './helpers/setup.js'

let app: FastifyInstance

beforeEach(async () => {
  app = await createTestApp()
})

describe('cors preflight', () => {
  const origin = 'http://localhost:5173'
  const preflightCases: Array<{ method: 'PATCH' | 'DELETE'; path: string }> = [
    { method: 'PATCH', path: '/api/v1/preferences' },
    { method: 'DELETE', path: '/api/v1/projects/recents' },
    { method: 'PATCH', path: '/api/v1/projects/0123456789abcdef0123456789abcdef/workspace-state' },
    { method: 'PATCH', path: '/api/v1/admin/server-settings' },
  ]

  it.each(preflightCases)('allows $method preflight for $path', async ({ method, path }) => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: path,
      headers: {
        origin,
        'access-control-request-method': method,
        'access-control-request-headers': 'content-type,x-share-token',
      },
    })

    expect([200, 204]).toContain(res.statusCode)

    const allowMethodsHeader = res.headers['access-control-allow-methods']
    const allowMethods = Array.isArray(allowMethodsHeader)
      ? allowMethodsHeader.join(',')
      : String(allowMethodsHeader ?? '')

    expect(allowMethods.toUpperCase()).toContain(method)
    expect(res.headers['access-control-allow-origin']).toBe(origin)
  })
})
