import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { AmbientBackground } from '@/components/AmbientBackground'
import { navigateToProjects } from '@/utils/route'

interface StatusPageProps {
  code: 403 | 404 | 503
  title: string
  description: string
}

export function StatusPage({ code, title, description }: StatusPageProps) {
  return (
    <AmbientBackground>
      <div className="relative w-full max-w-2xl rounded-2xl border border-cz-border bg-cz-surface/95 p-8 shadow-2xl backdrop-blur">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cz-border bg-cz-bg/70 px-3 py-1 text-xs uppercase tracking-wider text-cz-text-muted">
          <AlertTriangle size={12} />
          Error {code}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-cz-text">{title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-cz-text-muted">{description}</p>
        <button
          type="button"
          onClick={navigateToProjects}
          className="mt-7 inline-flex items-center gap-2 rounded-md bg-cz-accent px-4 py-2 text-sm text-white hover:bg-cz-accent-hover"
        >
          <ArrowLeft size={14} />
          Back
        </button>
      </div>
    </AmbientBackground>
  )
}
