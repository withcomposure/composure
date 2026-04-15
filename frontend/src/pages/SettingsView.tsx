import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Camera, ChevronLeft, History, Lock, Palette, Shield, Type, User } from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { NumberStepper } from '../components/NumberStepper'
import { SegmentedControl } from '../components/SegmentedControl'
import { ToggleSwitch } from '../components/ToggleSwitch'
import type { AuthSession, SessionSummary, UserPreferences } from './types'
import {
  buildAvatarDataUrl,
  fetchJson,
  fmtTime,
  getErrorMessage,
  navigateToAdmin,
  navigateToProjects,
} from './utils'

interface SettingsViewProps {
  session: AuthSession | null
  preferences: UserPreferences
  sessions: SessionSummary[]
  isAdmin?: boolean
  onSessionChange: (next: AuthSession) => void
  onReloadSessions: () => void
  onRevokeSession: (sessionId: string) => Promise<void>
  onUpdatePreferences: (patch: Partial<UserPreferences>) => Promise<void>
  onDeleteAccount: () => void
  onBeginAuthFlow: (mode: 'login' | 'signup') => void
  onLogout: () => Promise<void>
}

export function SettingsView({
  session,
  preferences,
  sessions,
  isAdmin,
  onSessionChange,
  onReloadSessions,
  onRevokeSession,
  onUpdatePreferences,
  onDeleteAccount,
  onBeginAuthFlow,
  onLogout,
}: SettingsViewProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [profileName, setProfileName] = useState(session?.user?.displayName ?? '')
  const [profileEmail, setProfileEmail] = useState(session?.user?.email ?? '')
  const [profileImageUrl, setProfileImageUrl] = useState(session?.user?.profileImageUrl ?? '')
  const profileImageUploadRef = useRef<HTMLInputElement | null>(null)
  const [activeSection, setActiveSection] = useState<'profile' | 'security' | 'appearance' | 'typesetting' | 'history' | 'danger'>('profile')
  const sectionRefs = useRef<Record<'profile' | 'security' | 'appearance' | 'typesetting' | 'history' | 'danger', HTMLElement | null>>({
    profile: null,
    security: null,
    appearance: null,
    typesetting: null,
    history: null,
    danger: null,
  })

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
      if (visible[0]) {
        setActiveSection(
          visible[0].target.id as 'profile' | 'security' | 'appearance' | 'typesetting' | 'history' | 'danger',
        )
      }
    }, { rootMargin: '-20% 0px -60% 0px', threshold: [0.2, 0.6] })

    Object.values(sectionRefs.current).forEach((node) => {
      if (node) observer.observe(node)
    })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setProfileName(session?.user?.displayName ?? '')
    setProfileEmail(session?.user?.email ?? '')
    setProfileImageUrl(session?.user?.profileImageUrl ?? '')
  }, [session?.user?.displayName, session?.user?.email, session?.user?.profileImageUrl])

  const hasCustomAvatar = profileImageUrl.trim().length > 0
  const normalizedProfileName = profileName.trim()
  const normalizedProfileEmail = profileEmail.trim().toLowerCase()
  const normalizedProfileImageUrl = profileImageUrl.trim()
  const hasProfileChanges =
    (session?.authenticated ?? false) &&
    (normalizedProfileName !== String(session?.user?.displayName ?? '').trim() ||
      normalizedProfileEmail !== String(session?.user?.email ?? '').trim().toLowerCase() ||
      normalizedProfileImageUrl !== String(session?.user?.profileImageUrl ?? '').trim())
  const canUpdateProfile =
    hasProfileChanges &&
    normalizedProfileName.length >= 2 &&
    /^\S+@\S+\.\S+$/.test(normalizedProfileEmail)
  const canSubmitPassword =
    currentPassword.trim().length > 0 &&
    newPassword.trim().length >= 8 &&
    confirmPassword.trim().length > 0 &&
    newPassword === confirmPassword

  const updateProfile = useCallback(async () => {
    setBusy(true)
    setGlobalError(null)
    try {
      const next = await fetchJson<AuthSession>('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: profileEmail, displayName: profileName, profileImageUrl }),
      })
      onSessionChange(next)
    } catch (err) {
      setGlobalError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [profileEmail, profileName, profileImageUrl, onSessionChange])

  const changePassword = useCallback(async () => {
    if (!session?.authenticated) return
    const current = currentPassword.trim()
    const next = newPassword.trim()
    const confirmation = confirmPassword.trim()

    if (!current) {
      setPasswordError('Enter your current password.')
      return
    }
    if (!next) {
      setPasswordError('Enter a new password.')
      return
    }
    if (next.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (!confirmation) {
      setPasswordError('Confirm your new password.')
      return
    }
    if (next !== confirmation) {
      setPasswordError('New password and confirmation do not match.')
      return
    }

    setBusy(true)
    setGlobalError(null)
    setPasswordError(null)
    try {
      await fetchJson<{ ok: boolean }>('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPasswordError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [session?.authenticated, currentPassword, newPassword, confirmPassword])

  const logout = useCallback(async () => {
    setBusy(true)
    setGlobalError(null)
    try {
      await onLogout()
    } catch {
      setGlobalError('Something went wrong while logging out.')
    } finally {
      setBusy(false)
    }
  }, [onLogout])

  const uploadProfileImage = useCallback(async (file: File | null) => {
    if (!file) return
    setGlobalError(null)
    try {
      const processed = await buildAvatarDataUrl(file)
      setProfileImageUrl(processed)
    } catch (err) {
      setGlobalError(getErrorMessage(err))
    }
  }, [])

  return (
    <div className="flex h-screen bg-pm-bg text-pm-text">
      <aside className="hidden w-72 flex-col border-r border-pm-border bg-pm-surface lg:flex">
        <div className="border-b border-pm-border p-4">
          <button
            onClick={navigateToProjects}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
          >
            <ChevronLeft size={14} />
            Back to projects
          </button>
        </div>
        <div className="flex-1 p-4">
          <div className="mb-4 text-xs uppercase tracking-wider text-pm-text-muted">Settings</div>
          <div className="relative ml-2 space-y-4 border-l border-pm-border pl-4">
            {[
              { id: 'profile', label: 'Profile', icon: User },
              { id: 'security', label: 'Security', icon: Lock },
              { id: 'appearance', label: 'Appearance', icon: Palette },
              { id: 'typesetting', label: 'Typesetting', icon: Type },
              { id: 'history', label: 'History', icon: History },
              { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
            ].map((item) => {
              const Icon = item.icon
              const active = activeSection === item.id
              return (
                <button
                  key={item.id}
                  onClick={() =>
                    sectionRefs.current[
                      item.id as 'profile' | 'security' | 'appearance' | 'typesetting' | 'history' | 'danger'
                    ]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  className={`relative flex items-center gap-2 text-sm ${active ? 'text-pm-text' : 'text-pm-text-muted hover:text-pm-text'}`}
                >
                  <span
                    className={`absolute -left-[22px] h-2.5 w-2.5 rounded-full border ${active ? 'border-pm-accent bg-pm-accent' : 'border-pm-border bg-pm-surface'}`}
                  />
                  <Icon size={14} />
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>
        {isAdmin && (
          <div className="border-t border-pm-border p-4">
            <button
              onClick={navigateToAdmin}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
            >
              <Shield size={14} />
              Administration
            </button>
          </div>
        )}
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {globalError && (
            <div className="rounded-md border border-pm-border bg-pm-bg/60 px-3 py-2 text-sm text-pm-text-muted">
              {globalError}
            </div>
          )}

          <section id="profile" ref={(node) => { sectionRefs.current.profile = node }} className="scroll-mt-6 rounded-xl border border-pm-border bg-pm-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <User size={14} /> Profile
            </div>

            {session?.authenticated ? (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-pm-border-subtle bg-pm-bg/60 p-3">
                  <div className="flex items-center gap-3">
                    <Avatar
                      name={session?.user?.displayName ?? session?.user?.email ?? 'User'}
                      imageUrl={profileImageUrl || null}
                      size={44}
                    />
                    <div className="text-xs font-medium uppercase tracking-wider text-pm-text-muted">Profile Photo</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => profileImageUploadRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-md border border-pm-border px-3 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
                    >
                      <Camera size={14} />
                      Upload Photo
                    </button>
                    {hasCustomAvatar && (
                      <button
                        type="button"
                        onClick={() => setProfileImageUrl('')}
                        className="rounded-md border border-pm-border px-3 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
                      >
                        Reset Avatar
                      </button>
                    )}
                    <input
                      ref={profileImageUploadRef}
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        void uploadProfileImage(event.target.files?.[0] ?? null)
                        event.currentTarget.value = ''
                      }}
                      className="hidden"
                    />
                  </div>
                </div>

                <label className="mt-4 block text-xs uppercase tracking-wider text-pm-text-muted">
                  Display name
                </label>
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
                />

                <label className="mt-4 block text-xs uppercase tracking-wider text-pm-text-muted">
                  Email
                </label>
                <input
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
                  placeholder="you@example.com"
                  autoComplete="email"
                />

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={updateProfile}
                    disabled={busy || !canUpdateProfile}
                    className={`rounded-md px-3 py-2 text-sm transition ${hasProfileChanges ? 'bg-pm-accent text-white hover:bg-pm-accent-hover disabled:opacity-60' : 'border border-pm-border text-pm-text-muted'}`}
                  >
                    Update profile
                  </button>
                  <button
                    onClick={logout}
                    disabled={busy}
                    className="rounded-md border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-70"
                  >
                    Log out
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-3 px-4 py-3">
                  <AlertCircle size={16} className="mt-0.5 text-pm-text-muted" />
                  <p className="text-sm text-pm-text-muted">
                    You are currently using Pressmark in guest mode. Your projects will be automatically deleted after 30 days of inactivity. Signing in allows you to save your work, customize settings, and use live collaboration features.
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => onBeginAuthFlow('login')}
                    className="rounded-md bg-pm-accent px-3 py-2 text-sm font-medium text-white hover:bg-pm-accent-hover"
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => onBeginAuthFlow('signup')}
                    className="rounded-md border border-pm-accent/40 bg-pm-accent/10 px-3 py-2 text-sm font-medium text-pm-accent hover:bg-pm-accent/20"
                  >
                    Create account
                  </button>
                </div>
              </>
            )}
          </section>

          <section id="security" ref={(node) => { sectionRefs.current.security = node }} className="scroll-mt-6 rounded-xl border border-pm-border bg-pm-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <Lock size={14} /> Security
            </div>

            {session?.authenticated ? (
              <>
                <div className="mb-2 text-xs uppercase tracking-wider text-pm-text-muted">Change password</div>
                <div className="mb-4 rounded-lg border border-pm-border bg-pm-bg/50 p-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      placeholder="Current password"
                      className="rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
                    />
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="New password"
                      className="rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
                    />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Confirm new password"
                      className="rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
                    />
                  </div>
                  {passwordError && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-red-300">
                      <AlertCircle size={14} />
                      {passwordError}
                    </div>
                  )}
                  <button
                    onClick={changePassword}
                    disabled={busy || !canSubmitPassword}
                    className={`mt-3 rounded-md px-3 py-2 text-sm transition ${canSubmitPassword ? 'bg-pm-accent text-white hover:bg-pm-accent-hover disabled:opacity-60' : 'border border-pm-border text-pm-text-muted'}`}
                  >
                    Update password
                  </button>
                </div>

                <div>
                  <div className="mb-2 text-xs uppercase tracking-wider text-pm-text-muted">Active sessions</div>
                  <div className="overflow-hidden rounded-xl border border-pm-border bg-pm-bg/40">
                    {sessions.map((item) => (
                      <div key={item.id} className="flex items-center justify-between border-b border-pm-border px-3 py-2 last:border-b-0">
                        <div>
                          <div className="text-sm text-pm-text">{item.isCurrent ? 'Current session' : 'Signed-in device'}</div>
                          <div className="text-xs text-pm-text-muted">Started {fmtTime(item.createdAt)} · Expires {fmtTime(item.expiresAt)}</div>
                        </div>
                        {!item.isCurrent && (
                          <button
                            onClick={() => {
                              void onRevokeSession(item.id)
                                .then(() => onReloadSessions())
                                .catch(() => setGlobalError('Something went wrong. Please try again.'))
                            }}
                            className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-pm-text-muted">Log in to manage security settings and sessions.</div>
            )}
          </section>
          <section id="appearance" ref={(node) => { sectionRefs.current.appearance = node }} className="scroll-mt-6 rounded-xl border border-pm-border bg-pm-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <Palette size={14} /> Appearance
            </div>
            <div className="mb-2 text-xs uppercase tracking-wider text-pm-text-muted">Theme</div>
            <div className="rounded-md border border-pm-border bg-pm-bg/50 px-3 py-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm text-pm-text">Display mode</div>
                  <div className="text-xs text-pm-text-muted">Choose a light or dark appearance across the app.</div>
                </div>
                <SegmentedControl
                  value={preferences.appearance}
                  options={['light', 'dark', 'system'] as const}
                  onChange={(next) => {
                    void onUpdatePreferences({ appearance: next }).catch(() => {
                      setGlobalError('Something went wrong. Please try again.')
                    })
                  }}
                  ariaLabel="Display mode"
                />
              </div>
            </div>

            <div className="mt-5 text-xs uppercase tracking-wider text-pm-text-muted">Dashboard</div>
            <div className="mt-2 overflow-hidden rounded-md border border-pm-border bg-pm-bg/50">
              <div className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-pm-text">Recently opened items</div>
                  <div className="text-xs text-pm-text-muted">How many items to keep in the dashboard recents list.</div>
                </div>
                <NumberStepper
                  value={preferences.recentItemsLimit}
                  min={3}
                  max={50}
                  ariaLabel="Recently opened items limit"
                  onChange={(val) => {
                    void onUpdatePreferences({ recentItemsLimit: val }).catch(() => {
                      setGlobalError('Something went wrong. Please try again.')
                    })
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-pm-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-pm-text">Quick-access pinned items</div>
                  <div className="text-xs text-pm-text-muted">Maximum pinned projects shown in the sidebar quick-access list.</div>
                </div>
                <NumberStepper
                  value={preferences.quickAccessPinnedLimit}
                  min={1}
                  max={30}
                  ariaLabel="Quick-access pinned items limit"
                  onChange={(val) => {
                    void onUpdatePreferences({ quickAccessPinnedLimit: val }).catch(() => {
                      setGlobalError('Something went wrong. Please try again.')
                    })
                  }}
                />
              </div>
            </div>
          </section>

          <section id="typesetting" ref={(node) => { sectionRefs.current.typesetting = node }} className="scroll-mt-6 rounded-xl border border-pm-border bg-pm-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <Type size={14} /> Typesetting
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-pm-border bg-pm-bg/50 px-3 py-3">
                <div>
                  <div className="text-sm text-pm-text">Enable auto-compile by default</div>
                  <div className="text-xs text-pm-text-muted">Applied when opening projects.</div>
                </div>
                <button
                  onClick={() => {
                    void onUpdatePreferences({ autoCompileDefault: !preferences.autoCompileDefault }).catch(() => {
                      setGlobalError('Something went wrong. Please try again.')
                    })
                  }}
                  className={`rounded px-3 py-2 text-xs ${preferences.autoCompileDefault ? 'bg-pm-accent text-white' : 'border border-pm-border text-pm-text-muted hover:bg-pm-surface-hover'}`}
                >
                  {preferences.autoCompileDefault ? 'On' : 'Off'}
                </button>
              </div>
              <div className="flex items-center justify-between rounded-md border border-pm-border bg-pm-bg/50 px-3 py-3">
                <div>
                  <div className="text-sm text-pm-text">Auto-compile timeout</div>
                  <div className="text-xs text-pm-text-muted">Seconds of inactivity before auto-compiling.</div>
                </div>
                <NumberStepper
                  value={preferences.autoCompileTimeoutSeconds}
                  min={1}
                  max={30}
                  suffix="s"
                  ariaLabel="Auto-compile timeout seconds"
                  onChange={(val) => {
                    void onUpdatePreferences({ autoCompileTimeoutSeconds: val }).catch(() => {
                      setGlobalError('Something went wrong. Please try again.')
                    })
                  }}
                />
              </div>

              <div className="overflow-hidden rounded-md border border-pm-border bg-pm-bg/50">
                <div className="border-b border-pm-border px-3 py-2 text-xs uppercase tracking-wider text-pm-text-muted">
                  Editor Features
                </div>

                <div className="flex items-center justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-pm-text">Brace matching</div>
                    <div className="text-xs text-pm-text-muted">Highlight matching bracket and brace pairs near the cursor.</div>
                  </div>
                  <ToggleSwitch
                    checked={preferences.editorBraceMatching}
                    ariaLabel="Brace matching"
                    onChange={(nextChecked) => {
                      void onUpdatePreferences({ editorBraceMatching: nextChecked }).catch(() => {
                        setGlobalError('Something went wrong. Please try again.')
                      })
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-pm-border px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-pm-text">Highlight selected matches</div>
                    <div className="text-xs text-pm-text-muted">When text is selected, highlight other exact matches in the current file.</div>
                  </div>
                  <ToggleSwitch
                    checked={preferences.editorHighlightSelectionMatches}
                    ariaLabel="Highlight selected matches"
                    onChange={(nextChecked) => {
                      void onUpdatePreferences({ editorHighlightSelectionMatches: nextChecked }).catch(() => {
                        setGlobalError('Something went wrong. Please try again.')
                      })
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-pm-border px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-pm-text">In-editor find and replace (Ctrl+F)</div>
                    <div className="text-xs text-pm-text-muted">Use CodeMirror search panels instead of the browser find dialog.</div>
                  </div>
                  <ToggleSwitch
                    checked={preferences.editorInEditorFind}
                    ariaLabel="In-editor find and replace"
                    onChange={(nextChecked) => {
                      void onUpdatePreferences({ editorInEditorFind: nextChecked }).catch(() => {
                        setGlobalError('Something went wrong. Please try again.')
                      })
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-pm-border px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-pm-text">Autocomplete suggestions</div>
                    <div className="text-xs text-pm-text-muted">Show completion suggestions for LaTeX and Typst, including bibliography keys.</div>
                  </div>
                  <ToggleSwitch
                    checked={preferences.editorAutocomplete}
                    ariaLabel="Autocomplete suggestions"
                    onChange={(nextChecked) => {
                      void onUpdatePreferences({ editorAutocomplete: nextChecked }).catch(() => {
                        setGlobalError('Something went wrong. Please try again.')
                      })
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-pm-border px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-pm-text">Auto-close LaTeX begin/end blocks</div>
                    <div className="text-xs text-pm-text-muted">
                      When pressing Enter after a complete {'\\begin{...}'} line, insert a matching {'\\end{...}'} below.
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={preferences.editorAutoCloseLatexBeginEnd}
                    ariaLabel="Auto-close LaTeX begin/end blocks"
                    onChange={(nextChecked) => {
                      void onUpdatePreferences({ editorAutoCloseLatexBeginEnd: nextChecked }).catch(() => {
                        setGlobalError('Something went wrong. Please try again.')
                      })
                    }}
                  />
                </div>
              </div>
            </div>
          </section>

          <section id="history" ref={(node) => { sectionRefs.current.history = node }} className="scroll-mt-6 rounded-xl border border-pm-border bg-pm-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <History size={14} /> History
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-pm-border bg-pm-bg/50 px-3 py-3">
                <div>
                  <div className="text-sm text-pm-text">Auto-commit interval (minutes)</div>
                  <div className="text-xs text-pm-text-muted">How often to create version snapshots automatically. Set to 0 to disable.</div>
                </div>
                <NumberStepper
                  value={preferences.autoVersionIntervalMinutes}
                  min={0}
                  max={60}
                  suffix="m"
                  ariaLabel="Auto-commit interval minutes"
                  onChange={(val) => {
                    void onUpdatePreferences({ autoVersionIntervalMinutes: val }).catch(() => {
                      setGlobalError('Something went wrong. Please try again.')
                    })
                  }}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-pm-border bg-pm-bg/50 px-3 py-3">
                <div>
                  <div className="text-sm text-pm-text">Auto-commit on compile</div>
                  <div className="text-xs text-pm-text-muted">Create a snapshot before manually compiling. Excludes automatic compiles.</div>
                </div>
                <button
                  onClick={() => {
                    void onUpdatePreferences({ autoSaveOnCompile: !preferences.autoSaveOnCompile }).catch(() => {
                      setGlobalError('Something went wrong. Please try again.')
                    })
                  }}
                  className={`rounded px-3 py-2 text-xs ${preferences.autoSaveOnCompile ? 'bg-pm-accent text-white' : 'border border-pm-border text-pm-text-muted hover:bg-pm-surface-hover'}`}
                >
                  {preferences.autoSaveOnCompile ? 'On' : 'Off'}
                </button>
              </div>
              <div className="flex items-center justify-between rounded-md border border-pm-border bg-pm-bg/50 px-3 py-3">
                <div>
                  <div className="text-sm text-pm-text">Auto-commit on export</div>
                  <div className="text-xs text-pm-text-muted">Create a snapshot before exporting.</div>
                </div>
                <button
                  onClick={() => {
                    void onUpdatePreferences({ autoSaveOnExport: !preferences.autoSaveOnExport }).catch(() => {
                      setGlobalError('Something went wrong. Please try again.')
                    })
                  }}
                  className={`rounded px-3 py-2 text-xs ${preferences.autoSaveOnExport ? 'bg-pm-accent text-white' : 'border border-pm-border text-pm-text-muted hover:bg-pm-surface-hover'}`}
                >
                  {preferences.autoSaveOnExport ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          </section>

          <section id="danger" ref={(node) => { sectionRefs.current.danger = node }} className="scroll-mt-6 rounded-xl border border-pm-border bg-pm-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-red-300">
              <AlertTriangle size={14} /> Danger Zone
            </div>
            <div className="rounded-lg border border-pm-border bg-pm-bg/50 p-4">
              <div className="text-sm font-medium">Delete account</div>
              <div className="mt-1 text-xs text-pm-text-muted">
                Permanently deletes your account, signs you out of all sessions, and soft-deletes projects you own.
              </div>
              <button
                onClick={onDeleteAccount}
                className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 hover:bg-red-500/20"
              >
                Delete account
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
