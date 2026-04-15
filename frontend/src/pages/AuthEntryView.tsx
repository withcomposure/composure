import { useCallback, useState } from 'react'

interface AuthEntryViewProps {
  busy: boolean
  error: string | null
  guestRetentionDays: number
  guestSignupsEnabled: boolean
  userCount: number
  signupMode: 'open' | 'invite-only'
  initialMode: 'login' | 'signup'
  inviteToken?: string
  onLogin: (input: { email: string; password: string }) => void
  onSignup: (input: { displayName: string; email: string; password: string; inviteToken?: string }) => void
  onPasswordReset: (input: { token: string; newPassword: string }) => void
  onContinueAsGuest: () => void
  resetToken?: string
  resetEmail?: string
}

export function AuthEntryView({
  busy,
  error,
  guestRetentionDays,
  guestSignupsEnabled,
  userCount,
  signupMode,
  initialMode,
  inviteToken,
  onLogin,
  onSignup,
  onPasswordReset,
  onContinueAsGuest,
  resetToken,
  resetEmail,
}: AuthEntryViewProps) {
  const isNoUsersBootstrap = userCount === 0 && !resetToken
  const isPasswordResetMode = Boolean(resetToken)
  const isInviteMode = Boolean(inviteToken)
  const canShowCreateAccount = isNoUsersBootstrap || isInviteMode || signupMode === 'open'

  const [mode, setMode] = useState<'login' | 'signup'>(isInviteMode ? 'signup' : initialMode)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const effectiveMode: 'login' | 'signup' = isNoUsersBootstrap || isInviteMode ? 'signup' : canShowCreateAccount ? mode : 'login'
  const effectiveEmail = isPasswordResetMode ? (resetEmail ?? '') : email

  const submitAuth = useCallback(() => {
    if (isPasswordResetMode && resetToken) {
      onPasswordReset({ token: resetToken, newPassword: password })
      return
    }

    if (effectiveMode === 'login') {
      onLogin({ email: effectiveEmail, password })
      return
    }
    if (effectiveMode === 'signup' && displayName.trim().length < 2) {
      return
    }
    onSignup({ displayName, email: effectiveEmail, password, inviteToken })
  }, [displayName, effectiveEmail, effectiveMode, inviteToken, isPasswordResetMode, onLogin, onPasswordReset, onSignup, password, resetToken])

  const passwordMismatch = isPasswordResetMode && confirmPassword.trim().length > 0 && confirmPassword !== password
  const invalidSignupDisplayName = !isPasswordResetMode && effectiveMode === 'signup' && displayName.trim().length < 2

  return (
    <div className="flex min-h-screen items-center justify-center bg-pm-bg px-4 text-pm-text">
      <div className="w-full max-w-md rounded-2xl border border-pm-border bg-pm-surface p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="text-xl font-semibold tracking-tight">
            <span className="text-pm-accent">P</span>ressmark
          </div>
          <p className="mt-4 text-sm text-pm-text-muted">
            {isPasswordResetMode
              ? 'Set a new password for your account.'
              : 'Sign in to sync your projects across devices.'}
          </p>
        </div>

        {isNoUsersBootstrap ? (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
            No accounts exist yet. The first account created will automatically become a server administrator.
          </div>
        ) : isInviteMode ? (
          <div className="mb-4 rounded-md border border-pm-accent/40 bg-pm-accent/10 px-3 py-3 text-sm text-pm-text">
            You have been invited to create an account.
          </div>
        ) : !isPasswordResetMode && canShowCreateAccount ? (
          <div className="mb-4 flex justify-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`rounded-md px-3 py-2 ${effectiveMode === 'login' ? 'bg-pm-accent text-white' : 'text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text'}`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`rounded-md px-3 py-2 ${effectiveMode === 'signup' ? 'bg-pm-accent text-white' : 'text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text'}`}
            >
              Create account
            </button>
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            submitAuth()
          }}
        >
          {effectiveMode === 'signup' && !isPasswordResetMode && (
            <>
              <label className="block text-xs uppercase tracking-wider text-pm-text-muted">Display name</label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mt-1 mb-3 w-full rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
                placeholder="Ada Lovelace"
              />
              {displayName.trim().length > 0 && displayName.trim().length < 2 && (
                <div className="-mt-2 mb-3 text-sm text-red-300">Display name must be at least 2 characters.</div>
              )}
            </>
          )}

          <label className="block text-xs uppercase tracking-wider text-pm-text-muted">Email</label>
          <input
            value={effectiveEmail}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isPasswordResetMode}
            className="mt-1 mb-3 w-full rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
            placeholder="you@example.com"
          />

          <label className="block text-xs uppercase tracking-wider text-pm-text-muted">
            {isPasswordResetMode ? 'New password' : 'Password'}
          </label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
          />

          {isPasswordResetMode && (
            <>
              <label className="mt-3 block text-xs uppercase tracking-wider text-pm-text-muted">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
              />
            </>
          )}

          {passwordMismatch && <div className="mt-3 text-sm text-red-300">Passwords must match.</div>}

          {error && <div className="mt-3 text-sm text-red-300">{error}</div>}

          <button
            type="submit"
            disabled={busy || passwordMismatch || invalidSignupDisplayName}
            className="mt-6 w-full rounded-md bg-pm-accent px-3 py-2 text-sm text-white hover:bg-pm-accent-hover disabled:opacity-70"
          >
            {busy
              ? 'Please wait...'
              : isPasswordResetMode
                ? 'Set new password'
                : effectiveMode === 'login'
                  ? 'Log in'
                  : 'Create account'}
          </button>
        </form>

        {!isPasswordResetMode && !isNoUsersBootstrap && guestSignupsEnabled && (
          <button
            type="button"
            disabled={busy}
            onClick={onContinueAsGuest}
            className="mt-4 w-full rounded-md border border-pm-border px-3 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text disabled:opacity-70"
          >
            Continue as guest
          </button>
        )}

        {!isPasswordResetMode && !isNoUsersBootstrap && guestSignupsEnabled && (
          <div className="mt-3 text-center text-xs text-pm-text-muted">
            Guest documents are retained for {guestRetentionDays} days of inactivity.
          </div>
        )}
      </div>
    </div>
  )
}
