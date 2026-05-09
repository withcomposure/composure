import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ExternalLink, Moon, Pin, Sun } from 'lucide-react'

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
  onSetScale: (scale: number) => void
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
  onSetScale,
  url,
  extra,
  pageIndicator,
}: PreviewToolbarProps) {
  const pageInputId = useId()
  const zoomInputId = useId()
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const zoomHadFocusRef = useRef(false)
  const [pageDraft, setPageDraft] = useState('')
  const [zoomDraft, setZoomDraft] = useState('')
  const [zoomFocused, setZoomFocused] = useState(false)

  useEffect(() => {
    if (!pageIndicator) {
      setPageDraft('')
      return
    }
    setPageDraft(String(pageIndicator.currentPage))
  }, [pageIndicator?.currentPage, pageIndicator?.totalPages])

  const roundedZoomPercent = Math.round(scale * 100)

  useEffect(() => {
    if (!zoomFocused) {
      setZoomDraft(String(roundedZoomPercent))
    }
  }, [roundedZoomPercent, zoomFocused])

  useLayoutEffect(() => {
    const gainedFocus = zoomFocused && !zoomHadFocusRef.current
    zoomHadFocusRef.current = zoomFocused
    if (gainedFocus) {
      zoomInputRef.current?.select()
    }
  }, [zoomFocused])

  const commitZoomDraft = () => {
    const parsed = Number.parseInt(zoomDraft, 10)
    const fallbackPct = roundedZoomPercent
    const pct = Number.isFinite(parsed) ? parsed : fallbackPct
    onSetScale(pct / 100)
  }

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
        <div className="-mx-px flex items-center gap-px">
          <button onClick={onZoomOut} className={`${btnClass} w-5`} title="Zoom out">-</button>
          <label className="sr-only" htmlFor={zoomInputId}>
            Zoom percentage
          </label>
          <input
            ref={zoomInputRef}
            id={zoomInputId}
            type="text"
            inputMode="numeric"
            value={zoomFocused ? zoomDraft : `${roundedZoomPercent}%`}
            onChange={(event) => {
              const next = event.target.value.replace(/%/g, '')
              if (/^\d{0,3}$/.test(next)) {
                setZoomDraft(next)
              }
            }}
            onFocus={() => {
              setZoomFocused(true)
              setZoomDraft(String(roundedZoomPercent))
            }}
            onBlur={() => {
              setZoomFocused(false)
              commitZoomDraft()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitZoomDraft()
                ;(event.target as HTMLInputElement).blur()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setZoomDraft(String(roundedZoomPercent))
                ;(event.target as HTMLInputElement).blur()
              }
            }}
            className="box-content h-6 w-[4.5ch] shrink-0 rounded border border-cz-border bg-cz-bg px-1 text-center text-[11px] text-cz-text font-mono tabular-nums outline-none focus:border-cz-accent"
            aria-label="Zoom percentage"
          />
          <button onClick={onZoomIn} className={`${btnClass} w-5`} title="Zoom in">+</button>
        </div>

        {extra && (
          <>
            <div className="mx-1 h-3 w-px bg-cz-border" />
            {extra}
          </>
        )}

        <button
          type="button"
          disabled={!url}
          onClick={() => {
            if (!url) return
            const win = window.open(url, '_blank')
            if (win) win.opener = null
          }}
          className={`${btnClass} w-6 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
          title={url ? 'Open in new tab' : 'Nothing to open in a new tab'}
        >
          <ExternalLink size={12} aria-hidden />
        </button>
      </div>
    </div>
  )
}

export function PreviewDarkModeToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-[11px] text-cz-text-muted transition-colors hover:bg-cz-surface-hover"
      title={enabled ? 'Switch to light background' : 'Switch to dark background'}
      aria-pressed={enabled}
    >
      {enabled ? <Moon size={12} /> : <Sun size={12} />}
    </button>
  )
}

export function PreviewPinToggle({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex h-6 w-6 items-center justify-center rounded text-[11px] transition-colors ${
        pinned ? 'bg-cz-accent-muted text-cz-accent' : 'text-cz-text-muted hover:bg-cz-surface-hover'
      }`}
      title={pinned ? 'Unpin preview from this file' : 'Pin preview to this file'}
      aria-pressed={pinned}
    >
      <Pin size={12} className={pinned ? 'fill-current' : ''} />
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