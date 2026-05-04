import type { FastifyReply, FastifyRequest } from 'fastify'

type ReferenceSource = 'arxiv'
type ReferenceSearchField = 'all' | 'title' | 'author' | 'abstract'

interface ReferenceSearchQuery {
  source?: string
  field?: string
  term?: string
  maxResults?: string | number
}

interface ReferenceSearchResult {
  id: string
  source: ReferenceSource
  identifier: string
  title: string
  authors: string[]
  year: string | null
  abstract: string
  citations: {
    bibtex: string
    biblatex: string
  }
}

const arxivFieldMap: Record<ReferenceSearchField, string> = {
  all: 'all',
  title: 'ti',
  author: 'au',
  abstract: 'abs',
}

const minArxivClientIntervalMs = 3_000
const lastArxivRequestByClient = new Map<string, number>()

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function normalizeWhitespace(raw: string): string {
  return decodeXmlEntities(raw).replace(/\s+/g, ' ').trim()
}

function escapeBibValue(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/[{}]/g, (match) => `\\${match}`)
}

function extractSingleTag(entryXml: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i').exec(entryXml)
  if (!match) {
    return null
  }
  return normalizeWhitespace(match[1])
}

function extractAuthors(entryXml: string): string[] {
  const matches = entryXml.matchAll(/<author>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)
  const authors: string[] = []
  for (const match of matches) {
    const authorName = normalizeWhitespace(match[1] ?? '')
    if (authorName.length > 0) {
      authors.push(authorName)
    }
  }
  return authors
}

function parseArxivIdentifier(idTagValue: string): string {
  const normalized = idTagValue.trim()
  const arxivIndex = normalized.lastIndexOf('/abs/')
  if (arxivIndex >= 0) {
    return normalized.slice(arxivIndex + '/abs/'.length)
  }
  return normalized
}

function createCitationKey(authors: string[], year: string | null, identifier: string): string {
  const firstAuthor = authors[0] ?? 'unknown'
  const lastName = (firstAuthor.split(/\s+/).at(-1) ?? 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '')
  const yearPart = (year ?? 'nodate').replace(/[^0-9a-z]/gi, '') || 'nodate'
  const idPart = identifier.toLowerCase().replace(/[^a-z0-9]/g, '') || 'arxiv'
  return `${lastName}${yearPart}${idPart}`
}

function buildCitations(input: {
  citationKey: string
  title: string
  authors: string[]
  year: string | null
  identifier: string
  primaryCategory: string | null
}): { bibtex: string; biblatex: string } {
  const authors = input.authors.length > 0 ? input.authors.join(' and ') : 'Unknown Author'
  const year = input.year ?? '0000'
  const title = escapeBibValue(input.title)
  const author = escapeBibValue(authors)
  const identifier = escapeBibValue(input.identifier)
  const category = input.primaryCategory ? escapeBibValue(input.primaryCategory) : null
  const url = `https://arxiv.org/abs/${encodeURIComponent(input.identifier)}`

  const bibtexLines = [
    `@article{${input.citationKey},`,
    `  title = {${title}},`,
    `  author = {${author}},`,
    `  year = {${year}},`,
    `  eprint = {${identifier}},`,
    '  archivePrefix = {arXiv},',
    ...(category ? [`  primaryClass = {${category}},`] : []),
    `  url = {${url}},`,
    '}',
  ]

  const biblatexLines = [
    `@online{${input.citationKey},`,
    `  title = {${title}},`,
    `  author = {${author}},`,
    `  year = {${year}},`,
    `  eprint = {${identifier}},`,
    '  eprinttype = {arXiv},',
    ...(category ? [`  eprintclass = {${category}},`] : []),
    `  url = {${url}},`,
    '}',
  ]

  return {
    bibtex: bibtexLines.join('\n'),
    biblatex: biblatexLines.join('\n'),
  }
}

function parseArxivFeed(xml: string): ReferenceSearchResult[] {
  const results: ReferenceSearchResult[] = []
  const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)

  for (const match of entryMatches) {
    const entryXml = match[1] ?? ''
    const idTag = extractSingleTag(entryXml, 'id')
    const title = extractSingleTag(entryXml, 'title')
    const abstract = extractSingleTag(entryXml, 'summary')

    if (!idTag || !title) {
      continue
    }

    const identifier = parseArxivIdentifier(idTag)
    const published = extractSingleTag(entryXml, 'published')
    const year = published && published.length >= 4 ? published.slice(0, 4) : null
    const authors = extractAuthors(entryXml)
    const primaryCategoryMatch = /<arxiv:primary_category[^>]*term="([^"]+)"/i.exec(entryXml)
    const primaryCategory = primaryCategoryMatch?.[1] ? normalizeWhitespace(primaryCategoryMatch[1]) : null
    const citationKey = createCitationKey(authors, year, identifier)

    results.push({
      id: `${identifier}`,
      source: 'arxiv',
      identifier,
      title,
      authors,
      year,
      abstract: abstract ?? '',
      citations: buildCitations({
        citationKey,
        title,
        authors,
        year,
        identifier,
        primaryCategory,
      }),
    })
  }

  return results
}

function parseReferenceSearchField(raw: string | undefined): ReferenceSearchField {
  if (raw === 'title' || raw === 'author' || raw === 'abstract') {
    return raw
  }
  return 'all'
}

function parseMaxResults(raw: string | number | undefined): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed)) {
    return 20
  }
  return Math.max(1, Math.min(50, Math.trunc(parsed)))
}

function arxivClientKey(req: FastifyRequest): string {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
    return forwardedFor.split(',')[0].trim().toLowerCase()
  }
  return String(req.ip ?? 'unknown').toLowerCase()
}

function shouldThrottleArxiv(req: FastifyRequest): boolean {
  const key = arxivClientKey(req)
  const now = Date.now()
  const last = lastArxivRequestByClient.get(key)
  if (typeof last === 'number' && now - last < minArxivClientIntervalMs) {
    return true
  }
  lastArxivRequestByClient.set(key, now)
  return false
}

async function searchArxiv(input: {
  field: ReferenceSearchField
  term: string
  maxResults: number
}): Promise<ReferenceSearchResult[]> {
  const fieldPrefix = arxivFieldMap[input.field]
  const queryValue = `${fieldPrefix}:${input.term}`
  const url = new URL('http://export.arxiv.org/api/query')
  url.searchParams.set('search_query', queryValue)
  url.searchParams.set('start', '0')
  url.searchParams.set('max_results', String(input.maxResults))
  url.searchParams.set('sortBy', 'relevance')
  url.searchParams.set('sortOrder', 'descending')

  const response = await fetch(url.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12_000),
  })

  if (!response.ok) {
    throw new Error(`arXiv search failed with status ${response.status}`)
  }

  const xml = await response.text()
  return parseArxivFeed(xml)
}

export async function referenceSearchRoute(
  req: FastifyRequest<{ Querystring: ReferenceSearchQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const source = String(req.query.source ?? '').trim().toLowerCase()
  if (source !== 'arxiv') {
    reply.status(400).send({ error: 'Unsupported reference source' })
    return
  }

  if (shouldThrottleArxiv(req)) {
    reply.status(429).send({ error: 'Please wait 3 seconds between arXiv queries.' })
    return
  }

  const term = String(req.query.term ?? '').trim()
  if (term.length === 0) {
    reply.status(400).send({ error: 'Search term is required' })
    return
  }

  const field = parseReferenceSearchField(typeof req.query.field === 'string' ? req.query.field : undefined)
  const maxResults = parseMaxResults(req.query.maxResults)

  try {
    const results = await searchArxiv({ field, term, maxResults })
    reply.send({
      source: 'arxiv',
      field,
      term,
      results,
    })
  } catch (err) {
    console.warn(`[references] search-failed source=arxiv error=${String(err)}`)
    reply.status(502).send({ error: 'Reference search is currently unavailable' })
  }
}
