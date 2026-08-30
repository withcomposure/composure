import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, UserPlus } from 'lucide-react'
import { fetchJson, getErrorMessage } from '@/utils/fetch'
import { fmtTime } from '@/utils/format-time'

interface InviteTokenRecord {
  token: string
  tokenPreview: string
  createdAt: number
  expiresAt: number
  email: string | null
  usedAt: number | null
}

interface InvitationsSectionProps {
  sectionRef: (node: HTMLElement | null) => void
}

export function InvitationsSection({ sectionRef }: InvitationsSectionProps) {
  const [invites, setInvites] = useState<InviteTokenRecord[]>([])
  const [invitesBusy, setInvitesBusy] = useState(false)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const generatedInviteRef = useRef<HTMLInputElement | null>(null)

  const loadInvites = useCallback(() => {
    return fetchJson<{ invites: InviteTokenRecord[] }>('/admin/invites')
      .then((response) => {
        setInvites(response.invites)
      })
      .catch((err: unknown) => {
        setInvitesError(getErrorMessage(err))
      })
  }, [])

  useEffect(() => {
    void loadInvites()
  }, [loadInvites])

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

  return (
    <section id="admin-section-invitations" ref={sectionRef} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium">
        <UserPlus size={14} /> Invitations
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={inviteEmail}
          onChange={(event) => setInviteEmail(event.target.value)}
          placeholder="Restrict to email (optional)"
          className="h-8 min-w-0 w-1/4 rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
        />
        <input
          ref={generatedInviteRef}
          value={generatedInviteUrl}
          readOnly
          placeholder="New invite links will appear here"
          className="h-8 min-w-0 flex-1 rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text-muted"
        />
        {generatedInviteUrl && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(generatedInviteUrl)
            }}
            className="inline-flex h-8 items-center gap-1 shrink-0 rounded-md border border-cz-border px-3 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
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
          className="inline-flex h-8 items-center gap-2 rounded-md bg-cz-accent px-3 text-sm text-white hover:bg-cz-accent-hover disabled:opacity-60"
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
  )
}
