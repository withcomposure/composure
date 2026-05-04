import { useMemo, useState } from 'react'
import { BookPlus, Copy, Search, X } from 'lucide-react'
import { apiFetch, getErrorMessage } from '@/utils/fetch'

type ReferenceSource = 'arxiv'
type ReferenceField = 'all' | 'title' | 'author' | 'abstract'
type CitationFormat = 'bibtex' | 'biblatex'

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

interface ReferenceLookupModalProps {
  open: boolean
  onClose: () => void
  canAddToBibliography: boolean
  shareHeaders?: Record<string, string>
  onAddToBibliography: (citation: string) => Promise<void>
}

const referenceFieldOptions: Array<{ value: ReferenceField; label: string }> = [
  { value: 'all', label: 'All fields' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'abstract', label: 'Abstract' },
]

const citationFormatOptions: Array<{ value: CitationFormat; label: string }> = [
  { value: 'bibtex', label: 'BibTeX' },
  { value: 'biblatex', label: 'BibLaTeX' },
]

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function ReferenceLookupModal({
  open,
  onClose,
  canAddToBibliography,
  shareHeaders,
  onAddToBibliography,
}: ReferenceLookupModalProps) {
  const [source] = useState<ReferenceSource>('arxiv')
  const [field, setField] = useState<ReferenceField>('all')
  const [term, setTerm] = useState('')
  const [citationFormat, setCitationFormat] = useState<CitationFormat>('bibtex')
  const [results, setResults] = useState<ReferenceSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)

  const canSearch = term.trim().length > 0 && !loading

  const emptyStateMessage = useMemo(() => {
    if (loading) {
      return 'Searching arXiv...'
    }
    if (error) {
      return error
    }
    if (!searched) {
      return 'Search results will appear here.'
    }
    return 'No results found for this query.'
  }, [error, loading, searched])

  const runSearch = async (): Promise<void> => {
    const searchTerm = term.trim()
    if (!searchTerm || loading) {
      return
    }

    setLoading(true)
    setError(null)
    setSearched(true)

    try {
      const query = new URLSearchParams({
        source,
        field,
        term: searchTerm,
        maxResults: '20',
      })

      const res = await apiFetch(`/references/search?${query.toString()}`, {
        headers: shareHeaders,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Search failed' })) as { error?: string }
        throw new Error(body.error ?? 'Search failed')
      }

      const body = await res.json() as { results?: ReferenceSearchResult[] }
      setResults(Array.isArray(body.results) ? body.results : [])
    } catch (err) {
      setResults([])
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-6" role="dialog" aria-modal="true" aria-label="Reference lookup">
      <div className="flex h-[min(84vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-cz-border bg-cz-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-cz-border px-4 py-3">
          <Search size={16} className="text-cz-text-muted" />
          <span className="text-sm text-cz-text-muted">Search in</span>
          <select
            value={source}
            disabled
            className="rounded-md border border-cz-border bg-cz-bg px-2 py-1 text-sm text-cz-text"
            aria-label="Reference source"
          >
            <option value="arxiv">arXiv</option>
          </select>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
            aria-label="Close reference lookup"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="rounded-lg border border-cz-border bg-cz-bg/60 p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <label className="flex flex-1 flex-col gap-1 text-xs text-cz-text-muted">
                Field
                <select
                  value={field}
                  onChange={(event) => setField(event.target.value as ReferenceField)}
                  className="rounded-md border border-cz-border bg-cz-bg px-2 py-1.5 text-sm text-cz-text"
                >
                  {referenceFieldOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex-[2] flex flex-col gap-1 text-xs text-cz-text-muted">
                Search term
                <input
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void runSearch()
                    }
                  }}
                  placeholder="e.g. diffusion models"
                  className="rounded-md border border-cz-border bg-cz-bg px-2 py-1.5 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  void runSearch()
                }}
                disabled={!canSearch}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${canSearch ? 'bg-cz-accent text-white hover:bg-cz-accent-hover' : 'cursor-not-allowed border border-cz-border text-cz-text-muted opacity-60'}`}
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-cz-border bg-cz-bg/40">
            <div className="flex items-center justify-between border-b border-cz-border px-3 py-2">
              <span className="text-xs uppercase tracking-wide text-cz-text-muted">Results</span>
              <select
                value={citationFormat}
                onChange={(event) => setCitationFormat(event.target.value as CitationFormat)}
                className="rounded-md border border-cz-border bg-cz-bg px-2 py-1 text-xs text-cz-text"
                aria-label="Citation format"
              >
                {citationFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {results.length === 0 ? (
                <div className={`flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-cz-border px-4 text-sm ${error ? 'text-red-300' : 'text-cz-text-muted'}`}>
                  {emptyStateMessage}
                </div>
              ) : (
                <div className="space-y-2">
                  {results.map((result) => {
                    const citationText = result.citations[citationFormat]
                    const authorsLine = result.authors.length > 0 ? result.authors.join(', ') : 'Unknown author'
                    return (
                      <article key={result.id} className="rounded-lg border border-cz-border bg-cz-surface p-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-cz-text">{result.title}</div>
                            <div className="truncate text-xs text-cz-text-muted">{authorsLine}</div>
                            <div className="mt-0.5 text-[11px] text-cz-text-muted">{result.year ?? 'Unknown'} · {result.identifier}</div>
                            <p
                              className="mt-2 overflow-hidden text-xs text-cz-text-muted"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                              }}
                            >
                              {result.abstract || 'No abstract available.'}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setCopyingId(result.id)
                                void copyToClipboard(citationText)
                                  .catch(() => undefined)
                                  .finally(() => setCopyingId((current) => current === result.id ? null : current))
                              }}
                              className="rounded border border-cz-border p-1.5 text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                              aria-label="Copy citation"
                              title="Copy citation"
                            >
                              <Copy size={14} className={copyingId === result.id ? 'animate-pulse' : ''} />
                            </button>

                            <button
                              type="button"
                              disabled={!canAddToBibliography || addingId === result.id}
                              onClick={() => {
                                if (!canAddToBibliography || addingId === result.id) {
                                  return
                                }
                                setAddingId(result.id)
                                void onAddToBibliography(citationText)
                                  .catch(() => undefined)
                                  .finally(() => {
                                    setAddingId((current) => current === result.id ? null : current)
                                  })
                              }}
                              className={`rounded border p-1.5 ${canAddToBibliography ? 'border-cz-border text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text' : 'cursor-not-allowed border-cz-border text-cz-text-muted/50 opacity-60'}`}
                              aria-label="Add citation to bibliography"
                              title={canAddToBibliography ? 'Add to bibliography' : 'Set a default bibliography file to enable this action'}
                            >
                              <BookPlus size={14} className={addingId === result.id ? 'animate-pulse' : ''} />
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
