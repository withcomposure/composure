import { describe, expect, it } from 'vitest'
import { isLibraryItemShape, parseLibraryItemsShape } from '../src/whiteboard/library-schema'

function makeValidLibraryItem() {
  return {
    id: 'library-item-1',
    status: 'published',
    created: 1714732800000,
    elements: [
      {
        id: 'element-1',
        type: 'rectangle',
        isDeleted: false,
      },
    ],
  }
}

describe('whiteboard library shape validation', () => {
  it('accepts valid LibraryItem objects', () => {
    expect(isLibraryItemShape(makeValidLibraryItem())).toBe(true)
  })

  it('rejects LibraryItem objects with invalid status', () => {
    expect(
      isLibraryItemShape({
        ...makeValidLibraryItem(),
        status: 'draft',
      }),
    ).toBe(false)
  })

  it('rejects LibraryItem objects with malformed elements', () => {
    expect(
      isLibraryItemShape({
        ...makeValidLibraryItem(),
        elements: [{ type: 'rectangle' }],
      }),
    ).toBe(false)
  })

  it('parses only fully valid LibraryItems arrays', () => {
    const valid = parseLibraryItemsShape([makeValidLibraryItem()])
    const invalid = parseLibraryItemsShape([
      makeValidLibraryItem(),
      {
        ...makeValidLibraryItem(),
        id: '',
      },
    ])

    expect(valid).not.toBeNull()
    expect(invalid).toBeNull()
  })
})
