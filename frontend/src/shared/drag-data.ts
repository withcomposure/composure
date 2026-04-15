export const TREE_MULTI_PATHS_MIME = 'text/x-pressmark-paths'
export const TREE_SINGLE_PATH_MIME = 'text/x-pressmark-path'
export const TAB_SINGLE_PATH_MIME = 'text/x-pressmark-tab-path'
export const TAB_SOURCE_PANE_MIME = 'text/x-pressmark-tab-source-pane'
export const TAB_SOURCE_BAR_MIME = 'text/x-pressmark-tab-source-bar'

const FALLBACK_TEXT_MIME = 'text/plain'
const FALLBACK_TEXT_ALIAS_MIME = 'text'
const FALLBACK_PREFIX = 'pressmark-dnd:'

type DragPayloadRecord = Record<string, string>

let activePressmarkDragPayload: DragPayloadRecord | null = null
let didBindCleanupListeners = false

function clearActivePressmarkDragPayload(): void {
  activePressmarkDragPayload = null
}

function bindCleanupListeners(): void {
  if (didBindCleanupListeners || typeof window === 'undefined') {
    return
  }

  didBindCleanupListeners = true
  // Clear stale in-memory payload at the start and end of any drag lifecycle.
  window.addEventListener('dragstart', clearActivePressmarkDragPayload, true)
  window.addEventListener('dragend', clearActivePressmarkDragPayload, true)
  window.addEventListener('drop', clearActivePressmarkDragPayload, true)
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
  const raw = dataTransfer.getData(FALLBACK_TEXT_MIME)
  if (!raw || !raw.startsWith(FALLBACK_PREFIX)) {
    return null
  }

  try {
    const parsed = JSON.parse(raw.slice(FALLBACK_PREFIX.length)) as unknown
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

export function writePressmarkDragPayload(dataTransfer: DataTransfer, payload: DragPayloadRecord): void {
  bindCleanupListeners()

  const normalized = sanitizePayload(payload)
  activePressmarkDragPayload = normalized

  for (const [mime, value] of Object.entries(normalized)) {
    dataTransfer.setData(mime, value)
  }

  const fallback = `${FALLBACK_PREFIX}${JSON.stringify(normalized)}`
  dataTransfer.setData(FALLBACK_TEXT_MIME, fallback)

  // Older engines may expose text/plain through the text alias.
  try {
    dataTransfer.setData(FALLBACK_TEXT_ALIAS_MIME, fallback)
  } catch {
    // Ignore unsupported aliases.
  }
}

export function readPressmarkDragData(dataTransfer: DataTransfer, mime: string): string {
  const direct = dataTransfer.getData(mime)
  if (direct) {
    return direct
  }

  const fallback = readFallbackPayload(dataTransfer)
  if (fallback?.[mime]) {
    return fallback[mime]
  }

  return activePressmarkDragPayload?.[mime] ?? ''
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
