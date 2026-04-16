import { describe, it, expect } from 'vitest'
import { normalizeWorkspacePath } from '../src/utils/file-metadata'

describe('normalizeWorkspacePath', () => {
  it('returns simple name unchanged', () => {
    expect(normalizeWorkspacePath('main.tex')).toBe('main.tex')
  })

  it('preserves a single-level nested path', () => {
    expect(normalizeWorkspacePath('src/main.tex')).toBe('src/main.tex')
  })

  it('collapses consecutive slashes', () => {
    expect(normalizeWorkspacePath('a////b')).toBe('a/b')
    expect(normalizeWorkspacePath('a//b//c')).toBe('a/b/c')
  })

  it('strips leading slashes', () => {
    expect(normalizeWorkspacePath('/a/b')).toBe('a/b')
    expect(normalizeWorkspacePath('///a')).toBe('a')
  })

  it('strips trailing slashes', () => {
    expect(normalizeWorkspacePath('a/b/')).toBe('a/b')
    expect(normalizeWorkspacePath('a///')).toBe('a')
  })

  it('strips both leading and trailing slashes', () => {
    expect(normalizeWorkspacePath('/a/b/')).toBe('a/b')
  })

  it('handles all slashes returning empty string', () => {
    expect(normalizeWorkspacePath('///')).toBe('')
    expect(normalizeWorkspacePath('/')).toBe('')
  })

  it('trims whitespace', () => {
    expect(normalizeWorkspacePath('  a/b  ')).toBe('a/b')
    expect(normalizeWorkspacePath('  ')).toBe('')
  })

  it('handles complex mixed case', () => {
    expect(normalizeWorkspacePath('  /a///b//c/  ')).toBe('a/b/c')
  })
})
