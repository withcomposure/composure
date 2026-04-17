import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { apiFetch } from '@/utils/fetch'

/**
 * Citation autocomplete plugin.
 * Triggers on \cite{ (LaTeX) and @ (Typst/Hayagriva) patterns.
 * Fetches parsed bibliography entries from the backend.
 */

interface BibEntry {
  key: string
  title?: string
  author?: string
  year?: string
}

let cachedEntries: BibEntry[] | null = null
let lastFetch = 0
const cacheTtl = 10_000 // 10 seconds

function extractProjectIdFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/project\/([a-f0-9]{32})$/)
  return match ? match[1] : null
}

function extractShareTokenFromUrl(): string | null {
  const query = new URLSearchParams(window.location.search)
  return query.get('share')
}

async function fetchBibEntries(): Promise<BibEntry[]> {
  const now = Date.now()
  if (cachedEntries && now - lastFetch < cacheTtl) {
    return cachedEntries
  }
  try {
    const projectId = extractProjectIdFromUrl()
    if (!projectId) {
      return cachedEntries ?? []
    }
    const shareToken = extractShareTokenFromUrl()
    const headers = shareToken ? { 'X-Share-Token': shareToken } : undefined
    const res = await apiFetch(`/api/bibliography/${projectId}`, {
      credentials: 'same-origin',
      headers,
    })
    if (!res.ok) return cachedEntries ?? []
    cachedEntries = await res.json()
    lastFetch = now
    return cachedEntries ?? []
  } catch {
    return cachedEntries ?? []
  }
}

export async function citationCompletion(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  // Match \cite{...  or @key patterns
  const latexMatch = context.matchBefore(/\\cite\{[\w,\s]*$/)
  const typstMatch = context.matchBefore(/@[\w-]*$/)

  const match = latexMatch || typstMatch
  if (!match) return null

  const entries = await fetchBibEntries()
  if (!entries.length) return null

  // For LaTeX, complete after the last comma inside \cite{}
  let from = match.from
  if (latexMatch) {
    const lastComma = match.text.lastIndexOf(',')
    const lastBrace = match.text.lastIndexOf('{')
    from = match.from + Math.max(lastComma, lastBrace) + 1
    // Skip whitespace
    const rest = context.state.doc.sliceString(from, match.to)
    from += rest.length - rest.trimStart().length
  } else {
    // For @citation, skip the @
    from = match.from + 1
  }

  return {
    from,
    options: entries.map((entry) => ({
      label: entry.key,
      detail: entry.year ?? '',
      info: [entry.title, entry.author].filter(Boolean).join(' — '),
      type: 'text',
    })),
    validFor: /^[\w-]*$/,
  }
}
