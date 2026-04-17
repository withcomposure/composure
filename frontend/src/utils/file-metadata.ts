export type NodeType = 'text' | 'asset' | 'folder'

export interface FileMetadata {
  type: NodeType
  id?: string
  storageKey?: string
  size?: number
  mimeType?: string
}

const uidHexPattern = /^[a-f0-9]{32}$/

export function createUid(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function parseFileMetadata(raw: string): FileMetadata {
  if (!raw) return { type: 'text' }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as FileMetadata
    }
  } catch {
    // Legacy plain string format.
  }
  return { type: 'text' }
}

export function serializeFileMetadata(meta: FileMetadata): string {
  return JSON.stringify(meta)
}

export function withFileId(meta: FileMetadata): FileMetadata {
  if (meta.type === 'folder') {
    return { ...meta, id: undefined }
  }
  if (meta.id && uidHexPattern.test(meta.id)) {
    return meta
  }
  return { ...meta, id: createUid() }
}

/** Collapse consecutive slashes, strip leading/trailing slashes, and trim whitespace from a workspace-relative path. */
export function normalizeWorkspacePath(raw: string): string {
  return raw.trim().replace(/\/+/g, '/').replace(/^\/|\/$/g, '')
}
