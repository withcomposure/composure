import { describe, expect, it } from 'vitest'
import {
  hasDataTransferType,
  readComposureDragData,
  TAB_SINGLE_PATH_MIME,
  TAB_SOURCE_PANE_MIME,
  writeComposureDragPayload,
} from '../src/shared/drag-data'

function createDataTransferStub(seed: Record<string, string> = {}, typeEntries: string[] = []): DataTransfer {
  const store = new Map<string, string>(Object.entries(seed))
  const types: { length: number; [index: number]: string; contains: (type: string) => boolean } = {
    length: typeEntries.length,
    contains: (type: string) => typeEntries.includes(type),
  }

  for (const [index, entry] of typeEntries.entries()) {
    types[index] = entry
  }

  return {
    getData: (format: string) => store.get(format) ?? '',
    setData: (format: string, value: string) => {
      store.set(format, value)
    },
    types,
  } as unknown as DataTransfer
}

describe('drag-data helpers', () => {
  it('reads drag payload fields written by writeComposureDragPayload', () => {
    const dataTransfer = createDataTransferStub()

    writeComposureDragPayload(dataTransfer, {
      [TAB_SINGLE_PATH_MIME]: 'chapter/intro.tex',
      [TAB_SOURCE_PANE_MIME]: 'pane-7',
    })

    expect(readComposureDragData(dataTransfer, TAB_SINGLE_PATH_MIME)).toBe('chapter/intro.tex')
    expect(readComposureDragData(dataTransfer, TAB_SOURCE_PANE_MIME)).toBe('pane-7')
  })

  it('falls back to text/plain payload when custom MIME entries are unavailable', () => {
    const source = createDataTransferStub()
    writeComposureDragPayload(source, {
      [TAB_SINGLE_PATH_MIME]: 'main.tex',
      [TAB_SOURCE_PANE_MIME]: 'pane-1',
    })

    const fallback = source.getData('text/plain')
    const strippedCustomTypes = createDataTransferStub({ 'text/plain': fallback, text: fallback }, ['text/plain'])

    expect(readComposureDragData(strippedCustomTypes, TAB_SINGLE_PATH_MIME)).toBe('main.tex')
    expect(readComposureDragData(strippedCustomTypes, TAB_SOURCE_PANE_MIME)).toBe('pane-1')
  })

  it('falls back to active in-memory payload when dragover data is empty', () => {
    const source = createDataTransferStub()
    writeComposureDragPayload(source, {
      [TAB_SINGLE_PATH_MIME]: 'main.tex',
      [TAB_SOURCE_PANE_MIME]: 'pane-1',
    })

    const emptyDuringDragOver = createDataTransferStub()
    expect(readComposureDragData(emptyDuringDragOver, TAB_SINGLE_PATH_MIME)).toBe('main.tex')
    expect(readComposureDragData(emptyDuringDragOver, TAB_SOURCE_PANE_MIME)).toBe('pane-1')

    window.dispatchEvent(new Event('drop'))

    const emptyAfterDrop = createDataTransferStub()
    expect(readComposureDragData(emptyAfterDrop, TAB_SINGLE_PATH_MIME)).toBe('')
    expect(readComposureDragData(emptyAfterDrop, TAB_SOURCE_PANE_MIME)).toBe('')
  })

  it('checks DataTransfer type membership across DOMStringList-like implementations', () => {
    const dataTransfer = createDataTransferStub({}, ['Files', 'text/x-composure-path'])

    expect(hasDataTransferType(dataTransfer, 'Files')).toBe(true)
    expect(hasDataTransferType(dataTransfer, 'text/x-composure-path')).toBe(true)
    expect(hasDataTransferType(dataTransfer, 'text/x-composure-tab-path')).toBe(false)
  })
})
