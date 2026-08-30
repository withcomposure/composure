import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadLibraryFromBlob, serializeLibraryAsJSON } from '@excalidraw/excalidraw'
import type { LibraryItems, OnUserFollowedPayload, SocketId } from '@excalidraw/excalidraw/types'
import { PopupDialog } from '@/components/PopupDialog'
import type { SessionUser, ShareRole } from '@/types'
import { apiFetch, getErrorMessage } from '@/utils/fetch'
import { useProjectSharing } from '@/hooks/use-project-sharing'
import { ShareModal } from '@/workspace/ShareModal'
import { WhiteboardCanvas } from './WhiteboardCanvas'
import { WhiteboardToolbar } from './WhiteboardToolbar'
import { exportWhiteboardAsPng, exportWhiteboardAsSvg } from './whiteboard-export'
import { parseLibraryItemsShape } from './library-schema'
import { useWhiteboardCollab } from './use-whiteboard-collab'

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

  const {
    peopleWithAccess,
    linkEnabled,
    linkRole,
    accessRole,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    inviting,
    setLinkRole,
    inviteMember,
    updateMemberRole,
    setLinkSharing,
    invalidateLinkSharing,
    shareUrl,
  } = useProjectSharing({
    projectId,
    shareToken,
    shareHeaders,
    onPopupAlert,
    normalizeRole: normalizeWhiteboardShareRole,
  })

  const canRoleEdit = accessRole === 'owner' || accessRole === 'edit'
  const canWrite = canRoleEdit && editModeEnabled
  const canManageAccess = accessRole === 'owner' && Boolean(sessionUser?.id)

  // Edit mode follows the user's role whenever it (or the project) changes
  // (previously an effect; runs on mount too, matching the old behavior).
  const [prevEditModeKey, setPrevEditModeKey] = useState<{
    canRoleEdit: boolean
    projectId: string
  } | null>(null)
  if (
    prevEditModeKey === null ||
    prevEditModeKey.canRoleEdit !== canRoleEdit ||
    prevEditModeKey.projectId !== projectId
  ) {
    setPrevEditModeKey({ canRoleEdit, projectId })
    setEditModeEnabled(canRoleEdit)
  }

  // The library reloads per project/user; reset the loading state as soon as
  // the identity changes (previously the first lines of the load effect).
  const [prevLibraryKey, setPrevLibraryKey] = useState({
    projectId,
    userId: principal.userId,
  })
  if (
    prevLibraryKey.projectId !== projectId ||
    prevLibraryKey.userId !== principal.userId
  ) {
    setPrevLibraryKey({ projectId, userId: principal.userId })
    setLibraryLoaded(false)
    setLibraryItems([])
  }

  useEffect(() => {
    let cancelled = false

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
    initialScene,
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
        {libraryLoaded && initialScene ? (
          <WhiteboardCanvas
            key={projectId}
            canEdit={canWrite}
            isCollaborating={isCollaborating}
            collaborators={collaborators}
            initialLibraryItems={libraryItems}
            initialScene={initialScene}
            onSetApi={setExcalidrawApi}
            onLibraryChange={handleLibraryChange}
            onPointerUpdate={handlePointerUpdate}
            onUserFollow={handleUserFollow}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-cz-text-muted">
            Loading whiteboard...
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
        onInviteRoleChange={setInviteRole}
        onInvite={() => {
          void inviteMember()
        }}
        onMemberRoleChange={(memberId, role) => {
          void updateMemberRole(memberId, role)
        }}
        onLinkToggle={(enabled) => {
          void setLinkSharing(enabled, linkRole)
        }}
        onLinkRoleChange={(role) => {
          setLinkRole(role)
          void setLinkSharing(linkEnabled, role)
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
