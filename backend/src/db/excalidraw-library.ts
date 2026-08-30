import { sql } from './connection.js'

const maxLibraryJsonBytes = 8 * 1024 * 1024
const excalidrawLibraryType = 'excalidrawlib'
const defaultLibrarySource = 'https://withcomposure.com'

export interface ExcalidrawLibraryPersisted {
  library: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isLibraryStatus(value: unknown): value is 'published' | 'unpublished' {
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

function isLibraryItemV2Shape(value: unknown): value is Record<string, unknown> {
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

function isLegacyLibraryItemShape(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every((element) => isLibraryElementShape(element))
}

function isLibraryItemAnyVersion(value: unknown): boolean {
  return isLibraryItemV2Shape(value) || isLegacyLibraryItemShape(value)
}

function isLibraryItemsAnyVersion(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every((item) => isLibraryItemAnyVersion(item))
}

function normalizeLibraryDocument(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (value.type !== excalidrawLibraryType) {
    return null
  }

  if (value.version !== 1 && value.version !== 2) {
    return null
  }

  const rawLibraryItems = value.libraryItems ?? value.library
  if (!isLibraryItemsAnyVersion(rawLibraryItems)) {
    return null
  }

  return JSON.stringify({
    type: excalidrawLibraryType,
    version: value.version,
    source: isNonEmptyString(value.source) ? value.source : defaultLibrarySource,
    libraryItems: rawLibraryItems,
  })
}

function parseAndNormalizeLibraryText(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return normalizeLibraryDocument(parsed)
  } catch {
    return null
  }
}

function serializeLegacyLibraryItems(items: unknown[]): string | null {
  if (!isLibraryItemsAnyVersion(items)) {
    return null
  }

  return JSON.stringify({
    type: excalidrawLibraryType,
    version: 2,
    source: defaultLibrarySource,
    libraryItems: items,
  })
}

export function parseExcalidrawLibraryBody(body: unknown): ExcalidrawLibraryPersisted | null {
  if (!isRecord(body)) {
    return null
  }

  if (typeof body.library === 'string') {
    const normalized = parseAndNormalizeLibraryText(body.library)
    return normalized ? { library: normalized } : null
  }

  if (Array.isArray(body.libraryItems)) {
    const normalized = serializeLegacyLibraryItems(body.libraryItems)
    return normalized ? { library: normalized } : null
  }

  return null
}

function parseStoredLibraryText(value: string): ExcalidrawLibraryPersisted | null {
  try {
    const parsed = JSON.parse(value) as unknown

    if (typeof parsed === 'string') {
      const normalized = parseAndNormalizeLibraryText(parsed)
      return normalized ? { library: normalized } : null
    }

    if (isRecord(parsed) && typeof parsed.library === 'string') {
      const normalized = parseAndNormalizeLibraryText(parsed.library)
      return normalized ? { library: normalized } : null
    }

    if (isRecord(parsed) && Array.isArray(parsed.libraryItems)) {
      const normalized = serializeLegacyLibraryItems(parsed.libraryItems)
      return normalized ? { library: normalized } : null
    }

    const normalized = normalizeLibraryDocument(parsed)
    return normalized ? { library: normalized } : null
  } catch {
    return null
  }
}

export async function getUserExcalidrawLibrary(userId: string): Promise<ExcalidrawLibraryPersisted | null> {
  const [row] = await sql<[{ library_text: string }?]>`
    SELECT library_json::text AS library_text
    FROM user_excalidraw_libraries
    WHERE user_id = ${userId}
    LIMIT 1
  `

  if (!row) {
    return null
  }

  return parseStoredLibraryText(row.library_text)
}

export async function upsertUserExcalidrawLibrary(
  userId: string,
  library: ExcalidrawLibraryPersisted,
): Promise<void> {
  const normalizedLibrary = parseAndNormalizeLibraryText(library.library)
  if (!normalizedLibrary) {
    throw new Error('invalid-library')
  }

  if (Buffer.byteLength(normalizedLibrary, 'utf8') > maxLibraryJsonBytes) {
    throw new Error('library-too-large')
  }

  await sql`
    INSERT INTO user_excalidraw_libraries (user_id, library_json, updated_at)
    VALUES (${userId}, ${normalizedLibrary}::jsonb, extract(epoch from now())::integer)
    ON CONFLICT (user_id) DO UPDATE SET
      library_json = excluded.library_json,
      updated_at = excluded.updated_at
  `
}
