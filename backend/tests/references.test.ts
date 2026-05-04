import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp } from './helpers/setup.js'

let app: FastifyInstance

const sampleArxivFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1234.5678v1</id>
    <updated>2025-01-01T00:00:00Z</updated>
    <published>2025-01-01T00:00:00Z</published>
    <title>Example Diffusion Paper</title>
    <summary>Short abstract for testing.</summary>
    <author><name>Jane Doe</name></author>
    <author><name>John Smith</name></author>
    <arxiv:primary_category term="cs.LG" />
  </entry>
</feed>`

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await app.close()
})

describe('reference search route', () => {
  it('proxies arXiv queries and returns parsed results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sampleArxivFeed, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      }),
    )

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/references/search?source=arxiv&field=title&term=diffusion&maxResults=5',
      headers: {
        'x-forwarded-for': '203.0.113.31',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      source: string
      field: string
      term: string
      results: Array<{
        identifier: string
        title: string
        year: string | null
        authors: string[]
        citations: { bibtex: string; biblatex: string }
      }>
    }

    expect(body.source).toBe('arxiv')
    expect(body.field).toBe('title')
    expect(body.term).toBe('diffusion')
    expect(body.results).toHaveLength(1)
    expect(body.results[0]).toMatchObject({
      identifier: '1234.5678v1',
      title: 'Example Diffusion Paper',
      year: '2025',
      authors: ['Jane Doe', 'John Smith'],
    })
    expect(body.results[0].citations.bibtex).toContain('@article{')
    expect(body.results[0].citations.biblatex).toContain('@online{')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throttles repeated arXiv requests from the same client', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sampleArxivFeed, { status: 200 }),
    )

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/references/search?source=arxiv&term=test',
      headers: {
        'x-forwarded-for': '203.0.113.44',
      },
    })
    expect(first.statusCode).toBe(200)

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/references/search?source=arxiv&term=test',
      headers: {
        'x-forwarded-for': '203.0.113.44',
      },
    })
    expect(second.statusCode).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported reference sources', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/references/search?source=doi&term=test',
      headers: {
        'x-forwarded-for': '203.0.113.57',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'Unsupported reference source' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
