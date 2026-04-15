import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { syncProjectSource } from '../src/utils.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pressmark-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('syncProjectSource', () => {
  it('writes new files', () => {
    const files = new Map<string, string>()
    files.set('main.tex', '\\documentclass{article}')
    files.set('chapter1.tex', '\\chapter{One}')

    const result = syncProjectSource(tmpDir, files)

    expect(result.written).toBe(2)
    expect(result.unchanged).toBe(0)
    expect(result.removed).toBe(0)
    expect(fs.readFileSync(path.join(tmpDir, 'main.tex'), 'utf8')).toBe('\\documentclass{article}')
    expect(fs.readFileSync(path.join(tmpDir, 'chapter1.tex'), 'utf8')).toBe('\\chapter{One}')
  })

  it('skips unchanged files', () => {
    const files = new Map<string, string>()
    files.set('main.tex', '\\documentclass{article}')

    // First sync
    syncProjectSource(tmpDir, files)

    // Second sync with same content
    const result = syncProjectSource(tmpDir, files)

    expect(result.written).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(result.removed).toBe(0)
  })

  it('updates changed files', () => {
    const files1 = new Map<string, string>()
    files1.set('main.tex', 'version 1')
    syncProjectSource(tmpDir, files1)

    const files2 = new Map<string, string>()
    files2.set('main.tex', 'version 2')
    const result = syncProjectSource(tmpDir, files2)

    expect(result.written).toBe(1)
    expect(result.unchanged).toBe(0)
    expect(fs.readFileSync(path.join(tmpDir, 'main.tex'), 'utf8')).toBe('version 2')
  })

  it('removes stale files', () => {
    const files1 = new Map<string, string>()
    files1.set('main.tex', 'content')
    files1.set('old.tex', 'old content')
    syncProjectSource(tmpDir, files1)

    const files2 = new Map<string, string>()
    files2.set('main.tex', 'content')
    const result = syncProjectSource(tmpDir, files2)

    expect(result.removed).toBe(1)
    expect(fs.existsSync(path.join(tmpDir, 'old.tex'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'main.tex'))).toBe(true)
  })

  it('creates nested directories as needed', () => {
    const files = new Map<string, string>()
    files.set('src/chapters/ch1.tex', 'chapter 1')

    const result = syncProjectSource(tmpDir, files)

    expect(result.written).toBe(1)
    expect(fs.readFileSync(path.join(tmpDir, 'src/chapters/ch1.tex'), 'utf8')).toBe('chapter 1')
  })

  it('rejects traversal paths', () => {
    const files = new Map<string, string>()
    files.set('../../../etc/passwd', 'hacked')
    files.set('main.tex', 'legit')

    const result = syncProjectSource(tmpDir, files)

    // Only the legitimate file should be written
    expect(result.written).toBe(1)
    expect(fs.existsSync(path.join(tmpDir, 'main.tex'))).toBe(true)
  })

  it('handles empty desired files', () => {
    // Pre-populate
    fs.writeFileSync(path.join(tmpDir, 'old.tex'), 'old')

    const result = syncProjectSource(tmpDir, new Map())

    expect(result.removed).toBe(1)
    expect(result.written).toBe(0)
    expect(result.unchanged).toBe(0)
  })
})
