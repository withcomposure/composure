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

const sampleCrossrefByDoi = {
  message: {
    DOI: '10.1234/example.doi',
    title: ['Crossref Example Paper'],
    author: [{ given: 'Ada', family: 'Lovelace' }],
    URL: 'https://doi.org/10.1234/example.doi',
    issued: { 'date-parts': [[2024, 5, 2]] },
    abstract: '<jats:p>Crossref abstract.</jats:p>',
  },
}

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
        url: string
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
      url: 'https://arxiv.org/abs/1234.5678v1',
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
      url: '/api/v1/references/search?source=unknown&term=test',
      headers: {
        'x-forwarded-for': '203.0.113.57',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'Unsupported reference source' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses Crossref DOI endpoint when source is crossref and field is doi', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleCrossrefByDoi), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/references/search?source=crossref&field=doi&term=10.1234/example.doi',
      headers: {
        'x-forwarded-for': '203.0.113.21',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      source: string
      field: string
      results: Array<{
        source: string
        identifier: string
        url: string
        title: string
        year: string | null
      }>
    }

    expect(body.source).toBe('crossref')
    expect(body.field).toBe('doi')
    expect(body.results).toHaveLength(1)
    expect(body.results[0]).toMatchObject({
      source: 'crossref',
      identifier: '10.1234/example.doi',
      url: 'https://doi.org/10.1234/example.doi',
      title: 'Crossref Example Paper',
      year: '2024',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/works/10.1234%2Fexample.doi')
  })
})
