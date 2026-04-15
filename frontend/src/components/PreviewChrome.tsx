import type { ReactNode } from 'react'
import { AlertTriangle, ExternalLink, Moon, Sun } from 'lucide-react'

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
}: PreviewToolbarProps) {
  const btnClass =
    'rounded px-1.5 py-0.5 text-xs text-pm-text-muted hover:bg-pm-surface-hover transition-colors'
  const fitBtnClass = isFit
    ? 'rounded px-1.5 py-0.5 text-xs text-pm-accent bg-pm-accent-muted transition-colors'
    : btnClass

  return (
    <div className="flex items-center justify-between border-b border-pm-border px-3 py-1.5 bg-pm-surface">
      <span className="text-[11px] text-pm-text-muted">{statusLabel}</span>

      <div className="flex items-center gap-0.5">
        {extra}

        {showFitButton && (
          <button onClick={onFit} className={fitBtnClass} title="Fit to width">Fit</button>
        )}
        <button onClick={onZoomOut} className={btnClass} title="Zoom out">-</button>
        <span className="text-[11px] text-pm-text-muted w-11 text-center tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={onZoomIn} className={btnClass} title="Zoom in">+</button>

        {url && (
          <>
            <div className="mx-1 h-3 w-px bg-pm-border" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btnClass} inline-flex items-center gap-1`}
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
    <>
      <div className="mx-1 h-3 w-px bg-pm-border" />
      <button
        onClick={onToggle}
        className={`rounded px-1.5 py-0.5 text-xs transition-colors inline-flex items-center ${
          enabled ? 'text-pm-accent bg-pm-accent-muted' : 'text-pm-text-muted hover:bg-pm-surface-hover'
        }`}
        title={enabled ? 'Switch to light background' : 'Switch to dark background'}
      >
        {enabled ? <Moon size={12} /> : <Sun size={12} />}
      </button>
    </>
  )
}

export function PreviewErrorBanner({ label, message }: { label: string; message: string }) {
  return (
    <div className="mx-3 mt-3 rounded-lg border border-pm-danger/30 bg-pm-danger/10 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 text-pm-danger" size={14} aria-hidden="true" />
        <div>
          <p className="text-xs font-medium text-pm-danger mb-1">{label}</p>
          <pre className="text-[11px] text-pm-text-muted whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
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