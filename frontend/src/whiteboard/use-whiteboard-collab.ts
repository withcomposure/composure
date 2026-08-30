import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import * as Y from 'yjs'
import type {
  AppState,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  SocketId,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ConnectionState } from '@/types'
import { collaborationWsUrl } from '@/utils/api-routing'
import { createHocuspocusProviderStore } from '@/utils/hocuspocus-provider-store'

const elementsMapKey = 'excalidraw.elements'
const elementOrderKey = 'excalidraw.elementOrder'
const filesMapKey = 'excalidraw.files'
const appStateMapKey = 'excalidraw.appState'

const persistedAppStateKeys = [
  'viewBackgroundColor',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFillStyle',
  'currentItemStrokeWidth',
  'currentItemStrokeStyle',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemStartArrowhead',
  'currentItemEndArrowhead',
  'currentItemRoundness',
  'gridSize',
  'theme',
  'zoom',
  'scrollX',
  'scrollY',
  'exportBackground',
  'exportWithDarkMode',
] as const satisfies ReadonlyArray<keyof AppState>

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function hashIdentity(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function colorForIdentity(identity: string): { background: string; stroke: string } {
  const palette = [
    { background: '#2563eb', stroke: '#1d4ed8' },
    { background: '#059669', stroke: '#047857' },
    { background: '#ea580c', stroke: '#c2410c' },
    { background: '#db2777', stroke: '#be185d' },
    { background: '#7c3aed', stroke: '#6d28d9' },
    { background: '#0891b2', stroke: '#0e7490' },
  ]
  return palette[hashIdentity(identity) % palette.length]
}

function pickPersistedAppState(appState: AppState | Partial<AppState>): Partial<AppState> {
  const next: Record<string, unknown> = {}
  for (const key of persistedAppStateKeys) {
    const value = appState[key]
    if (value !== undefined) {
      next[key] = value
    }
  }
  return next as Partial<AppState>
}

function toSortedIds(elements: readonly OrderedExcalidrawElement[]): string[] {
  return elements.map((element) => element.id)
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function mergeElementOrder(existingOrder: readonly string[], incomingOrder: readonly string[]): string[] {
  const dedupedIncomingOrder: string[] = []
  const seenIncoming = new Set<string>()
  for (const elementId of incomingOrder) {
    if (!seenIncoming.has(elementId)) {
      seenIncoming.add(elementId)
      dedupedIncomingOrder.push(elementId)
    }
  }

  if (dedupedIncomingOrder.length === 0) {
    return [...existingOrder]
  }

  if (existingOrder.length === 0) {
    return dedupedIncomingOrder
  }

  // If incoming order fully covers existing IDs, treat it as a complete snapshot
  // and honor its z-ordering.
  const incomingIdSet = new Set<string>(dedupedIncomingOrder)
  const coversExistingOrder = existingOrder.every((elementId) => incomingIdSet.has(elementId))
  if (coversExistingOrder) {
    return dedupedIncomingOrder
  }

  // For partial snapshots, preserve existing order and only append new IDs.
  const mergedOrder = [...existingOrder]
  const mergedIdSet = new Set<string>(existingOrder)
  for (const elementId of dedupedIncomingOrder) {
    if (!mergedIdSet.has(elementId)) {
      mergedIdSet.add(elementId)
      mergedOrder.push(elementId)
    }
  }
  return mergedOrder
}

function dedupeIds(ids: readonly string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    deduped.push(id)
  }
  return deduped
}

function snapshotCoversExistingElements(
  existingElementIds: readonly string[],
  incomingElements: readonly OrderedExcalidrawElement[],
): boolean {
  if (existingElementIds.length === 0) {
    return true
  }

  const incomingIds = new Set<string>(dedupeIds(toSortedIds(incomingElements)))
  for (const elementId of existingElementIds) {
    if (!incomingIds.has(elementId)) {
      return false
    }
  }
  return true
}

function toPersistedOrderedElements(
  elements: readonly ExcalidrawElement[],
): OrderedExcalidrawElement[] {
  const next: OrderedExcalidrawElement[] = []
  for (const element of elements) {
    const index = (element as { index?: unknown }).index
    if (typeof index !== 'string') {
      continue
    }
    next.push(element as OrderedExcalidrawElement)
  }
  return next
}

function getElementVersion(element: OrderedExcalidrawElement): number {
  const value = (element as { version?: unknown }).version
  return typeof value === 'number' ? value : -1
}

function getElementVersionNonce(element: OrderedExcalidrawElement): number {
  const value = (element as { versionNonce?: unknown }).versionNonce
  return typeof value === 'number' ? value : -1
}

function shouldAcceptIncomingElement(
  existingRawValue: string | undefined,
  incomingElement: OrderedExcalidrawElement,
): boolean {
  if (!existingRawValue) {
    return true
  }

  const existingElement = parseJson<OrderedExcalidrawElement>(existingRawValue)
  if (!existingElement) {
    return true
  }

  const incomingVersion = getElementVersion(incomingElement)
  const existingVersion = getElementVersion(existingElement)

  if (incomingVersion > existingVersion) {
    return true
  }
  if (incomingVersion < existingVersion) {
    return false
  }

  const incomingIsDeleted = incomingElement.isDeleted === true
  const existingIsDeleted = existingElement.isDeleted === true
  if (!existingIsDeleted && incomingIsDeleted) {
    return false
  }
  if (existingIsDeleted && !incomingIsDeleted) {
    return true
  }

  const incomingVersionNonce = getElementVersionNonce(incomingElement)
  const existingVersionNonce = getElementVersionNonce(existingElement)
  if (incomingVersionNonce > existingVersionNonce) {
    return true
  }
  if (incomingVersionNonce < existingVersionNonce) {
    return false
  }

  return true
}

export interface WhiteboardSceneData {
  elements: readonly OrderedExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

export interface WhiteboardPresenceUser {
  clientId: number
  socketId: SocketId
  name: string
  profileImageUrl: string | null
  hasPointer: boolean
  userId: string | null
  guestId: string | null
}

export function readWhiteboardSceneFromYDoc(ydoc: Y.Doc): WhiteboardSceneData {
  const elementsMap = ydoc.getMap<string>(elementsMapKey)
  const elementOrder = ydoc.getArray<string>(elementOrderKey).toArray()
  const filesMap = ydoc.getMap<string>(filesMapKey)
  const appStateMap = ydoc.getMap<string>(appStateMapKey)

  const elementsById = new Map<string, OrderedExcalidrawElement>()
  for (const [elementId, rawValue] of elementsMap.entries()) {
    const parsed = parseJson<OrderedExcalidrawElement>(rawValue)
    if (parsed) {
      elementsById.set(elementId, parsed)
    }
  }

  const orderedElements: OrderedExcalidrawElement[] = []
  for (const elementId of elementOrder) {
    const element = elementsById.get(elementId)
    if (element) {
      orderedElements.push(element)
      elementsById.delete(elementId)
    }
  }
  for (const element of elementsById.values()) {
    orderedElements.push(element)
  }

  const files: BinaryFiles = {}
  for (const [fileId, rawValue] of filesMap.entries()) {
    const parsed = parseJson<BinaryFiles[string]>(rawValue)
    if (parsed) {
      files[fileId] = parsed
    }
  }

  const appState: Partial<AppState> = {}
  for (const [key, rawValue] of appStateMap.entries()) {
    try {
      ;(appState as Record<string, unknown>)[key] = JSON.parse(rawValue) as unknown
    } catch {
      // Ignore malformed app-state entries.
    }
  }

  return {
    elements: orderedElements,
    appState,
    files,
  }
}

export function writeWhiteboardSceneToYDoc(
  ydoc: Y.Doc,
  scene: {
    elements: readonly OrderedExcalidrawElement[]
    appState: AppState | Partial<AppState>
    files: BinaryFiles
  },
  origin: string,
): void {
  const elementsMap = ydoc.getMap<string>(elementsMapKey)
  const elementOrder = ydoc.getArray<string>(elementOrderKey)
  const filesMap = ydoc.getMap<string>(filesMapKey)
  const appStateMap = ydoc.getMap<string>(appStateMapKey)

  const persistedAppState = pickPersistedAppState(scene.appState)

  ydoc.transact(() => {
    const currentOrder = elementOrder.toArray()
    const existingElementIds = currentOrder.length > 0
      ? dedupeIds(currentOrder)
      : dedupeIds(Array.from(elementsMap.keys()))
    let didApplyAnyElementUpdate = false
    let didRejectAnyIncomingElementUpdate = false

    for (const element of scene.elements) {
      const serialized = JSON.stringify(element)
      const existingRawValue = elementsMap.get(element.id)
      if (existingRawValue === serialized) {
        continue
      }
      if (!shouldAcceptIncomingElement(existingRawValue, element)) {
        didRejectAnyIncomingElementUpdate = true
        continue
      }

      if (elementsMap.get(element.id) !== serialized) {
        elementsMap.set(element.id, serialized)
        didApplyAnyElementUpdate = true
      }
    }

    const incomingSnapshotIsComplete = snapshotCoversExistingElements(existingElementIds, scene.elements)
    const shouldApplyMetadata = didApplyAnyElementUpdate
      || (incomingSnapshotIsComplete && !didRejectAnyIncomingElementUpdate)

    // Merge element order so partial snapshots cannot drop existing elements.
    const nextOrder = mergeElementOrder(currentOrder, toSortedIds(scene.elements))
    if (!arraysEqual(nextOrder, currentOrder)) {
      elementOrder.delete(0, elementOrder.length)
      if (nextOrder.length > 0) {
        elementOrder.insert(0, nextOrder)
      }
    }

    if (shouldApplyMetadata) {
      for (const [fileId, file] of Object.entries(scene.files)) {
        const serialized = JSON.stringify(file)
        if (filesMap.get(fileId) !== serialized) {
          filesMap.set(fileId, serialized)
        }
      }

      for (const [key, value] of Object.entries(persistedAppState)) {
        const serialized = JSON.stringify(value)
        if (appStateMap.get(key) !== serialized) {
          appStateMap.set(key, serialized)
        }
      }
    }
  }, origin)
}

function hasStructuredWhiteboardState(ydoc: Y.Doc): boolean {
  const elementsMap = ydoc.getMap<string>(elementsMapKey)
  const filesMap = ydoc.getMap<string>(filesMapKey)
  const appStateMap = ydoc.getMap<string>(appStateMapKey)
  const elementOrder = ydoc.getArray<string>(elementOrderKey)
  return elementsMap.size > 0 || filesMap.size > 0 || appStateMap.size > 0 || elementOrder.length > 0
}

export function migrateLegacyWhiteboardSceneFile(ydoc: Y.Doc, rootFile: string): boolean {
  if (hasStructuredWhiteboardState(ydoc)) {
    return false
  }

  const filesMap = ydoc.getMap<string>('files')
  const metadata = parseJson<{ type?: string }>(filesMap.get(rootFile) ?? '')
  if (!metadata || metadata.type !== 'text') {
    return false
  }

  const sceneText = ydoc.getText(`file:${rootFile}`).toString().trim()
  if (!sceneText) {
    return false
  }

  const parsed = parseJson<{
    elements?: OrderedExcalidrawElement[]
    appState?: Partial<AppState>
    files?: BinaryFiles
  }>(sceneText)

  if (!parsed) {
    return false
  }

  writeWhiteboardSceneToYDoc(
    ydoc,
    {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      appState: parsed.appState ?? {},
      files: parsed.files ?? {},
    },
    'composure:whiteboard-migration',
  )

  return true
}

interface WhiteboardCollabOptions {
  projectId: string
  shareToken?: string
  rootFile: string
  canWrite: boolean
  localUser: {
    name: string
    userId: string | null
    guestId: string | null
    profileImageUrl: string | null
  }
}

interface WhiteboardCollabResult {
  connectionState: ConnectionState
  collaborators: Map<SocketId, Collaborator>
  activeCollaborators: WhiteboardPresenceUser[]
  isCollaborating: boolean
  isSynced: boolean
  initialScene: WhiteboardSceneData | null
  excalidrawApi: ExcalidrawImperativeAPI | null
  setExcalidrawApi: (api: ExcalidrawImperativeAPI) => void
  handlePointerUpdate: NonNullable<ExcalidrawProps['onPointerUpdate']>
}

interface WhiteboardProviderSnapshot {
  provider: HocuspocusProvider | null
  connectionState: ConnectionState
  isSynced: boolean
  initialScene: WhiteboardSceneData | null
}

const offlineWhiteboardSnapshot: WhiteboardProviderSnapshot = {
  provider: null,
  connectionState: 'connecting',
  isSynced: false,
  initialScene: null,
}

function presenceIsLocalUser(
  person: WhiteboardPresenceUser,
  localUser: Pick<WhiteboardCollabOptions['localUser'], 'userId' | 'guestId'>,
): boolean {
  if (localUser.userId && person.userId && person.userId === localUser.userId) {
    return true
  }
  if (localUser.guestId && person.guestId && person.guestId === localUser.guestId) {
    return true
  }
  return false
}

export function useWhiteboardCollab(options: WhiteboardCollabOptions): WhiteboardCollabResult {
  const { projectId, shareToken, rootFile, canWrite, localUser } = options
  const [ydoc, setYdoc] = useState(() => new Y.Doc())
  const [excalidrawApi, setExcalidrawApiState] = useState<ExcalidrawImperativeAPI | null>(null)
  const [collaborators, setCollaborators] = useState<Map<SocketId, Collaborator>>(new Map())
  const [activeCollaborators, setActiveCollaborators] = useState<WhiteboardPresenceUser[]>([])
  const ydocProjectIdRef = useRef(projectId)
  const activeProjectIdRef = useRef(projectId)
  const activeExcalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const sceneHydratedForWritesRef = useRef(false)
  const suppressLocalSceneWritesRef = useRef(false)
  const suppressLocalSceneWritesTokenRef = useRef(0)
  useEffect(() => {
    // Stale-event guards read this at event time; syncing it post-commit
    // only widens the (intentional) drop window around a project switch by
    // one commit.
    activeProjectIdRef.current = projectId
  }, [projectId])

  const providerStore = useMemo(
    () =>
      createHocuspocusProviderStore<WhiteboardProviderSnapshot>((update, read) => {
        const wsUrl = collaborationWsUrl(shareToken)
        return new HocuspocusProvider({
          url: wsUrl,
          name: projectId,
          document: ydoc,
          onConnect: () => update({ connectionState: 'connected' }),
          onDisconnect: () => update({ connectionState: 'disconnected' }),
          onClose: () => update({ connectionState: 'disconnected' }),
          onAuthenticationFailed: () => update({ connectionState: 'disconnected' }),
          onStatus: ({ status }) => {
            if (status === 'connected' || status === 'connecting' || status === 'disconnected') {
              update({ connectionState: status })
            }
          },
          onSynced: ({ state }) => {
            if (!state || read().isSynced) {
              return
            }
            migrateLegacyWhiteboardSceneFile(ydoc, rootFile)
            update({
              isSynced: true,
              initialScene: readWhiteboardSceneFromYDoc(ydoc),
            })
          },
        })
      }, offlineWhiteboardSnapshot),
    [projectId, rootFile, shareToken, ydoc],
  )

  const { provider, connectionState, isSynced, initialScene } = useSyncExternalStore(
    providerStore.subscribe,
    providerStore.getSnapshot,
  )

  const runWithSuppressedLocalSceneWrites = useCallback((callback: () => void): void => {
    suppressLocalSceneWritesRef.current = true
    suppressLocalSceneWritesTokenRef.current += 1
    const token = suppressLocalSceneWritesTokenRef.current

    try {
      callback()
    } finally {
      queueMicrotask(() => {
        if (suppressLocalSceneWritesTokenRef.current === token) {
          suppressLocalSceneWritesRef.current = false
        }
      })
    }
  }, [])

  const persistSceneSnapshot = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (projectId !== activeProjectIdRef.current) {
      return
    }

    if (!canWrite || !isSynced || !sceneHydratedForWritesRef.current) {
      return
    }

    if (suppressLocalSceneWritesRef.current) {
      return
    }

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: toPersistedOrderedElements(elements),
        appState,
        files,
      },
      'composure:whiteboard-local',
    )
  }, [canWrite, isSynced, projectId, ydoc])

  useEffect(() => {
    if (ydocProjectIdRef.current === projectId) {
      return
    }

    ydocProjectIdRef.current = projectId
    setExcalidrawApiState(null)
    activeExcalidrawApiRef.current = null
    sceneHydratedForWritesRef.current = false
    setYdoc(() => new Y.Doc())
  }, [projectId])

  useEffect(() => {
    return () => {
      ydoc.destroy()
    }
  }, [ydoc])

  // A provider swap (project or share-token change) discards the previous
  // session's collaborator lists before the new awareness feed repopulates
  // them (previously the provider effect's cleanup).
  const [prevCollabProvider, setPrevCollabProvider] = useState<
    HocuspocusProvider | null
  >(provider)
  if (prevCollabProvider !== provider) {
    setPrevCollabProvider(provider)
    if (!provider?.awareness) {
      setCollaborators(new Map())
      setActiveCollaborators([])
    }
  }

  useEffect(() => {
    if (!provider) {
      return
    }

    const awareness = provider.awareness
    if (!awareness) {
      return
    }
    const identity = localUser.userId ?? localUser.guestId ?? localUser.name
    const color = colorForIdentity(identity)

    awareness.setLocalStateField('user', {
      name: localUser.name,
      userId: localUser.userId,
      guestId: localUser.guestId,
      profileImageUrl: localUser.profileImageUrl,
      color,
    })

    return () => {
      awareness.setLocalStateField('user', null)
      awareness.setLocalStateField('cursor', null)
    }
  }, [provider, localUser.guestId, localUser.name, localUser.profileImageUrl, localUser.userId])

  const localUserId = localUser.userId
  const localGuestId = localUser.guestId

  useEffect(() => {
    const awareness = provider?.awareness
    if (!awareness) {
      return
    }

    const update = () => {
      const states = awareness.getStates()
      const localClientId = awareness.clientID
      const nextCollaborators = new Map<SocketId, Collaborator>()
      const dedupedPeople = new Map<string, WhiteboardPresenceUser>()

      states.forEach((value, clientId) => {
        if (Number(clientId) === Number(localClientId)) {
          return
        }

        const state = value as {
          user?: {
            name?: string
            userId?: string | null
            guestId?: string | null
            profileImageUrl?: string | null
            color?: { background: string; stroke: string }
          }
          cursor?: { x: number; y: number; tool?: 'pointer' | 'laser'; button?: 'up' | 'down' }
        }

        const user = state.user
        if (!user) {
          return
        }

        const socketId = `client:${String(clientId)}` as SocketId
        const pointer = state.cursor
          ? {
              x: state.cursor.x,
              y: state.cursor.y,
              tool: state.cursor.tool ?? 'pointer',
            }
          : undefined

        nextCollaborators.set(socketId, {
          id: user.userId ?? user.guestId ?? socketId,
          socketId,
          username: user.name ?? 'Guest',
          avatarUrl: user.profileImageUrl ?? undefined,
          color: user.color ?? colorForIdentity(user.userId ?? user.guestId ?? socketId),
          pointer,
          button: state.cursor?.button ?? 'up',
        })

        const dedupeKey = user.userId ?? user.guestId ?? socketId
        const person: WhiteboardPresenceUser = {
          clientId,
          socketId,
          name: user.name ?? 'Guest',
          profileImageUrl: user.profileImageUrl ?? null,
          hasPointer: Boolean(pointer),
          userId: user.userId ?? null,
          guestId: user.guestId ?? null,
        }
        const existing = dedupedPeople.get(dedupeKey)
        if (!existing || (!existing.hasPointer && person.hasPointer)) {
          dedupedPeople.set(dedupeKey, person)
        }
      })

      setCollaborators(nextCollaborators)
      setActiveCollaborators(
        Array.from(dedupedPeople.values()).filter(
          (p) => !presenceIsLocalUser(p, { userId: localUserId, guestId: localGuestId }),
        ),
      )
    }

    awareness.on('change', update)
    update()

    return () => {
      awareness.off('change', update)
    }
  }, [provider, localUserId, localGuestId])

  useEffect(() => {
    if (!excalidrawApi || !isSynced) {
      return
    }

    const elementsMap = ydoc.getMap<string>(elementsMapKey)
    const elementOrder = ydoc.getArray<string>(elementOrderKey)
    const filesMap = ydoc.getMap<string>(filesMapKey)
    const appStateMap = ydoc.getMap<string>(appStateMapKey)

    const applyFromDoc = () => {
      const scene = readWhiteboardSceneFromYDoc(ydoc)
      runWithSuppressedLocalSceneWrites(() => {
        const fileValues = Object.values(scene.files)
        if (fileValues.length > 0) {
          excalidrawApi.addFiles(fileValues)
        }
        excalidrawApi.updateScene({
          elements: scene.elements,
          appState: scene.appState as Pick<AppState, keyof AppState>,
          captureUpdate: CaptureUpdateAction.NEVER,
        })
      })
    }

    const applyFromMapEvent = (
      _event: Y.YMapEvent<string>,
      transaction: Y.Transaction,
    ) => {
      if (transaction.origin === 'composure:whiteboard-local') {
        return
      }
      applyFromDoc()
    }

    const applyFromArrayEvent = (
      _event: Y.YArrayEvent<string>,
      transaction: Y.Transaction,
    ) => {
      if (transaction.origin === 'composure:whiteboard-local') {
        return
      }
      applyFromDoc()
    }

    applyFromDoc()
    sceneHydratedForWritesRef.current = true

    elementsMap.observe(applyFromMapEvent)
    elementOrder.observe(applyFromArrayEvent)
    filesMap.observe(applyFromMapEvent)
    appStateMap.observe(applyFromMapEvent)

    return () => {
      elementsMap.unobserve(applyFromMapEvent)
      elementOrder.unobserve(applyFromArrayEvent)
      filesMap.unobserve(applyFromMapEvent)
      appStateMap.unobserve(applyFromMapEvent)
      sceneHydratedForWritesRef.current = false
      suppressLocalSceneWritesRef.current = false
      suppressLocalSceneWritesTokenRef.current += 1
    }
  }, [excalidrawApi, isSynced, runWithSuppressedLocalSceneWrites, ydoc])

  useEffect(() => {
    if (!excalidrawApi) {
      return
    }

    const subscribedApi = excalidrawApi
    const unsubscribe = subscribedApi.onChange((elements, appState, files) => {
      if (activeExcalidrawApiRef.current !== subscribedApi) {
        return
      }
      persistSceneSnapshot(elements, appState, files)
    })

    return () => {
      unsubscribe()
    }
  }, [excalidrawApi, persistSceneSnapshot])

  useEffect(() => {
    if (!excalidrawApi) {
      return
    }

    runWithSuppressedLocalSceneWrites(() => {
      excalidrawApi.updateScene({
        collaborators,
        captureUpdate: CaptureUpdateAction.NEVER,
      })
    })
  }, [collaborators, excalidrawApi, runWithSuppressedLocalSceneWrites])

  const handlePointerUpdate = useCallback<NonNullable<ExcalidrawProps['onPointerUpdate']>>((payload) => {
    if (projectId !== activeProjectIdRef.current) {
      return
    }

    const awareness = provider?.awareness
    if (!awareness) {
      return
    }

    awareness.setLocalStateField('cursor', {
      x: payload.pointer.x,
      y: payload.pointer.y,
      tool: payload.pointer.tool,
      button: payload.button,
    })
  }, [projectId, provider])

  const setExcalidrawApi = useCallback((api: ExcalidrawImperativeAPI) => {
    if (projectId !== activeProjectIdRef.current) {
      return
    }

    activeExcalidrawApiRef.current = api
    sceneHydratedForWritesRef.current = false
    setExcalidrawApiState(api)
  }, [projectId])

  const isCollaborating = useMemo(() => collaborators.size > 0, [collaborators])

  return {
    connectionState,
    collaborators,
    activeCollaborators,
    isCollaborating,
    isSynced,
    initialScene,
    excalidrawApi,
    setExcalidrawApi,
    handlePointerUpdate,
  }
}
