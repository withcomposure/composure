import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  migrateLegacyWhiteboardSceneFile,
  readWhiteboardSceneFromYDoc,
  writeWhiteboardSceneToYDoc,
} from '../src/whiteboard/useWhiteboardCollab'

describe('whiteboard collaboration scene persistence', () => {
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
})
