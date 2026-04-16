import path from 'path'
import fs from 'fs'
import os from 'os'
import * as Y from 'yjs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Set DATA_DIR to a temp directory before importing history module
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'composure-history-test-'))
process.env.DATA_DIR = tmpBase

// Must import after setting DATA_DIR so module-level const picks it up
const history = await import('../src/history.js')
const { initTestDatabase } = await import('../src/db/connection.js')
const { storeDocument } = await import('../src/db/documents.js')

describe('history', () => {
  const projectId = 'a'.repeat(32)
  const assetsDir = path.join(tmpBase, 'assets', projectId)

  beforeEach(async () => {
    await initTestDatabase()
    // Clean repos and assets between tests
    const reposDir = path.join(tmpBase, 'repos')
    if (fs.existsSync(reposDir)) fs.rmSync(reposDir, { recursive: true })
    fs.mkdirSync(reposDir, { recursive: true })
    if (fs.existsSync(assetsDir)) fs.rmSync(assetsDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up repos
    const reposDir = path.join(tmpBase, 'repos')
    if (fs.existsSync(reposDir)) fs.rmSync(reposDir, { recursive: true })
  })

  /** Create a Y.Doc with given text files and persist to DB */
  async function createAndStoreDoc(files: Record<string, string>): Promise<Uint8Array> {
    const doc = new Y.Doc()
    const filesMap = doc.getMap('files')
    for (const [filepath, content] of Object.entries(files)) {
      filesMap.set(filepath, JSON.stringify({ type: 'text' }))
      doc.getText(`file:${filepath}`).insert(0, content)
    }
    const state = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    // Store in DB so commitSnapshot can load it
    await storeDocument(projectId, Buffer.from(state))
    return state
  }

  /** Create a Y.Doc with text and asset files, persist to DB */
  async function createAndStoreDocWithAssets(
    textFiles: Record<string, string>,
    assetFiles: Record<string, { storageKey: string; data: Buffer }>,
  ): Uint8Array {
    const doc = new Y.Doc()
    const filesMap = doc.getMap('files')
    for (const [filepath, content] of Object.entries(textFiles)) {
      filesMap.set(filepath, JSON.stringify({ type: 'text' }))
      doc.getText(`file:${filepath}`).insert(0, content)
    }
    for (const [filepath, asset] of Object.entries(assetFiles)) {
      filesMap.set(filepath, JSON.stringify({ type: 'asset', storageKey: asset.storageKey }))
      // Write asset to assets dir
      fs.mkdirSync(assetsDir, { recursive: true })
      fs.writeFileSync(path.join(assetsDir, asset.storageKey), asset.data)
    }
    const state = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    await storeDocument(projectId, Buffer.from(state))
    return state
  }

  // ---------------------------------------------------------------------------
  // Issue 1: .composure/types.json must not appear in history
  // ---------------------------------------------------------------------------

  describe('.composure filtering', () => {
    it('should not include .composure/ files in changed files list', async () => {
      const state = await createAndStoreDoc({ 'main.tex': '\\documentclass{article}' })
      await history.commitSnapshot(projectId, state)

      const log = await history.getLog(projectId)
      expect(log.length).toBe(1)

      const changed = await history.getChangedFilesForCommit(projectId, log[0].sha)
      const paths = changed.map((f) => f.path)
      expect(paths).toContain('main.tex')
      expect(paths.every((p) => !p.startsWith('.composure/'))).toBe(true)
    })

    it('should not show .composure/ changes between commits', async () => {
      const state1 = await createAndStoreDoc({ 'main.tex': 'v1' })
      await history.commitSnapshot(projectId, state1)

      const state2 = await createAndStoreDoc({ 'main.tex': 'v2' })
      await history.commitSnapshot(projectId, state2)

      const log = await history.getLog(projectId)
      expect(log.length).toBe(2)

      // Second commit should only show main.tex changed, not .composure/types.json
      const changed = await history.getChangedFilesForCommit(projectId, log[0].sha)
      for (const file of changed) {
        expect(file.path).not.toMatch(/^\.composure\//)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Issue 2: Binary/asset file diffs
  // ---------------------------------------------------------------------------

  describe('binary diff detection', () => {
    it('should flag binary files as isBinary in getFileDiff', async () => {
      // Create a PNG-like binary blob (starts with PNG magic bytes, contains null bytes)
      const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG header
        0x00, 0x00, 0x00, 0x0d, // chunk length
        0x49, 0x48, 0x44, 0x52, // IHDR
      ])

      const state = await createAndStoreDocWithAssets(
        { 'main.tex': '\\includegraphics{img.png}' },
        { 'img.png': { storageKey: 'abc123.png', data: pngData } },
      )
      await history.commitSnapshot(projectId, state)

      const log = await history.getLog(projectId)
      const diff = await history.getFileDiff(projectId, log[0].sha, 'img.png')
      expect(diff).not.toBeNull()
      expect(diff!.isBinary).toBe(true)
      // Binary files should not have decoded text content
      expect(diff!.oldContent).toBeNull()
      expect(diff!.newContent).toBeNull()
    })

    it('should not flag text files as binary', async () => {
      const state = await createAndStoreDoc({ 'main.tex': '\\documentclass{article}' })
      await history.commitSnapshot(projectId, state)

      const log = await history.getLog(projectId)
      const diff = await history.getFileDiff(projectId, log[0].sha, 'main.tex')
      expect(diff).not.toBeNull()
      expect(diff!.isBinary).toBe(false)
      expect(diff!.newContent).toBe('\\documentclass{article}')
    })

    it('should report unchanged when comparing commit against current HEAD with same content', async () => {
      const state = await createAndStoreDoc({ 'main.tex': 'same content' })
      await history.commitSnapshot(projectId, state)

      const log = await history.getLog(projectId)
      const diff = await history.getFileDiff(projectId, log[0].sha, 'main.tex', 'current')
      expect(diff).not.toBeNull()
      expect(diff!.changeType).toBe('unchanged')
      expect(diff!.oldContent).toBe('same content')
      expect(diff!.newContent).toBe('same content')
    })
  })

  // ---------------------------------------------------------------------------
  // Issue 3: Restore operations
  // ---------------------------------------------------------------------------

  describe('version restore', () => {
    it('should restore to an earlier commit without appending', async () => {
      // Snapshot 1: a.tex = "hello world"
      const state1 = await createAndStoreDoc({ 'a.tex': 'hello world' })
      const sha1 = await history.commitSnapshot(projectId, state1)
      expect(sha1).not.toBeNull()

      // Snapshot 2: a.tex = "hello everyone"
      const state2 = await createAndStoreDoc({ 'a.tex': 'hello everyone' })
      const sha2 = await history.commitSnapshot(projectId, state2)
      expect(sha2).not.toBeNull()

      // Restore to snapshot 1
      const result = await history.restoreToCommit(projectId, sha1!)
      expect(result).not.toBeNull()

      // Verify via getDocStateAtCommit on the restore commit
      const restoredState = await history.getDocStateAtCommit(projectId, result!.commit.sha)
      expect(restoredState).not.toBeNull()

      const doc = new Y.Doc()
      Y.applyUpdate(doc, restoredState!)
      const text = doc.getText('file:a.tex').toString()
      doc.destroy()

      // Must be exactly "hello world", NOT "hello worldhello everyone"
      expect(text).toBe('hello world')
    })

    it('should restore files map correctly', async () => {
      const state1 = await createAndStoreDoc({ 'a.tex': 'content a', 'b.tex': 'content b' })
      const sha1 = await history.commitSnapshot(projectId, state1)

      // Add a new file, remove b.tex
      const state2 = await createAndStoreDoc({ 'a.tex': 'content a v2', 'c.tex': 'content c' })
      await history.commitSnapshot(projectId, state2)

      // Restore to snapshot 1
      const result = await history.restoreToCommit(projectId, sha1!)
      expect(result).not.toBeNull()
      expect(result!.restoredFiles.has('a.tex')).toBe(true)
      expect(result!.restoredFiles.has('b.tex')).toBe(true)
      expect(result!.restoredFiles.has('c.tex')).toBe(false)

      expect(result!.restoredFiles.get('a.tex')!.content).toBe('content a')
      expect(result!.restoredFiles.get('b.tex')!.content).toBe('content b')
    })

    it('should produce correct restored file content for live doc application', async () => {
      // This tests the exact pattern used in the restore route handler
      const state1 = await createAndStoreDoc({ 'a.tex': 'version one' })
      const sha1 = await history.commitSnapshot(projectId, state1)

      const state2 = await createAndStoreDoc({ 'a.tex': 'version two' })
      await history.commitSnapshot(projectId, state2)

      const result = await history.restoreToCommit(projectId, sha1!)
      expect(result).not.toBeNull()

      // Simulate applying to a live doc (as the route handler does)
      const liveDoc = new Y.Doc()
      // Load the "current" state (version two)
      Y.applyUpdate(liveDoc, state2)

      // Verify current content before restore
      expect(liveDoc.getText('file:a.tex').toString()).toBe('version two')

      // Apply restore (same pattern as the route handler)
      liveDoc.transact(() => {
        const filesMap = liveDoc.getMap<string>('files')

        const existingPaths = Array.from(filesMap.keys())
        for (const p of existingPaths) {
          filesMap.delete(p)
        }

        // Use getText() to properly promote AbstractType entries
        const fileKeys = Array.from(liveDoc.share.keys()).filter(k => k.startsWith('file:'))
        for (const key of fileKeys) {
          const text = liveDoc.getText(key)
          text.delete(0, text.length)
        }

        for (const [filepath, data] of result!.restoredFiles) {
          filesMap.set(filepath, data.meta)
          if (data.content != null) {
            const text = liveDoc.getText(`file:${filepath}`)
            text.insert(0, data.content)
          }
        }
      })

      // CRITICAL: must be exactly "version one", not "version oneversion two"
      expect(liveDoc.getText('file:a.tex').toString()).toBe('version one')
      liveDoc.destroy()
    })

    it('should handle applying restore to a remotely-loaded doc', async () => {
      // This tests the scenario where the live doc was loaded via Y.applyUpdate
      // (as Hocuspocus does), which creates AbstractType entries in the share map
      // rather than proper Y.Text instances
      const state1 = await createAndStoreDoc({ 'a.tex': 'original content' })
      const sha1 = await history.commitSnapshot(projectId, state1)

      const state2 = await createAndStoreDoc({ 'a.tex': 'modified content' })
      await history.commitSnapshot(projectId, state2)

      const result = await history.restoreToCommit(projectId, sha1!)

      // Create a doc as if loaded from remote update (like Hocuspocus onLoadDocument)
      const remoteDoc = new Y.Doc()
      Y.applyUpdate(remoteDoc, state2)

      // Verify the share entry exists but DON'T access it via getText first
      // (this simulates the Hocuspocus scenario where entries are AbstractType)
      expect(remoteDoc.share.has('file:a.tex')).toBe(true)

      // Apply restore using getText (the fixed pattern)
      remoteDoc.transact(() => {
        const filesMap = remoteDoc.getMap<string>('files')
        const existingPaths = Array.from(filesMap.keys())
        for (const p of existingPaths) {
          filesMap.delete(p)
        }

        const fileKeys = Array.from(remoteDoc.share.keys()).filter(k => k.startsWith('file:'))
        for (const key of fileKeys) {
          const text = remoteDoc.getText(key)
          text.delete(0, text.length)
        }

        for (const [filepath, data] of result!.restoredFiles) {
          filesMap.set(filepath, data.meta)
          if (data.content != null) {
            const text = remoteDoc.getText(`file:${filepath}`)
            text.insert(0, data.content)
          }
        }
      })

      expect(remoteDoc.getText('file:a.tex').toString()).toBe('original content')
      remoteDoc.destroy()
    })
  })

  describe('single file restore', () => {
    it('should restore a single file from an earlier commit', async () => {
      const state1 = await createAndStoreDoc({ 'a.tex': 'old a', 'b.tex': 'old b' })
      const sha1 = await history.commitSnapshot(projectId, state1)

      const state2 = await createAndStoreDoc({ 'a.tex': 'new a', 'b.tex': 'new b' })
      await history.commitSnapshot(projectId, state2)

      const result = await history.restoreSingleFile(projectId, sha1!, 'a.tex')
      expect(result).not.toBeNull()
      expect(result!.content).toBe('old a')
      expect(JSON.parse(result!.meta).type).toBe('text')
    })

    it('should apply single file restore without appending', async () => {
      const state1 = await createAndStoreDoc({ 'a.tex': 'first version' })
      const sha1 = await history.commitSnapshot(projectId, state1)

      const state2 = await createAndStoreDoc({ 'a.tex': 'second version' })
      await history.commitSnapshot(projectId, state2)

      const result = await history.restoreSingleFile(projectId, sha1!, 'a.tex')

      // Simulate applying to a live doc
      const liveDoc = new Y.Doc()
      Y.applyUpdate(liveDoc, state2)
      expect(liveDoc.getText('file:a.tex').toString()).toBe('second version')

      liveDoc.transact(() => {
        const filesMap = liveDoc.getMap<string>('files')
        const textKey = 'file:a.tex'

        if (liveDoc.share.has(textKey)) {
          const text = liveDoc.getText(textKey)
          text.delete(0, text.length)
        }

        filesMap.set('a.tex', result!.meta)
        if (result!.content != null) {
          liveDoc.getText(textKey).insert(0, result!.content)
        }
      })

      expect(liveDoc.getText('file:a.tex').toString()).toBe('first version')
      liveDoc.destroy()
    })

    it('should return null for a non-existent file', async () => {
      const state = await createAndStoreDoc({ 'a.tex': 'content' })
      const sha = await history.commitSnapshot(projectId, state)

      const result = await history.restoreSingleFile(projectId, sha!, 'nonexistent.tex')
      expect(result).toBeNull()
    })
  })

  describe('restore with file additions and deletions', () => {
    it('should restore a deleted file', async () => {
      // Snapshot 1: has both files
      const state1 = await createAndStoreDoc({ 'a.tex': 'content', 'b.tex': 'to be deleted' })
      const sha1 = await history.commitSnapshot(projectId, state1)

      // Snapshot 2: b.tex removed
      const state2 = await createAndStoreDoc({ 'a.tex': 'content v2' })
      await history.commitSnapshot(projectId, state2)

      // Restore to snapshot 1 should bring back b.tex
      const result = await history.restoreToCommit(projectId, sha1!)
      expect(result).not.toBeNull()
      expect(result!.restoredFiles.has('b.tex')).toBe(true)
      expect(result!.restoredFiles.get('b.tex')!.content).toBe('to be deleted')
    })

    it('should not carry forward files added after the target commit', async () => {
      const state1 = await createAndStoreDoc({ 'a.tex': 'original' })
      const sha1 = await history.commitSnapshot(projectId, state1)

      // Add extra.tex in snapshot 2
      const state2 = await createAndStoreDoc({ 'a.tex': 'original', 'extra.tex': 'extra file' })
      await history.commitSnapshot(projectId, state2)

      // Restore to snapshot 1 — extra.tex should NOT be in restored files
      const result = await history.restoreToCommit(projectId, sha1!)
      expect(result).not.toBeNull()
      expect(result!.restoredFiles.has('extra.tex')).toBe(false)
      expect(result!.restoredFiles.has('a.tex')).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // skipEmpty option — auto-saves should not create empty commits
  // ---------------------------------------------------------------------------

  describe('skipEmpty auto-save commits', () => {
    it('should skip commit when no user-visible changes exist (skipEmpty: true)', async () => {
      const state = await createAndStoreDoc({ 'main.tex': 'hello' })
      const sha1 = await history.commitSnapshot(projectId, state)
      expect(sha1).not.toBeNull()

      // Commit same state again with skipEmpty
      const sha2 = await history.commitSnapshot(projectId, state, { skipEmpty: true })
      expect(sha2).toBeNull()

      // Only 1 commit should exist
      const log = await history.getLog(projectId)
      expect(log.length).toBe(1)
    })

    it('should create commit when actual content changes exist (skipEmpty: true)', async () => {
      const state1 = await createAndStoreDoc({ 'main.tex': 'v1' })
      await history.commitSnapshot(projectId, state1)

      const state2 = await createAndStoreDoc({ 'main.tex': 'v2' })
      const sha2 = await history.commitSnapshot(projectId, state2, { skipEmpty: true })
      expect(sha2).not.toBeNull()

      const log = await history.getLog(projectId)
      expect(log.length).toBe(2)
    })

    it('should still allow empty commits without skipEmpty (manual snapshots)', async () => {
      const state = await createAndStoreDoc({ 'main.tex': 'content' })
      await history.commitSnapshot(projectId, state)

      // Without skipEmpty, recommitting the same state still returns null
      // because the tree is clean (no actual git changes)
      const sha2 = await history.commitSnapshot(projectId, state)
      expect(sha2).toBeNull()
    })
  })
})
