import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { navigateToProjects } from './utils'

interface StatusPageProps {
  code: 403 | 404
  title: string
  description: string
}

export function StatusPage({ code, title, description }: StatusPageProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-pm-bg px-4 py-12 text-pm-text">
      <div className="pointer-events-none absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-pm-accent/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-10 h-72 w-72 rounded-full bg-pm-accent/10 blur-3xl" />

      <div className="relative w-full max-w-2xl rounded-2xl border border-pm-border bg-pm-surface/95 p-8 shadow-2xl backdrop-blur">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-pm-border bg-pm-bg/70 px-3 py-1 text-xs uppercase tracking-wider text-pm-text-muted">
          <AlertTriangle size={12} />
          Error {code}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-pm-text">{title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-pm-text-muted">{description}</p>
        <button
          type="button"
          onClick={navigateToProjects}
          className="mt-7 inline-flex items-center gap-2 rounded-md bg-pm-accent px-4 py-2 text-sm text-white hover:bg-pm-accent-hover"
        >
          <ArrowLeft size={14} />
          Back
        </button>
      </div>
    </div>
  )
}
