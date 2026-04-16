import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { TemplateGallery } from './dashboard/TemplateGallery'
import { PopupDialog } from './components/PopupDialog'
import { AuthEntryView } from './auth/AuthEntryView'
import { AdministrationView } from './admin/AdministrationView'
import { DashboardView } from './dashboard/DashboardView'
import { ProjectWorkspace } from './workspace/ProjectWorkspace'
import { SettingsView } from './settings/SettingsView'
import { StatusPage } from './auth/StatusPage'
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
} from './types'
import {
  guestIdLabel,
  guestLabel,
} from './utils/page-utils'
import { fetchJson, getErrorMessage } from './utils/fetch'
import {
  navigateToProject,
  navigateToProjects,
  navigateToAdmin,
  navigateToSettings,
  parseRoute,
} from './utils/route'
import {
  getDashboardPrincipalKey,
  loadDashboardPreferences,
  saveDashboardPreferences,
} from './dashboard/dashboard-prefs'

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute())
  const [session, setSession] = useState<AuthSession | null>(null)
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
  const wasAuthenticatedRef = useRef(false)

  const grantAuthEntry = useCallback(() => {
    window.sessionStorage.setItem('composure.auth-entry', 'granted')
    setAuthEntryGranted(true)
  }, [])

  const revokeAuthEntry = useCallback(() => {
    window.sessionStorage.removeItem('composure.auth-entry')
    setAuthEntryGranted(false)
  }, [])

  const loadSession = useCallback(async () => {
    const next = await fetchJson<AuthSession>('/api/auth/session')
    setSession(next)
    return next
  }, [])

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    try {
      const list = await fetchJson<ProjectSummary[]>('/api/projects')
      setProjects(list)

      const shared = await fetchJson<ProjectSummary[]>('/api/projects/shared-with-me')
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
      const list = await fetchJson<RecentProjectSummary[]>('/api/projects/recents')
      setRecentProjects(list)
    } catch {
      setRecentProjects([])
    }
  }, [])

  const loadTrash = useCallback(async () => {
    try {
      const response = await fetchJson<{ projects: TrashedProjectSummary[]; retentionDays: number }>('/api/projects/trash')
      setTrashedProjects(response.projects)
      setTrashRetentionDays(response.retentionDays)
    } catch {
      setTrashedProjects([])
    }
  }, [])

  const loadPreferences = useCallback(async () => {
    try {
      const next = await fetchJson<UserPreferences>('/api/preferences')
      setPreferences(next)
    } catch {
      setPreferences({
        appearance: 'system',
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
      const body = await fetchJson<{ sessions: SessionSummary[] }>('/api/auth/sessions')
      setAuthSessions(body.sessions)
    } catch {
      setAuthSessions([])
    }
  }, [session?.authenticated])

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    setTemplatesError(null)
    try {
      const body = await fetchJson<{ templates: ProjectTemplate[] }>('/api/templates')
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
      try {
        await loadSession()
      } finally {
        if (!cancelled) {
          setSessionLoading(false)
        }
      }
      if (!cancelled) {
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
    const root = document.documentElement
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const effective =
      preferences.appearance === 'system'
        ? systemDark
          ? 'dark'
          : 'light'
        : preferences.appearance
    root.dataset.theme = effective
  }, [preferences.appearance])

  useEffect(() => {
    if (sessionLoading) return
    if (route.kind !== 'project') return
    void fetch(`/api/projects/${route.projectId}/open`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: route.shareToken ? { 'X-Share-Token': route.shareToken } : undefined,
    })
      .catch(() => undefined)
      .finally(() => {
        void loadRecents()
      })
  }, [route, loadRecents, sessionLoading])

  useEffect(() => {
    if (route.kind !== 'reset-password') {
      setPasswordResetEmail(null)
      setPasswordResetLoading(false)
      return
    }

    setPasswordResetLoading(true)
    setAuthEntryError(null)
    void fetchJson<{ email: string }>(`/api/auth/password-reset/${encodeURIComponent(route.token)}`)
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
    }
    void loadProjects()
    void loadRecents()
    void loadTrash()
    void loadPreferences()
    void loadAuthSessions()
  }, [grantAuthEntry, loadProjects, loadRecents, loadTrash, loadPreferences, loadAuthSessions])

  const clearRecents = useCallback(async () => {
    try {
      await fetchJson<{ ok: boolean }>('/api/projects/recents', { method: 'DELETE' })
      setRecentProjects([])
    } catch (err) {
      console.error(`[app] clear-recents-failed ${String(err)}`)
    }
  }, [])

  const openProject = useCallback((projectId: string, shareToken?: string) => {
    void fetch(`/api/projects/${projectId}/open`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: shareToken ? { 'X-Share-Token': shareToken } : undefined,
    }).catch(() => undefined)
    navigateToProject(projectId, shareToken)
  }, [])

  const logoutEverywhere = useCallback(async () => {
    const next = await fetchJson<AuthSession>('/api/auth/logout', {
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
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup'
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

  const submitPasswordReset = useCallback(async (payload: { token: string; newPassword: string }) => {
    setAuthEntryBusy(true)
    setAuthEntryError(null)
    try {
      const next = await fetchJson<AuthSession>(`/api/auth/password-reset/${encodeURIComponent(payload.token)}`, {
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

  const requestDeleteAccount = useCallback(() => {
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

        const next = await fetchJson<AuthSession>('/api/auth/delete-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: trimmed }),
        })
        setSession(next)
        revokeAuthEntry()
        setAuthEntryMode('login')
        setAuthEntryError('Account deleted. Please log in to continue.')
        navigateToProjects()
      },
    })
  }, [revokeAuthEntry])

  const updatePreferencesPatch = useCallback(async (patch: Partial<UserPreferences>) => {
    if (!isAuthenticated) {
      setPreferences((prev) => ({ ...prev, ...patch }))
      return
    }

    const next = await fetchJson<UserPreferences>('/api/preferences', {
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
    await fetchJson<{ ok: boolean }>(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' })
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
      const created = await fetchJson<ProjectSummary>('/api/projects', {
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
          await fetchJson<{ ok: boolean }>(`/api/projects/${project.id}`, {
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

  const deleteProject = useCallback((project: ProjectSummary) => {
    setPopup({
      kind: 'confirm',
      title: 'Delete Project',
      message: `Move "${project.title}" to Recently Deleted? It will be permanently removed after ${trashRetentionDays} days.`,
      confirmLabel: 'Delete project',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await fetchJson<{ ok: boolean }>(`/api/projects/${project.id}`, {
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
      await fetchJson<{ ok: boolean }>(`/api/projects/${projectId}/restore`, { method: 'POST' })
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
          await fetchJson<{ ok: boolean }>(`/api/projects/${projectId}/permanent`, { method: 'DELETE' })
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

  let content: ReactNode

  if (sessionLoading) {
    content = (
      <div className="flex h-screen w-screen items-center justify-center bg-cz-bg text-sm text-cz-text-muted">
        Initializing workspace...
      </div>
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
        inviteToken={route.kind === 'invite' ? route.token : undefined}
        resetToken={route.kind === 'reset-password' ? route.token : undefined}
        resetEmail={route.kind === 'reset-password' ? passwordResetEmail ?? undefined : undefined}
        onLogin={({ email, password }) => {
          void submitEntryAuth('login', { email, password })
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
    content = (
      <ProjectWorkspace
        projectId={route.projectId}
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
