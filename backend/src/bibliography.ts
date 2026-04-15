import type { FastifyReply, FastifyRequest } from 'fastify'
import * as Y from 'yjs'
import { parse } from '@retorquere/bibtex-parser'
import type { Creator } from '@retorquere/bibtex-parser'
import { loadDocument } from './db/index.js'
import { isValidProjectId } from './security.js'

interface BibEntry {
  key: string
  type: string
  title?: string
  author?: string
  year?: string
  journal?: string
  [field: string]: string | undefined
}

function serializeField(value: unknown): string {
  if (!Array.isArray(value)) return String(value)
  if (value.length === 0) return ''
  // Creator array (author, editor, etc.)
  if (typeof value[0] === 'object' && value[0] !== null) {
    return (value as Creator[]).map(c =>
      c.name ?? [c.firstName, c.prefix, c.lastName, c.suffix].filter(Boolean).join(' ')
    ).join(' and ')
  }
  // String array (keywords, publisher, etc.)
  return (value as string[]).join(', ')
}

/**
 * GET /api/bibliography/:projectId
 * Extracts .bib content from the Yjs document and returns parsed entries.
 */
export async function bibliographyRoute(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = req.params as { projectId?: string }
  const projectId = String(params.projectId ?? '')

  if (!projectId || !isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  try {
    const stored = await loadDocument(projectId)
    if (!stored) {
      reply.send([])
      return
    }

    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(stored))

    const allEntries: BibEntry[] = []
    const keys = Array.from(doc.share.keys())

    for (const key of keys) {
      if (key.startsWith('file:') && key.endsWith('.bib')) {
        const content = doc.getText(key).toString()
        const { entries } = parse(content, { unsupported: 'ignore' })
        for (const entry of entries) {
          const bibEntry: BibEntry = { key: entry.key, type: entry.type }
          for (const [field, value] of Object.entries(entry.fields)) {
            if (value !== undefined) bibEntry[field] = serializeField(value)
          }
          allEntries.push(bibEntry)
        }
      }
    }

    doc.destroy()
    reply.send(allEntries)
  } catch (err: unknown) {
    console.error('[bibliography] Parse error:', err)
    reply.send([]) // Never crash, graceful degradation.
  }
}
