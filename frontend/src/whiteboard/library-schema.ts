import type { LibraryItem, LibraryItems } from '@excalidraw/excalidraw/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isLibraryStatus(value: unknown): value is LibraryItem['status'] {
  return value === 'published' || value === 'unpublished'
}

function isLibraryElementShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false
  }

  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.type)) {
    return false
  }

  if ('isDeleted' in value && typeof value.isDeleted !== 'boolean') {
    return false
  }

  return value.isDeleted !== true
}

export function isLibraryItemShape(value: unknown): value is LibraryItem {
  if (!isRecord(value)) {
    return false
  }

  if (!isNonEmptyString(value.id)) {
    return false
  }

  if (!isLibraryStatus(value.status)) {
    return false
  }

  if (!isFiniteNumber(value.created) || value.created < 0) {
    return false
  }

  if ('name' in value && value.name !== undefined && typeof value.name !== 'string') {
    return false
  }

  if ('error' in value && value.error !== undefined && typeof value.error !== 'string') {
    return false
  }

  if (!Array.isArray(value.elements)) {
    return false
  }

  return value.elements.every((element) => isLibraryElementShape(element))
}

export function parseLibraryItemsShape(value: unknown): LibraryItems | null {
  if (!Array.isArray(value)) {
    return null
  }

  if (!value.every((item) => isLibraryItemShape(item))) {
    return null
  }

  return value as LibraryItems
}
