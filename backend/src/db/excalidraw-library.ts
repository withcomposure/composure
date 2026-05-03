import { sql } from './connection.js'

const MAX_LIBRARY_JSON_BYTES = 8 * 1024 * 1024

export interface ExcalidrawLibraryPersisted {
  libraryItems: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseExcalidrawLibraryBody(body: unknown): ExcalidrawLibraryPersisted | null {
  if (!isRecord(body)) {
    return null
  }
  if (!('libraryItems' in body)) {
    return null
  }
  const { libraryItems } = body
  if (!Array.isArray(libraryItems)) {
    return null
  }
  return { libraryItems }
}

export async function getUserExcalidrawLibrary(userId: string): Promise<ExcalidrawLibraryPersisted | null> {
  const [row] = await sql<{ library_json: unknown }>`
    SELECT library_json
    FROM user_excalidraw_libraries
    WHERE user_id = ${userId}
    LIMIT 1
  `

  if (!row) {
    return null
  }

  const parsed = row.library_json
  if (!isRecord(parsed) || !Array.isArray(parsed.libraryItems)) {
    return null
  }

  return { libraryItems: parsed.libraryItems }
}

export async function upsertUserExcalidrawLibrary(
  userId: string,
  library: ExcalidrawLibraryPersisted,
): Promise<void> {
  const jsonText = JSON.stringify(library)
  if (jsonText.length > MAX_LIBRARY_JSON_BYTES) {
    throw new Error('library-too-large')
  }

  await sql`
    INSERT INTO user_excalidraw_libraries (user_id, library_json, updated_at)
    VALUES (${userId}, ${sql.json(library as never)}::jsonb, extract(epoch from now())::integer)
    ON CONFLICT (user_id) DO UPDATE SET
      library_json = excluded.library_json,
      updated_at = excluded.updated_at
  `
}
