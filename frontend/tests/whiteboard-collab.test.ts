import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'

const hocuspocusMockState = vi.hoisted(() => ({
  lastDocument: null as unknown,
}))

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class MockHocuspocusProvider {
    readonly awareness = new class MockAwareness {
      clientID = 1
      private readonly states = new Map<number, Record<string, unknown>>()
      private readonly listeners = new Set<() => void>()

      getStates(): Map<number, Record<string, unknown>> {
        return this.states
      }

      setLocalStateField(key: string, value: unknown): void {
        const current = this.states.get(this.clientID) ?? {}
        if (value === null || value === undefined) {
          const next = { ...current }
          delete next[key]
          if (Object.keys(next).length === 0) {
            this.states.delete(this.clientID)
          } else {
            this.states.set(this.clientID, next)
          }
        } else {
          this.states.set(this.clientID, { ...current, [key]: value })
        }

        for (const callback of this.listeners) {
          callback()
        }
      }

      on(eventName: string, callback: () => void): void {
        if (eventName === 'change') {
          this.listeners.add(callback)
        }
      }

      off(eventName: string, callback: () => void): void {
        if (eventName === 'change') {
          this.listeners.delete(callback)
        }
      }
    }()

    private readonly options: {
      document: Y.Doc
      onConnect?: () => void
      onDisconnect?: () => void
      onClose?: () => void
      onStatus?: (payload: { status: 'connected' | 'connecting' | 'disconnected' }) => void
      onSynced?: (payload: { state: boolean }) => void
    }

    constructor(options: {
      document: Y.Doc
      onConnect?: () => void
      onDisconnect?: () => void
      onClose?: () => void
      onStatus?: (payload: { status: 'connected' | 'connecting' | 'disconnected' }) => void
      onSynced?: (payload: { state: boolean }) => void
    }) {
      this.options = options
      hocuspocusMockState.lastDocument = options.document
      options.onStatus?.({ status: 'connecting' })
      options.onConnect?.()
      options.onStatus?.({ status: 'connected' })
      queueMicrotask(() => {
        options.onSynced?.({ state: true })
      })
    }

    destroy(): void {
      this.options.onDisconnect?.()
      this.options.onClose?.()
    }
  },
}))

import {
  migrateLegacyWhiteboardSceneFile,
  readWhiteboardSceneFromYDoc,
  useWhiteboardCollab,
  writeWhiteboardSceneToYDoc,
} from '../src/whiteboard/use-whiteboard-collab'

function createMockExcalidrawApi(options?: { keepListenersOnUnsubscribe?: boolean }): {
  api: ExcalidrawImperativeAPI
  addFiles: ReturnType<typeof vi.fn>
  updateScene: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
  emitChange: (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void
} {
  const addFiles = vi.fn()
  const updateScene = vi.fn()
  const changeListeners = new Set<(
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void>()
  const onChange = vi.fn((listener: (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void) => {
    changeListeners.add(listener)
    return () => {
      if (options?.keepListenersOnUnsubscribe) {
        return
      }
      changeListeners.delete(listener)
    }
  })

  const emitChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    for (const listener of Array.from(changeListeners)) {
      listener(elements, appState, files)
    }
  }

  return {
    api: {
      addFiles,
      updateScene,
      onChange,
    } as unknown as ExcalidrawImperativeAPI,
    addFiles,
    updateScene,
    onChange,
    emitChange,
  }
}

describe('whiteboard collaboration scene persistence', () => {
  beforeEach(() => {
    hocuspocusMockState.lastDocument = null
  })

  it('stores scene data in structured Yjs maps and reads it back', () => {
    const ydoc = new Y.Doc()

    const element = {
      id: 'el-1',
      type: 'rectangle',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    const files = {
      'file-1': {
        id: 'file-1',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,',
        created: 1,
      },
    } as unknown as BinaryFiles

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [element],
        appState: {
          viewBackgroundColor: '#ffffff',
        } as Partial<AppState>,
        files,
      },
      'test:whiteboard',
    )

    const elementsMap = ydoc.getMap<string>('excalidraw.elements')
    const filesMap = ydoc.getMap<string>('excalidraw.files')
    const appStateMap = ydoc.getMap<string>('excalidraw.appState')

    expect(elementsMap.get('el-1')).toBeTruthy()
    expect(filesMap.get('file-1')).toBeTruthy()
    expect(appStateMap.get('viewBackgroundColor')).toBe(JSON.stringify('#ffffff'))

    const scene = readWhiteboardSceneFromYDoc(ydoc)
    expect(scene.elements).toHaveLength(1)
    expect(scene.elements[0]?.id).toBe('el-1')
    expect(Object.keys(scene.files)).toContain('file-1')
    expect(scene.appState.viewBackgroundColor).toBe('#ffffff')

    ydoc.destroy()
  })

  it('merges partial scene updates instead of deleting existing state', () => {
    const ydoc = new Y.Doc()

    const firstElement = {
      id: 'el-1',
      type: 'rectangle',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    const secondElement = {
      id: 'el-2',
      type: 'ellipse',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    const files = {
      'file-1': {
        id: 'file-1',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,',
        created: 1,
      },
    } as unknown as BinaryFiles

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [firstElement, secondElement],
        appState: {
          viewBackgroundColor: '#ffffff',
        } as Partial<AppState>,
        files,
      },
      'test:seed',
    )

    const updatedFirstElement = {
      ...firstElement,
      x: 24,
    } as unknown as OrderedExcalidrawElement

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [updatedFirstElement],
        appState: {
          theme: 'dark',
        } as Partial<AppState>,
        files: {} as BinaryFiles,
      },
      'test:partial-update',
    )

    const scene = readWhiteboardSceneFromYDoc(ydoc)
    expect(scene.elements.map((element) => element.id)).toContain('el-1')
    expect(scene.elements.map((element) => element.id)).toContain('el-2')
    expect(Object.keys(scene.files)).toContain('file-1')
    expect(scene.appState.viewBackgroundColor).toBe('#ffffff')
    expect(scene.appState.theme).toBe('dark')

    ydoc.destroy()
  })

  it('persists explicit deleted-element updates', () => {
    const ydoc = new Y.Doc()

    const persistedElement = {
      id: 'delete-me',
      type: 'rectangle',
      version: 1,
      versionNonce: 10,
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [persistedElement],
        appState: {
          viewBackgroundColor: '#ffffff',
        } as Partial<AppState>,
        files: {} as BinaryFiles,
      },
      'test:seed-delete',
    )

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [
          {
            ...persistedElement,
            version: 2,
            versionNonce: 11,
            isDeleted: true,
          } as unknown as OrderedExcalidrawElement,
        ],
        appState: {
          viewBackgroundColor: '#ffffff',
        } as Partial<AppState>,
        files: {} as BinaryFiles,
      },
      'test:mark-deleted',
    )

    const scene = readWhiteboardSceneFromYDoc(ydoc)
    const updatedElement = scene.elements.find((element) => element.id === 'delete-me')
    expect(updatedElement?.isDeleted).toBe(true)

    ydoc.destroy()
  })

  it('rejects stale deleted tombstones when versions are not newer', () => {
    const ydoc = new Y.Doc()

    const persistedElement = {
      id: 'guarded-el',
      type: 'rectangle',
      version: 7,
      versionNonce: 11,
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [persistedElement],
        appState: {
          viewBackgroundColor: '#ffffff',
        } as Partial<AppState>,
        files: {} as BinaryFiles,
      },
      'test:seed-guarded',
    )

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [
          {
            ...persistedElement,
            isDeleted: true,
          } as unknown as OrderedExcalidrawElement,
        ],
        appState: {
          viewBackgroundColor: '#ffffff',
        } as Partial<AppState>,
        files: {} as BinaryFiles,
      },
      'test:stale-tombstone',
    )

    let scene = readWhiteboardSceneFromYDoc(ydoc)
    expect(scene.elements.find((element) => element.id === 'guarded-el')?.isDeleted).toBe(false)

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [
          {
            ...persistedElement,
            version: 8,
            versionNonce: 12,
            isDeleted: true,
          } as unknown as OrderedExcalidrawElement,
        ],
        appState: {
          viewBackgroundColor: '#ffffff',
        } as Partial<AppState>,
        files: {} as BinaryFiles,
      },
      'test:fresh-tombstone',
    )

    scene = readWhiteboardSceneFromYDoc(ydoc)
    expect(scene.elements.find((element) => element.id === 'guarded-el')?.isDeleted).toBe(true)

    ydoc.destroy()
  })

  it('does not apply metadata from stale full snapshots when element updates are rejected', () => {
    const ydoc = new Y.Doc()

    const currentElement = {
      id: 'stale-metadata-el',
      type: 'rectangle',
      version: 7,
      versionNonce: 22,
      isDeleted: false,
      index: 'a0',
    } as unknown as OrderedExcalidrawElement

    const currentFiles = {
      'file-current': {
        id: 'file-current',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,current',
        created: 1,
      },
    } as unknown as BinaryFiles

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [currentElement],
        appState: {
          viewBackgroundColor: '#0f172a',
        } as Partial<AppState>,
        files: currentFiles,
      },
      'test:seed-current-metadata',
    )

    const staleFiles = {
      'file-stale': {
        id: 'file-stale',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,stale',
        created: 2,
      },
    } as unknown as BinaryFiles

    writeWhiteboardSceneToYDoc(
      ydoc,
      {
        elements: [
          {
            ...currentElement,
            version: 6,
            versionNonce: 21,
          } as unknown as OrderedExcalidrawElement,
        ],
        appState: {
          viewBackgroundColor: '#ffffff',
          theme: 'dark',
        } as Partial<AppState>,
        files: staleFiles,
      },
      'test:stale-full-metadata-snapshot',
    )

    const scene = readWhiteboardSceneFromYDoc(ydoc)
    expect(scene.appState.viewBackgroundColor).toBe('#0f172a')
    expect(scene.appState.theme).toBeUndefined()
    expect(Object.keys(scene.files)).toContain('file-current')
    expect(Object.keys(scene.files)).not.toContain('file-stale')

    ydoc.destroy()
  })

  it('migrates legacy scene text document into structured maps', () => {
    const ydoc = new Y.Doc()

    const legacyElement = {
      id: 'legacy-el',
      type: 'ellipse',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    const filesMap = ydoc.getMap<string>('files')
    filesMap.set('scene.excalidraw', JSON.stringify({ type: 'text' }))

    const legacyText = ydoc.getText('file:scene.excalidraw')
    legacyText.insert(
      0,
      JSON.stringify({
        elements: [legacyElement],
        appState: { viewBackgroundColor: '#f8fafc' },
        files: {},
      }),
    )

    const migrated = migrateLegacyWhiteboardSceneFile(ydoc, 'scene.excalidraw')
    expect(migrated).toBe(true)

    const scene = readWhiteboardSceneFromYDoc(ydoc)
    expect(scene.elements).toHaveLength(1)
    expect(scene.elements[0]?.id).toBe('legacy-el')
    expect(scene.appState.viewBackgroundColor).toBe('#f8fafc')

    ydoc.destroy()
  })

  it('hydrates initial scene snapshot from synced Yjs state', async () => {
    const { result } = renderHook(() => useWhiteboardCollab({
      projectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rootFile: 'scene.excalidraw',
      canWrite: true,
      localUser: {
        name: 'Owner',
        userId: 'user-1',
        guestId: null,
        profileImageUrl: null,
      },
    }))

    const ydoc = hocuspocusMockState.lastDocument as Y.Doc | null
    expect(ydoc).toBeTruthy()
    if (!ydoc) {
      throw new Error('expected collaboration document to be available')
    }

    const seededElement = {
      id: 'initial-el',
      type: 'rectangle',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    act(() => {
      writeWhiteboardSceneToYDoc(
        ydoc,
        {
          elements: [seededElement],
          appState: {
            viewBackgroundColor: '#0f172a',
          } as Partial<AppState>,
          files: {} as BinaryFiles,
        },
        'test:seed-initial-scene',
      )
    })

    await waitFor(() => {
      expect(result.current.isSynced).toBe(true)
      expect(result.current.initialScene).toBeTruthy()
    })

    expect(result.current.initialScene?.elements.map((element) => element.id)).toContain('initial-el')
    expect(result.current.initialScene?.appState.viewBackgroundColor).toBe('#0f172a')
  })

  it('does not clear persisted scene when API rebind emits an early empty onChange', async () => {
    const { result } = renderHook(() => useWhiteboardCollab({
      projectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rootFile: 'scene.excalidraw',
      canWrite: true,
      localUser: {
        name: 'Owner',
        userId: 'user-1',
        guestId: null,
        profileImageUrl: null,
      },
    }))

    await waitFor(() => {
      expect(result.current.isSynced).toBe(true)
    })

    const ydoc = hocuspocusMockState.lastDocument as Y.Doc | null
    expect(ydoc).toBeTruthy()
    if (!ydoc) {
      throw new Error('expected mock collaboration document to be available')
    }

    const persistedElement = {
      id: 'persisted-el',
      type: 'rectangle',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    act(() => {
      writeWhiteboardSceneToYDoc(
        ydoc,
        {
          elements: [persistedElement],
          appState: {
            viewBackgroundColor: '#0f172a',
          } as Partial<AppState>,
          files: {} as BinaryFiles,
        },
        'test:seed',
      )
    })

    const firstApi = createMockExcalidrawApi()
    act(() => {
      result.current.setExcalidrawApi(firstApi.api)
    })

    await waitFor(() => {
      expect(firstApi.updateScene).toHaveBeenCalled()
      expect(firstApi.onChange).toHaveBeenCalled()
    })

    const replacementApi = createMockExcalidrawApi()
    act(() => {
      result.current.setExcalidrawApi(replacementApi.api)
    })

    await waitFor(() => {
      expect(replacementApi.onChange).toHaveBeenCalled()
    })

    act(() => {
      firstApi.emitChange(
        [],
        {
          viewBackgroundColor: '#ffffff',
        } as AppState,
        {} as BinaryFiles,
      )
    })

    const sceneAfterEarlyChange = readWhiteboardSceneFromYDoc(ydoc)
    expect(sceneAfterEarlyChange.elements.map((element) => element.id)).toContain('persisted-el')
    expect(sceneAfterEarlyChange.appState.viewBackgroundColor).toBe('#0f172a')
  })

  it('ignores stale onChange listeners from replaced APIs in the same project', async () => {
    const { result } = renderHook(() => useWhiteboardCollab({
      projectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rootFile: 'scene.excalidraw',
      canWrite: true,
      localUser: {
        name: 'Owner',
        userId: 'user-1',
        guestId: null,
        profileImageUrl: null,
      },
    }))

    await waitFor(() => {
      expect(result.current.isSynced).toBe(true)
    })

    const ydoc = hocuspocusMockState.lastDocument as Y.Doc | null
    expect(ydoc).toBeTruthy()
    if (!ydoc) {
      throw new Error('expected mock collaboration document to be available')
    }

    const persistedElement = {
      id: 'persisted-rebind-el',
      type: 'rectangle',
      version: 3,
      versionNonce: 12,
      index: 'a0',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    act(() => {
      writeWhiteboardSceneToYDoc(
        ydoc,
        {
          elements: [persistedElement],
          appState: {
            viewBackgroundColor: '#0f172a',
          } as Partial<AppState>,
          files: {} as BinaryFiles,
        },
        'test:seed-rebind-guard',
      )
    })

    const firstApi = createMockExcalidrawApi({ keepListenersOnUnsubscribe: true })
    act(() => {
      result.current.setExcalidrawApi(firstApi.api)
    })

    await waitFor(() => {
      expect(firstApi.onChange).toHaveBeenCalled()
    })

    const replacementApi = createMockExcalidrawApi()
    act(() => {
      result.current.setExcalidrawApi(replacementApi.api)
    })

    await waitFor(() => {
      const appliedSceneFromDoc = replacementApi.updateScene.mock.calls.some(([payload]) => (
        typeof payload === 'object'
          && payload !== null
          && Object.prototype.hasOwnProperty.call(payload as object, 'elements')
      ))
      expect(appliedSceneFromDoc).toBe(true)
    })

    act(() => {
      firstApi.emitChange(
        [persistedElement],
        {
          viewBackgroundColor: '#ffffff',
        } as AppState,
        {} as BinaryFiles,
      )
    })

    const sceneAfterStaleListener = readWhiteboardSceneFromYDoc(ydoc)
    expect(sceneAfterStaleListener.elements.map((element) => element.id)).toContain('persisted-rebind-el')
    expect(sceneAfterStaleListener.appState.viewBackgroundColor).toBe('#0f172a')
  })

  it('does not clear persisted scene when a late empty onChange snapshot arrives', async () => {
    const { result } = renderHook(() => useWhiteboardCollab({
      projectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rootFile: 'scene.excalidraw',
      canWrite: true,
      localUser: {
        name: 'Owner',
        userId: 'user-1',
        guestId: null,
        profileImageUrl: null,
      },
    }))

    await waitFor(() => {
      expect(result.current.isSynced).toBe(true)
    })

    const ydoc = hocuspocusMockState.lastDocument as Y.Doc | null
    expect(ydoc).toBeTruthy()
    if (!ydoc) {
      throw new Error('expected mock collaboration document to be available')
    }

    const persistedElement = {
      id: 'persisted-late-el',
      type: 'rectangle',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    act(() => {
      writeWhiteboardSceneToYDoc(
        ydoc,
        {
          elements: [persistedElement],
          appState: {
            viewBackgroundColor: '#0f172a',
          } as Partial<AppState>,
          files: {} as BinaryFiles,
        },
        'test:seed-late',
      )
    })

    const api = createMockExcalidrawApi()
    act(() => {
      result.current.setExcalidrawApi(api.api)
    })

    await waitFor(() => {
      const appliedSceneFromDoc = api.updateScene.mock.calls.some(([payload]) => (
        typeof payload === 'object'
          && payload !== null
          && Object.prototype.hasOwnProperty.call(payload as object, 'elements')
      ))
      expect(appliedSceneFromDoc).toBe(true)
    })

    act(() => {
      api.emitChange(
        [],
        {
          viewBackgroundColor: '#ffffff',
        } as AppState,
        {} as BinaryFiles,
      )
    })

    const sceneAfterLateEmptyChange = readWhiteboardSceneFromYDoc(ydoc)
    expect(sceneAfterLateEmptyChange.elements.map((element) => element.id)).toContain('persisted-late-el')
    expect(sceneAfterLateEmptyChange.appState.viewBackgroundColor).toBe('#0f172a')
  })

  it('ignores stale callbacks after switching projects', async () => {
    const { result, rerender } = renderHook(
      ({ nextProjectId }: { nextProjectId: string }) => useWhiteboardCollab({
        projectId: nextProjectId,
        rootFile: 'scene.excalidraw',
        canWrite: true,
        localUser: {
          name: 'Owner',
          userId: 'user-1',
          guestId: null,
          profileImageUrl: null,
        },
      }),
      {
        initialProps: {
          nextProjectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    )

    await waitFor(() => {
      expect(result.current.isSynced).toBe(true)
    })

    const projectADoc = hocuspocusMockState.lastDocument as Y.Doc | null
    expect(projectADoc).toBeTruthy()
    if (!projectADoc) {
      throw new Error('expected first project collaboration document to be available')
    }

    const persistedElement = {
      id: 'persisted-a',
      type: 'rectangle',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    act(() => {
      writeWhiteboardSceneToYDoc(
        projectADoc,
        {
          elements: [persistedElement],
          appState: {
            viewBackgroundColor: '#ffffff',
          } as Partial<AppState>,
          files: {} as BinaryFiles,
        },
        'test:seed-project-a',
      )
    })

    const staleApi = createMockExcalidrawApi({ keepListenersOnUnsubscribe: true })

    act(() => {
      result.current.setExcalidrawApi(staleApi.api)
    })

    await waitFor(() => {
      expect(staleApi.onChange).toHaveBeenCalled()
    })

    rerender({ nextProjectId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })

    const staleElement = {
      id: 'stale-write',
      type: 'ellipse',
      isDeleted: false,
    } as unknown as OrderedExcalidrawElement

    act(() => {
      staleApi.emitChange(
        [staleElement],
        {
          viewBackgroundColor: '#ffffff',
        } as AppState,
        {} as BinaryFiles,
      )
    })

    await waitFor(() => {
      expect(result.current.isSynced).toBe(true)
    })

    const sceneAfterStaleCallbacks = readWhiteboardSceneFromYDoc(projectADoc)
    expect(sceneAfterStaleCallbacks.elements.map((element) => element.id)).toContain('persisted-a')
    expect(sceneAfterStaleCallbacks.elements.map((element) => element.id)).not.toContain('stale-write')
  })
})
