import { sql } from './connection.js'

/** Load a Yjs document state from PostgreSQL */
export async function loadDocument(name: string): Promise<Buffer | null> {
  const [row] = await sql`SELECT state FROM documents WHERE name = ${name}`
  if (row?.state) {
    const buf = Buffer.from(row.state as Uint8Array)
    console.info(`[db] load-hit name=${name} bytes=${buf.length}`)
    return buf
  }
  console.warn(`[db] load-miss name=${name}`)
  return null
}

/** Store a Yjs document state snapshot into PostgreSQL */
export async function storeDocument(name: string, state: Buffer): Promise<void> {
  await sql`
    INSERT INTO documents (name, state, updated_at)
    VALUES (${name}, ${state}, extract(epoch from now())::integer)
    ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `
  console.info(`[db] stored name=${name} bytes=${state.length}`)
}
