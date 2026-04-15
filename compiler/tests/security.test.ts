import { describe, it, expect } from 'vitest'
import { normalizeRelativePath, isPathWithin } from '../src/utils.js'

describe('normalizeRelativePath', () => {
  it('normalizes simple paths', () => {
    expect(normalizeRelativePath('main.tex')).toBe('main.tex')
    expect(normalizeRelativePath('src/main.tex')).toBe('src/main.tex')
  })

  it('normalizes redundant separators', () => {
    expect(normalizeRelativePath('src//main.tex')).toBe('src/main.tex')
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeRelativePath('src\\main.tex')).toBe('src/main.tex')
  })

  it('rejects absolute paths', () => {
    expect(normalizeRelativePath('/etc/passwd')).toBeNull()
    expect(normalizeRelativePath('/root/file.tex')).toBeNull()
  })

  it('rejects Windows absolute paths', () => {
    expect(normalizeRelativePath('C:/Windows/system32')).toBeNull()
    expect(normalizeRelativePath('D:/file.tex')).toBeNull()
  })

  it('rejects traversal paths', () => {
    expect(normalizeRelativePath('../secret.txt')).toBeNull()
    expect(normalizeRelativePath('../../etc/passwd')).toBeNull()
    expect(normalizeRelativePath('..')).toBeNull()
  })

  it('rejects traversal through subdirectory', () => {
    expect(normalizeRelativePath('src/../../etc/passwd')).toBeNull()
  })

  it('rejects null bytes', () => {
    expect(normalizeRelativePath('file\x00.tex')).toBeNull()
  })

  it('rejects empty/whitespace input', () => {
    expect(normalizeRelativePath('')).toBeNull()
    expect(normalizeRelativePath('   ')).toBeNull()
    expect(normalizeRelativePath(null)).toBeNull()
    expect(normalizeRelativePath(undefined)).toBeNull()
  })

  it('rejects dot-only input', () => {
    expect(normalizeRelativePath('.')).toBeNull()
  })

  it('handles nested relative paths with dot segments', () => {
    expect(normalizeRelativePath('src/./main.tex')).toBe('src/main.tex')
  })
})

describe('isPathWithin', () => {
  it('returns true for path within base', () => {
    expect(isPathWithin('/home/project', '/home/project/src/main.tex')).toBe(true)
  })

  it('returns true for base dir itself', () => {
    expect(isPathWithin('/home/project', '/home/project')).toBe(true)
  })

  it('returns false for path outside base', () => {
    expect(isPathWithin('/home/project', '/home/other/file.txt')).toBe(false)
  })

  it('returns false for traversal escape', () => {
    expect(isPathWithin('/home/project', '/home/project/../other/file.txt')).toBe(false)
  })

  it('returns true for deeply nested path', () => {
    expect(isPathWithin('/home/project', '/home/project/a/b/c/d/file.tex')).toBe(true)
  })
})
