import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Monitor,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Trash2,
  User,
  UserPlus,
  Users,
} from 'lucide-react'
import { ActionMenu } from '@/components/ActionMenu'
import { BackToProjectsButton } from './BackToProjectsButton'
import { IconDropdown } from '@/components/IconDropdown'
import { MobileDrawerToolbar } from '@/components/MobileDrawerToolbar'
import { NumberStepper } from '@/components/NumberStepper'
import { PopupDialog } from '@/components/PopupDialog'
import { SegmentedControl } from '@/components/SegmentedControl'
import { SideDrawer } from '@/components/SideDrawer'
import { ToggleSwitch } from '@/components/ToggleSwitch'
import { UserFormModal } from './UserFormModal'
import {
  DEFAULT_SERVER_SETTINGS_FORM_STATE,
  toServerSettingsFormState,
  toServerSettingsPayload,
  type ServerSettings,
  type ServerSettingsFormState,
} from './admin-utils'
import { useSectionObserver } from '@/hooks/use-section-observer'
import { apiUrl, fetchJson, getErrorMessage } from '@/utils/fetch'
import { apiRequestCredentials } from '@/utils/api-routing'
import { fmtTime, fmtRelativeTime } from '@/utils/format-time'
import { navigateToProjects, navigateToSettings } from '@/utils/route'

interface AdminUser {
  id: string
  email: string
  displayName: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  maxProjects: number | null
  lastLoginAt: number | null
  createdAt: number
}

interface PasswordResetLinkRecord {
  token: string
  tokenPreview: string
  createdAt: number
  expiresAt: number
  usedAt: number | null
  expiredEarlyAt: number | null
}

interface InviteTokenRecord {
  token: string
  tokenPreview: string
  createdAt: number
  expiresAt: number
  email: string | null
  usedAt: number | null
}

interface SmtpSettingsMasked {
  host: string
  port: number
  username: string
  hasPassword: boolean
  senderName: string
  senderAddress: string
  encryption: 'none' | 'starttls' | 'tls'
}

interface JobQueueSummary {
  runningCount: number
  waitingCount: number
  lastCompletedAt: number | null
  lastFailedJob: { id: string; type: string; error: string | null; finishedAt: number } | null
  totalDone: number
  totalFailed: number
  totalInvalid: number
  totalStalled: number
}

interface BackgroundJobSummary {
  id: string
  type: string
  status: 'waiting' | 'running' | 'done' | 'failed' | 'invalid' | 'stalled'
  userId: string | null
  userEmail: string | null
  userDisplayName: string | null
  projectId: string | null
  projectTitle: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

type HealthStatus = 'healthy' | 'degraded' | 'stalled'

type EncryptionOption = 'none' | 'starttls' | 'tls'

const encryptionOptions: Array<{ value: EncryptionOption; label: string; icon: typeof Lock }> = [
  { value: 'none', label: 'None', icon: Shield },
  { value: 'starttls', label: 'STARTTLS', icon: Lock },
  { value: 'tls', label: 'TLS/SSL', icon: Lock },
]

const jobTimeframeOptions = [
  { value: '3600', label: '1h' },
  { value: '7200', label: '2h' },
  { value: '21600', label: '6h' },
  { value: '43200', label: '12h' },
  { value: '86400', label: '24h' },
] as const

interface AdministrationViewProps {
  currentUserId: string
  onForceLogin: (message?: string) => void
}

type RoleOption = 'user' | 'admin'
type AdminSectionId = 'users' | 'server' | 'invitations' | 'email' | 'login-providers' | 'monitoring'

const roleOptions: Array<{ value: RoleOption; label: string; icon: typeof User }> = [
  { value: 'user', label: 'User', icon: User },
  { value: 'admin', label: 'Admin', icon: Crown },
]

const loginProviderLabels: Record<string, string> = {
  password: 'Password',
  github: 'GitHub',
  google: 'Google',
  orcid: 'ORCID',
}

const adminSectionItems: Array<{ id: AdminSectionId; label: string; icon: typeof User }> = [
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'server', label: 'Server Settings', icon: Settings },
  { id: 'invitations', label: 'Invitations', icon: UserPlus },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'login-providers', label: 'Login Providers', icon: KeyRound },
  { id: 'monitoring', label: 'Monitoring', icon: Monitor },
]

function validatePassword(password: string): string | null {
  if (password.trim().length < 8) {
    return 'Password must be at least 8 characters.'
  }
  return null
}

export function AdministrationView({ currentUserId, onForceLogin }: AdministrationViewProps) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)

  const [passwordResetExpiryHours, setPasswordResetExpiryHours] = useState(24)
  const [signupMode, setSignupMode] = useState<'open' | 'invite-only'>('open')
  const [guestSignupsEnabled, setGuestSignupsEnabled] = useState(true)
  const [inviteExpiryHours, setInviteExpiryHours] = useState(72)
  const [defaultProjectLimitMode, setDefaultProjectLimitMode] = useState<'on' | 'unlimited'>('unlimited')
  const [defaultProjectLimitValue, setDefaultProjectLimitValue] = useState(50)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [maxConcurrentJobs, setMaxConcurrentJobs] = useState(3)
  const [maxUploadMode, setMaxUploadMode] = useState<'on' | 'unlimited'>('on')
  const [maxUploadValue, setMaxUploadValue] = useState(50)
  const [maxTextMode, setMaxTextMode] = useState<'on' | 'unlimited'>('on')
  const [maxTextValue, setMaxTextValue] = useState(5)
  const [maxFilesMode, setMaxFilesMode] = useState<'on' | 'unlimited'>('on')
  const [maxFilesValue, setMaxFilesValue] = useState(200)
  const [trashRetentionDays, setTrashRetentionDays] = useState(30)
  const [largeFileThreshold, setLargeFileThreshold] = useState(500)  // in thousands of chars
  const [chatHistoryRetentionMode, setChatHistoryRetentionMode] = useState<'on' | 'unlimited'>('unlimited')
  const [chatHistoryRetentionValue, setChatHistoryRetentionValue] = useState(30)
  const [serverSettingsSaved, setServerSettingsSaved] = useState<ServerSettingsFormState>(
    DEFAULT_SERVER_SETTINGS_FORM_STATE,
  )

  const [invites, setInvites] = useState<InviteTokenRecord[]>([])
  const [invitesBusy, setInvitesBusy] = useState(false)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const generatedInviteRef = useRef<HTMLInputElement | null>(null)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createEmail, setCreateEmail] = useState('')
  const [createDisplayName, setCreateDisplayName] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createRole, setCreateRole] = useState<RoleOption>('user')
  const [createMaxProjectsMode, setCreateMaxProjectsMode] = useState<'custom' | 'unlimited' | 'inherit'>('inherit')
  const [createMaxProjectsValue, setCreateMaxProjectsValue] = useState(50)

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editRole, setEditRole] = useState<RoleOption>('user')
  const [editSuspended, setEditSuspended] = useState(false)
  const [editMaxProjectsMode, setEditMaxProjectsMode] = useState<'custom' | 'unlimited' | 'inherit'>('inherit')
  const [editMaxProjectsValue, setEditMaxProjectsValue] = useState(50)
  const [editNewPassword, setEditNewPassword] = useState('')
  const [editConfirmPassword, setEditConfirmPassword] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [generatedResetUrl, setGeneratedResetUrl] = useState('')
  const [existingResetLinks, setExistingResetLinks] = useState<PasswordResetLinkRecord[]>([])

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')

  const [activeSection, setActiveSection] = useState<AdminSectionId>('users')
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false)

  // SMTP state
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(587)
  const [smtpUsername, setSmtpUsername] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpHasPassword, setSmtpHasPassword] = useState(false)
  const [smtpSenderName, setSmtpSenderName] = useState('')
  const [smtpSenderAddress, setSmtpSenderAddress] = useState('')
  const [smtpEncryption, setSmtpEncryption] = useState<EncryptionOption>('starttls')
  const [smtpBusy, setSmtpBusy] = useState(false)
  const [smtpError, setSmtpError] = useState<string | null>(null)
  const [smtpShowPassword, setSmtpShowPassword] = useState(false)
  const [smtpSaved, setSmtpSaved] = useState({ host: '', port: 587, username: '', senderName: '', senderAddress: '', encryption: 'starttls' as EncryptionOption })
  const [testEmailTo, setTestEmailTo] = useState('')
  const [testEmailBusy, setTestEmailBusy] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Monitoring state
  const [jobSummary, setJobSummary] = useState<JobQueueSummary | null>(null)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('healthy')
  const [recentJobs, setRecentJobs] = useState<BackgroundJobSummary[]>([])
  const [jobsTimeframe, setJobsTimeframe] = useState<string>('86400')
  const [monitoringBusy, setMonitoringBusy] = useState(false)
  const [monitoringError, setMonitoringError] = useState<string | null>(null)

  // Login providers state
  interface LoginProviderItem {
    provider: string
    enabled: boolean
    hasCredentials: boolean
    clientId: string
    clientSecret: string
    dirty: boolean
  }
  const [loginProviders, setLoginProviders] = useState<LoginProviderItem[]>([])
  const [loginProvidersSaved, setLoginProvidersSaved] = useState<LoginProviderItem[]>([])
  const [loginProvidersBusy, setLoginProvidersBusy] = useState(false)
  const [loginProvidersError, setLoginProvidersError] = useState<string | null>(null)
  const [providerTestResults, setProviderTestResults] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'fail'>>({})
  const [providerTestErrors, setProviderTestErrors] = useState<Record<string, string>>({})
  const [callbackCopied, setCallbackCopied] = useState(false)
  const [strandedDialog, setStrandedDialog] = useState<{
    kind: 'error' | 'warning'
    message: string
    strandedCount: number
    strandedUserIds: string[]
  } | null>(null)
  const [strandedCsvDownloaded, setStrandedCsvDownloaded] = useState(false)
  const [strandedConfirmText, setStrandedConfirmText] = useState('')

  const loadUsers = useCallback(async (search: string) => {
    setLoadingUsers(true)
    setUsersError(null)
    try {
      const response = await fetchJson<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(search)}`)
      setUsers(response.users)
    } catch (err) {
      setUsersError(getErrorMessage(err))
      setUsers([])
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  const applyServerSettingsForm = useCallback((next: ServerSettingsFormState) => {
    setPasswordResetExpiryHours(next.passwordResetExpiryHours)
    setSignupMode(next.signupMode)
    setGuestSignupsEnabled(next.guestSignupsEnabled)
    setInviteExpiryHours(next.inviteExpiryHours)
    setMaxConcurrentJobs(next.maxConcurrentJobs)
    setDefaultProjectLimitMode(next.defaultProjectLimitMode)
    setDefaultProjectLimitValue(next.defaultProjectLimitValue)
    setMaxUploadMode(next.maxUploadMode)
    setMaxUploadValue(next.maxUploadValue)
    setMaxTextMode(next.maxTextMode)
    setMaxTextValue(next.maxTextValue)
    setMaxFilesMode(next.maxFilesMode)
    setMaxFilesValue(next.maxFilesValue)
    setTrashRetentionDays(next.trashRetentionDays)
    setLargeFileThreshold(next.largeFileThreshold)
    setChatHistoryRetentionMode(next.chatHistoryRetentionMode)
    setChatHistoryRetentionValue(next.chatHistoryRetentionValue)
  }, [])

  const loadServerSettings = useCallback(async () => {
    try {
      const response = await fetchJson<ServerSettings>('/admin/server-settings')
      const next = toServerSettingsFormState(response)
      applyServerSettingsForm(next)
      setServerSettingsSaved(next)
    } catch (err) {
      setSettingsError(getErrorMessage(err))
    }
  }, [applyServerSettingsForm])

  const loadInvites = useCallback(async () => {
    try {
      const response = await fetchJson<{ invites: InviteTokenRecord[] }>('/admin/invites')
      setInvites(response.invites)
    } catch (err) {
      setInvitesError(getErrorMessage(err))
    }
  }, [])

  const loadSmtpSettings = useCallback(async () => {
    try {
      const response = await fetchJson<SmtpSettingsMasked>('/admin/smtp')
      setSmtpHost(response.host)
      setSmtpPort(response.port)
      setSmtpUsername(response.username)
      setSmtpHasPassword(response.hasPassword)
      setSmtpSenderName(response.senderName)
      setSmtpSenderAddress(response.senderAddress)
      setSmtpEncryption(response.encryption)
      setSmtpSaved({ host: response.host, port: response.port, username: response.username, senderName: response.senderName, senderAddress: response.senderAddress, encryption: response.encryption })
    } catch (err) {
      setSmtpError(getErrorMessage(err))
    }
  }, [])

  const loadLoginProviders = useCallback(async () => {
    try {
      const response = await fetchJson<{ providers: Array<{ provider: string; enabled: boolean; hasCredentials: boolean; clientId?: string }> }>('/admin/login-providers')
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
    } catch (err) {
      setLoginProvidersError(getErrorMessage(err))
    }
  }, [])

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
          .map((result) => loginProviderLabels[result.provider] ?? result.provider)

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
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'stranded-users.csv'
      a.click()
      URL.revokeObjectURL(url)
      setStrandedCsvDownloaded(true)
    } catch {
      // ignore
    }
  }, [])

  const loadMonitoringData = useCallback(async (seconds: string) => {
    setMonitoringBusy(true)
    setMonitoringError(null)
    try {
      const response = await fetchJson<{ jobs: BackgroundJobSummary[]; health: HealthStatus }>(`/admin/monitoring/jobs?seconds=${seconds}`)
      setRecentJobs(response.jobs)
      setHealthStatus(response.health)
      const summaryResponse = await fetchJson<{ summary: JobQueueSummary; health: HealthStatus }>(`/admin/monitoring/summary?seconds=${seconds}`)
      setJobSummary(summaryResponse.summary)
      setHealthStatus(summaryResponse.health)
    } catch (err) {
      setMonitoringError(getErrorMessage(err))
    } finally {
      setMonitoringBusy(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers(query)
    }, 120)
    return () => {
      window.clearTimeout(timer)
    }
  }, [loadUsers, query])

  useEffect(() => {
    void loadServerSettings()
    void loadInvites()
    void loadSmtpSettings()
    void loadLoginProviders()
    void loadMonitoringData(jobsTimeframe)
  }, [loadServerSettings, loadInvites, loadSmtpSettings, loadLoginProviders, loadMonitoringData, jobsTimeframe])

  const beginEditUser = useCallback((user: AdminUser) => {
    setEditingUser(user)
    setEditDisplayName(user.displayName)
    setEditRole(user.role)
    setEditSuspended(user.status === 'suspended')
    setEditMaxProjectsMode(user.maxProjects == null ? 'inherit' : user.maxProjects === 0 ? 'unlimited' : 'custom')
    setEditMaxProjectsValue(user.maxProjects != null && user.maxProjects > 0 ? user.maxProjects : 50)
    setEditNewPassword('')
    setEditConfirmPassword('')
    setEditError(null)
  }, [])

  const openResetModal = useCallback(async (user: AdminUser) => {
    setResetTarget(user)
    setGeneratedResetUrl('')
    setResetError(null)
    setResetBusy(true)
    try {
      const createResponse = await fetchJson<{ url: string }>(`/admin/users/${user.id}/password-reset-link`, {
        method: 'POST',
      })
      const linksResponse = await fetchJson<{ links: PasswordResetLinkRecord[] }>(`/admin/users/${user.id}/password-reset-links`)
      setGeneratedResetUrl(createResponse.url)
      setExistingResetLinks(linksResponse.links)
    } catch (err) {
      setResetError(getErrorMessage(err))
    } finally {
      setResetBusy(false)
    }
  }, [])

  const refreshResetLinks = useCallback(async (userId: string) => {
    const linksResponse = await fetchJson<{ links: PasswordResetLinkRecord[] }>(`/admin/users/${userId}/password-reset-links`)
    setExistingResetLinks(linksResponse.links)
  }, [])

  const expireResetLink = useCallback(async (token: string) => {
    if (!resetTarget) return
    setResetBusy(true)
    setResetError(null)
    try {
      await fetchJson<{ ok: boolean }>(`/admin/password-reset-links/${encodeURIComponent(token)}/expire`, {
        method: 'POST',
      })
      await refreshResetLinks(resetTarget.id)
    } catch (err) {
      setResetError(getErrorMessage(err))
    } finally {
      setResetBusy(false)
    }
  }, [refreshResetLinks, resetTarget])

  const submitCreateUser = useCallback(async () => {
    const email = createEmail.trim().toLowerCase()
    const displayName = createDisplayName.trim()
    const passwordError = validatePassword(createPassword)

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setCreateError('Enter a valid email address.')
      return
    }
    if (displayName.length < 2) {
      setCreateError('Display name must be at least 2 characters.')
      return
    }
    if (passwordError) {
      setCreateError(passwordError)
      return
    }

    setCreateBusy(true)
    setCreateError(null)
    try {
      await fetchJson<{ user: AdminUser }>('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          displayName,
          password: createPassword,
          role: createRole,
          maxProjects: createMaxProjectsMode === 'custom' ? createMaxProjectsValue : createMaxProjectsMode === 'unlimited' ? 0 : null,
        }),
      })
      setShowCreateModal(false)
      setCreateEmail('')
      setCreateDisplayName('')
      setCreatePassword('')
      setCreateRole('user')
      setCreateMaxProjectsMode('inherit')
      setCreateMaxProjectsValue(50)
      await loadUsers(query)
    } catch (err) {
      setCreateError(getErrorMessage(err))
    } finally {
      setCreateBusy(false)
    }
  }, [createEmail, createDisplayName, createPassword, createRole, createMaxProjectsMode, createMaxProjectsValue, loadUsers, query])

  const submitEditUser = useCallback(async () => {
    if (!editingUser) return

    const displayName = editDisplayName.trim()
    if (displayName.length < 2) {
      setEditError('Display name must be at least 2 characters.')
      return
    }

    if (editNewPassword.trim().length > 0) {
      const passwordError = validatePassword(editNewPassword)
      if (passwordError) {
        setEditError(passwordError)
        return
      }
      if (editNewPassword !== editConfirmPassword) {
        setEditError('New password and confirmation do not match.')
        return
      }
    }

    setEditBusy(true)
    setEditError(null)
    try {
      const response = await fetchJson<{ user: AdminUser; forceRelogin?: boolean }>(`/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          role: editRole,
          suspended: editSuspended,
          maxProjects: editMaxProjectsMode === 'custom' ? editMaxProjectsValue : editMaxProjectsMode === 'unlimited' ? 0 : null,
          newPassword: editNewPassword.trim().length > 0 ? editNewPassword : undefined,
        }),
      })

      setEditingUser(null)
      setEditNewPassword('')
      setEditConfirmPassword('')
      await loadUsers(query)

      if (response.forceRelogin) {
        onForceLogin('Your password was changed. Please log in again.')
      }
    } catch (err) {
      setEditError(getErrorMessage(err))
    } finally {
      setEditBusy(false)
    }
  }, [editConfirmPassword, editDisplayName, editMaxProjectsMode, editMaxProjectsValue, editNewPassword, editRole, editSuspended, editingUser, loadUsers, onForceLogin, query])

  const deleteSelectedUser = useCallback(async () => {
    if (!deleteTarget) return

    if (deleteConfirmEmail.trim().toLowerCase() !== deleteTarget.email.toLowerCase()) {
      setDeleteError('Type the exact email address to confirm deletion.')
      return
    }

    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const response = await fetchJson<{ ok: boolean; forceRelogin?: boolean }>(`/admin/users/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: deleteConfirmEmail.trim() }),
      })
      setDeleteTarget(null)
      setDeleteConfirmEmail('')
      await loadUsers(query)
      if (response.forceRelogin) {
        onForceLogin('Your account was removed. Please log in again.')
      }
    } catch (err) {
      setDeleteError(getErrorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }, [deleteConfirmEmail, deleteTarget, loadUsers, onForceLogin, query])

  const saveServerSettings = useCallback(async () => {
    setSettingsBusy(true)
    setSettingsError(null)
    try {
      const payload = toServerSettingsPayload({
        signupMode,
        guestSignupsEnabled,
        inviteExpiryHours,
        passwordResetExpiryHours,
        maxConcurrentJobs,
        defaultProjectLimitMode,
        defaultProjectLimitValue,
        maxUploadMode,
        maxUploadValue,
        maxTextMode,
        maxTextValue,
        maxFilesMode,
        maxFilesValue,
        trashRetentionDays,
        largeFileThreshold,
        chatHistoryRetentionMode,
        chatHistoryRetentionValue,
      })
      const response = await fetchJson<ServerSettings>('/admin/server-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const next = toServerSettingsFormState(response)
      applyServerSettingsForm(next)
      setServerSettingsSaved(next)
    } catch (err) {
      setSettingsError(getErrorMessage(err))
    } finally {
      setSettingsBusy(false)
    }
  }, [
    applyServerSettingsForm,
    signupMode,
    guestSignupsEnabled,
    inviteExpiryHours,
    passwordResetExpiryHours,
    maxConcurrentJobs,
    defaultProjectLimitMode,
    defaultProjectLimitValue,
    maxUploadMode,
    maxUploadValue,
    maxTextMode,
    maxTextValue,
    maxFilesMode,
    maxFilesValue,
    trashRetentionDays,
    largeFileThreshold,
    chatHistoryRetentionMode,
    chatHistoryRetentionValue,
  ])

  const createNewInvite = useCallback(async () => {
    setInvitesBusy(true)
    setInvitesError(null)
    try {
      const emailValue = inviteEmail.trim().toLowerCase()
      const response = await fetchJson<{ url: string }>('/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue || undefined }),
      })
      setGeneratedInviteUrl(response.url)
      setInviteEmail('')
      await loadInvites()
      requestAnimationFrame(() => {
        generatedInviteRef.current?.select()
      })
    } catch (err) {
      setInvitesError(getErrorMessage(err))
    } finally {
      setInvitesBusy(false)
    }
  }, [inviteEmail, loadInvites])

  const revokeInvite = useCallback(async (token: string) => {
    setInvitesBusy(true)
    setInvitesError(null)
    try {
      await fetchJson<{ ok: boolean }>(`/admin/invites/${encodeURIComponent(token)}`, {
        method: 'DELETE',
      })
      await loadInvites()
    } catch (err) {
      setInvitesError(getErrorMessage(err))
    } finally {
      setInvitesBusy(false)
    }
  }, [loadInvites])

  const saveSmtpSettings = useCallback(async () => {
    setSmtpBusy(true)
    setSmtpError(null)
    try {
      const response = await fetchJson<SmtpSettingsMasked>('/admin/smtp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          username: smtpUsername,
          password: smtpPassword || undefined,
          senderName: smtpSenderName,
          senderAddress: smtpSenderAddress,
          encryption: smtpEncryption,
        }),
      })
      setSmtpHost(response.host)
      setSmtpPort(response.port)
      setSmtpUsername(response.username)
      setSmtpHasPassword(response.hasPassword)
      setSmtpSenderName(response.senderName)
      setSmtpSenderAddress(response.senderAddress)
      setSmtpEncryption(response.encryption)
      setSmtpPassword('')
      setSmtpSaved({ host: response.host, port: response.port, username: response.username, senderName: response.senderName, senderAddress: response.senderAddress, encryption: response.encryption })
    } catch (err) {
      setSmtpError(getErrorMessage(err))
    } finally {
      setSmtpBusy(false)
    }
  }, [smtpHost, smtpPort, smtpUsername, smtpPassword, smtpSenderName, smtpSenderAddress, smtpEncryption])

  const sendTestEmail = useCallback(async () => {
    setTestEmailBusy(true)
    setTestEmailResult(null)
    try {
      await fetchJson<{ ok: boolean }>('/admin/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmailTo.trim().toLowerCase() }),
      })
      setTestEmailResult({ ok: true, message: 'Test email sent successfully.' })
    } catch (err) {
      setTestEmailResult({ ok: false, message: getErrorMessage(err) })
    } finally {
      setTestEmailBusy(false)
    }
  }, [testEmailTo])

  const smtpDirty = smtpHost !== smtpSaved.host || smtpPort !== smtpSaved.port || smtpUsername !== smtpSaved.username || smtpSenderName !== smtpSaved.senderName || smtpSenderAddress !== smtpSaved.senderAddress || smtpEncryption !== smtpSaved.encryption || smtpPassword !== ''
  const smtpAllFilled = smtpHost.trim() !== '' && smtpPort > 0 && smtpUsername.trim() !== '' && smtpSenderName.trim() !== '' && smtpSenderAddress.trim() !== '' && (smtpHasPassword || smtpPassword.trim() !== '')

  const loginProvidersDirty = loginProviders.some((p) => {
    const saved = loginProvidersSaved.find((item) => item.provider === p.provider)
    return !saved || p.enabled !== saved.enabled || p.clientId !== saved.clientId || p.clientSecret !== ''
  })

  const enabledLoginProviderCount = loginProviders.filter((p) => p.enabled).length

  const serverSettingsDirty = signupMode !== serverSettingsSaved.signupMode || guestSignupsEnabled !== serverSettingsSaved.guestSignupsEnabled || inviteExpiryHours !== serverSettingsSaved.inviteExpiryHours || passwordResetExpiryHours !== serverSettingsSaved.passwordResetExpiryHours || maxConcurrentJobs !== serverSettingsSaved.maxConcurrentJobs || defaultProjectLimitMode !== serverSettingsSaved.defaultProjectLimitMode || (defaultProjectLimitMode === 'on' && defaultProjectLimitValue !== serverSettingsSaved.defaultProjectLimitValue) || maxUploadMode !== serverSettingsSaved.maxUploadMode || (maxUploadMode === 'on' && maxUploadValue !== serverSettingsSaved.maxUploadValue) || maxTextMode !== serverSettingsSaved.maxTextMode || (maxTextMode === 'on' && maxTextValue !== serverSettingsSaved.maxTextValue) || maxFilesMode !== serverSettingsSaved.maxFilesMode || (maxFilesMode === 'on' && maxFilesValue !== serverSettingsSaved.maxFilesValue) || trashRetentionDays !== serverSettingsSaved.trashRetentionDays || largeFileThreshold !== serverSettingsSaved.largeFileThreshold || chatHistoryRetentionMode !== serverSettingsSaved.chatHistoryRetentionMode || (chatHistoryRetentionMode === 'on' && chatHistoryRetentionValue !== serverSettingsSaved.chatHistoryRetentionValue)

  const isSelfEditing = editingUser?.id === currentUserId

  const sectionRefs = useRef<Record<AdminSectionId, HTMLElement | null>>({
    users: null,
    server: null,
    invitations: null,
    email: null,
    'login-providers': null,
    monitoring: null,
  })

  useSectionObserver(sectionRefs, setActiveSection, {
    rootId: 'admin-main-scroll',
    getSectionId: (entry) => {
      const normalizedId = entry.target.id.replace('admin-section-', '')
      return normalizedId as AdminSectionId
    },
  })

  const scrollToSection = useCallback((sectionId: AdminSectionId) => {
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setSidebarDrawerOpen(false)
  }, [])

  const goToProjects = useCallback(() => {
    setSidebarDrawerOpen(false)
    navigateToProjects()
  }, [])

  const backToProjectsButton = (
    <BackToProjectsButton onClick={goToProjects} />
  )

  const sidebarContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 p-4">
        <div className="mb-4 text-xs uppercase tracking-wider text-cz-text-muted">Administration</div>
        <div className="relative ml-2 space-y-4 border-l border-cz-border pl-4">
          {adminSectionItems.map((item) => {
            const Icon = item.icon
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`relative flex items-center gap-2 text-sm ${active ? 'text-cz-text' : 'text-cz-text-muted hover:text-cz-text'}`}
              >
                <span
                  className={`absolute -left-[22px] h-2.5 w-2.5 rounded-full border ${active ? 'border-cz-accent bg-cz-accent' : 'border-cz-border bg-cz-surface'}`}
                />
                <Icon size={14} />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="border-t border-cz-border p-4">
        <button
          onClick={() => {
            setSidebarDrawerOpen(false)
            navigateToSettings()
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
        >
          <Settings size={14} />
          Settings
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-cz-bg text-cz-text">
      <SideDrawer
        open={sidebarDrawerOpen}
        onClose={() => setSidebarDrawerOpen(false)}
        ariaLabel="Administration navigation"
        title={backToProjectsButton}
      >
        {sidebarContent}
      </SideDrawer>

      <aside className="hidden w-72 flex-col border-r border-cz-border bg-cz-surface lg:flex">
        <div className="border-b border-cz-border p-4">
          {backToProjectsButton}
        </div>
        {sidebarContent}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileDrawerToolbar
          title="Administration"
          openLabel="Open administration navigation"
          onOpenDrawer={() => setSidebarDrawerOpen(true)}
        />

        <main id="admin-main-scroll" className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <section id="admin-section-users" ref={(node) => { sectionRefs.current.users = node }} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <Users size={14} /> User Management
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full max-w-md">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cz-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name or email"
                  className="w-full rounded-md border border-cz-border bg-cz-bg py-2 pl-9 pr-3 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 rounded-md bg-cz-accent px-3 py-2 text-sm text-white hover:bg-cz-accent-hover"
              >
                <UserPlus size={14} />
                Add User
              </button>
            </div>

            {usersError && <div className="mb-3 text-sm text-red-300">{usersError}</div>}

            <div className="overflow-x-auto rounded-xl border border-cz-border bg-cz-bg/40">
              <div className="inline-grid grid-cols-[minmax(80px,1.2fr)_minmax(100px,1.3fr)_minmax(70px,0.9fr)_minmax(80px,1fr)_minmax(120px,1.5fr)_minmax(120px,1.5fr)_minmax(60px,0.8fr)] gap-3 border-b border-cz-border px-3 py-2 text-xs uppercase tracking-wider text-cz-text-muted min-w-full">
                <div>Name</div>
                <div>Email</div>
                <div>Role</div>
                <div>Status</div>
                <div>Last Login</div>
                <div>Created</div>
                <div className="text-right">Actions</div>
              </div>

              {loadingUsers ? (
                <div className="px-3 py-4 text-sm text-cz-text-muted">Loading users...</div>
              ) : users.length === 0 ? (
                <div className="px-3 py-4 text-sm text-cz-text-muted">No users found.</div>
              ) : (
                users.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => beginEditUser(user)}
                    className="inline-grid grid-cols-[minmax(80px,1.2fr)_minmax(100px,1.3fr)_minmax(70px,0.9fr)_minmax(80px,1fr)_minmax(120px,1.5fr)_minmax(120px,1.5fr)_minmax(60px,0.8fr)] items-center gap-3 border-b border-cz-border px-3 py-3 text-sm last:border-b-0 hover:bg-cz-surface-hover min-w-full"
                  >
                    <div className="truncate text-left text-cz-text">
                      {user.displayName}
                      {user.id === currentUserId && (
                        <span className="ml-2 rounded-full border border-cz-border bg-cz-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cz-text-muted">
                          You
                        </span>
                      )}
                    </div>
                    <div className="truncate text-left text-cz-text-muted">{user.email}</div>
                    <div className="text-cz-text">{user.role === 'admin' ? 'Admin' : 'User'}</div>
                    <div className={user.status === 'active' ? 'text-emerald-300' : 'text-amber-300'}>{user.status}</div>
                    <div className="text-cz-text-muted">{user.lastLoginAt ? fmtTime(user.lastLoginAt) : 'Never'}</div>
                    <div className="text-cz-text-muted">{fmtTime(user.createdAt)}</div>
                    <div className="flex justify-end">
                      <ActionMenu
                        ariaLabel={`Actions for ${user.email}`}
                        items={[
                          {
                            id: 'reset',
                            label: 'Password Reset Link',
                            icon: KeyRound,
                            onSelect: () => {
                              void openResetModal(user)
                            },
                          },
                          {
                            id: 'delete',
                            label: 'Delete Account...',
                            icon: Trash2,
                            danger: true,
                            onSelect: () => {
                              setDeleteTarget(user)
                              setDeleteConfirmEmail('')
                              setDeleteError(null)
                            },
                          },
                        ]}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section id="admin-section-server" ref={(node) => { sectionRefs.current.server = node }} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Settings size={14} /> Server Settings
              </div>
              <button
                type="button"
                onClick={() => { void saveServerSettings() }}
                disabled={settingsBusy || !serverSettingsDirty}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs disabled:opacity-60 ${
                  serverSettingsDirty
                    ? 'border-transparent bg-cz-accent text-white hover:bg-cz-accent-hover'
                    : 'border-cz-border bg-cz-bg text-cz-text-muted'
                }`}
              >
                {!serverSettingsDirty && <Check size={12} />}
                {settingsBusy ? 'Applying...' : serverSettingsDirty ? 'Apply Settings' : 'Saved'}
              </button>
            </div>
            <div className="overflow-hidden rounded-md border border-cz-border bg-cz-bg/50">
              <div className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Signup mode</div>
                  <div className="text-xs text-cz-text-muted">Open signups lets anyone create an account. Invite only requires a valid invite link.</div>
                </div>
                <SegmentedControl
                  value={signupMode}
                  options={[
                    { value: 'open', label: 'Open' },
                    { value: 'invite-only', label: 'Invite-Only' },
                  ] as const}
                  onChange={setSignupMode}
                  ariaLabel="Signup mode"
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Guest access</div>
                  <div className="text-xs text-cz-text-muted">Allow new visitors to continue as guest. Existing guests keep access when disabled.</div>
                </div>
                <ToggleSwitch
                  checked={guestSignupsEnabled}
                  onChange={setGuestSignupsEnabled}
                  ariaLabel="Guest access"
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Invite link expiry (hours)</div>
                  <div className="text-xs text-cz-text-muted">Default expiry for newly generated invite links. Default: 72.</div>
                </div>
                <NumberStepper
                  value={inviteExpiryHours}
                  min={1}
                  max={8760}
                  suffix="h"
                  ariaLabel="Invite link expiry hours"
                  onChange={setInviteExpiryHours}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Default project limits</div>
                  <div className="text-xs text-cz-text-muted">Maximum projects a user can create. Can be overridden per-user. Applies to authenticated users only.</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {defaultProjectLimitMode === 'on' && (
                    <NumberStepper
                      value={defaultProjectLimitValue}
                      min={1}
                      max={10000}
                      ariaLabel="Default project limit"
                      onChange={setDefaultProjectLimitValue}
                    />
                  )}
                  <SegmentedControl
                    value={defaultProjectLimitMode}
                    options={['on', 'unlimited'] as const}
                    onChange={setDefaultProjectLimitMode}
                    ariaLabel="Default project limit mode"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Password reset token expiry (hours)</div>
                  <div className="text-xs text-cz-text-muted">Default is 24 hours. Range: 0.08 to 168 hours.</div>
                </div>
                <NumberStepper
                  value={passwordResetExpiryHours}
                  min={0.08}
                  max={168}
                  step={0.25}
                  suffix="h"
                  ariaLabel="Password reset expiry hours"
                  allowDecimals
                  onChange={setPasswordResetExpiryHours}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Maximum concurrent jobs per compiler</div>
                  <div className="text-xs text-cz-text-muted">How many compile jobs can run simultaneously on each compiler. Default: 3.</div>
                </div>
                <NumberStepper
                  value={maxConcurrentJobs}
                  min={1}
                  max={50}
                  ariaLabel="Maximum concurrent jobs"
                  onChange={setMaxConcurrentJobs}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Maximum upload file size (MB)</div>
                  <div className="text-xs text-cz-text-muted">Limit for individual uploaded asset files. Default: 50 MB.</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {maxUploadMode === 'on' && (
                    <NumberStepper
                      value={maxUploadValue}
                      min={1}
                      max={500}
                      suffix=" MB"
                      ariaLabel="Maximum upload file size MB"
                      onChange={setMaxUploadValue}
                    />
                  )}
                  <SegmentedControl
                    value={maxUploadMode}
                    options={['on', 'unlimited'] as const}
                    onChange={setMaxUploadMode}
                    ariaLabel="Upload file size limit mode"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Maximum text file size (MB)</div>
                  <div className="text-xs text-cz-text-muted">Limit for individual text files in the editor. Default: 5 MB.</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {maxTextMode === 'on' && (
                    <NumberStepper
                      value={maxTextValue}
                      min={1}
                      max={100}
                      suffix=" MB"
                      ariaLabel="Maximum text file size MB"
                      onChange={setMaxTextValue}
                    />
                  )}
                  <SegmentedControl
                    value={maxTextMode}
                    options={['on', 'unlimited'] as const}
                    onChange={setMaxTextMode}
                    ariaLabel="Text file size limit mode"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Maximum files per project</div>
                  <div className="text-xs text-cz-text-muted">Limit on total files (text + assets) in a project. Default: 200.</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {maxFilesMode === 'on' && (
                    <NumberStepper
                      value={maxFilesValue}
                      min={1}
                      max={10000}
                      ariaLabel="Maximum files per project"
                      onChange={setMaxFilesValue}
                    />
                  )}
                  <SegmentedControl
                    value={maxFilesMode}
                    options={['on', 'unlimited'] as const}
                    onChange={setMaxFilesMode}
                    ariaLabel="Files per project limit mode"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Trash retention (days)</div>
                  <div className="text-xs text-cz-text-muted">Deleted projects are permanently purged after this many days. Default: 30.</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <NumberStepper
                    value={trashRetentionDays}
                    min={1}
                    max={365}
                    ariaLabel="Trash retention days"
                    onChange={setTrashRetentionDays}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Large file mode threshold (K chars)</div>
                  <div className="text-xs text-cz-text-muted">Files above this character count open in lightweight mode with reduced editor features. Default: 500K.</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <NumberStepper
                    value={largeFileThreshold}
                    min={100}
                    max={5000}
                    step={100}
                    suffix="K"
                    ariaLabel="Large file mode threshold in thousands of characters"
                    onChange={setLargeFileThreshold}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-cz-text">Chat history retention (days)</div>
                  <div className="text-xs text-cz-text-muted">Controls how long project chat messages are kept. Choose unlimited to retain all chat history.</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {chatHistoryRetentionMode === 'on' && (
                    <NumberStepper
                      value={chatHistoryRetentionValue}
                      min={1}
                      max={3650}
                      suffix=" days"
                      ariaLabel="Chat history retention days"
                      onChange={setChatHistoryRetentionValue}
                    />
                  )}
                  <SegmentedControl
                    value={chatHistoryRetentionMode}
                    options={['on', 'unlimited'] as const}
                    onChange={setChatHistoryRetentionMode}
                    ariaLabel="Chat history retention mode"
                  />
                </div>
              </div>
            </div>
            {settingsError && <div className="mt-2 text-sm text-red-300">{settingsError}</div>}
          </section>

          <section id="admin-section-invitations" ref={(node) => { sectionRefs.current.invitations = node }} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <UserPlus size={14} /> Invitations
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="Restrict to email (optional)"
                className="min-w-0 w-1/4 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
              />
              <input
                ref={generatedInviteRef}
                value={generatedInviteUrl}
                readOnly
                placeholder="New invite links will appear here"
                className="min-w-0 flex-1 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text-muted"
              />
              {generatedInviteUrl && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(generatedInviteUrl)
                  }}
                  className="inline-flex items-center gap-1 shrink-0 rounded-md border border-cz-border px-3 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                >
                  <Copy size={14} />
                  Copy
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void createNewInvite()
                }}
                disabled={invitesBusy}
                className="inline-flex items-center gap-2 rounded-md bg-cz-accent px-3 py-2 text-sm text-white hover:bg-cz-accent-hover disabled:opacity-60"
              >
                <UserPlus size={14} />
                New Invite
              </button>
            </div>

            {invitesError && <div className="mb-3 text-sm text-red-300">{invitesError}</div>}

            <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-xl border border-cz-border bg-cz-bg/40">
              <div className="inline-grid grid-cols-[minmax(80px,1fr)_minmax(100px,1.3fr)_minmax(100px,1.3fr)_minmax(80px,1fr)_minmax(100px,1.3fr)_minmax(60px,0.8fr)] gap-3 border-b border-cz-border px-3 py-2 text-xs uppercase tracking-wider text-cz-text-muted min-w-full">
                <div>Token</div>
                <div>Created</div>
                <div>Expires</div>
                <div>Used</div>
                <div>Email</div>
                <div className="text-right">Actions</div>
              </div>
              {invites.length === 0 ? (
                <div className="px-3 py-4 text-sm text-cz-text-muted">No invite tokens.</div>
              ) : (
                invites.map((invite) => (
                  <div
                    key={invite.token}
                    className="inline-grid grid-cols-[minmax(80px,1fr)_minmax(100px,1.3fr)_minmax(100px,1.3fr)_minmax(80px,1fr)_minmax(100px,1.3fr)_minmax(60px,0.8fr)] items-center gap-3 border-b border-cz-border px-3 py-3 text-sm last:border-b-0 min-w-full"
                  >
                    <div className="truncate font-mono text-cz-text-muted">{invite.tokenPreview}</div>
                    <div className="text-cz-text-muted">{fmtTime(invite.createdAt)}</div>
                    <div className="text-cz-text-muted">{fmtTime(invite.expiresAt)}</div>
                    <div className="text-cz-text-muted">{invite.usedAt ? fmtTime(invite.usedAt) : 'Unused'}</div>
                    <div className="truncate text-cz-text-muted">{invite.email || '—'}</div>
                    <div className="flex justify-end gap-1">
                      {!invite.usedAt && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const url = `${window.location.origin}/invite?token=${encodeURIComponent(invite.token)}`
                              void navigator.clipboard.writeText(url)
                            }}
                            className="rounded-md border border-cz-border px-2 py-1 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void revokeInvite(invite.token)
                            }}
                            disabled={invitesBusy}
                            className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/15 disabled:opacity-60"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section id="admin-section-email" ref={(node) => { sectionRefs.current.email = node }} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Mail size={14} /> Email (SMTP)
              </div>
              <button
                type="button"
                onClick={() => { void saveSmtpSettings() }}
                disabled={smtpBusy || !smtpDirty}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs disabled:opacity-60 ${
                  smtpDirty
                    ? 'border-transparent bg-cz-accent text-white hover:bg-cz-accent-hover'
                    : 'border-cz-border bg-cz-bg text-cz-text-muted'
                }`}
              >
                {!smtpDirty && <Check size={12} />}
                {smtpBusy ? 'Applying...' : smtpDirty ? 'Apply Settings' : 'Saved'}
              </button>
            </div>

            <div className="overflow-hidden rounded-md border border-cz-border bg-cz-bg/50">
              {/* Host + Port */}
              <div className="flex items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-cz-text">Host</div>
                  <div className="text-xs text-cz-text-muted">SMTP server hostname</div>
                </div>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.example.com"
                  className="w-42 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
                <NumberStepper
                  value={smtpPort}
                  min={1}
                  max={65535}
                  ariaLabel="SMTP port"
                  onChange={setSmtpPort}
                />
              </div>

              {/* Encryption */}
              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-cz-text">Encryption</div>
                  <div className="text-xs text-cz-text-muted">
                    It is recommended to use the best encryption method supported by your SMTP server.{' '}
                    <strong>STARTTLS</strong> (e.g., port 587) upgrades to TLS after connecting.{' '}
                    <strong>TLS/SSL</strong> (e.g., port 465) is encrypted from the start.
                  </div>
                </div>
                <IconDropdown value={smtpEncryption} options={encryptionOptions} onChange={setSmtpEncryption} />
              </div>

              {/* Username */}
              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-cz-text">Username</div>
                  <div className="text-xs text-cz-text-muted">Authentication username (often your email)</div>
                </div>
                <input
                  type="text"
                  value={smtpUsername}
                  onChange={(e) => setSmtpUsername(e.target.value)}
                  placeholder="user@example.com"
                  className="w-69 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
              </div>

              {/* Password */}
              <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-cz-text">Password</div>
                  <div className="text-xs text-cz-text-muted">
                    {smtpHasPassword ? 'A password is saved. Leave blank to keep it unchanged.' : 'No password set.'}
                  </div>
                </div>
                <div className="relative shrink-0">
                  <input
                    type={smtpShowPassword ? 'text' : 'password'}
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                    placeholder={smtpHasPassword ? '••••••••' : 'Enter password'}
                    className="w-69 rounded-md border border-cz-border bg-cz-bg px-3 py-2 pr-9 text-sm text-cz-text outline-none focus:border-cz-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setSmtpShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-cz-text-muted hover:text-cz-text"
                    tabIndex={-1}
                  >
                    {smtpShowPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Sender Name + Sender Address */}
              <div className="flex items-center gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-cz-text">Sender Name &amp; Address</div>
                  <div className="text-xs text-cz-text-muted">Display name for outgoing emails</div>
                </div>
                <input
                  type="text"
                  value={smtpSenderName}
                  onChange={(e) => setSmtpSenderName(e.target.value)}
                  placeholder="Composure"
                  className="w-28 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
                <input
                  type="text"
                  value={smtpSenderAddress}
                  onChange={(e) => setSmtpSenderAddress(e.target.value)}
                  placeholder="noreply@example.com"
                  className="w-48 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
              </div>

              {/* Test Email */}
              <div className="flex items-center gap-3 border-t border-cz-border px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-cz-text">Test Email</div>
                  <div className="text-xs text-cz-text-muted">Once you've saved your settings, you can send a test email.</div>
                </div>
                <input
                  type="text"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-48 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                />
                <button
                  type="button"
                  onClick={() => { void sendTestEmail() }}
                  disabled={testEmailBusy || !testEmailTo.trim() || smtpDirty || !smtpAllFilled}
                  className="inline-flex shrink-0 items-center gap-2 rounded-md bg-cz-accent px-3 py-2 text-sm text-white hover:bg-cz-accent-hover disabled:opacity-60"
                >
                  <Send size={14} />
                  {testEmailBusy ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>

            {smtpError && <div className="mt-2 text-sm text-red-300">{smtpError}</div>}
            {testEmailResult && (
              <div className={`mt-2 text-sm ${testEmailResult.ok ? 'text-green-400' : 'text-red-300'}`}>
                {testEmailResult.message}
              </div>
            )}
          </section>

          <section id="admin-section-login-providers" ref={(node) => { sectionRefs.current['login-providers'] = node }} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound size={14} /> Login Providers
              </div>
              <button
                type="button"
                onClick={() => { void saveLoginProviders() }}
                disabled={loginProvidersBusy || !loginProvidersDirty}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs disabled:opacity-60 ${
                  loginProvidersDirty
                    ? 'border-transparent bg-cz-accent text-white hover:bg-cz-accent-hover'
                    : 'border-cz-border bg-cz-bg text-cz-text-muted'
                }`}
              >
                {!loginProvidersDirty && <Check size={12} />}
                {loginProvidersBusy ? 'Applying...' : loginProvidersDirty ? 'Apply Settings' : 'Saved'}
              </button>
            </div>

            {/* Callback URL */}
            <div className="mb-4">
              <label className="mb-1 block text-xs text-cz-text-muted">Callback URL (configure this in each provider)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={new URL(apiUrl('/auth/via/{provider}/callback'), window.location.origin).href}
                  className="flex-1 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text-muted outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(new URL(apiUrl('/auth/via/{provider}/callback'), window.location.origin).href)
                    setCallbackCopied(true)
                    setTimeout(() => setCallbackCopied(false), 2000)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cz-border bg-cz-bg px-2.5 py-2 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                >
                  {callbackCopied ? <Check size={14} /> : <Copy size={14} />}
                  {callbackCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border border-cz-border bg-cz-bg/50">
              {loginProviders.map((p, idx) => {
                const testStatus = providerTestResults[p.provider] ?? 'idle'
                const testError = providerTestErrors[p.provider]
                const isPasswordProvider = p.provider === 'password'
                const canTest = !isPasswordProvider && p.enabled && p.clientId.trim() !== '' && (p.clientSecret.trim() !== '' || p.hasCredentials)
                const toggleDisabled = loginProvidersBusy || (p.enabled && enabledLoginProviderCount <= 1)
                const providerLabel = loginProviderLabels[p.provider] ?? p.provider
                return (
                  <div key={p.provider} className={`${idx === 0 ? '' : 'border-t border-cz-border'} px-3 py-3`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-cz-text">{providerLabel}</div>
                        <div className="text-xs text-cz-text-muted">
                          {isPasswordProvider
                            ? 'Email and password login for local accounts.'
                            : p.provider === 'github'
                              ? 'GitHub OAuth App'
                              : p.provider === 'google'
                                ? 'Google OAuth 2.0'
                                : p.provider === 'orcid'
                                  ? 'ORCID OpenID Connect'
                                : `${p.provider} OAuth`}
                        </div>
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
                    {!isPasswordProvider && p.enabled && (
                      <div className="mt-3 space-y-2">
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
                              className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
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
                              className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
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
                            className="inline-flex items-center gap-1.5 rounded-md border border-cz-border bg-cz-bg px-2.5 py-1.5 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-60"
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
                      className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                    />
                  </div>
                )}
              </div>
            )}
          </PopupDialog>

          <section id="admin-section-monitoring" ref={(node) => { sectionRefs.current.monitoring = node }} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Monitor size={14} /> Monitoring
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  healthStatus === 'healthy' ? 'bg-green-500/20 text-green-400' :
                  healthStatus === 'degraded' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                    healthStatus === 'healthy' ? 'bg-green-400' :
                    healthStatus === 'degraded' ? 'bg-yellow-400' :
                    'bg-red-400'
                  }`} />
                  {healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'degraded' ? 'Degraded' : 'Stalled'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <SegmentedControl
                  value={jobsTimeframe}
                  options={jobTimeframeOptions}
                  onChange={(next) => {
                    setJobsTimeframe(next)
                  }}
                  ariaLabel="Monitoring timeframe"
                />
                <button
                  type="button"
                  onClick={() => { void loadMonitoringData(jobsTimeframe) }}
                  disabled={monitoringBusy}
                  className="inline-flex items-center gap-2 rounded-md border border-cz-border bg-cz-bg px-3 py-1.5 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-60"
                >
                  <RefreshCw size={14} className={monitoringBusy ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>
            </div>

            {monitoringError && <div className="mb-3 text-sm text-red-300">{monitoringError}</div>}

            {/* Summary Cards */}
            {jobSummary && (
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
                  <div className="text-xs text-cz-text-muted">Active / Queued</div>
                  <div className="mt-1 text-lg font-semibold text-cz-text">
                    {jobSummary.runningCount}{' / '}{jobSummary.waitingCount}
                  </div>
                </div>
                <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
                  <div className="text-xs text-cz-text-muted">Last Completed</div>
                  <div className="mt-1 text-sm text-cz-text">
                    {jobSummary.lastCompletedAt ? fmtRelativeTime(jobSummary.lastCompletedAt) : 'None'}
                  </div>
                </div>
                <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
                  <div className="text-xs text-cz-text-muted">Last Failed</div>
                  <div className="mt-1 text-sm text-cz-text">
                    {jobSummary.lastFailedJob ? (
                      <span>
                        <span className="text-red-300">{jobSummary.lastFailedJob.type}</span>{' '}
                        <span className="text-cz-text-muted">{fmtRelativeTime(jobSummary.lastFailedJob.finishedAt)}</span>
                        {jobSummary.lastFailedJob.error && (
                          <div className="mt-0.5 truncate text-xs text-red-300/80">{jobSummary.lastFailedJob.error}</div>
                        )}
                      </span>
                    ) : 'None'}
                  </div>
                </div>
                <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
                  <div className="text-xs text-cz-text-muted">Last {jobTimeframeOptions.find((o) => o.value === jobsTimeframe)?.label ?? '24h'}</div>
                  <div className="mt-1 text-sm text-cz-text">
                    <span className="text-green-400">{jobSummary.totalDone} done</span>
                    {' / '}
                    <span className="text-red-300">{jobSummary.totalFailed} failed</span>
                    {jobSummary.totalInvalid > 0 && (
                      <>
                        {' / '}
                        <span className="text-yellow-400">{jobSummary.totalInvalid} invalid</span>
                      </>
                    )}
                    {jobSummary.totalStalled > 0 && (
                      <>
                        {' / '}
                        <span className="text-orange-400">{jobSummary.totalStalled} stalled</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Jobs table */}
            <div className="text-xs font-medium text-cz-text mb-2">Jobs</div>
            <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-xl border border-cz-border bg-cz-bg/40">
              <div className="inline-grid grid-cols-[minmax(80px,1fr)_minmax(80px,1fr)_minmax(70px,0.8fr)_minmax(60px,0.7fr)_minmax(90px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)] gap-3 border-b border-cz-border px-3 py-2 text-xs uppercase tracking-wider text-cz-text-muted min-w-full">
                <span>User</span>
                <span>Project</span>
                <span>Type</span>
                <span>Status</span>
                <span>Created</span>
                <span>Started</span>
                <span>Finished</span>
              </div>
              {recentJobs.length === 0 ? (
                <div className="px-3 py-4 text-sm text-cz-text-muted">No jobs in this timeframe.</div>
              ) : (
                recentJobs.map((job) => (
                  <div
                    key={job.id}
                    className="inline-grid grid-cols-[minmax(80px,1fr)_minmax(80px,1fr)_minmax(70px,0.8fr)_minmax(60px,0.7fr)_minmax(90px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)] gap-3 border-b border-cz-border px-3 py-2 text-sm text-cz-text min-w-full last:border-b-0"
                  >
                    <span className="truncate text-xs" title={job.userEmail ?? job.userId ?? 'unknown'}>
                      {job.userDisplayName ?? job.userEmail ?? (job.userId ? `User ${job.userId.slice(0, 8)}` : '—')}
                    </span>
                    <span className="truncate text-xs" title={job.projectId ?? undefined}>
                      {job.projectTitle ?? (job.projectId ? `${job.projectId.slice(0, 8)}…` : '—')}
                    </span>
                    <span className="text-xs">{job.type}</span>
                    <span className={`text-xs font-medium ${
                      job.status === 'done' ? 'text-green-400' :
                      job.status === 'failed' ? 'text-red-300' :
                      job.status === 'running' ? 'text-blue-400' :
                      job.status === 'invalid' ? 'text-yellow-400' :
                      job.status === 'stalled' ? 'text-orange-400' :
                      job.status === 'waiting' ? 'text-sky-300' :
                      'text-cz-text-muted'
                    }`}>
                      {job.status}
                      {job.status === 'failed' && job.error && (
                        <span className="block truncate font-normal text-red-300/70" title={job.error}>{job.error}</span>
                      )}
                      {job.status === 'invalid' && job.error && (
                        <span className="block truncate font-normal text-yellow-400/70" title={job.error}>{job.error}</span>
                      )}
                      {job.status === 'stalled' && job.error && (
                        <span className="block truncate font-normal text-orange-400/70" title={job.error}>{job.error}</span>
                      )}
                    </span>
                    <span className="text-xs text-cz-text-muted">{fmtTime(job.createdAt)}</span>
                    <span className="text-xs text-cz-text-muted">{job.startedAt ? fmtTime(job.startedAt) : '—'}</span>
                    <span className="text-xs text-cz-text-muted">{job.finishedAt ? fmtTime(job.finishedAt) : '—'}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
        </main>
      </div>

      <UserFormModal
        mode='create'
        open={showCreateModal}
        busy={createBusy}
        error={createError}
        roleOptions={roleOptions}
        defaultProjectLimitMode={defaultProjectLimitMode}
        defaultProjectLimitValue={defaultProjectLimitValue}
        email={createEmail}
        displayName={createDisplayName}
        password={createPassword}
        role={createRole}
        maxProjectsMode={createMaxProjectsMode}
        maxProjectsValue={createMaxProjectsValue}
        onEmailChange={setCreateEmail}
        onDisplayNameChange={setCreateDisplayName}
        onPasswordChange={setCreatePassword}
        onRoleChange={setCreateRole}
        onMaxProjectsModeChange={setCreateMaxProjectsMode}
        onMaxProjectsValueChange={setCreateMaxProjectsValue}
        onClose={() => {
          setShowCreateModal(false)
          setCreateError(null)
        }}
        onSubmit={() => {
          void submitCreateUser()
        }}
      />

      <UserFormModal
        mode='edit'
        open={editingUser != null}
        busy={editBusy}
        error={editError}
        roleOptions={roleOptions}
        defaultProjectLimitMode={defaultProjectLimitMode}
        defaultProjectLimitValue={defaultProjectLimitValue}
        user={editingUser ? { displayName: editingUser.displayName, email: editingUser.email } : null}
        isSelfEditing={isSelfEditing}
        displayName={editDisplayName}
        role={editRole}
        suspended={editSuspended}
        maxProjectsMode={editMaxProjectsMode}
        maxProjectsValue={editMaxProjectsValue}
        newPassword={editNewPassword}
        confirmPassword={editConfirmPassword}
        onDisplayNameChange={setEditDisplayName}
        onRoleChange={setEditRole}
        onSuspendedChange={setEditSuspended}
        onMaxProjectsModeChange={setEditMaxProjectsMode}
        onMaxProjectsValueChange={setEditMaxProjectsValue}
        onNewPasswordChange={setEditNewPassword}
        onConfirmPasswordChange={setEditConfirmPassword}
        onClose={() => {
          setEditingUser(null)
          setEditError(null)
        }}
        onSubmit={() => {
          void submitEditUser()
        }}
      />

      <PopupDialog
        open={resetTarget != null}
        title={resetTarget ? `Password Reset Link for ${resetTarget.displayName}` : 'Password Reset Link'}
        message={`Share this single-use link with ${resetTarget?.displayName || 'the user'} securely.`}
        panelWidth="3xl"
        dismiss={{
          label: 'Close',
          onClick: () => {
            if (resetBusy) return
            setResetTarget(null)
            setGeneratedResetUrl('')
            setExistingResetLinks([])
            setResetError(null)
          },
          disabled: resetBusy,
        }}
        actions={[]}
      >
        <div className="space-y-4">
          {resetBusy ? (
            <div className="text-sm text-cz-text-muted">Generating password reset link...</div>
          ) : resetError ? (
            <div className="text-sm text-red-300">{resetError}</div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  value={generatedResetUrl}
                  readOnly
                  className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text-muted"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(generatedResetUrl)
                  }}
                  className="shrink-0 rounded-md border border-cz-border px-3 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                >
                  Copy link
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto overflow-x-hidden rounded-md border border-cz-border">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1.35fr)] gap-2 border-b border-cz-border bg-cz-surface px-3 py-2 text-[11px] uppercase tracking-wider text-cz-text-muted">
                  <div>Token</div>
                  <div>Created</div>
                  <div>Used</div>
                  <div className="text-right">Actions</div>
                </div>
                {existingResetLinks.length === 0 && (
                  <div className="px-3 py-3 text-xs text-cz-text-muted">No links yet.</div>
                )}
                {existingResetLinks.map((link) => {
                  const now = Math.floor(Date.now() / 1000)
                  const autoExpired = link.expiresAt <= now
                  const isExpireable = link.usedAt == null && link.expiredEarlyAt == null && !autoExpired
                  return (
                    <div
                      key={link.token}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1.35fr)] items-center gap-2 border-b border-cz-border px-3 py-2 text-xs last:border-b-0"
                    >
                      <div className="truncate font-mono text-cz-text-muted">{link.tokenPreview}</div>
                      <div className="text-cz-text-muted">{fmtTime(link.createdAt)}</div>
                      <div className="text-cz-text-muted">{link.usedAt ? fmtTime(link.usedAt) : 'Unused'}</div>
                      <div className="text-right">
                        {isExpireable ? (
                          <button
                            type="button"
                            onClick={() => {
                              void expireResetLink(link.token)
                            }}
                            className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/15"
                          >
                            Expire
                          </button>
                        ) : link.expiredEarlyAt != null ? (
                          <span className="text-cz-text-muted">{fmtTime(link.expiredEarlyAt)}</span>
                        ) : autoExpired ? (
                          <span className="text-cz-text-muted">{fmtTime(link.expiresAt)}</span>
                        ) : (
                          <span className="text-cz-text-muted">Used</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </PopupDialog>

      <PopupDialog
        open={deleteTarget != null}
        title={deleteTarget ? `Delete ${deleteTarget.displayName}` : 'Delete User'}
        message="Type the account email to permanently delete this user."
        dismiss={{
          label: 'Cancel',
          onClick: () => {
            if (deleteBusy) return
            setDeleteTarget(null)
            setDeleteConfirmEmail('')
            setDeleteError(null)
          },
          disabled: deleteBusy,
        }}
        actions={[
          {
            label: deleteBusy ? 'Deleting...' : 'Delete account',
            variant: 'danger',
            onClick: () => {
              void deleteSelectedUser()
            },
            disabled: deleteBusy || !deleteTarget,
          },
        ]}
      >
        <div className="space-y-3">
          {deleteTarget && (
            <div className="text-xs text-cz-text-muted">
              Confirm email: <span className="text-cz-text">{deleteTarget.email}</span>
            </div>
          )}
          <input
            value={deleteConfirmEmail}
            onChange={(event) => setDeleteConfirmEmail(event.target.value)}
            className="w-full rounded-md border border-red-500/40 bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none"
            placeholder="Enter email to confirm"
          />
          {deleteError && <div className="text-sm text-red-300">{deleteError}</div>}
        </div>
      </PopupDialog>
    </div>
  )
}
