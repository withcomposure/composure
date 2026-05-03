import { Avatar } from '@/components/Avatar'
import { X } from 'lucide-react'
import { Eye, MessageSquare, Pencil, RefreshCw, Trash2, type LucideIcon } from 'lucide-react'
import { ToggleSwitch } from '@/components/ToggleSwitch'
import { CustomDropdown } from '@/components/CustomDropdown'
import type { AccessPerson, ShareRole } from '@/types'

interface ShareModalProps {
  open: boolean
  inviteEmail: string
  inviteRole: ShareRole
  inviting: boolean
  linkEnabled: boolean
  linkRole: ShareRole
  people: AccessPerson[]
  canManage: boolean
  shareUrl: string
  onClose: () => void
  onInviteEmailChange: (email: string) => void
  onInviteRoleChange: (role: ShareRole) => void
  onInvite: () => void
  onMemberRoleChange: (userId: string, role: ShareRole | 'remove') => void
  onLinkToggle: (enabled: boolean) => void
  onLinkRoleChange: (role: ShareRole) => void
  onLinkInvalidate: () => void
}

function roleLabel(role: ShareRole | 'owner'): string {
  if (role === 'comment') return 'Can comment'
  if (role === 'edit') return 'Can edit'
  if (role === 'owner') return 'Owner'
  return 'Can view'
}

const shareRoleDropdownOptions: Array<{ value: ShareRole; label: string; icon: LucideIcon }> = [
  { value: 'view', label: 'Can view', icon: Eye },
  { value: 'comment', label: 'Can comment', icon: MessageSquare },
  { value: 'edit', label: 'Can edit', icon: Pencil },
]

const memberRoleDropdownOptions: Array<{ value: ShareRole | 'remove'; label: string; icon: LucideIcon }> = [
  ...shareRoleDropdownOptions,
  { value: 'remove', label: 'Revoke access', icon: Trash2 },
]

export function ShareModal({
  open,
  inviteEmail,
  inviteRole,
  inviting,
  linkEnabled,
  linkRole,
  people,
  canManage,
  shareUrl,
  onClose,
  onInviteEmailChange,
  onInviteRoleChange,
  onInvite,
  onMemberRoleChange,
  onLinkToggle,
  onLinkRoleChange,
  onLinkInvalidate,
}: ShareModalProps) {
  if (!open) return null

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-cz-border bg-cz-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-cz-border px-5 py-4">
          <h2 className="text-base font-semibold text-cz-text">Share Project</h2>
          <button
            onClick={onClose}
            aria-label="Close share modal"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          <section className="rounded-lg border border-cz-border bg-cz-bg/60 p-4">
            <div className="mb-2 text-xs uppercase tracking-wider text-cz-text-muted">Invite by Email</div>
            <div className="flex flex-wrap gap-2">
              <input
                value={inviteEmail}
                onChange={(e) => onInviteEmailChange(e.target.value)}
                disabled={!canManage || inviting}
                placeholder="person@example.com"
                className="min-w-[200px] flex-1 rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-xs text-cz-text outline-none focus:border-cz-accent disabled:opacity-60"
              />
              <CustomDropdown
                value={inviteRole}
                options={shareRoleDropdownOptions}
                onChange={onInviteRoleChange}
                className={!canManage || inviting ? 'pointer-events-none opacity-60' : ''}
              />
              <button
                onClick={onInvite}
                disabled={!canManage || inviting || inviteEmail.trim().length === 0}
                className="rounded-md bg-cz-accent px-3 py-2 text-xs font-medium text-white hover:bg-cz-accent-hover disabled:opacity-60"
              >
                {inviting ? 'Inviting...' : 'Invite'}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-cz-border bg-cz-bg/60 p-4">
            <div className="mb-3 text-xs uppercase tracking-wider text-cz-text-muted">People with Access</div>
            <div className="space-y-2">
              {people.map((person, index) => (
                <div
                  key={`${person.userId ?? person.email ?? person.displayName}-${person.status}-${index}`}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-md border border-cz-border-subtle bg-cz-surface px-3 py-2"
                >
                  <Avatar name={person.displayName} imageUrl={person.profileImageUrl} isGuest={!person.userId} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-cz-text">{person.displayName}</div>
                    {person.email && <div className="truncate text-xs text-cz-text-muted">{person.email}</div>}
                  </div>
                  <div className="text-xs text-cz-text-muted">{person.status === 'pending' ? 'Pending' : ''}</div>
                  {person.isOwner ? (
                    <span className="rounded-full border border-cz-border px-2 py-1 text-xs text-cz-text">Owner</span>
                  ) : person.userId && canManage ? (
                    <CustomDropdown
                      value={person.role as ShareRole}
                      options={memberRoleDropdownOptions}
                      onChange={(value) => onMemberRoleChange(person.userId as string, value)}
                    />
                  ) : (
                    <span className="text-xs text-cz-text-muted">{roleLabel(person.role)}</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-cz-border bg-cz-bg/60 p-4">
            <div className="mb-3 text-xs uppercase tracking-wider text-cz-text-muted">Link Sharing</div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-cz-text-muted">Anyone with this link can</span>
              <CustomDropdown
                value={linkRole}
                options={shareRoleDropdownOptions}
                onChange={onLinkRoleChange}
                className={!canManage || !linkEnabled ? 'pointer-events-none opacity-60' : ''}
              />
              <div className="ml-auto inline-flex items-center">
                <ToggleSwitch
                  checked={linkEnabled}
                  disabled={!canManage}
                  onChange={onLinkToggle}
                  ariaLabel="Toggle link sharing"
                />
              </div>
            </div>

            {linkEnabled && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  aria-label="Share link"
                  value={shareUrl}
                  className="min-w-[200px] flex-1 rounded-md border border-cz-border bg-cz-surface px-3 py-2 text-xs text-cz-text-muted outline-none"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                  className="rounded-md border border-cz-border px-3 py-2 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                >
                  Copy link
                </button>
                {canManage && (
                  <button
                    onClick={onLinkInvalidate}
                    className="rounded-md border border-cz-border px-3 py-2 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                    title="Generate a new link, invalidating the previous one"
                  >
                    <RefreshCw size={12} className="mr-1 inline" />
                    Rotate
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
