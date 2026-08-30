import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound, Search, Trash2, UserPlus, Users } from 'lucide-react'
import { ActionMenu } from '@/components/ActionMenu'
import { PopupDialog } from '@/components/PopupDialog'
import { UserFormModal } from '../UserFormModal'
import { fetchJson, getErrorMessage } from '@/utils/fetch'
import { fmtTime } from '@/utils/format-time'
import { roleOptions, type AdminUser, type RoleOption } from './admin-types'
import { validatePassword } from '@/utils/password'

interface PasswordResetLinkRecord {
  token: string
  tokenPreview: string
  createdAt: number
  expiresAt: number
  usedAt: number | null
  expiredEarlyAt: number | null
}

interface UserManagementSectionProps {
  currentUserId: string
  onForceLogin: (message?: string) => void
  defaultProjectLimitMode: 'on' | 'unlimited'
  defaultProjectLimitValue: number
  sectionRef: (node: HTMLElement | null) => void
}

export function UserManagementSection({
  currentUserId,
  onForceLogin,
  defaultProjectLimitMode,
  defaultProjectLimitValue,
  sectionRef,
}: UserManagementSectionProps) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)

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
  // Captured when links are (re)fetched so expiry labels render purely.
  const [resetLinksNowSec, setResetLinksNowSec] = useState(0)

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')

  const loadUsersSeqRef = useRef(0)
  const loadUsers = useCallback(async (search: string) => {
    // Sequence guard: the debounce doesn't cancel in-flight requests, so a
    // slow older response must not overwrite a newer one.
    const seq = ++loadUsersSeqRef.current
    setLoadingUsers(true)
    setUsersError(null)
    try {
      const response = await fetchJson<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(search)}`)
      if (seq !== loadUsersSeqRef.current) return
      setUsers(response.users)
    } catch (err) {
      if (seq !== loadUsersSeqRef.current) return
      setUsersError(getErrorMessage(err))
      setUsers([])
    } finally {
      if (seq === loadUsersSeqRef.current) {
        setLoadingUsers(false)
      }
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
      setResetLinksNowSec(Math.floor(Date.now() / 1000))
    } catch (err) {
      setResetError(getErrorMessage(err))
    } finally {
      setResetBusy(false)
    }
  }, [])

  const refreshResetLinks = useCallback(async (userId: string) => {
    const linksResponse = await fetchJson<{ links: PasswordResetLinkRecord[] }>(`/admin/users/${userId}/password-reset-links`)
    setExistingResetLinks(linksResponse.links)
    setResetLinksNowSec(Math.floor(Date.now() / 1000))
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

  const isSelfEditing = editingUser?.id === currentUserId

  return (
    <>
      <section id="admin-section-users" ref={sectionRef} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
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
              className="h-8 w-full rounded-md border border-cz-border bg-cz-bg pl-9 pr-3 text-sm text-cz-text outline-none focus:border-cz-accent"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-cz-accent px-3 text-sm text-white hover:bg-cz-accent-hover"
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
                  const autoExpired = link.expiresAt <= resetLinksNowSec
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
    </>
  )
}
