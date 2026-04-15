import path from 'path'
import fs from 'fs'
import * as Y from 'yjs'
import { loadDocument } from './db/index.js'
import { getProjectAssetsDir } from './storage.js'
import { isPathWithin, normalizeRelativePath } from './security.js'

/** Extract Yjs project files + assets into a directory on disk. */
export async function extractFiles(projectId: string, dir: string): Promise<void> {
  const stored = await loadDocument(projectId)
  if (stored) {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(stored))

    const filesMap = doc.getMap('files')

    for (const [filePath, mapContent] of filesMap.entries()) {
      const normalized = normalizeRelativePath(filePath)
      if (!normalized) continue

      let meta: { type: string; storageKey?: string } = { type: 'text' }
      if (typeof mapContent === 'string') {
        try {
          const parsed = JSON.parse(mapContent)
          if (parsed && typeof parsed === 'object' && 'type' in parsed) {
            meta = parsed
          }
        } catch {
          // Legacy plain-string entry → text
        }
      }

      if (meta.type === 'text') {
        const textKey = `file:${normalized}`
        const hasText = doc.share.has(textKey)
        if (hasText) {
          const fullPath = path.resolve(dir, normalized)
          if (!isPathWithin(dir, fullPath)) continue
          fs.mkdirSync(path.dirname(fullPath), { recursive: true })
          fs.writeFileSync(fullPath, doc.getText(textKey).toString(), 'utf-8')
        }
      } else if (meta.type === 'asset' && meta.storageKey) {
        const fullPath = path.resolve(dir, normalized)
        if (!isPathWithin(dir, fullPath)) continue
        const assetsDir = getProjectAssetsDir(projectId)
        const srcPath = path.join(assetsDir, meta.storageKey)
        if (fs.existsSync(srcPath)) {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true })
          fs.copyFileSync(srcPath, fullPath)
        }
      }
      // type === 'folder' → skip (directories created implicitly)
    }

    doc.destroy()
  }
}

/** Extract Yjs doc files into a directory (from an already-loaded Y.Doc). */
export function extractFilesFromDoc(doc: Y.Doc, projectId: string, dir: string): void {
  const filesMap = doc.getMap('files')
  const typeManifest: Record<string, 'text' | 'asset'> = {}

  for (const [filePath, mapContent] of filesMap.entries()) {
    const normalized = normalizeRelativePath(filePath)
    if (!normalized) continue

    let meta: { type: string; storageKey?: string } = { type: 'text' }
    if (typeof mapContent === 'string') {
      try {
        const parsed = JSON.parse(mapContent)
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          meta = parsed
        }
      } catch {
        // Legacy plain-string entry → text
      }
    }

    if (meta.type === 'text') {
      typeManifest[normalized] = 'text'
      const textKey = `file:${normalized}`
      const hasText = doc.share.has(textKey)
      if (hasText) {
        const fullPath = path.resolve(dir, normalized)
        if (!isPathWithin(dir, fullPath)) continue
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, doc.getText(textKey).toString(), 'utf-8')
      }
    } else if (meta.type === 'asset' && meta.storageKey) {
      typeManifest[normalized] = 'asset'
      const fullPath = path.resolve(dir, normalized)
      if (!isPathWithin(dir, fullPath)) continue
      const assetsDir = getProjectAssetsDir(projectId)
      const srcPath = path.join(assetsDir, meta.storageKey)
      if (fs.existsSync(srcPath)) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.copyFileSync(srcPath, fullPath)
      }
    }
  }

  // Write type manifest sidecar for git history classification
  const manifestDir = path.join(dir, '.pressmark')
  fs.mkdirSync(manifestDir, { recursive: true })
  fs.writeFileSync(path.join(manifestDir, 'types.json'), JSON.stringify(typeManifest), 'utf-8')
}
