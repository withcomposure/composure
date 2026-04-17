import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import * as Y from 'yjs'
import { createTestApp, createTestProject, createTestSession, createTestUser, sessionCookie } from './helpers/setup.js'
import { sql } from '../src/db/connection.js'
import { loadDocument } from '../src/db/documents.js'
import { findTextSizeViolation } from '../src/text-size-limit.js'

let app: FastifyInstance

async function setMaxTextSizeLimit(bytes: number): Promise<void> {
  await sql`INSERT INTO server_settings (key, value, updated_at)
     VALUES ('max_text_file_size_bytes', ${String(bytes)}, extract(epoch from now())::integer)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
}

function createOversizedDocUpdate(filePath: string, content: string): string {
  const doc = new Y.Doc()
  try {
    const filesMap = doc.getMap<string>('files')
    filesMap.set(filePath, JSON.stringify({ type: 'text' }))
    doc.getText(`file:${filePath}`).insert(0, content)
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  } finally {
    doc.destroy()
  }
}

beforeEach(async () => {
  app = await createTestApp()
})

describe('text size validator', () => {
  it('detects oversize text even when doc content comes from applied updates', async () => {
    const source = new Y.Doc()
    source.getMap<string>('files').set('main.tex', JSON.stringify({ type: 'text' }))
    source.getText('file:main.tex').insert(0, 'x'.repeat(4096))
    const update = Y.encodeStateAsUpdate(source)

    const loadedFromUpdate = new Y.Doc()
    Y.applyUpdate(loadedFromUpdate, update)

    const violation = findTextSizeViolation(loadedFromUpdate, 1024)

    expect(violation).not.toBeNull()
    expect(violation?.filePath).toBe('main.tex')
    expect((violation?.sizeBytes ?? 0) > 1024).toBe(true)

    source.destroy()
    loadedFromUpdate.destroy()
  })
})

describe('text size API enforcement', () => {
  it('rejects oversized /api/v1/save payloads with 413', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    await setMaxTextSizeLimit(1024)
    const documentUpdateBase64 = createOversizedDocUpdate('main.tex', 'a'.repeat(2048))

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/save/${projectId}`,
      headers: {
        cookie: sessionCookie(sessionId),
      },
      payload: {
        documentUpdateBase64,
        reason: 'manual',
      },
    })

    expect(response.statusCode).toBe(413)
    expect((response.json() as { error?: string }).error ?? '').toMatch(/text size limit/i)
    expect(await loadDocument(projectId)).toBeNull()
  })

  it('rejects oversized /api/v1/compile document snapshots with 413', async () => {
    const user = await createTestUser()
    const sessionId = await createTestSession(user.id)
    const projectId = await createTestProject(user.id)

    await setMaxTextSizeLimit(1024)
    const documentUpdateBase64 = createOversizedDocUpdate('main.tex', 'b'.repeat(2048))

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compile',
      headers: {
        cookie: sessionCookie(sessionId),
      },
      payload: {
        projectId,
        rootFile: 'main.tex',
        documentUpdateBase64,
      },
    })

    expect(response.statusCode).toBe(413)
    expect((response.json() as { error?: string }).error ?? '').toMatch(/text size limit/i)
    expect(await loadDocument(projectId)).toBeNull()
  })
})
