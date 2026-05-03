import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadLibraryFromBlob, serializeLibraryAsJSON } from '@excalidraw/excalidraw'
import type { LibraryItems, OnUserFollowedPayload, SocketId } from '@excalidraw/excalidraw/types'
import { PopupDialog } from '@/components/PopupDialog'
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
import { parseLibraryItemsShape } from './library-schema'
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

interface LibraryInstallTokens {
  libraryUrl: string
  idToken: string | null
}

function parseLibraryInstallTokens(): LibraryInstallTokens | null {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const hashLibraryUrl = hash.get('addLibrary')
  if (hashLibraryUrl) {
    return {
      libraryUrl: hashLibraryUrl,
      idToken: hash.get('token'),
    }
  }

  const query = new URLSearchParams(window.location.search)
  const queryLibraryUrl = query.get('addLibrary')
  if (!queryLibraryUrl) {
    return null
  }

  return {
    libraryUrl: queryLibraryUrl,
    idToken: hash.get('token'),
  }
}

function clearLibraryInstallTokensFromUrl(): void {
  if (window.location.hash.includes('addLibrary')) {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    hash.delete('addLibrary')
    const nextHash = hash.toString()
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`
    window.history.replaceState({}, '', nextUrl)
    return
  }

  if (window.location.search.includes('addLibrary')) {
    const query = new URLSearchParams(window.location.search)
    query.delete('addLibrary')
    const nextQuery = query.toString()
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', nextUrl)
  }
}

function normalizeLibraryInstallUrl(rawLibraryUrl: string): string {
  const decodedLibraryUrl = decodeURIComponent(rawLibraryUrl)

  let parsed: URL
  try {
    parsed = new URL(decodedLibraryUrl)
  } catch {
    throw new Error(`Invalid library URL: ${decodedLibraryUrl}`)
  }

  const hostname = parsed.hostname.toLowerCase()
  const isAllowedHost = hostname === 'libraries.excalidraw.com' || hostname.endsWith('.libraries.excalidraw.com')
  if (parsed.protocol !== 'https:' || !isAllowedHost) {
    throw new Error(`Invalid or disallowed library URL: ${decodedLibraryUrl}`)
  }

  return parsed.toString()
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
  const [libraryItems, setLibraryItems] = useState<LibraryItems>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [libraryImportShapeCount, setLibraryImportShapeCount] = useState<number | null>(null)
  const pendingLibraryImportPromptRef = useRef<((confirmed: boolean) => void) | null>(null)

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

  useEffect(() => {
    let cancelled = false
    setLibraryLoaded(false)
    setLibraryItems([])

    const loadLibrary = async () => {
      try {
        const response = await apiFetch('/excalidraw-library')
        if (!response.ok) {
          throw new Error('Failed to load Excalidraw library')
        }
        const body = (await response.json()) as { library?: unknown; libraryItems?: unknown }
        let nextLibraryItems: LibraryItems = []

        if (typeof body.library === 'string') {
          try {
            nextLibraryItems = await loadLibraryFromBlob(
              new Blob([body.library], { type: 'application/json' }),
              'unpublished',
            )
          } catch (error) {
            console.warn(`[whiteboard] load-library-blob-parse-failed ${String(error)}`)
          }
        } else if (Array.isArray(body.libraryItems)) {
          // Legacy API fallback path.
          const parsedLegacyLibraryItems = parseLibraryItemsShape(body.libraryItems)
          if (parsedLegacyLibraryItems) {
            nextLibraryItems = parsedLegacyLibraryItems
          } else {
            console.warn('[whiteboard] load-library-legacy-shape-invalid')
          }
        }

        if (!cancelled) {
          setLibraryItems(nextLibraryItems)
        }
      } catch (error) {
        console.warn(`[whiteboard] load-library-failed ${String(error)}`)
        if (!cancelled) {
          setLibraryItems([])
        }
      } finally {
        if (!cancelled) {
          setLibraryLoaded(true)
        }
      }
    }

    void loadLibrary()
    return () => {
      cancelled = true
    }
  }, [projectId, principal.userId])

  const {
    connectionState,
    collaborators,
    activeCollaborators,
    isCollaborating,
    excalidrawApi,
    setExcalidrawApi,
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

  const resolveLibraryImportPrompt = useCallback((confirmed: boolean) => {
    const resolve = pendingLibraryImportPromptRef.current
    pendingLibraryImportPromptRef.current = null
    setLibraryImportShapeCount(null)
    resolve?.(confirmed)
  }, [])

  const requestLibraryImportConfirmation = useCallback((shapeCount: number): Promise<boolean> => {
    return new Promise((resolve) => {
      if (pendingLibraryImportPromptRef.current) {
        pendingLibraryImportPromptRef.current(false)
      }

      pendingLibraryImportPromptRef.current = resolve
      setLibraryImportShapeCount(shapeCount)
    })
  }, [])

  useEffect(() => {
    if (!excalidrawApi) {
      return
    }

    let cancelled = false

    const importLibraryFromTokens = async (tokens: LibraryInstallTokens): Promise<void> => {
      try {
        const libraryUrl = normalizeLibraryInstallUrl(tokens.libraryUrl)
        const response = await fetch(libraryUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch library: status ${response.status}`)
        }

        const blob = await response.blob()
        const importedLibraryItems = await loadLibraryFromBlob(blob, 'published')
        if (cancelled) {
          return
        }

        const shouldPrompt = tokens.idToken !== excalidrawApi.id
        if (shouldPrompt && document.hidden) {
          await new Promise<void>((resolve) => {
            window.addEventListener('focus', () => resolve(), { once: true })
          })
        }

        if (shouldPrompt && !cancelled) {
          const confirmed = await requestLibraryImportConfirmation(importedLibraryItems.length)
          if (!confirmed || cancelled) {
            return
          }
        }

        await excalidrawApi.updateLibrary({
          libraryItems: importedLibraryItems,
          merge: true,
          defaultStatus: 'published',
          openLibraryMenu: true,
        })
      } catch (error) {
        if (!cancelled) {
          onPopupAlert(getErrorMessage(error), 'Library import failed')
        }
      } finally {
        clearLibraryInstallTokensFromUrl()
      }
    }

    const maybeImportLibraryFromUrl = () => {
      const tokens = parseLibraryInstallTokens()
      if (!tokens) {
        return
      }

      void importLibraryFromTokens(tokens)
    }

    maybeImportLibraryFromUrl()

    const onHashChange = (event: HashChangeEvent) => {
      const tokens = parseLibraryInstallTokens()
      if (!tokens) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      window.history.replaceState({}, '', event.oldURL)
      void importLibraryFromTokens(tokens)
    }

    window.addEventListener('hashchange', onHashChange)
    return () => {
      cancelled = true
      window.removeEventListener('hashchange', onHashChange)
      if (pendingLibraryImportPromptRef.current) {
        pendingLibraryImportPromptRef.current(false)
        pendingLibraryImportPromptRef.current = null
      }
    }
  }, [excalidrawApi, onPopupAlert, requestLibraryImportConfirmation])

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

  const handleLibraryChange = useCallback(async (nextLibraryItems: LibraryItems) => {
    const validatedLibraryItems = parseLibraryItemsShape(nextLibraryItems)
    if (!validatedLibraryItems) {
      console.warn('[whiteboard] save-library-shape-invalid')
      return
    }

    setLibraryItems(validatedLibraryItems)
    if (!principal.userId) {
      return
    }

    try {
      const serializedLibrary = serializeLibraryAsJSON(validatedLibraryItems)
      const response = await apiFetch('/excalidraw-library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library: serializedLibrary }),
      })
      if (!response.ok) {
        throw new Error('Failed to save Excalidraw library')
      }
    } catch (error) {
      console.warn(`[whiteboard] save-library-failed ${String(error)}`)
    }
  }, [principal.userId])

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
        {libraryLoaded ? (
          <WhiteboardCanvas
            key={projectId}
            canEdit={canWrite}
            isCollaborating={isCollaborating}
            collaborators={collaborators}
            initialLibraryItems={libraryItems}
            onSetApi={setExcalidrawApi}
            onLibraryChange={handleLibraryChange}
            onPointerUpdate={handlePointerUpdate}
            onUserFollow={handleUserFollow}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-cz-text-muted">
            Loading whiteboard library...
          </div>
        )}
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

      <PopupDialog
        open={libraryImportShapeCount !== null}
        title="Add to Library"
        message={`This will add ${libraryImportShapeCount ?? 0} shape(s) to your library. Are you sure?`}
        dismiss={{
          label: 'Cancel',
          onClick: () => resolveLibraryImportPrompt(false),
        }}
        actions={[
          {
            label: 'Add to library',
            onClick: () => resolveLibraryImportPrompt(true),
            autoFocus: true,
          },
        ]}
      />
    </div>
  )
}
