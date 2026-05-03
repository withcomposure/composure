import { sql } from './connection.js'

const MAX_LIBRARY_JSON_BYTES = 8 * 1024 * 1024

export interface ExcalidrawLibraryPersisted {
  library: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function serializeLegacyLibraryItems(items: unknown[]): string {
  return JSON.stringify({
    type: 'excalidrawlib',
    version: 2,
    source: 'https://withcomposure.com',
    libraryItems: items,
  })
}

export function parseExcalidrawLibraryBody(body: unknown): ExcalidrawLibraryPersisted | null {
  if (!isRecord(body)) {
    return null
  }

  if (typeof body.library === 'string') {
    return { library: body.library }
  }

  if (Array.isArray(body.libraryItems)) {
    return { library: serializeLegacyLibraryItems(body.libraryItems) }
  }

  return null
}

function parseStoredLibraryText(value: string): ExcalidrawLibraryPersisted | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'string') {
      return { library: parsed }
    }
    if (isRecord(parsed) && typeof parsed.library === 'string') {
      return { library: parsed.library }
    }
    if (isRecord(parsed) && Array.isArray(parsed.libraryItems)) {
      return { library: serializeLegacyLibraryItems(parsed.libraryItems) }
    }
    return null
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
  const serializedLibrary = library.library
  const jsonText = JSON.stringify(serializedLibrary)
  if (jsonText.length > MAX_LIBRARY_JSON_BYTES) {
    throw new Error('library-too-large')
  }

  await sql`
    INSERT INTO user_excalidraw_libraries (user_id, library_json, updated_at)
    VALUES (${userId}, ${jsonText}::jsonb, extract(epoch from now())::integer)
    ON CONFLICT (user_id) DO UPDATE SET
      library_json = excluded.library_json,
      updated_at = excluded.updated_at
  `
}
