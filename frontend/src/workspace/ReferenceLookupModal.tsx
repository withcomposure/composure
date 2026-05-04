import { useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowDownUp, ArrowUpAZ, BookPlus, Braces, Check, Copy, LibraryBig, ScanSearch, Search, UserRoundSearch, WholeWord, X, type LucideIcon } from 'lucide-react'
import { CustomDropdown } from '@/components/CustomDropdown'
import { apiFetch, getErrorMessage } from '@/utils/fetch'

type ReferenceSource = 'arxiv' | 'crossref' | 'pubmed' | 'openalex'
type ReferenceField = 'all' | 'title' | 'author' | 'abstract' | 'doi'
type CitationFormat = 'bibtex' | 'biblatex'
type ReferenceSort = 'relevance' | 'year-desc' | 'year-asc' | 'title-asc'

interface AddCitationResult {
  added: boolean
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

interface ReferenceLookupModalProps {
  open: boolean
  onClose: () => void
  canAddToBibliography: boolean
  shareHeaders?: Record<string, string>
  citationFormat: CitationFormat
  onCitationFormatChange: (nextFormat: CitationFormat) => void
  onAddToBibliography: (citation: string) => Promise<AddCitationResult>
}

const referenceSourceOptions: Array<{ value: ReferenceSource; label: string; icon: LucideIcon }> = [
  { value: 'arxiv', label: 'arXiv', icon: LibraryBig },
  { value: 'crossref', label: 'Crossref', icon: Braces },
  { value: 'pubmed', label: 'PubMed/NCBI', icon: UserRoundSearch },
  { value: 'openalex', label: 'OpenAlex', icon: ScanSearch },
]

const referenceFieldOptions: Array<{ value: ReferenceField; label: string; icon: LucideIcon }> = [
  { value: 'all', label: 'All fields', icon: WholeWord },
  { value: 'title', label: 'Title', icon: ScanSearch },
  { value: 'author', label: 'Author', icon: UserRoundSearch },
  { value: 'abstract', label: 'Abstract', icon: Search },
  { value: 'doi', label: 'DOI', icon: Braces },
]

const citationFormatOptions: Array<{ value: CitationFormat; label: string; icon: LucideIcon }> = [
  { value: 'bibtex', label: 'BibTeX', icon: Braces },
  { value: 'biblatex', label: 'BibLaTeX', icon: Braces },
]

const referenceSortOptions: Array<{ value: ReferenceSort; label: string; icon: LucideIcon }> = [
  { value: 'relevance', label: 'Relevance', icon: ArrowDownUp },
  { value: 'year-desc', label: 'Year (Newest)', icon: ArrowDownAZ },
  { value: 'year-asc', label: 'Year (Oldest)', icon: ArrowUpAZ },
  { value: 'title-asc', label: 'Title (A-Z)', icon: ArrowUpAZ },
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
  citationFormat,
  onCitationFormatChange,
  onAddToBibliography,
}: ReferenceLookupModalProps) {
  const [source, setSource] = useState<ReferenceSource>('arxiv')
  const [field, setField] = useState<ReferenceField>('all')
  const [term, setTerm] = useState('')
  const [sortBy, setSortBy] = useState<ReferenceSort>('relevance')
  const [results, setResults] = useState<ReferenceSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedResultIds, setAddedResultIds] = useState<Set<string>>(new Set())

  const canSearch = term.trim().length > 0 && !loading
  const selectedSourceLabel = useMemo(() => {
    return referenceSourceOptions.find((option) => option.value === source)?.label ?? source
  }, [source])

  const emptyStateMessage = useMemo(() => {
    if (loading) {
      return `Searching ${selectedSourceLabel}...`
    }
    if (error) {
      return error
    }
    if (!searched) {
      return 'Search results will appear here.'
    }
    return 'No results found for this query.'
  }, [error, loading, searched, selectedSourceLabel])

  const displayedResults = useMemo(() => {
    if (sortBy === 'relevance') {
      return results
    }

    const sorted = [...results]

    if (sortBy === 'title-asc') {
      sorted.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }))
      return sorted
    }

    const parseYear = (value: string | null): number | null => {
      if (!value) {
        return null
      }
      const parsed = Number.parseInt(value, 10)
      return Number.isFinite(parsed) ? parsed : null
    }

    sorted.sort((left, right) => {
      const leftYear = parseYear(left.year)
      const rightYear = parseYear(right.year)
      if (leftYear == null && rightYear == null) {
        return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
      }
      if (leftYear == null) {
        return 1
      }
      if (rightYear == null) {
        return -1
      }
      if (sortBy === 'year-desc') {
        return rightYear - leftYear
      }
      return leftYear - rightYear
    })

    return sorted
  }, [results, sortBy])

  const runSearch = async (): Promise<void> => {
    const searchTerm = term.trim()
    if (!searchTerm || loading) {
      return
    }

    setLoading(true)
    setError(null)
    setSearched(true)
    setAddedResultIds(new Set())

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
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Reference lookup"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-[min(84vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-cz-border bg-cz-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-cz-border px-4 py-3">
          <Search size={16} className="text-cz-text-muted" />
          <span className="text-sm text-cz-text-muted">Find references in:</span>
          <CustomDropdown
            value={source}
            options={referenceSourceOptions}
            onChange={(nextSource) => {
              setSource(nextSource)
              setField((current) => {
                if (nextSource === 'crossref') {
                  return 'doi'
                }
                if (nextSource === 'arxiv' && current === 'doi') {
                  return 'all'
                }
                return current
              })
            }}
          />
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
          <div className="rounded-lg border border-cz-border bg-cz-bg/60 px-3 pb-3 pt-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-2">
              <label className="flex flex-col gap-1 text-xs text-cz-text-muted md:w-40 md:flex-none">
                <span
                  className="text-xs tracking-[0.06em] text-cz-text-muted"
                  style={{ fontVariantCaps: 'all-small-caps' }}
                >
                  Field
                </span>
                <CustomDropdown
                  value={field}
                  options={referenceFieldOptions}
                  onChange={setField}
                  className="w-full"
                />
              </label>

              <label className="flex flex-1 flex-col gap-1 text-xs text-cz-text-muted">
                <span
                  className="text-xs tracking-[0.06em] text-cz-text-muted"
                  style={{ fontVariantCaps: 'all-small-caps' }}
                >
                  Search term
                </span>
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
                  className="h-7 rounded-md border border-cz-border bg-cz-bg px-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  void runSearch()
                }}
                disabled={!canSearch}
                className={`h-7 rounded-md px-3 text-sm font-medium transition-colors ${canSearch ? 'bg-cz-accent text-white hover:bg-cz-accent-hover' : 'cursor-not-allowed border border-cz-border text-cz-text-muted opacity-60'}`}
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-cz-border bg-cz-bg/40">
            <div className="flex items-center justify-between border-b border-cz-border px-3 py-2">
              <span className="text-xs uppercase tracking-wide text-cz-text-muted">Results</span>
              <div className="flex items-center gap-2">
                <CustomDropdown
                  value={sortBy}
                  options={referenceSortOptions}
                  onChange={setSortBy}
                  className="shrink-0"
                />
                <CustomDropdown
                  value={citationFormat}
                  options={citationFormatOptions}
                  onChange={onCitationFormatChange}
                  className="shrink-0"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {displayedResults.length === 0 ? (
                <div className={`flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-cz-border px-4 text-sm ${error ? 'text-red-300' : 'text-cz-text-muted'}`}>
                  {emptyStateMessage}
                </div>
              ) : (
                <div className="space-y-2">
                  {displayedResults.map((result) => {
                    const citationText = result.citations[citationFormat]
                    const authorsLine = result.authors.length > 0 ? result.authors.join(', ') : 'Unknown author'
                    const alreadyAdded = addedResultIds.has(result.id)
                    const addDisabled = !canAddToBibliography || addingId === result.id || alreadyAdded
                    return (
                      <article key={result.id} className="rounded-lg border border-cz-border bg-cz-surface p-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <a
                              href={result.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="block truncate text-sm font-medium text-cz-text hover:text-cz-accent"
                              title="Open paper in a new tab"
                            >
                              {result.title}
                            </a>
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
                              disabled={addDisabled}
                              onClick={() => {
                                if (addDisabled) {
                                  return
                                }
                                setAddingId(result.id)
                                void onAddToBibliography(citationText)
                                  .then((outcome) => {
                                    if (outcome.added) {
                                      setAddedResultIds((prev) => {
                                        const next = new Set(prev)
                                        next.add(result.id)
                                        return next
                                      })
                                    }
                                  })
                                  .catch(() => undefined)
                                  .finally(() => {
                                    setAddingId((current) => current === result.id ? null : current)
                                  })
                              }}
                              className={`rounded border p-1.5 ${addDisabled ? 'cursor-not-allowed border-cz-border bg-cz-surface text-cz-text-muted/50 opacity-70' : 'border-cz-border text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'}`}
                              aria-label="Add citation to bibliography"
                              title={canAddToBibliography ? 'Add to bibliography' : 'Set a default bibliography file to enable this action'}
                            >
                              {alreadyAdded ? (
                                <Check size={14} className="text-cz-accent" />
                              ) : (
                                <BookPlus size={14} className={addingId === result.id ? 'animate-pulse' : ''} />
                              )}
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
