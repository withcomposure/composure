import { useMemo, useState } from 'react'
import { AmbientBackground } from '@/components/AmbientBackground'

const providerLabels: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
  orcid: 'ORCID',
}

interface CompleteProfileViewProps {
  busy: boolean
  error: string | null
  provider: string
  displayName?: string | null
  onSubmit: (email: string) => void
  onCancel: () => void
}

export function CompleteProfileView({
  busy,
  error,
  provider,
  displayName,
  onSubmit,
  onCancel,
}: CompleteProfileViewProps) {
  const [email, setEmail] = useState('')

  const providerName = useMemo(() => providerLabels[provider] ?? provider, [provider])
  const normalizedEmail = email.trim().toLowerCase()

  return (
    <AmbientBackground className="text-cz-text">
      <div className="w-full max-w-md rounded-2xl border border-cz-border bg-cz-surface p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="text-xl font-semibold tracking-tight">
            <span className="text-cz-accent">C</span>omposure
          </div>
          <p className="mt-4 text-sm text-cz-text-muted">
            Complete your profile to finish signing in with {providerName}.
          </p>
        </div>

        {displayName && (
          <div className="mb-4 rounded-md border border-cz-border bg-cz-bg/60 px-3 py-3 text-sm text-cz-text-muted">
            Signed in as {displayName}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit(normalizedEmail)
          }}
        >
          <label className="block text-xs uppercase tracking-wider text-cz-text-muted">
            Email
          </label>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
            placeholder="you@example.com"
            autoComplete="email"
          />

          {error && (
            <div className="mt-3 text-sm text-red-300">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy || normalizedEmail.length === 0}
            className="mt-6 w-full rounded-md bg-cz-accent px-3 py-2 text-sm text-white hover:bg-cz-accent-hover disabled:opacity-70"
          >
            {busy ? 'Please wait...' : 'Complete sign in'}
          </button>
        </form>

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="mt-3 w-full rounded-md border border-cz-border px-3 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-70"
        >
          Start over
        </button>
      </div>
    </AmbientBackground>
  )
}
