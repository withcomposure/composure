import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { TemplateGallery } from '@/dashboard/TemplateGallery'
import { PopupDialog } from '@/components/PopupDialog'
import { AuthEntryView } from '@/auth/AuthEntryView'
import { CompleteProfileView } from './auth/CompleteProfileView'
import { AdministrationView } from '@/settings/AdministrationView'
import { DashboardView } from '@/dashboard/DashboardView'
import { ProjectWorkspace } from '@/workspace/ProjectWorkspace'
import { WhiteboardWorkspace } from '@/whiteboard/WhiteboardWorkspace'
import { SettingsView } from '@/settings/SettingsView'
import { StatusPage } from '@/auth/StatusPage'
import type {
  AppPopupState,
  AuthSession,
  DashboardLayout,
  ProjectTemplate,
  ProjectSummary,
  RecentProjectSummary,
  RouteState,
  SessionSummary,
  SortBy,
  TrashedProjectSummary,
  UserPreferences,
} from '@/types'
import {
  guestIdLabel,
  guestLabel,
} from '@/utils/page-utils'
import { apiFetch, fetchJson, getErrorMessage } from '@/utils/fetch'
import { isPasskeyCancellation, loginWithPasskey } from '@/utils/passkey'
import { providerLabel } from '@/utils/auth-providers'
import {
  navigateToProject,
  navigateToProjects,
  navigateToAdmin,
  navigateToSettings,
  parseRoute,
} from '@/utils/route'
import {
  getDashboardPrincipalKey,
  loadDashboardPreferences,
  saveDashboardPreferences,
} from '@/dashboard/dashboard-prefs'
import { applyTheme } from '@/themes/apply-theme'
import { DEFAULT_THEME_ID } from '@/themes/themes'

const authErrorMessages: Record<string, string> = {
  link_session_mismatch: 'Linking could not be completed because your session was not recognized. Please try again.',
  link_user_not_found: 'The account used to start linking no longer exists. Sign in again and retry.',
  provider_already_linked: 'This provider is already linked to another account.',
  invalid_state: 'Authentication state validation failed. Please retry the sign-in flow.',
  state_expired: 'Authentication took too long and expired. Please retry.',
  exchange_failed: 'Failed to complete provider authentication. Please try again.',
  provider_not_configured: 'This login provider is not configured correctly on the server.',
  missing_code_or_state: 'Authentication callback was incomplete. Please retry.',
  unknown_provider: 'Unknown login provider.',
  account_suspended_or_conflict: 'Sign-in failed due to account conflict or suspension.',
  invite_required: 'Signups are currently invite-only. Use a valid invite link to create a new account.',
  invalid_invite: 'The invite link is invalid or has expired. Request a new invite and try again.',
  invite_email_mismatch: 'This invite link was issued for a different email address.',
  provider_email_unverified: 'This provider email is not verified. Verify your provider email before linking or creating an account.',
  email_conflict_requires_linking: 'An account with this email already exists. Log in to that account and link this provider from Settings.',
}

export default function App() {
  type ProjectWorkspaceMetadata = Pick<ProjectSummary, 'id' | 'title' | 'rootFile' | 'engine' | 'defaultBibliographyFile' | 'referenceLookupFormat'>

  const [route, setRoute] = useState<RouteState>(() => parseRoute())
  const [oauthProfileCompletion, setOAuthProfileCompletion] = useState<{
    token: string
    provider: string
    displayName: string | null
  } | null>(null)
  const [oauthProfileBusy, setOAuthProfileBusy] = useState(false)
  const [oauthProfileError, setOAuthProfileError] = useState<string | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [backendUnavailable, setBackendUnavailable] = useState(false)
  const [authEntryGranted, setAuthEntryGranted] = useState<boolean>(
    () => window.sessionStorage.getItem('composure.auth-entry') === 'granted',
  )
  const [authEntryMode, setAuthEntryMode] = useState<'login' | 'signup'>('login')
  const [authEntryBusy, setAuthEntryBusy] = useState(false)
  const [authEntryError, setAuthEntryError] = useState<string | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [sharedProjects, setSharedProjects] = useState<ProjectSummary[]>([])
  const [recentProjects, setRecentProjects] = useState<RecentProjectSummary[]>([])
  const [preferences, setPreferences] = useState<UserPreferences>({
    appearance: 'system',
    theme: DEFAULT_THEME_ID,
    recentItemsLimit: 10,
    autoCompileDefault: false,
    autoCompileTimeoutSeconds: 2,
    editorBraceMatching: true,
    editorHighlightSelectionMatches: true,
    editorInEditorFind: true,
    editorAutocomplete: true,
    editorAutoCloseLatexBeginEnd: true,
    dashboardSortBy: 'last-active',
    dashboardLayout: 'grid',
    pinnedProjectIds: [],
    quickAccessPinnedLimit: 8,
    autoVersionIntervalMinutes: 5,
    autoSaveOnCompile: true,
    autoSaveOnExport: true,
  })
  const [dashboardSortBy, setDashboardSortBy] = useState<SortBy>('last-active')
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout>('grid')
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>([])
  const [authSessions, setAuthSessions] = useState<SessionSummary[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [popup, setPopup] = useState<AppPopupState | null>(null)
  const [popupInput, setPopupInput] = useState('')
  const [popupBusy, setPopupBusy] = useState(false)
  const [showTemplateGallery, setShowTemplateGallery] = useState(false)
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false)
  const [passwordResetEmail, setPasswordResetEmail] = useState<string | null>(null)
  const [passwordResetLoading, setPasswordResetLoading] = useState(false)
  const [trashedProjects, setTrashedProjects] = useState<TrashedProjectSummary[]>([])
  const [trashRetentionDays, setTrashRetentionDays] = useState(30)
  const [projectMetadataById, setProjectMetadataById] = useState<Record<string, ProjectWorkspaceMetadata>>({})
  const [projectMetadataLoadingId, setProjectMetadataLoadingId] = useState<string | null>(null)
  const wasAuthenticatedRef = useRef(false)

  const knownProjectsById = useMemo(() => {
    const map = new Map<string, ProjectWorkspaceMetadata>()
    for (const project of projects) {
      map.set(project.id, {
        id: project.id,
        title: project.title,
        rootFile: project.rootFile,
        defaultBibliographyFile: project.defaultBibliographyFile ?? null,
        engine: project.engine,
      })
    }
    for (const project of sharedProjects) {
      map.set(project.id, {
        id: project.id,
        title: project.title,
        rootFile: project.rootFile,
        defaultBibliographyFile: project.defaultBibliographyFile ?? null,
        engine: project.engine,
      })
    }
    for (const project of recentProjects) {
      map.set(project.id, {
        id: project.id,
        title: project.title,
        rootFile: project.rootFile,
        defaultBibliographyFile: project.defaultBibliographyFile ?? null,
        engine: project.engine,
      })
    }
    return map
  }, [projects, recentProjects, sharedProjects])

  const grantAuthEntry = useCallback(() => {
    window.sessionStorage.setItem('composure.auth-entry', 'granted')
    setAuthEntryGranted(true)
    setBackendUnavailable(false)
  }, [])

  const revokeAuthEntry = useCallback(() => {
    window.sessionStorage.removeItem('composure.auth-entry')
    setAuthEntryGranted(false)
  }, [])

  const checkBackendHealth = useCallback(async (): Promise<boolean> => {
    try {
      const status = await fetchJson<{ status: string }>('/health')
      const healthy = status.status === 'ok'
      setBackendUnavailable(!healthy)
      return healthy
    } catch {
      setBackendUnavailable(true)
      return false
    }
  }, [])

  const loadSession = useCallback(async (): Promise<AuthSession | null> => {
    try {
      const next = await fetchJson<AuthSession>('/auth/session')
      setSession(next)
      setBackendUnavailable(false)
      return next
    } catch (err) {
      const healthy = await checkBackendHealth()
      if (!healthy) {
        setSession(null)
        return null
      }
      throw err
    }
  }, [checkBackendHealth])

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    try {
      const list = await fetchJson<ProjectSummary[]>('/projects')
      setProjects(list)

      const shared = await fetchJson<ProjectSummary[]>('/projects/shared-with-me')
      setSharedProjects(shared)
    } catch (err) {
      console.error(`[app] load-projects-failed ${String(err)}`)
      setProjects([])
      setSharedProjects([])
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  const loadRecents = useCallback(async () => {
    try {
      const list = await fetchJson<RecentProjectSummary[]>('/projects/recents')
      setRecentProjects(list)
    } catch {
      setRecentProjects([])
    }
  }, [])

  const loadTrash = useCallback(async () => {
    try {
      const response = await fetchJson<{ projects: TrashedProjectSummary[]; retentionDays: number }>('/projects/trash')
      setTrashedProjects(response.projects)
      setTrashRetentionDays(response.retentionDays)
    } catch {
      setTrashedProjects([])
    }
  }, [])

  const loadPreferences = useCallback(async () => {
    try {
      const next = await fetchJson<UserPreferences>('/preferences')
      setPreferences(next)
    } catch {
      setPreferences({
        appearance: 'system',
        theme: DEFAULT_THEME_ID,
        recentItemsLimit: 10,
        autoCompileDefault: false,
        autoCompileTimeoutSeconds: 2,
        editorBraceMatching: true,
        editorHighlightSelectionMatches: true,
        editorInEditorFind: true,
        editorAutocomplete: true,
        editorAutoCloseLatexBeginEnd: true,
        dashboardSortBy: 'last-active',
        dashboardLayout: 'grid',
        pinnedProjectIds: [],
        quickAccessPinnedLimit: 8,
        autoVersionIntervalMinutes: 5,
        autoSaveOnCompile: true,
        autoSaveOnExport: true,
      })
    }
  }, [])

  const loadAuthSessions = useCallback(async () => {
    if (!session?.authenticated) {
      setAuthSessions([])
      return
    }
    try {
      const body = await fetchJson<{ sessions: SessionSummary[] }>('/auth/sessions')
      setAuthSessions(body.sessions)
    } catch {
      setAuthSessions([])
    }
  }, [session?.authenticated])

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    setTemplatesError(null)
    try {
      const body = await fetchJson<{ templates: ProjectTemplate[] }>('/templates')
      setTemplates(body.templates)
    } catch (err) {
      setTemplates([])
      setTemplatesError(getErrorMessage(err))
    } finally {
      setTemplatesLoading(false)
    }
  }, [])

  useEffect(() => {
    const handleRouteChange = () => {
      setRoute(parseRoute())
    }

    window.addEventListener('popstate', handleRouteChange)
    return () => {
      window.removeEventListener('popstate', handleRouteChange)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let loadedSession: AuthSession | null = null
      try {
        loadedSession = await loadSession()
      } catch (err) {
        console.warn(`[app] initial-session-load-failed ${String(err)}`)
      } finally {
        if (!cancelled) {
          setSessionLoading(false)
        }
      }

      if (!cancelled && loadedSession) {
        await loadProjects()
        await loadRecents()
        await loadTrash()
        await loadPreferences()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadSession, loadProjects, loadRecents, loadTrash, loadPreferences])

  useEffect(() => {
    void loadAuthSessions()
  }, [loadAuthSessions])

  useEffect(() => {
    if (sessionLoading) return

    const refreshSession = () => {
      void loadSession().catch(() => undefined)
    }

    window.addEventListener('focus', refreshSession)
    const interval = window.setInterval(refreshSession, 30000)

    return () => {
      window.removeEventListener('focus', refreshSession)
      window.clearInterval(interval)
    }
  }, [loadSession, sessionLoading])

  const dashboardPrincipalKey = useMemo(() => getDashboardPrincipalKey(session), [session])
  const isAuthenticated = Boolean(session?.authenticated)

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    setDashboardSortBy(preferences.dashboardSortBy)
    setDashboardLayout(preferences.dashboardLayout)
    setPinnedProjectIds(preferences.pinnedProjectIds)
  }, [
    isAuthenticated,
    preferences.dashboardSortBy,
    preferences.dashboardLayout,
    preferences.pinnedProjectIds,
  ])

  useEffect(() => {
    if (isAuthenticated) {
      return
    }

    const next = loadDashboardPreferences(dashboardPrincipalKey)
    setDashboardSortBy(next.sortBy)
    setDashboardLayout(next.layout)
    setPinnedProjectIds(next.pinnedProjectIds)
  }, [dashboardPrincipalKey, isAuthenticated])

  useEffect(() => {
    if (isAuthenticated) {
      return
    }

    saveDashboardPreferences(dashboardPrincipalKey, {
      sortBy: dashboardSortBy,
      layout: dashboardLayout,
      pinnedProjectIds,
    })
  }, [dashboardPrincipalKey, dashboardSortBy, dashboardLayout, pinnedProjectIds, isAuthenticated])

  useEffect(() => {
    const allIds = new Set([...projects, ...sharedProjects].map((project) => project.id))
    setPinnedProjectIds((prev) => {
      const next = prev.filter((id) => allIds.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [projects, sharedProjects])

  useEffect(() => {
    applyTheme(preferences.theme ?? DEFAULT_THEME_ID, preferences.appearance)
  }, [preferences.theme, preferences.appearance])

  useEffect(() => {
    if (preferences.appearance !== 'system') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemAppearanceChange = () => {
      applyTheme(preferences.theme ?? DEFAULT_THEME_ID, 'system')
    }

    media.addEventListener('change', onSystemAppearanceChange)

    return () => {
      media.removeEventListener('change', onSystemAppearanceChange)
    }
  }, [preferences.theme, preferences.appearance])

  useEffect(() => {
    if (sessionLoading) return
    if (route.kind !== 'project') return
    void apiFetch(`/projects/${route.projectId}/open`, {
      method: 'POST',
      headers: route.shareToken ? { 'X-Share-Token': route.shareToken } : undefined,
    })
      .catch(() => undefined)
      .finally(() => {
        void loadRecents()
      })
  }, [route, loadRecents, sessionLoading])

  useEffect(() => {
    if (sessionLoading || route.kind !== 'project') {
      return
    }

    const projectId = route.projectId
    const known = knownProjectsById.get(projectId)
    if (known) {
      setProjectMetadataById((prev) => (
        prev[projectId]
          ? prev
          : {
              ...prev,
              [projectId]: known,
            }
      ))
    }

    let cancelled = false
    setProjectMetadataLoadingId(projectId)

    void apiFetch(`/projects/${projectId}/metadata`, {
      headers: route.shareToken ? { 'X-Share-Token': route.shareToken } : undefined,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`status=${response.status}`)
        }

        const metadata = (await response.json()) as ProjectWorkspaceMetadata
        if (cancelled) {
          return
        }

        setProjectMetadataById((prev) => ({
          ...prev,
          [projectId]: metadata,
        }))
      })
      .catch((err) => {
        console.warn(`[app] load-project-metadata-failed projectId=${projectId} error=${String(err)}`)
      })
      .finally(() => {
        if (cancelled) {
          return
        }
        setProjectMetadataLoadingId((prev) => (prev === projectId ? null : prev))
      })

    return () => {
      cancelled = true
    }
  }, [knownProjectsById, route, sessionLoading])

  useEffect(() => {
    if (route.kind !== 'reset-password') {
      setPasswordResetEmail(null)
      setPasswordResetLoading(false)
      return
    }

    setPasswordResetLoading(true)
    setAuthEntryError(null)
    void fetchJson<{ email: string }>(`/auth/password-reset/${encodeURIComponent(route.token)}`)
      .then((body) => {
        setPasswordResetEmail(body.email)
      })
      .catch((err) => {
        console.warn(`[app] password-reset-prefill-unavailable ${String(err)}`)
        setPasswordResetEmail(null)
      })
      .finally(() => {
        setPasswordResetLoading(false)
      })
  }, [route])

  useEffect(() => {
    const currentlyAuthenticated = Boolean(session?.authenticated)
    if (wasAuthenticatedRef.current && !currentlyAuthenticated) {
      revokeAuthEntry()
      setAuthEntryMode('login')
      setAuthEntryError('Your session has ended. Please log in again.')
      navigateToProjects()
    }
    wasAuthenticatedRef.current = currentlyAuthenticated
  }, [session?.authenticated, revokeAuthEntry])

  const handleSessionChange = useCallback((next: AuthSession) => {
    setSession(next)
    if (next.authenticated) {
      grantAuthEntry()
      setAuthEntryError(null)
      setOAuthProfileCompletion(null)
      setOAuthProfileError(null)
      setOAuthProfileBusy(false)
    }
    void loadProjects()
    void loadRecents()
    void loadTrash()
    void loadPreferences()
    void loadAuthSessions()
  }, [grantAuthEntry, loadProjects, loadRecents, loadTrash, loadPreferences, loadAuthSessions])

  const clearRecents = useCallback(async () => {
    try {
      await fetchJson<{ ok: boolean }>('/projects/recents', { method: 'DELETE' })
      setRecentProjects([])
    } catch (err) {
      console.error(`[app] clear-recents-failed ${String(err)}`)
    }
  }, [])

  const openProject = useCallback((projectId: string, shareToken?: string) => {
    void apiFetch(`/projects/${projectId}/open`, {
      method: 'POST',
      headers: shareToken ? { 'X-Share-Token': shareToken } : undefined,
    }).catch(() => undefined)
    navigateToProject(projectId, shareToken)
  }, [])

  const logoutEverywhere = useCallback(async () => {
    const next = await fetchJson<AuthSession>('/auth/logout', {
      method: 'POST',
    })
    revokeAuthEntry()
    setAuthEntryError(null)
    handleSessionChange(next)
    navigateToProjects()
  }, [handleSessionChange, revokeAuthEntry])

  const submitEntryAuth = useCallback(async (mode: 'login' | 'signup', payload: { displayName?: string; email: string; password: string; inviteToken?: string }) => {
    setAuthEntryBusy(true)
    setAuthEntryError(null)
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/signup'
      const body: Record<string, string> = {
        email: payload.email,
        password: payload.password,
      }
      if (mode === 'signup') {
        body.displayName = payload.displayName ?? ''
        if (payload.inviteToken) {
          body.inviteToken = payload.inviteToken
        }
      }
      const next = await fetchJson<AuthSession>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      grantAuthEntry()
      handleSessionChange(next)
      // Navigate away from invite route on successful signup
      if (route.kind === 'invite') {
        navigateToProjects()
      }
    } catch (err) {
      setAuthEntryError(getErrorMessage(err))
    } finally {
      setAuthEntryBusy(false)
    }
  }, [grantAuthEntry, handleSessionChange, route])

  const submitPasskeyLogin = useCallback(async () => {
    setAuthEntryBusy(true)
    setAuthEntryError(null)
    try {
      const next = await loginWithPasskey()
      grantAuthEntry()
      handleSessionChange(next)
      if (route.kind === 'invite') {
        navigateToProjects()
      }
    } catch (err) {
      if (!isPasskeyCancellation(err)) {
        setAuthEntryError(getErrorMessage(err))
      }
    } finally {
      setAuthEntryBusy(false)
    }
  }, [grantAuthEntry, handleSessionChange, route])

  const submitPasswordReset = useCallback(async (payload: { token: string; newPassword: string }) => {
    setAuthEntryBusy(true)
    setAuthEntryError(null)
    try {
      const next = await fetchJson<AuthSession>(`/auth/password-reset/${encodeURIComponent(payload.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: payload.newPassword }),
      })
      grantAuthEntry()
      handleSessionChange(next)
      navigateToProjects()
    } catch (err) {
      setAuthEntryError(getErrorMessage(err))
    } finally {
      setAuthEntryBusy(false)
    }
  }, [grantAuthEntry, handleSessionChange])

  const continueAsGuest = useCallback(() => {
    setAuthEntryError(null)
    grantAuthEntry()
  }, [grantAuthEntry])

  const forceLogin = useCallback((message = 'Please log in again.') => {
    revokeAuthEntry()
    setAuthEntryMode('login')
    setAuthEntryError(message)
    navigateToProjects()
    void loadSession().catch(() => undefined)
  }, [loadSession, revokeAuthEntry])

  const beginLoginFlow = useCallback((mode: 'login' | 'signup' = 'login') => {
    setAuthEntryMode(mode)
    setAuthEntryError(null)
    revokeAuthEntry()
  }, [revokeAuthEntry])

  const cancelOAuthProfileCompletion = useCallback(() => {
    setOAuthProfileCompletion(null)
    setOAuthProfileError(null)
    setOAuthProfileBusy(false)
    setAuthEntryMode('login')
    revokeAuthEntry()
    navigateToProjects()
  }, [revokeAuthEntry])

  const submitOAuthProfileCompletion = useCallback(async (email: string) => {
    if (!oauthProfileCompletion) {
      return
    }

    setOAuthProfileBusy(true)
    setOAuthProfileError(null)
    try {
      await fetchJson<{ ok: boolean; intent: 'login'; provider: string }>('/auth/oauth/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: oauthProfileCompletion.token, email }),
      })

      window.location.assign('/')
    } catch (err) {
      setOAuthProfileError(getErrorMessage(err))
    } finally {
      setOAuthProfileBusy(false)
    }
  }, [oauthProfileCompletion])

  const requestDeleteAccount = useCallback(async () => {
    const submitDeleteAccount = async (password: string | null) => {
      const next = await fetchJson<AuthSession>('/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(password ? { password } : {}),
      })
      setSession(next)
      revokeAuthEntry()
      setAuthEntryMode('login')
      setAuthEntryError('Account deleted. Please log in to continue.')
      navigateToProjects()
    }

    // OAuth-/passkey-only accounts have no password to confirm with; ask for
    // a plain confirmation instead of an unanswerable password prompt.
    let hasPassword = true
    try {
      const res = await fetchJson<{ linked: Array<{ provider: string }> }>('/auth/providers')
      hasPassword = res.linked.some((entry) => entry.provider === 'password')
    } catch {
      // If the lookup fails, fall back to the password prompt.
    }

    if (!hasPassword) {
      setPopup({
        kind: 'confirm',
        title: 'Delete Account',
        message: 'This permanently deletes your account and all projects you own. This cannot be undone.',
        confirmLabel: 'Delete account',
        confirmVariant: 'danger',
        onConfirm: async () => {
          await submitDeleteAccount(null)
        },
      })
      return
    }

    setPopupInput('')
    setPopup({
      kind: 'prompt',
      title: 'Delete Account',
      message: 'Enter your password to confirm permanent account deletion.',
      initialValue: '',
      inputType: 'password',
      confirmLabel: 'Delete account',
      confirmVariant: 'danger',
      onConfirm: async (password) => {
        const trimmed = password.trim()
        if (!trimmed) {
          throw new Error('Password is required to delete your account.')
        }
        await submitDeleteAccount(trimmed)
      },
    })
  }, [revokeAuthEntry])

  const updatePreferencesPatch = useCallback(async (patch: Partial<UserPreferences>) => {
    if (!isAuthenticated) {
      setPreferences((prev) => ({ ...prev, ...patch }))
      return
    }

    const next = await fetchJson<UserPreferences>('/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setPreferences(next)
    if (patch.recentItemsLimit != null) {
      void loadRecents()
    }
  }, [isAuthenticated, loadRecents])

  const persistDashboardPreferences = useCallback((next: {
    dashboardSortBy?: SortBy
    dashboardLayout?: DashboardLayout
    pinnedProjectIds?: string[]
  }) => {
    const patch: Partial<UserPreferences> = {}
    if (next.dashboardSortBy != null) {
      patch.dashboardSortBy = next.dashboardSortBy
    }
    if (next.dashboardLayout != null) {
      patch.dashboardLayout = next.dashboardLayout
    }
    if (next.pinnedProjectIds != null) {
      patch.pinnedProjectIds = next.pinnedProjectIds
    }

    if (Object.keys(patch).length > 0) {
      void updatePreferencesPatch(patch).catch((err) => {
        console.error(`[app] persist-dashboard-preferences-failed ${String(err)}`)
      })
    }
  }, [updatePreferencesPatch])

  const revokeSession = useCallback(async (sessionId: string) => {
    await fetchJson<{ ok: boolean }>(`/auth/sessions/${sessionId}`, { method: 'DELETE' })
    await loadAuthSessions()
  }, [loadAuthSessions])

  const openAlertPopup = useCallback((message: string, title = 'Notice') => {
    setPopup({
      kind: 'alert',
      title,
      message,
    })
    setPopupInput('')
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authError = params.get('auth_error')
    const linkedProvider = params.get('oauth_linked')
    const pendingToken = params.get('oauth_pending')
    const pendingProvider = params.get('oauth_provider')
    const pendingIntent = params.get('oauth_intent')

    if (!authError && !linkedProvider && !pendingToken) {
      return
    }

    const clearHandledParams = (): void => {
      params.delete('auth_error')
      params.delete('oauth_linked')
      params.delete('oauth_pending')
      params.delete('oauth_provider')
      params.delete('oauth_intent')
      const nextQuery = params.toString()
      const nextUrl = `${window.location.pathname}${nextQuery.length > 0 ? `?${nextQuery}` : ''}${window.location.hash}`
      history.replaceState(null, '', nextUrl)
    }

    if (authError) {
      openAlertPopup(
        authErrorMessages[authError] ?? 'Authentication provider action failed. Please try again.',
        'Authentication Error',
      )
      clearHandledParams()
      return
    }

    if (pendingToken) {
      if ((pendingIntent !== 'login' && pendingIntent !== 'link') || !pendingProvider) {
        openAlertPopup('Authentication callback data was incomplete. Please retry the sign-in flow.', 'Authentication Error')
        clearHandledParams()
        return
      }

      const pendingProviderName = providerLabel(pendingProvider)
      setPopup({
        kind: 'confirm',
        title: pendingIntent === 'link' ? 'Link Login Provider' : 'Confirm Sign In',
        message: pendingIntent === 'link'
          ? `Link ${pendingProviderName} to this Composure account?`
          : `Continue signing in with ${pendingProviderName}?`,
        confirmLabel: pendingIntent === 'link'
          ? `Link ${pendingProviderName}`
          : `Continue with ${pendingProviderName}`,
        onConfirm: async () => {
          const response = await fetchJson<{
            ok: boolean
            intent: 'login' | 'link'
            provider: string
            requiresProfileCompletion?: boolean
            completionToken?: string
            displayName?: string | null
          }>('/auth/oauth/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: pendingToken }),
          })

          if (pendingIntent === 'login' && response.requiresProfileCompletion) {
            if (!response.completionToken) {
              throw new Error('Profile completion token was missing. Please restart sign-in.')
            }

            setOAuthProfileCompletion({
              token: response.completionToken,
              provider: pendingProvider,
              displayName: typeof response.displayName === 'string' ? response.displayName : null,
            })
            setOAuthProfileError(null)
            setAuthEntryError(null)
            setAuthEntryMode('login')
            revokeAuthEntry()
            navigateToProjects()
            return
          }

          const nextPath = pendingIntent === 'link'
            ? `/settings?oauth_linked=${encodeURIComponent(pendingProvider)}`
            : '/'
          window.location.assign(nextPath)
        },
      })
      setPopupInput('')
      clearHandledParams()
      return
    }

    if (linkedProvider) {
      openAlertPopup(`${providerLabel(linkedProvider)} linked successfully.`, 'Login Provider Linked')
      clearHandledParams()
      return
    }
  }, [openAlertPopup, revokeAuthEntry, route.kind])

  const closePopup = useCallback(() => {
    if (popupBusy) return
    setPopup(null)
    setPopupInput('')
  }, [popupBusy])

  const handlePopupConfirm = useCallback(async () => {
    if (!popup || popup.kind === 'alert') {
      closePopup()
      return
    }

    setPopupBusy(true)
    try {
      if (popup.kind === 'prompt') {
        await popup.onConfirm(popupInput)
      } else {
        await popup.onConfirm()
      }
      setPopup(null)
      setPopupInput('')
    } catch (err) {
      openAlertPopup(getErrorMessage(err), 'Action failed')
    } finally {
      setPopupBusy(false)
    }
  }, [popup, popupInput, closePopup, openAlertPopup])

  const openTemplatePicker = useCallback(() => {
    setShowTemplateGallery(true)
    if (templates.length === 0 && !templatesLoading) {
      void loadTemplates()
    }
  }, [templates.length, templatesLoading, loadTemplates])

  const createProjectFromTemplate = useCallback(async (selection: { templateId: string; title: string }) => {
    setCreatingFromTemplate(true)
    try {
      const created = await fetchJson<ProjectSummary>('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selection.title,
          templateId: selection.templateId,
        }),
      })
      setShowTemplateGallery(false)
      await loadProjects()
      navigateToProject(created.id)
    } catch (err) {
      openAlertPopup(`Failed to create project: ${getErrorMessage(err)}`, 'Template creation failed')
    } finally {
      setCreatingFromTemplate(false)
    }
  }, [loadProjects, openAlertPopup])

  const renameProject = useCallback((project: ProjectSummary) => {
    setPopupInput(project.title)
    setPopup({
      kind: 'prompt',
      title: 'Rename Project',
      message: 'Update the project title.',
      initialValue: project.title,
      confirmLabel: 'Save',
      onConfirm: async (title) => {
        try {
          await fetchJson<{ ok: boolean }>(`/projects/${project.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
          })
          await loadProjects()
          await loadRecents()
        } catch (err) {
          throw new Error(`Failed to rename project: ${getErrorMessage(err)}`)
        }
      },
    })
  }, [loadProjects, loadRecents])

  const patchActiveProjectTitle = useCallback(
    async (title: string) => {
      if (route.kind !== 'project') {
        throw new Error('No active project')
      }
      const projectId = route.projectId
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(route.shareToken ? { 'X-Share-Token': route.shareToken } : {}),
      }
      await fetchJson<{ ok: boolean }>(`/projects/${projectId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title }),
      })
      setProjectMetadataById((prev) => {
        const cur = prev[projectId]
        if (!cur) {
          return prev
        }
        return { ...prev, [projectId]: { ...cur, title } }
      })
      await loadProjects()
      await loadRecents()
    },
    [route, loadProjects, loadRecents],
  )

  const deleteProject = useCallback((project: ProjectSummary) => {
    setPopup({
      kind: 'confirm',
      title: 'Delete Project',
      message: `Move "${project.title}" to Recently Deleted? It will be permanently removed after ${trashRetentionDays} days.`,
      confirmLabel: 'Delete project',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await fetchJson<{ ok: boolean }>(`/projects/${project.id}`, {
            method: 'DELETE',
          })
          await loadProjects()
          await loadRecents()
          await loadTrash()
          if (route.kind === 'project' && route.projectId === project.id) {
            navigateToProjects()
          }
        } catch (err) {
          throw new Error(`Failed to delete project: ${getErrorMessage(err)}`)
        }
      },
    })
    setPopupInput('')
  }, [loadProjects, loadRecents, loadTrash, route, trashRetentionDays])

  const restoreProject = useCallback(async (projectId: string) => {
    try {
      await fetchJson<{ ok: boolean }>(`/projects/${projectId}/restore`, { method: 'POST' })
      await loadProjects()
      await loadTrash()
    } catch (err) {
      openAlertPopup(getErrorMessage(err), 'Restore failed')
    }
  }, [loadProjects, loadTrash, openAlertPopup])

  const permanentDeleteProject = useCallback((projectId: string) => {
    const project = trashedProjects.find((p) => p.id === projectId)
    setPopup({
      kind: 'confirm',
      title: 'Permanently Delete',
      message: `Permanently delete "${project?.title ?? 'this project'}"? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await fetchJson<{ ok: boolean }>(`/projects/${projectId}/permanent`, { method: 'DELETE' })
          await loadTrash()
        } catch (err) {
          throw new Error(`Failed to permanently delete: ${getErrorMessage(err)}`)
        }
      },
    })
    setPopupInput('')
  }, [trashedProjects, loadTrash])

  const togglePinnedProject = useCallback((projectId: string) => {
    setPinnedProjectIds((prev) => {
      const next = prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
      persistDashboardPreferences({ pinnedProjectIds: next })
      return next
    })
  }, [persistDashboardPreferences])

  const handleDashboardSortByChange = useCallback((nextSortBy: SortBy) => {
    setDashboardSortBy(nextSortBy)
    persistDashboardPreferences({ dashboardSortBy: nextSortBy })
  }, [persistDashboardPreferences])

  const handleDashboardLayoutChange = useCallback((nextLayout: DashboardLayout) => {
    setDashboardLayout(nextLayout)
    persistDashboardPreferences({ dashboardLayout: nextLayout })
  }, [persistDashboardPreferences])

  const handlePinnedReorder = useCallback((nextPinnedOrder: string[]) => {
    setPinnedProjectIds(nextPinnedOrder)
    persistDashboardPreferences({ pinnedProjectIds: nextPinnedOrder })
  }, [persistDashboardPreferences])

  const accountLabel = useMemo(() => {
    if (!session) return 'Account'
    if (!session.authenticated) return guestLabel(session.principal.guestId)
    return session.user?.displayName || 'Account'
  }, [session])

  const accountEmail = useMemo(() => {
    if (!session) return null
    if (!session.authenticated) return guestIdLabel(session.principal.guestId)
    return session.user?.email ?? null
  }, [session])

  const accountIsGuest = Boolean(session && !session.authenticated)
  const isAdmin = session?.authenticated && session.user?.role === 'admin'
  const activeProjectMetadata = useMemo<ProjectWorkspaceMetadata | null>(() => {
    if (route.kind !== 'project') {
      return null
    }

    const fromState = projectMetadataById[route.projectId]
    if (fromState) {
      return fromState
    }

    const fromKnownProjects = knownProjectsById.get(route.projectId)
    return fromKnownProjects ?? null
  }, [knownProjectsById, projectMetadataById, route])

  let content: ReactNode

  if (sessionLoading) {
    content = (
      <div className="flex h-screen w-screen items-center justify-center bg-cz-bg text-sm text-cz-text-muted">
        Initializing workspace...
      </div>
    )
  } else if (backendUnavailable) {
    content = (
      <StatusPage
        code={503}
        title="Service Unavailable"
        description="The backend service is currently unreachable. Please try again in a moment."
      />
    )
  } else if (oauthProfileCompletion) {
    content = (
      <CompleteProfileView
        busy={oauthProfileBusy}
        error={oauthProfileError}
        provider={oauthProfileCompletion.provider}
        displayName={oauthProfileCompletion.displayName}
        onSubmit={(email: string) => {
          void submitOAuthProfileCompletion(email)
        }}
        onCancel={cancelOAuthProfileCompletion}
      />
    )
  } else if (!session?.authenticated && (route.kind === 'reset-password' || route.kind === 'invite' || !authEntryGranted)) {
    content = (
      <AuthEntryView
        busy={authEntryBusy || passwordResetLoading}
        error={authEntryError}
        guestRetentionDays={session?.guestRetentionDays ?? 30}
        guestSignupsEnabled={session?.guestSignupsEnabled ?? true}
        userCount={session?.userCount ?? 0}
        signupMode={session?.signupMode ?? 'open'}
        initialMode={authEntryMode}
        enabledLoginProviders={session?.enabledLoginProviders ?? []}
        inviteToken={route.kind === 'invite' ? route.token : undefined}
        resetToken={route.kind === 'reset-password' ? route.token : undefined}
        resetEmail={route.kind === 'reset-password' ? passwordResetEmail ?? undefined : undefined}
        onLogin={({ email, password }) => {
          void submitEntryAuth('login', { email, password })
        }}
        onPasskeyLogin={() => {
          void submitPasskeyLogin()
        }}
        onSignup={({ displayName, email, password, inviteToken }) => {
          void submitEntryAuth('signup', { displayName, email, password, inviteToken })
        }}
        onPasswordReset={({ token, newPassword }) => {
          void submitPasswordReset({ token, newPassword })
        }}
        onContinueAsGuest={continueAsGuest}
      />
    )
  } else if (route.kind === 'admin') {
    if (!isAdmin || !session?.user) {
      content = (
        <StatusPage
          code={403}
          title="Forbidden"
          description="You do not have permission to access Administration."
        />
      )
    } else {
      content = <AdministrationView currentUserId={session.user.id} onForceLogin={forceLogin} />
    }
  } else if (route.kind === 'settings') {
    content = (
      <SettingsView
        session={session}
        preferences={preferences}
        sessions={authSessions}
        isAdmin={Boolean(isAdmin)}
        onSessionChange={handleSessionChange}
        onReloadSessions={loadAuthSessions}
        onRevokeSession={revokeSession}
        onUpdatePreferences={updatePreferencesPatch}
        onDeleteAccount={requestDeleteAccount}
        onBeginAuthFlow={beginLoginFlow}
        onLogout={logoutEverywhere}
      />
    )
  } else if (route.kind === 'project') {
    if (projectMetadataLoadingId === route.projectId && !activeProjectMetadata) {
      content = (
        <div className="flex h-screen w-screen items-center justify-center bg-cz-bg text-sm text-cz-text-muted">
          Loading project workspace...
        </div>
      )
    } else if (activeProjectMetadata?.engine === 'excalidraw' || activeProjectMetadata?.rootFile.toLowerCase().endsWith('.excalidraw')) {
      content = (
        <WhiteboardWorkspace
          key={`${route.projectId}:${route.shareToken ?? ''}`}
          projectId={route.projectId}
          projectTitle={activeProjectMetadata?.title ?? 'Untitled Whiteboard'}
          rootFile={activeProjectMetadata?.rootFile ?? 'scene.excalidraw'}
          onBackToProjects={navigateToProjects}
          onRenameProject={patchActiveProjectTitle}
          session={{
            accountLabel,
            accountEmail,
            accountImageUrl: session?.user?.profileImageUrl ?? null,
            accountIsGuest,
            user: session?.user ?? null,
            principal: session?.principal ?? { userId: null, guestId: null },
          }}
          shareToken={route.shareToken}
          onPopupAlert={openAlertPopup}
          onOpenSettings={navigateToSettings}
          onLogin={() => beginLoginFlow('login')}
          onLogout={() => {
            void logoutEverywhere().catch((err) => {
              openAlertPopup(getErrorMessage(err), 'Log out failed')
            })
          }}
        />
      )
    } else {
      content = (
        <ProjectWorkspace
          projectId={route.projectId}
          projectTitle={activeProjectMetadata?.title ?? 'Untitled project'}
          entrypoint={activeProjectMetadata?.rootFile ?? ''}
          defaultBibliographyFile={activeProjectMetadata?.defaultBibliographyFile ?? null}
          referenceLookupFormat={activeProjectMetadata?.referenceLookupFormat}
          onRenameProject={patchActiveProjectTitle}
          session={{
            accountLabel,
            accountEmail,
            accountImageUrl: session?.user?.profileImageUrl ?? null,
            accountIsGuest,
            user: session?.user ?? null,
            principal: session?.principal ?? { userId: null, guestId: null },
          }}
          shareToken={route.shareToken}
          autoCompileDefault={preferences.autoCompileDefault}
          autoCompileTimeoutSeconds={preferences.autoCompileTimeoutSeconds}
          autoSaveOnCompile={preferences.autoSaveOnCompile}
          autoSaveOnExport={preferences.autoSaveOnExport}
          editorBraceMatching={preferences.editorBraceMatching}
          editorHighlightSelectionMatches={preferences.editorHighlightSelectionMatches}
          editorInEditorFind={preferences.editorInEditorFind}
          editorAutocomplete={preferences.editorAutocomplete}
          editorAutoCloseLatexBeginEnd={preferences.editorAutoCloseLatexBeginEnd}
          onLogin={() => beginLoginFlow('login')}
          onLogout={() => {
            void logoutEverywhere().catch((err) => {
              openAlertPopup(getErrorMessage(err), 'Log out failed')
            })
          }}
          onPopupAlert={openAlertPopup}
        />
      )
    }
  } else if (route.kind === 'not-found') {
    content = (
      <StatusPage
        code={404}
        title="Page Not Found"
        description={`The path ${route.path} does not exist in this workspace.`}
      />
    )
  } else {
    content = (
      <DashboardView
        projects={projects}
        sharedProjects={sharedProjects}
        recents={recentProjects}
        loading={projectsLoading}
        session={session}
        dashboardSortBy={dashboardSortBy}
        dashboardLayout={dashboardLayout}
        pinnedProjectIds={pinnedProjectIds}
        quickAccessPinnedLimit={preferences.quickAccessPinnedLimit}
        onOpenTemplatePicker={openTemplatePicker}
        onOpen={openProject}
        onRename={renameProject}
        onDelete={deleteProject}
        onTogglePin={togglePinnedProject}
        onSortByChange={handleDashboardSortByChange}
        onLayoutChange={handleDashboardLayoutChange}
        onReorderPinned={handlePinnedReorder}
        onClearRecents={clearRecents}
        showAdminLink={Boolean(isAdmin)}
        onOpenAdmin={navigateToAdmin}
        onOpenSettings={navigateToSettings}
        onLogin={() => beginLoginFlow('login')}
        onLogout={() => {
          void logoutEverywhere().catch((err) => {
            openAlertPopup(getErrorMessage(err), 'Log out failed')
          })
        }}
        trashedProjects={trashedProjects}
        trashRetentionDays={trashRetentionDays}
        onRestoreProject={restoreProject}
        onPermanentDeleteProject={permanentDeleteProject}
      />
    )
  }

  return (
    <>
      {content}
      {showTemplateGallery && (
        <TemplateGallery
          templates={templates}
          loading={templatesLoading}
          error={templatesError}
          creating={creatingFromTemplate}
          onClose={() => {
            if (creatingFromTemplate) return
            setShowTemplateGallery(false)
          }}
          onCreate={(selection) => {
            void createProjectFromTemplate(selection)
          }}
        />
      )}
      <PopupDialog
        open={popup !== null}
        title={popup?.title ?? ''}
        message={popup?.message}
        dismiss={
          popup && popup.kind !== 'alert'
            ? {
                label: 'Cancel',
                onClick: closePopup,
                disabled: popupBusy,
              }
            : undefined
        }
        actions={
          popup
            ? popup.kind === 'alert'
              ? [
                  {
                    label: 'OK',
                    onClick: closePopup,
                    autoFocus: true,
                  },
                ]
              : [
                  {
                    label: popup.confirmLabel,
                    onClick: () => {
                      void handlePopupConfirm()
                    },
                    variant: popup.confirmVariant ?? 'primary',
                    disabled: popupBusy,
                    autoFocus: true,
                  },
                ]
            : []
        }
      >
        {popup?.kind === 'prompt' && (
          <input
            type={popup.inputType ?? 'text'}
            value={popupInput}
            onChange={(event) => setPopupInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !popupBusy) {
                event.preventDefault()
                void handlePopupConfirm()
              }
            }}
            disabled={popupBusy}
            autoFocus
            className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent disabled:opacity-60"
          />
        )}
      </PopupDialog>
    </>
  )
}
