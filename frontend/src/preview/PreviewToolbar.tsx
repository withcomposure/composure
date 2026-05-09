import { useEffect, useId, useState, type ReactNode } from 'react'
import { AlertTriangle, ExternalLink, Moon, Sun } from 'lucide-react'

interface PreviewPageIndicator {
  currentPage: number
  totalPages: number
  onGoToPage: (page: number) => void
}

interface PreviewToolbarProps {
  statusLabel: string
  scale: number
  isFit: boolean
  onFit: () => void
  showFitButton?: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  url?: string | null
  extra?: ReactNode
  pageIndicator?: PreviewPageIndicator | null
}

export function PreviewToolbar({
  statusLabel,
  scale,
  isFit,
  onFit,
  showFitButton = true,
  onZoomIn,
  onZoomOut,
  url,
  extra,
  pageIndicator,
}: PreviewToolbarProps) {
  const pageInputId = useId()
  const [pageDraft, setPageDraft] = useState('')

  useEffect(() => {
    if (!pageIndicator) {
      setPageDraft('')
      return
    }
    setPageDraft(String(pageIndicator.currentPage))
  }, [pageIndicator?.currentPage, pageIndicator?.totalPages])

  const commitPageDraft = () => {
    if (!pageIndicator) {
      return
    }

    const parsed = Number.parseInt(pageDraft, 10)
    const fallbackPage = pageIndicator.currentPage
    const nextPage = Number.isFinite(parsed)
      ? Math.max(1, Math.min(pageIndicator.totalPages, parsed))
      : fallbackPage

    pageIndicator.onGoToPage(nextPage)
    setPageDraft(String(nextPage))
  }

  const btnClass =
    'inline-flex h-6 items-center justify-center rounded text-[11px] text-cz-text-muted transition-colors hover:bg-cz-surface-hover'
  const fitBtnBaseClass =
    'inline-flex h-6 items-center justify-center rounded px-2 text-[11px] transition-colors'
  const fitBtnClass = isFit
    ? `${fitBtnBaseClass} bg-cz-accent-muted text-cz-accent`
    : `${fitBtnBaseClass} text-cz-text-muted hover:bg-cz-surface-hover`

  return (
    <div
      className="flex items-center justify-between border-b border-cz-border bg-cz-surface px-3"
      style={{ height: 'var(--sub-toolbar-height)' }}
    >
      <span className="text-[11px] text-cz-text-muted">{statusLabel}</span>

      <div className="flex items-center gap-0.5">
        {pageIndicator && pageIndicator.totalPages > 1 && (
          <>
            <label className="sr-only" htmlFor={pageInputId}>
              Current page
            </label>
            <span className="inline-flex shrink-0 flex-row-reverse items-center">
              <span className="pr-1 text-[11px] text-cz-text-muted tabular-nums">/ {pageIndicator.totalPages}</span>
              <input
                id={pageInputId}
                type="text"
                inputMode="numeric"
                size={Math.max(1, pageDraft.length)}
                value={pageDraft}
                onChange={(event) => {
                  const next = event.target.value
                  if (/^\d*$/.test(next)) {
                    setPageDraft(next)
                  }
                }}
                onFocus={(event) => event.target.select()}
                onBlur={commitPageDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitPageDraft()
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setPageDraft(String(pageIndicator.currentPage))
                  }
                }}
                className="box-content mr-1 h-6 w-auto shrink-0 min-w-[1ch] max-w-[6ch] rounded border border-cz-border bg-cz-bg px-1 text-right text-[11px] text-cz-text font-mono tabular-nums outline-none focus:border-cz-accent"
                aria-label="Current page"
              />
            </span>
            <div className="mx-1 h-3 w-px bg-cz-border" />
          </>
        )}

        {showFitButton && (
          <button onClick={onFit} className={fitBtnClass} title="Fit to width">Fit</button>
        )}
        <button onClick={onZoomOut} className={`${btnClass} w-5`} title="Zoom out">-</button>
        <span className="w-8 text-center text-[11px] text-cz-text-muted tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={onZoomIn} className={`${btnClass} w-5`} title="Zoom in">+</button>

        {extra && (
          <>
            <div className="mx-1 h-3 w-px bg-cz-border" />
            {extra}
          </>
        )}

        {url && (
          <>
            <div className="mx-1 h-3 w-px bg-cz-border" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btnClass} w-6`}
              title="Open in new tab"
            >
              <ExternalLink size={12} />
            </a>
          </>
        )}
      </div>
    </div>
  )
}

export function PreviewDarkModeToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex h-6 w-6 items-center justify-center rounded text-[11px] transition-colors ${
        enabled ? 'bg-cz-accent-muted text-cz-accent' : 'text-cz-text-muted hover:bg-cz-surface-hover'
      }`}
      title={enabled ? 'Switch to light background' : 'Switch to dark background'}
    >
      {enabled ? <Moon size={12} /> : <Sun size={12} />}
    </button>
  )
}

export function PreviewErrorBanner({ label, message }: { label: string; message: string }) {
  return (
    <div className="mx-3 mt-3 rounded-lg border border-cz-danger/30 bg-cz-danger/10 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 text-cz-danger" size={14} aria-hidden="true" />
        <div>
          <p className="text-xs font-medium text-cz-danger mb-1">{label}</p>
          <pre className="text-[11px] text-cz-text-muted whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
            {message}
          </pre>
        </div>
      </div>
    </div>
  )
}

export function PreviewEmptyState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-3 flex justify-center opacity-40">{icon}</div>
        {children}
      </div>
    </div>
  )
}