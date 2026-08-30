import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, RefreshCw } from 'lucide-react'
import { PopupDialog } from '@/components/PopupDialog'
import { ToggleSwitch } from '@/components/ToggleSwitch'
import { apiUrl, fetchJson, getErrorMessage } from '@/utils/fetch'
import { apiRequestCredentials } from '@/utils/api-routing'
import { PROVIDER_LABELS } from '@/utils/auth-providers'

interface LoginProviderItem {
  provider: string
  enabled: boolean
  hasCredentials: boolean
  clientId: string
  clientSecret: string
  dirty: boolean
}

interface LoginProvidersSectionProps {
  sectionRef: (node: HTMLElement | null) => void
}

export function LoginProvidersSection({ sectionRef }: LoginProvidersSectionProps) {
  const [loginProviders, setLoginProviders] = useState<LoginProviderItem[]>([])
  const [loginProvidersSaved, setLoginProvidersSaved] = useState<LoginProviderItem[]>([])
  const [loginProvidersBusy, setLoginProvidersBusy] = useState(false)
  const [loginProvidersError, setLoginProvidersError] = useState<string | null>(null)
  const [providerTestResults, setProviderTestResults] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'fail'>>({})
  const [providerTestErrors, setProviderTestErrors] = useState<Record<string, string>>({})
  const [callbackCopiedProvider, setCallbackCopiedProvider] = useState<string | null>(null)
  const [strandedDialog, setStrandedDialog] = useState<{
    kind: 'error' | 'warning'
    message: string
    strandedCount: number
    strandedUserIds: string[]
  } | null>(null)
  const [strandedCsvDownloaded, setStrandedCsvDownloaded] = useState(false)
  const [strandedConfirmText, setStrandedConfirmText] = useState('')

  const loadLoginProviders = useCallback(() => {
    return fetchJson<{ providers: Array<{ provider: string; enabled: boolean; hasCredentials: boolean; clientId?: string }> }>('/admin/login-providers')
      .then((response) => {
        const items: LoginProviderItem[] = response.providers
          .map((p) => ({
            provider: p.provider,
            enabled: p.enabled,
            hasCredentials: p.hasCredentials,
            clientId: p.clientId ?? '',
            clientSecret: '',
            dirty: false,
          }))
        setLoginProviders(items)
        setLoginProvidersSaved(items.map((i) => ({ ...i })))
      })
      .catch((err: unknown) => {
        setLoginProvidersError(getErrorMessage(err))
      })
  }, [])

  useEffect(() => {
    void loadLoginProviders()
  }, [loadLoginProviders])

  const testProvider = useCallback(async (provider: string, clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }> => {
    setProviderTestResults((prev) => ({ ...prev, [provider]: 'testing' }))
    setProviderTestErrors((prev) => {
      const next = { ...prev }
      delete next[provider]
      return next
    })
    try {
      const result = await fetchJson<{ ok: boolean; error?: string }>('/admin/login-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, clientId, clientSecret }),
      })
      setProviderTestResults((prev) => ({ ...prev, [provider]: result.ok ? 'ok' : 'fail' }))
      if (!result.ok) {
        const message = result.error ?? 'Test failed'
        setProviderTestErrors((prev) => ({ ...prev, [provider]: message }))
        return { ok: false, error: message }
      }
      return { ok: true }
    } catch (err) {
      const message = getErrorMessage(err)
      setProviderTestResults((prev) => ({ ...prev, [provider]: 'fail' }))
      setProviderTestErrors((prev) => ({ ...prev, [provider]: message }))
      return { ok: false, error: message }
    }
  }, [])

  const saveLoginProviders = useCallback(async (force = false) => {
    setLoginProvidersBusy(true)
    setLoginProvidersError(null)
    try {
      if (!loginProviders.some((p) => p.enabled)) {
        setLoginProvidersError('At least one login provider must remain enabled.')
        setLoginProvidersBusy(false)
        return
      }

      const providersToValidate = loginProviders.filter(
        (provider) => provider.provider !== 'password'
          && provider.enabled
          && provider.clientId.trim() !== ''
          && (provider.clientSecret.trim() !== '' || provider.hasCredentials),
      )

      if (providersToValidate.length > 0) {
        const testResults = await Promise.all(providersToValidate.map(async (provider) => {
          const result = await testProvider(provider.provider, provider.clientId, provider.clientSecret || '__keep__')
          return {
            provider: provider.provider,
            ok: result.ok,
          }
        }))
        const failedProviders = testResults
          .filter((result) => !result.ok)
          .map((result) => PROVIDER_LABELS[result.provider] ?? result.provider)

        if (failedProviders.length > 0) {
          setLoginProvidersError(
            `${failedProviders.join(', ')} failed credential validation. Fix the provider settings and try again.`,
          )
          setLoginProvidersBusy(false)
          return
        }
      }

      // Determine which providers are being disabled
      const providersToDisable: string[] = []
      for (const p of loginProviders) {
        const saved = loginProvidersSaved.find((s) => s.provider === p.provider)
        if (saved?.enabled && !p.enabled) {
          providersToDisable.push(p.provider)
        }
      }
      if (!force && providersToDisable.length > 0) {
        const check = await fetchJson<{
          strandedCount: number
          totalUsers: number
          adminStranded: boolean
          allStranded: boolean
          strandedUserIds: string[]
        }>('/admin/login-providers/check-stranded', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providersToDisable }),
        })

        if (check.adminStranded) {
          setStrandedDialog({
            kind: 'error',
            message: 'You cannot disable this provider because your own account relies on it. Link another login method first.',
            strandedCount: check.strandedCount,
            strandedUserIds: check.strandedUserIds,
          })
          setLoginProvidersBusy(false)
          return
        }

        if (check.allStranded) {
          setStrandedDialog({
            kind: 'error',
            message: 'Every user on this server relies on a provider you are disabling. No one would be able to log in.',
            strandedCount: check.strandedCount,
            strandedUserIds: check.strandedUserIds,
          })
          setLoginProvidersBusy(false)
          return
        }

        if (check.strandedCount > 0) {
          setStrandedDialog({
            kind: 'warning',
            message: `${check.strandedCount} user${check.strandedCount === 1 ? '' : 's'} will lose access to their account${check.strandedCount === 1 ? '' : 's'} because ${check.strandedCount === 1 ? 'their' : 'their'} only login method is being disabled.`,
            strandedCount: check.strandedCount,
            strandedUserIds: check.strandedUserIds,
          })
          setStrandedCsvDownloaded(false)
          setStrandedConfirmText('')
          setLoginProvidersBusy(false)
          return
        }
      }

      await fetchJson('/admin/login-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providers: loginProviders.map((p) => ({
            provider: p.provider,
            enabled: p.enabled,
            ...(p.clientId && { clientId: p.clientId }),
            ...(p.clientSecret && { clientSecret: p.clientSecret }),
          })),
        }),
      })

      setStrandedDialog(null)
      await loadLoginProviders()
    } catch (err) {
      setLoginProvidersError(getErrorMessage(err))
    } finally {
      setLoginProvidersBusy(false)
    }
  }, [loginProviders, loginProvidersSaved, loadLoginProviders, testProvider])

  const downloadStrandedCsv = useCallback(async (userIds: string[]) => {
    try {
      const res = await fetch(
        apiUrl('/admin/login-providers/stranded-csv'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: apiRequestCredentials(),
          body: JSON.stringify({ userIds }),
        },
      )
      // This download gates the destructive "Save Anyway" button — a failed
      // response must not count as a successful backup.
      if (!res.ok) {
        throw new Error(`CSV download failed (HTTP ${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'stranded-users.csv'
      a.click()
      URL.revokeObjectURL(url)
      setStrandedCsvDownloaded(true)
    } catch (err) {
      setLoginProvidersError(getErrorMessage(err))
    }
  }, [])

  const loginProvidersDirty = loginProviders.some((p) => {
    const saved = loginProvidersSaved.find((item) => item.provider === p.provider)
    return !saved || p.enabled !== saved.enabled || p.clientId !== saved.clientId || p.clientSecret !== ''
  })

  const enabledLoginProviderCount = loginProviders.filter((p) => p.enabled).length

  return (
    <>
      <section id="admin-section-login-providers" ref={sectionRef} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound size={14} /> Login Providers
          </div>
          <button
            type="button"
            onClick={() => { void saveLoginProviders() }}
            disabled={loginProvidersBusy || !loginProvidersDirty}
            className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs disabled:opacity-60 ${
              loginProvidersDirty
                ? 'border-transparent bg-cz-accent text-white hover:bg-cz-accent-hover'
                : 'border-cz-border bg-cz-bg text-cz-text-muted'
            }`}
          >
            {!loginProvidersDirty && <Check size={12} />}
            {loginProvidersBusy ? 'Applying...' : loginProvidersDirty ? 'Apply Settings' : 'Saved'}
          </button>
        </div>

        <div className="overflow-hidden rounded-md border border-cz-border bg-cz-bg/50">
          {loginProviders.map((p, idx) => {
            const testStatus = providerTestResults[p.provider] ?? 'idle'
            const testError = providerTestErrors[p.provider]
            const isPasswordProvider = p.provider === 'password'
            const isPasskeyProvider = p.provider === 'passkey'
            const isOAuthProvider = !isPasswordProvider && !isPasskeyProvider
            const canTest = isOAuthProvider && p.enabled && p.clientId.trim() !== '' && (p.clientSecret.trim() !== '' || p.hasCredentials)
            const toggleDisabled = loginProvidersBusy || (p.enabled && enabledLoginProviderCount <= 1)
            const providerLabel = PROVIDER_LABELS[p.provider] ?? p.provider
            return (
              <div key={p.provider} className={`${idx === 0 ? '' : 'border-t border-cz-border'} px-3 py-3`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-cz-text">{providerLabel}</div>
                    {isPasswordProvider && (
                      <div className="text-xs text-cz-text-muted">Email and password login for local accounts.</div>
                    )}
                    {isPasskeyProvider && (
                      <div className="text-xs text-cz-text-muted">Passwordless sign-in with device biometrics or security keys.</div>
                    )}
                  </div>
                  <ToggleSwitch
                    checked={p.enabled}
                    disabled={toggleDisabled}
                    onChange={(checked) => {
                      setLoginProviders((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, enabled: checked } : item)),
                      )
                      setProviderTestResults((prev) => {
                        const next = { ...prev }
                        delete next[p.provider]
                        return next
                      })
                    }}
                    ariaLabel={`Enable ${p.provider}`}
                  />
                </div>
                {isOAuthProvider && p.enabled && (
                  <div className="mt-3 space-y-2">
                    <div>
                      <label className="mb-1 block text-xs text-cz-text-muted">Callback URL (configure this in your {providerLabel} app)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={new URL(apiUrl(`/auth/via/${p.provider}/callback`), window.location.origin).href}
                          onFocus={(e) => e.currentTarget.select()}
                          className="h-8 min-w-0 flex-1 rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text-muted outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(new URL(apiUrl(`/auth/via/${p.provider}/callback`), window.location.origin).href)
                            setCallbackCopiedProvider(p.provider)
                            setTimeout(() => setCallbackCopiedProvider((prev) => (prev === p.provider ? null : prev)), 2000)
                          }}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-cz-border bg-cz-bg px-2.5 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                        >
                          {callbackCopiedProvider === p.provider ? <Check size={14} /> : <Copy size={14} />}
                          {callbackCopiedProvider === p.provider ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs text-cz-text-muted">Client ID</label>
                        <input
                          type="text"
                          value={p.clientId}
                          onChange={(e) => {
                            setLoginProviders((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, clientId: e.target.value } : item)),
                            )
                            setProviderTestResults((prev) => {
                              const next = { ...prev }
                              delete next[p.provider]
                              return next
                            })
                          }}
                          placeholder="Client ID"
                          className="h-8 w-full rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-cz-text-muted">Client Secret</label>
                        <input
                          type="password"
                          value={p.clientSecret}
                          onChange={(e) => {
                            setLoginProviders((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, clientSecret: e.target.value } : item)),
                            )
                            setProviderTestResults((prev) => {
                              const next = { ...prev }
                              delete next[p.provider]
                              return next
                            })
                          }}
                          placeholder={p.hasCredentials ? '••••••••' : 'Client Secret'}
                          className="h-8 w-full rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!canTest || testStatus === 'testing'}
                        onClick={() => {
                          void testProvider(p.provider, p.clientId, p.clientSecret || '__keep__')
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cz-border bg-cz-bg px-2.5 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-60"
                      >
                        {testStatus === 'testing' && <RefreshCw size={12} className="animate-spin" />}
                        {testStatus === 'ok' && <Check size={12} className="text-green-400" />}
                        {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                      </button>
                      {testStatus === 'ok' && <span className="text-xs text-green-400">Credentials valid</span>}
                      {testStatus === 'fail' && <span className="text-xs text-red-300">{testError ?? 'Test failed'}</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {loginProvidersDirty && (
          <div className="mt-2 text-xs text-cz-text-muted">Enabled OAuth providers are tested automatically when you apply settings.</div>
        )}
        {loginProvidersError && <div className="mt-2 text-sm text-red-300">{loginProvidersError}</div>}
      </section>

      {/* Stranded users dialog */}
      <PopupDialog
        open={strandedDialog !== null}
        title={strandedDialog?.kind === 'error' ? 'Cannot Disable Provider' : 'Users Will Lose Access'}
        message={strandedDialog?.message}
        panelWidth="lg"
        actions={
          strandedDialog?.kind === 'error'
            ? [{ label: 'OK', onClick: () => setStrandedDialog(null), variant: 'primary' as const }]
            : [
                {
                  label: 'Save Anyway',
                  onClick: () => { void saveLoginProviders(true) },
                  variant: 'danger' as const,
                  disabled: !strandedCsvDownloaded || strandedConfirmText.toLowerCase() !== 'i understand',
                },
              ]
        }
        dismiss={strandedDialog ? { label: 'Cancel', onClick: () => setStrandedDialog(null) } : undefined}
      >
        {strandedDialog?.kind === 'warning' && (
          <div className="space-y-3">
            <p className="text-sm text-cz-text-muted">
              {strandedDialog.strandedCount} user{strandedDialog.strandedCount === 1 ? "'s" : "s'"} only login method is being disabled. They will not be able to log in until you help them recover their account.
            </p>
            <button
              type="button"
              onClick={() => { void downloadStrandedCsv(strandedDialog.strandedUserIds) }}
              className="inline-flex items-center gap-2 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text hover:bg-cz-surface-hover"
            >
              {strandedCsvDownloaded ? <Check size={14} /> : null}
              {strandedCsvDownloaded ? 'Downloaded' : 'Download stranded users CSV'}
            </button>
            {strandedCsvDownloaded && (
              <div>
                <label className="mb-1 block text-xs text-cz-text-muted">
                  Type &quot;I understand&quot; to confirm you will help these users recover their accounts.
                </label>
                <input
                  type="text"
                  value={strandedConfirmText}
                  onChange={(e) => setStrandedConfirmText(e.target.value)}
                  placeholder="I understand"
                  className="h-8 w-full rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
              </div>
            )}
          </div>
        )}
      </PopupDialog>
    </>
  )
}
