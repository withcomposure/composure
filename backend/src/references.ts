import type { FastifyReply, FastifyRequest } from 'fastify'

type ReferenceSource = 'arxiv' | 'crossref' | 'semantic-scholar' | 'pubmed' | 'openalex'
type ReferenceSearchField = 'all' | 'title' | 'author' | 'abstract' | 'doi'

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
  url: string
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
  doi: 'all',
}

const minArxivClientIntervalMs = 3_000
const lastArxivRequestByClient = new Map<string, number>()

function asObject(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw != null ? raw as Record<string, unknown> : null
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null
}

function firstString(raw: unknown): string | null {
  if (typeof raw === 'string') {
    return raw
  }
  if (!Array.isArray(raw)) {
    return null
  }
  for (const value of raw) {
    if (typeof value === 'string') {
      return value
    }
  }
  return null
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const values: string[] = []
  for (const value of raw) {
    if (typeof value === 'string') {
      const normalized = normalizeWhitespace(value)
      if (normalized.length > 0) {
        values.push(normalized)
      }
    }
  }

  return values
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function stripXmlTags(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ')
}

function normalizeWhitespace(raw: string): string {
  return decodeXmlEntities(raw).replace(/\s+/g, ' ').trim()
}

function normalizeDoi(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  const withoutPrefix = trimmed
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .trim()

  return withoutPrefix.length > 0 ? withoutPrefix : null
}

function escapeBibValue(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/[{}]/g, (match) => `\\${match}`)
}

function parseDatePartsYear(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null
  }

  const first = raw[0]
  if (!Array.isArray(first) || first.length === 0) {
    return null
  }

  return extractYear(first[0])
}

function extractYear(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.trunc(raw))
  }

  if (typeof raw === 'string') {
    const match = /(19|20)\d{2}/.exec(raw)
    return match?.[0] ?? null
  }

  return null
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

function parseReferenceSource(raw: string | undefined): ReferenceSource | null {
  if (raw === 'arxiv' || raw === 'crossref' || raw === 'semantic-scholar' || raw === 'pubmed' || raw === 'openalex') {
    return raw
  }
  return null
}

function parseReferenceSearchField(raw: string | undefined): ReferenceSearchField {
  if (raw === 'title' || raw === 'author' || raw === 'abstract' || raw === 'doi') {
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

function createCitationKey(authors: string[], year: string | null, identifier: string, source: ReferenceSource): string {
  const firstAuthor = authors[0] ?? 'unknown'
  const lastName = (firstAuthor.split(/\s+/).at(-1) ?? 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '')
  const yearPart = (year ?? 'nodate').replace(/[^0-9a-z]/gi, '') || 'nodate'
  const sourcePart = source.replace(/[^a-z0-9]/g, '') || 'ref'
  const idPart = identifier.toLowerCase().replace(/[^a-z0-9]/g, '') || 'entry'
  return `${lastName}${yearPart}${sourcePart}${idPart}`
}

function buildCitations(input: {
  citationKey: string
  source: ReferenceSource
  title: string
  authors: string[]
  year: string | null
  identifier: string
  url: string
  doi?: string | null
}): { bibtex: string; biblatex: string } {
  const authors = input.authors.length > 0 ? input.authors.join(' and ') : 'Unknown Author'
  const year = input.year ?? '0000'
  const title = escapeBibValue(input.title)
  const author = escapeBibValue(authors)
  const identifier = escapeBibValue(input.identifier)
  const url = escapeBibValue(input.url)
  const source = escapeBibValue(input.source)
  const doi = input.doi ? escapeBibValue(input.doi) : null

  const bibtexLines = [
    `@article{${input.citationKey},`,
    `  title = {${title}},`,
    `  author = {${author}},`,
    `  year = {${year}},`,
    ...(doi ? [`  doi = {${doi}},`] : []),
    `  url = {${url}},`,
    `  note = {${source}:${identifier}},`,
    '}',
  ]

  const biblatexLines = [
    `@online{${input.citationKey},`,
    `  title = {${title}},`,
    `  author = {${author}},`,
    `  year = {${year}},`,
    ...(doi ? [`  doi = {${doi}},`] : []),
    `  url = {${url}},`,
    `  note = {${source}:${identifier}},`,
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

    const source: ReferenceSource = 'arxiv'
    const identifier = parseArxivIdentifier(idTag)
    const url = `https://arxiv.org/abs/${encodeURIComponent(identifier)}`
    const published = extractSingleTag(entryXml, 'published')
    const year = published && published.length >= 4 ? published.slice(0, 4) : null
    const authors = extractAuthors(entryXml)
    const citationKey = createCitationKey(authors, year, identifier, source)

    results.push({
      id: `${identifier}`,
      source,
      identifier,
      url,
      title,
      authors,
      year,
      abstract: abstract ?? '',
      citations: buildCitations({
        citationKey,
        source,
        title,
        authors,
        year,
        identifier,
        url,
      }),
    })
  }

  return results
}

function parseCrossrefAuthors(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const authors: string[] = []
  for (const value of raw) {
    const item = asObject(value)
    if (!item) {
      continue
    }

    const given = normalizeWhitespace(String(item.given ?? ''))
    const family = normalizeWhitespace(String(item.family ?? ''))
    const full = [given, family].filter((part) => part.length > 0).join(' ').trim()
    if (full.length > 0) {
      authors.push(full)
    }
  }

  return authors
}

function crossrefYear(item: Record<string, unknown>): string | null {
  const issued = asObject(item.issued)
  const issuedYear = parseDatePartsYear(issued?.['date-parts'])
  if (issuedYear) return issuedYear

  const publishedPrint = asObject(item['published-print'])
  const printYear = parseDatePartsYear(publishedPrint?.['date-parts'])
  if (printYear) return printYear

  const publishedOnline = asObject(item['published-online'])
  return parseDatePartsYear(publishedOnline?.['date-parts'])
}

function crossrefFromItem(raw: unknown): ReferenceSearchResult | null {
  const item = asObject(raw)
  if (!item) {
    return null
  }

  const title = normalizeWhitespace(firstString(item.title) ?? '')
  if (!title) {
    return null
  }

  const source: ReferenceSource = 'crossref'
  const doi = normalizeDoi(String(item.DOI ?? ''))
  const identifier = doi ?? normalizeWhitespace(asString(item.URL) ?? '')
  if (!identifier) {
    return null
  }

  const url = normalizeWhitespace(asString(item.URL) ?? '') || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : '')
  if (!url) {
    return null
  }

  const authors = parseCrossrefAuthors(item.author)
  const year = crossrefYear(item)
  const abstractRaw = asString(item.abstract) ?? ''
  const abstract = normalizeWhitespace(stripXmlTags(abstractRaw))
  const citationKey = createCitationKey(authors, year, identifier, source)

  return {
    id: doi ? `crossref:${doi.toLowerCase()}` : `crossref:${identifier.toLowerCase()}`,
    source,
    identifier,
    url,
    title,
    authors,
    year,
    abstract,
    citations: buildCitations({
      citationKey,
      source,
      title,
      authors,
      year,
      identifier,
      url,
      doi,
    }),
  }
}

function semanticScholarFromPaper(raw: unknown): ReferenceSearchResult | null {
  const paper = asObject(raw)
  if (!paper) {
    return null
  }

  const title = normalizeWhitespace(asString(paper.title) ?? '')
  if (!title) {
    return null
  }

  const source: ReferenceSource = 'semantic-scholar'
  const externalIds = asObject(paper.externalIds)
  const doi = normalizeDoi(String(externalIds?.DOI ?? ''))
  const paperId = normalizeWhitespace(asString(paper.paperId) ?? '')
  const identifier = doi ?? paperId
  if (!identifier) {
    return null
  }

  const url = normalizeWhitespace(asString(paper.url) ?? '') || (paperId ? `https://www.semanticscholar.org/paper/${encodeURIComponent(paperId)}` : '')
  if (!url) {
    return null
  }

  const authorsRaw = Array.isArray(paper.authors) ? paper.authors : []
  const authors: string[] = []
  for (const value of authorsRaw) {
    const author = asObject(value)
    const name = normalizeWhitespace(asString(author?.name) ?? '')
    if (name.length > 0) {
      authors.push(name)
    }
  }

  const year = extractYear(paper.year)
  const abstract = normalizeWhitespace(asString(paper.abstract) ?? '')
  const citationKey = createCitationKey(authors, year, identifier, source)

  return {
    id: paperId ? `semanticscholar:${paperId}` : `semanticscholar:${identifier.toLowerCase()}`,
    source,
    identifier,
    url,
    title,
    authors,
    year,
    abstract,
    citations: buildCitations({
      citationKey,
      source,
      title,
      authors,
      year,
      identifier,
      url,
      doi,
    }),
  }
}

function openAlexAbstract(raw: unknown): string {
  const inverted = asObject(raw)
  if (!inverted) {
    return ''
  }

  const tokens: Array<{ pos: number; token: string }> = []
  for (const [token, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) {
      continue
    }
    for (const pos of positions) {
      if (typeof pos === 'number' && Number.isFinite(pos)) {
        tokens.push({ pos: Math.trunc(pos), token })
      }
    }
  }

  tokens.sort((left, right) => left.pos - right.pos)
  return normalizeWhitespace(tokens.map((entry) => entry.token).join(' '))
}

function openAlexId(rawId: string): string {
  const slash = rawId.lastIndexOf('/')
  return slash >= 0 ? rawId.slice(slash + 1) : rawId
}

function openAlexFromWork(raw: unknown): ReferenceSearchResult | null {
  const work = asObject(raw)
  if (!work) {
    return null
  }

  const title = normalizeWhitespace(asString(work.display_name) ?? '')
  if (!title) {
    return null
  }

  const source: ReferenceSource = 'openalex'
  const doi = normalizeDoi(String(work.doi ?? ''))
  const workId = normalizeWhitespace(asString(work.id) ?? '')
  if (!workId) {
    return null
  }

  const identifier = doi ?? openAlexId(workId)
  const primaryLocation = asObject(work.primary_location)
  const landingPage = normalizeWhitespace(asString(primaryLocation?.landing_page_url) ?? '')
  const url = landingPage || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : workId)

  const authorships = Array.isArray(work.authorships) ? work.authorships : []
  const authors: string[] = []
  for (const value of authorships) {
    const authorship = asObject(value)
    const author = asObject(authorship?.author)
    const name = normalizeWhitespace(asString(author?.display_name) ?? '')
    if (name.length > 0) {
      authors.push(name)
    }
  }

  const year = extractYear(work.publication_year)
  const abstract = openAlexAbstract(work.abstract_inverted_index)
  const citationKey = createCitationKey(authors, year, identifier, source)

  return {
    id: `openalex:${openAlexId(workId).toLowerCase()}`,
    source,
    identifier,
    url,
    title,
    authors,
    year,
    abstract,
    citations: buildCitations({
      citationKey,
      source,
      title,
      authors,
      year,
      identifier,
      url,
      doi,
    }),
  }
}

function pubmedSearchTerm(field: ReferenceSearchField, term: string): string {
  if (field === 'title') return `${term}[Title]`
  if (field === 'author') return `${term}[Author]`
  if (field === 'abstract') return `${term}[Abstract]`
  if (field === 'doi') return `${term}[DOI]`
  return term
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

async function searchCrossref(input: {
  field: ReferenceSearchField
  term: string
  maxResults: number
}): Promise<ReferenceSearchResult[]> {
  const normalizedDoi = normalizeDoi(input.term)

  if (input.field === 'doi' && normalizedDoi) {
    const doiUrl = new URL(`https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`)
    const response = await fetch(doiUrl.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(12_000),
    })

    if (response.status === 404) {
      return []
    }

    if (!response.ok) {
      throw new Error(`Crossref DOI search failed with status ${response.status}`)
    }

    const body = asObject(await response.json())
    const parsed = crossrefFromItem(body?.message)
    return parsed ? [parsed] : []
  }

  const queryUrl = new URL('https://api.crossref.org/works')
  queryUrl.searchParams.set('rows', String(input.maxResults))
  queryUrl.searchParams.set('sort', 'relevance')

  if (input.field === 'title') {
    queryUrl.searchParams.set('query.title', input.term)
  } else if (input.field === 'author') {
    queryUrl.searchParams.set('query.author', input.term)
  } else {
    queryUrl.searchParams.set('query.bibliographic', input.term)
  }

  const response = await fetch(queryUrl.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12_000),
  })

  if (!response.ok) {
    throw new Error(`Crossref query search failed with status ${response.status}`)
  }

  const body = asObject(await response.json())
  const message = asObject(body?.message)
  const items = Array.isArray(message?.items) ? message.items : []

  const results: ReferenceSearchResult[] = []
  for (const item of items) {
    const parsed = crossrefFromItem(item)
    if (parsed) {
      results.push(parsed)
    }
  }

  return results
}

async function searchSemanticScholar(input: {
  field: ReferenceSearchField
  term: string
  maxResults: number
}): Promise<ReferenceSearchResult[]> {
  const fields = 'paperId,title,authors,year,abstract,url,externalIds'
  const normalizedDoi = normalizeDoi(input.term)

  if (input.field === 'doi' && normalizedDoi) {
    const doiUrl = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(normalizedDoi)}`)
    doiUrl.searchParams.set('fields', fields)

    const response = await fetch(doiUrl.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(12_000),
    })

    if (response.status === 404) {
      return []
    }

    if (!response.ok) {
      throw new Error(`Semantic Scholar DOI search failed with status ${response.status}`)
    }

    const parsed = semanticScholarFromPaper(await response.json())
    return parsed ? [parsed] : []
  }

  const queryUrl = new URL('https://api.semanticscholar.org/graph/v1/paper/search')
  queryUrl.searchParams.set('query', input.term)
  queryUrl.searchParams.set('limit', String(input.maxResults))
  queryUrl.searchParams.set('fields', fields)

  const response = await fetch(queryUrl.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12_000),
  })

  if (!response.ok) {
    throw new Error(`Semantic Scholar search failed with status ${response.status}`)
  }

  const body = asObject(await response.json())
  const papers = Array.isArray(body?.data) ? body.data : []
  const results: ReferenceSearchResult[] = []

  for (const paper of papers) {
    const parsed = semanticScholarFromPaper(paper)
    if (parsed) {
      results.push(parsed)
    }
  }

  return results
}

async function searchOpenAlex(input: {
  field: ReferenceSearchField
  term: string
  maxResults: number
}): Promise<ReferenceSearchResult[]> {
  const url = new URL('https://api.openalex.org/works')
  url.searchParams.set('per-page', String(input.maxResults))

  const normalizedDoi = normalizeDoi(input.term)
  if (input.field === 'doi' && normalizedDoi) {
    url.searchParams.set('filter', `doi:https://doi.org/${normalizedDoi.toLowerCase()}`)
  } else {
    url.searchParams.set('search', input.term)
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12_000),
  })

  if (!response.ok) {
    throw new Error(`OpenAlex search failed with status ${response.status}`)
  }

  const body = asObject(await response.json())
  const works = Array.isArray(body?.results) ? body.results : []
  const results: ReferenceSearchResult[] = []

  for (const work of works) {
    const parsed = openAlexFromWork(work)
    if (parsed) {
      results.push(parsed)
    }
  }

  return results
}

async function searchPubmed(input: {
  field: ReferenceSearchField
  term: string
  maxResults: number
}): Promise<ReferenceSearchResult[]> {
  const searchUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi')
  searchUrl.searchParams.set('db', 'pubmed')
  searchUrl.searchParams.set('retmode', 'json')
  searchUrl.searchParams.set('retmax', String(input.maxResults))
  searchUrl.searchParams.set('term', pubmedSearchTerm(input.field, input.term))

  const searchResponse = await fetch(searchUrl.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12_000),
  })

  if (!searchResponse.ok) {
    throw new Error(`PubMed search failed with status ${searchResponse.status}`)
  }

  const searchBody = asObject(await searchResponse.json())
  const searchResult = asObject(searchBody?.esearchresult)
  const idList = asStringArray(searchResult?.idlist)
  if (idList.length === 0) {
    return []
  }

  const summaryUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi')
  summaryUrl.searchParams.set('db', 'pubmed')
  summaryUrl.searchParams.set('retmode', 'json')
  summaryUrl.searchParams.set('id', idList.join(','))

  const summaryResponse = await fetch(summaryUrl.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12_000),
  })

  if (!summaryResponse.ok) {
    throw new Error(`PubMed summary failed with status ${summaryResponse.status}`)
  }

  const summaryBody = asObject(await summaryResponse.json())
  const result = asObject(summaryBody?.result)
  if (!result) {
    return []
  }

  const uids = asStringArray(result.uids)
  const source: ReferenceSource = 'pubmed'
  const output: ReferenceSearchResult[] = []

  for (const uid of uids) {
    const item = asObject(result[uid])
    if (!item) {
      continue
    }

    const title = normalizeWhitespace(asString(item.title) ?? '')
    if (!title) {
      continue
    }

    const authorsRaw = Array.isArray(item.authors) ? item.authors : []
    const authors: string[] = []
    for (const value of authorsRaw) {
      const author = asObject(value)
      const name = normalizeWhitespace(asString(author?.name) ?? '')
      if (name.length > 0) {
        authors.push(name)
      }
    }

    const articleIds = Array.isArray(item.articleids) ? item.articleids : []
    let doi: string | null = null
    for (const value of articleIds) {
      const articleId = asObject(value)
      const idType = normalizeWhitespace(asString(articleId?.idtype) ?? '').toLowerCase()
      if (idType === 'doi') {
        doi = normalizeDoi(asString(articleId?.value) ?? '')
        if (doi) {
          break
        }
      }
    }

    const identifier = doi ?? `PMID:${uid}`
    const url = `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(uid)}/`
    const year = extractYear(item.pubdate)
    const citationKey = createCitationKey(authors, year, identifier, source)

    output.push({
      id: `pubmed:${uid}`,
      source,
      identifier,
      url,
      title,
      authors,
      year,
      abstract: '',
      citations: buildCitations({
        citationKey,
        source,
        title,
        authors,
        year,
        identifier,
        url,
        doi,
      }),
    })
  }

  return output
}

export async function referenceSearchRoute(
  req: FastifyRequest<{ Querystring: ReferenceSearchQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const source = parseReferenceSource(String(req.query.source ?? '').trim().toLowerCase())
  if (!source) {
    reply.status(400).send({ error: 'Unsupported reference source' })
    return
  }

  if (source === 'arxiv' && shouldThrottleArxiv(req)) {
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
    let results: ReferenceSearchResult[] = []

    if (source === 'arxiv') {
      results = await searchArxiv({ field, term, maxResults })
    } else if (source === 'crossref') {
      results = await searchCrossref({ field, term, maxResults })
    } else if (source === 'semantic-scholar') {
      results = await searchSemanticScholar({ field, term, maxResults })
    } else if (source === 'pubmed') {
      results = await searchPubmed({ field, term, maxResults })
    } else if (source === 'openalex') {
      results = await searchOpenAlex({ field, term, maxResults })
    }

    reply.send({
      source,
      field,
      term,
      results,
    })
  } catch (err) {
    console.warn(`[references] search-failed source=${source} error=${String(err)}`)
    reply.status(502).send({ error: 'Reference search is currently unavailable' })
  }
}
