import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OnUserFollowedPayload, SocketId } from '@excalidraw/excalidraw/types'
import type { AccessPerson, SessionUser, ShareRole } from '@/types'
import { apiFetch, getErrorMessage } from '@/utils/fetch'
import { makeProjectUrl } from '@/utils/route'
import { ShareModal } from '@/workspace/ShareModal'
import { WhiteboardCanvas } from './WhiteboardCanvas'
import {
  exportWhiteboardAsPng,
  exportWhiteboardAsSvg,
  WhiteboardToolbar,
} from './WhiteboardToolbar'
import { useWhiteboardCollab } from './useWhiteboardCollab'

interface WhiteboardWorkspaceProps {
  projectId: string
  projectTitle: string
  rootFile: string
  onBackToProjects: () => void
  onRenameProject?: (nextTitle: string) => Promise<void>
  session: {
    accountLabel: string
    accountEmail: string | null
    accountImageUrl: string | null
    accountIsGuest: boolean
    user: SessionUser | null
    principal: {
      userId: string | null
      guestId: string | null
    }
  }
  shareToken?: string
  onPopupAlert: (message: string, title?: string) => void
  onOpenSettings: () => void
  onLogout: () => void
  onLogin: () => void
}

function normalizeWhiteboardShareRole(role: ShareRole): ShareRole {
  return role === 'edit' ? 'edit' : 'view'
}

export function WhiteboardWorkspace({
  projectId,
  projectTitle,
  rootFile,
  onBackToProjects,
  onRenameProject,
  session,
  shareToken,
  onPopupAlert,
  onOpenSettings,
  onLogout,
  onLogin,
}: WhiteboardWorkspaceProps) {
  const {
    accountLabel,
    accountEmail,
    accountImageUrl,
    accountIsGuest,
    user: sessionUser,
    principal,
  } = session

  const [showShareModal, setShowShareModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ShareRole>('view')
  const [inviting, setInviting] = useState(false)
  const [peopleWithAccess, setPeopleWithAccess] = useState<AccessPerson[]>([])
  const [linkEnabled, setLinkEnabled] = useState(false)
  const [linkRole, setLinkRole] = useState<ShareRole>('view')
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [accessRole, setAccessRole] = useState<ShareRole | 'owner' | null>(null)
  const [editModeEnabled, setEditModeEnabled] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [followedSocketId, setFollowedSocketId] = useState<SocketId | null>(null)

  const shareHeaders = useMemo<Record<string, string>>(
    () =>
      shareToken
        ? { 'X-Share-Token': shareToken }
        : ({} as Record<string, string>),
    [shareToken],
  )

  const canRoleEdit = accessRole === 'owner' || accessRole === 'edit'
  const canWrite = canRoleEdit && editModeEnabled
  const canManageAccess = accessRole === 'owner' && Boolean(sessionUser?.id)

  useEffect(() => {
    setEditModeEnabled(canRoleEdit)
  }, [canRoleEdit, projectId])

  const {
    connectionState,
    collaborators,
    activeCollaborators,
    isCollaborating,
    excalidrawApi,
    setExcalidrawApi,
    handleSceneChange,
    handlePointerUpdate,
  } = useWhiteboardCollab({
    projectId,
    shareToken,
    rootFile,
    canWrite,
    localUser: {
      name: accountLabel,
      userId: principal.userId,
      guestId: principal.guestId,
      profileImageUrl: session.user?.profileImageUrl ?? null,
    },
  })

  const loadAccess = useCallback(async () => {
    try {
      const response = await apiFetch(`/projects/${projectId}/access`, {
        headers: shareHeaders,
      })

      if (!response.ok) {
        throw new Error('Failed to load project access')
      }

      const body = (await response.json()) as {
        people: AccessPerson[]
        linkSharing: {
          enabled: boolean
          role: ShareRole | null
          token: string | null
        }
        currentRole: ShareRole | 'owner' | null
      }

      setPeopleWithAccess(body.people)
      setLinkEnabled(body.linkSharing.enabled)
      setLinkRole(body.linkSharing.role ? normalizeWhiteboardShareRole(body.linkSharing.role) : 'view')
      setLinkToken(body.linkSharing.token)
      setAccessRole(body.currentRole)
    } catch (error) {
      console.warn(`[whiteboard] load-access-failed ${String(error)}`)
    }
  }, [projectId, shareHeaders])

  useEffect(() => {
    void loadAccess()
  }, [loadAccess])

  const inviteMember = useCallback(async () => {
    const email = inviteEmail.trim()
    if (!email) {
      return
    }

    setInviting(true)
    try {
      const response = await apiFetch(`/projects/${projectId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...shareHeaders,
        },
        body: JSON.stringify({
          email,
          role: normalizeWhiteboardShareRole(inviteRole),
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Invite failed' })) as { error?: string }
        throw new Error(String(body.error ?? 'Invite failed'))
      }

      setInviteEmail('')
      await loadAccess()
    } catch (error) {
      onPopupAlert(getErrorMessage(error), 'Invite failed')
    } finally {
      setInviting(false)
    }
  }, [inviteEmail, inviteRole, loadAccess, onPopupAlert, projectId, shareHeaders])

  const updateMemberRole = useCallback(async (userId: string, role: ShareRole | 'remove') => {
    const response = await apiFetch(`/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...shareHeaders,
      },
      body: JSON.stringify(role === 'remove' ? { remove: true } : { role: normalizeWhiteboardShareRole(role) }),
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to update member' })) as { error?: string }
      onPopupAlert(String(body.error ?? 'Failed to update member'), 'Update failed')
      return
    }

    await loadAccess()
  }, [loadAccess, onPopupAlert, projectId, shareHeaders])

  const setLinkSharing = useCallback(async (enabled: boolean, role: ShareRole) => {
    const response = await apiFetch(`/projects/${projectId}/link-sharing`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...shareHeaders,
      },
      body: JSON.stringify({ enabled, role: normalizeWhiteboardShareRole(role) }),
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to update link sharing' })) as { error?: string }
      onPopupAlert(String(body.error ?? 'Failed to update link sharing'), 'Update failed')
      return
    }

    const body = (await response.json()) as {
      enabled: boolean
      role: ShareRole | null
      token: string | null
    }

    setLinkEnabled(body.enabled)
    setLinkRole(body.role ? normalizeWhiteboardShareRole(body.role) : 'view')
    setLinkToken(body.token)
  }, [onPopupAlert, projectId, shareHeaders])

  const invalidateLinkSharing = useCallback(async () => {
    const response = await apiFetch(`/projects/${projectId}/link-sharing`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...shareHeaders,
      },
      body: JSON.stringify({ invalidate: true }),
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to rotate link' })) as { error?: string }
      onPopupAlert(String(body.error ?? 'Failed to rotate link'), 'Rotate failed')
      return
    }

    const body = (await response.json()) as {
      enabled: boolean
      role: ShareRole | null
      token: string | null
    }

    setLinkEnabled(body.enabled)
    setLinkRole(body.role ? normalizeWhiteboardShareRole(body.role) : 'view')
    setLinkToken(body.token)
  }, [onPopupAlert, projectId, shareHeaders])

  const shareUrl = useMemo(
    () => `${window.location.origin}${makeProjectUrl(projectId, linkToken ?? shareToken)}`,
    [linkToken, projectId, shareToken],
  )

  const handleExportPng = useCallback(async () => {
    if (!excalidrawApi) {
      onPopupAlert('Whiteboard is still initializing. Please try export again.', 'Export unavailable')
      return
    }

    setExporting(true)
    try {
      await exportWhiteboardAsPng(excalidrawApi, projectTitle)
    } catch (error) {
      onPopupAlert(getErrorMessage(error), 'PNG export failed')
    } finally {
      setExporting(false)
    }
  }, [excalidrawApi, onPopupAlert, projectTitle])

  const handleExportSvg = useCallback(async () => {
    if (!excalidrawApi) {
      onPopupAlert('Whiteboard is still initializing. Please try export again.', 'Export unavailable')
      return
    }

    setExporting(true)
    try {
      await exportWhiteboardAsSvg(excalidrawApi, projectTitle)
    } catch (error) {
      onPopupAlert(getErrorMessage(error), 'SVG export failed')
    } finally {
      setExporting(false)
    }
  }, [excalidrawApi, onPopupAlert, projectTitle])

  const openShareModal = useCallback(() => setShowShareModal(true), [])

  const handleUserFollow = useCallback((payload: OnUserFollowedPayload) => {
    if (payload.action === 'FOLLOW') {
      setFollowedSocketId(payload.userToFollow.socketId)
    } else {
      setFollowedSocketId(null)
    }
  }, [])

  const handleFollowCollaborator = useCallback(
    (socketId: SocketId, username: string) => {
      if (!excalidrawApi) {
        return
      }
      const current = excalidrawApi.getAppState().userToFollow
      if (current?.socketId === socketId) {
        excalidrawApi.updateScene({ appState: { userToFollow: null } })
        setFollowedSocketId(null)
      } else {
        excalidrawApi.updateScene({
          appState: { userToFollow: { socketId, username } },
        })
        setFollowedSocketId(socketId)
      }
    },
    [excalidrawApi],
  )

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-cz-bg">
      <WhiteboardToolbar
        title={projectTitle}
        canRenameProject={canRoleEdit}
        onBackToProjects={onBackToProjects}
        onRenameProject={onRenameProject}
        onRenameProjectError={(message) => onPopupAlert(message, 'Rename failed')}
        canEdit={canWrite}
        canRoleEdit={canRoleEdit}
        connectionState={connectionState}
        activeCollaborators={activeCollaborators}
        followedSocketId={followedSocketId}
        onFollowCollaborator={handleFollowCollaborator}
        exporting={exporting}
        accountLabel={accountLabel}
        accountEmail={accountEmail}
        accountImageUrl={accountImageUrl}
        accountIsGuest={accountIsGuest}
        onOpenSettings={onOpenSettings}
        onLogout={onLogout}
        onLogin={onLogin}
        onOpenShare={openShareModal}
        onToggleEditMode={setEditModeEnabled}
        onExportPng={handleExportPng}
        onExportSvg={handleExportSvg}
      />

      <main className="min-h-0 flex-1">
        <WhiteboardCanvas
          canEdit={canWrite}
          isCollaborating={isCollaborating}
          collaborators={collaborators}
          onSetApi={setExcalidrawApi}
          onChange={handleSceneChange}
          onPointerUpdate={handlePointerUpdate}
          onUserFollow={handleUserFollow}
        />
      </main>

      <ShareModal
        open={showShareModal}
        inviteEmail={inviteEmail}
        inviteRole={inviteRole}
        inviting={inviting}
        linkEnabled={linkEnabled}
        linkRole={linkRole}
        people={peopleWithAccess}
        canManage={canManageAccess}
        shareUrl={shareUrl}
        onClose={() => setShowShareModal(false)}
        onInviteEmailChange={setInviteEmail}
        onInviteRoleChange={(role) => setInviteRole(normalizeWhiteboardShareRole(role))}
        onInvite={() => {
          void inviteMember()
        }}
        onMemberRoleChange={(userId, role) => {
          void updateMemberRole(userId, role)
        }}
        onLinkToggle={(enabled) => {
          void setLinkSharing(enabled, linkRole)
        }}
        onLinkRoleChange={(role) => {
          const normalizedRole = normalizeWhiteboardShareRole(role)
          setLinkRole(normalizedRole)
          void setLinkSharing(linkEnabled, normalizedRole)
        }}
        onLinkInvalidate={() => {
          void invalidateLinkSharing()
        }}
        allowedRoles={['view', 'edit']}
      />
    </div>
  )
}
