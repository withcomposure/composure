export const TREE_MULTI_PATHS_MIME = 'text/x-composure-paths'
export const TREE_SINGLE_PATH_MIME = 'text/x-composure-path'
export const TAB_SINGLE_PATH_MIME = 'text/x-composure-tab-path'
export const TAB_SOURCE_PANE_MIME = 'text/x-composure-tab-source-pane'
export const TAB_SOURCE_BAR_MIME = 'text/x-composure-tab-source-bar'

const fallbackTextMime = 'text/plain'
const fallbackTextAliasMime = 'text'
const fallbackPrefix = 'composure-dnd:'

type DragPayloadRecord = Record<string, string>

let activeComposureDragPayload: DragPayloadRecord | null = null
let didBindCleanupListeners = false

function clearActiveComposureDragPayload(): void {
  activeComposureDragPayload = null
}

function bindCleanupListeners(): void {
  if (didBindCleanupListeners || typeof window === 'undefined') {
    return
  }

  didBindCleanupListeners = true
  // Clear stale in-memory payload at the start and end of any drag lifecycle.
  window.addEventListener('dragstart', clearActiveComposureDragPayload, true)
  window.addEventListener('dragend', clearActiveComposureDragPayload, true)
  window.addEventListener('drop', clearActiveComposureDragPayload, true)
}

function sanitizePayload(payload: DragPayloadRecord): DragPayloadRecord {
  const next: DragPayloadRecord = {}
  for (const [mime, value] of Object.entries(payload)) {
    if (typeof value === 'string' && value.length > 0) {
      next[mime] = value
    }
  }
  return next
}

function readFallbackPayload(dataTransfer: DataTransfer): DragPayloadRecord | null {
  const raw = dataTransfer.getData(fallbackTextMime)
  if (!raw || !raw.startsWith(fallbackPrefix)) {
    return null
  }

  try {
    const parsed = JSON.parse(raw.slice(fallbackPrefix.length)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const next: DragPayloadRecord = {}
    for (const [mime, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0) {
        next[mime] = value
      }
    }
    return next
  } catch {
    return null
  }
}

export function writeComposureDragPayload(dataTransfer: DataTransfer, payload: DragPayloadRecord): void {
  bindCleanupListeners()

  const normalized = sanitizePayload(payload)
  activeComposureDragPayload = normalized

  for (const [mime, value] of Object.entries(normalized)) {
    dataTransfer.setData(mime, value)
  }

  const fallback = `${fallbackPrefix}${JSON.stringify(normalized)}`
  dataTransfer.setData(fallbackTextMime, fallback)

  // Older engines may expose text/plain through the text alias.
  try {
    dataTransfer.setData(fallbackTextAliasMime, fallback)
  } catch {
    // Ignore unsupported aliases.
  }
}

export function readComposureDragData(dataTransfer: DataTransfer, mime: string): string {
  const direct = dataTransfer.getData(mime)
  if (direct) {
    return direct
  }

  const fallback = readFallbackPayload(dataTransfer)
  if (fallback?.[mime]) {
    return fallback[mime]
  }

  return activeComposureDragPayload?.[mime] ?? ''
}

type DragTypeList = {
  length?: number
  [index: number]: string
  contains?: (type: string) => boolean
  includes?: (type: string) => boolean
  indexOf?: (type: string) => number
}

export function hasDataTransferType(dataTransfer: DataTransfer, type: string): boolean {
  const types = dataTransfer.types as unknown as DragTypeList | null
  if (!types) {
    return false
  }

  if (typeof types.contains === 'function') {
    return types.contains(type)
  }

  if (typeof types.includes === 'function') {
    return types.includes(type)
  }

  if (typeof types.indexOf === 'function') {
    return types.indexOf(type) >= 0
  }

  const length = typeof types.length === 'number' ? types.length : 0
  for (let i = 0; i < length; i += 1) {
    if (types[i] === type) {
      return true
    }
  }

  return false
}
