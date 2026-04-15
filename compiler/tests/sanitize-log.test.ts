import { describe, it, expect } from 'vitest'
import { sanitizeCompileLog } from '../src/utils.js'

describe('sanitizeCompileLog', () => {
  it('returns undefined for undefined input', () => {
    expect(sanitizeCompileLog(undefined, '/tmp/proj', '/compiles', '/tectonic', '/typst')).toBeUndefined()
  })

  it('replaces project dir with <build>', () => {
    const log = 'Error in /tmp/proj/main.tex at line 5'
    const result = sanitizeCompileLog(log, '/tmp/proj', '/compiles', '/tectonic', '/typst')
    expect(result).toBe('Error in <build>/main.tex at line 5')
    expect(result).not.toContain('/tmp/proj')
  })

  it('replaces compile dir with <build>', () => {
    const log = 'Output written to /compiles/output.pdf'
    const result = sanitizeCompileLog(log, '/tmp/proj', '/compiles', '/tectonic', '/typst')
    expect(result).toBe('Output written to <build>/output.pdf')
  })

  it('replaces tectonic cache with <cache>', () => {
    const log = 'Loading package from /tectonic/files/abc123'
    const result = sanitizeCompileLog(log, '/tmp/proj', '/compiles', '/tectonic', '/typst')
    expect(result).toBe('Loading package from <cache>/files/abc123')
  })

  it('replaces typst cache with <cache>', () => {
    const log = 'Cache hit at /typst/fonts/example'
    const result = sanitizeCompileLog(log, '/tmp/proj', '/compiles', '/tectonic', '/typst')
    expect(result).toBe('Cache hit at <cache>/fonts/example')
  })

  it('replaces multiple occurrences', () => {
    const log = '/tmp/proj/a.tex and /tmp/proj/b.tex'
    const result = sanitizeCompileLog(log, '/tmp/proj', '/compiles', '/tectonic', '/typst')
    expect(result).toBe('<build>/a.tex and <build>/b.tex')
  })

  it('leaves non-sensitive text unchanged', () => {
    const log = 'Compilation successful, 0 warnings'
    const result = sanitizeCompileLog(log, '/tmp/proj', '/compiles', '/tectonic', '/typst')
    expect(result).toBe('Compilation successful, 0 warnings')
  })
})
