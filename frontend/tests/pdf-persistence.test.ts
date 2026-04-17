import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Tests the sessionStorage persistence contract used by ProjectWorkspace
 * for restoring the last known PDF preview URL across page reloads.
 *
 * The workspace writes:   sessionStorage.setItem(`composure:pdfUrl:${projectId}`, url)
 * The workspace reads:    sessionStorage.getItem(`composure:pdfUrl:${projectId}`)
 */

const STORAGE_KEY = (projectId: string) => `composure:pdfUrl:${projectId}`

describe('PDF URL sessionStorage persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    const url = sessionStorage.getItem(STORAGE_KEY('project-1'))
    expect(url).toBeNull()
  })

  it('persists and retrieves a PDF URL', () => {
    const pdfUrl = '/api/v1/projects/project-1/preview.pdf?v=abc123'
    sessionStorage.setItem(STORAGE_KEY('project-1'), pdfUrl)

    const restored = sessionStorage.getItem(STORAGE_KEY('project-1'))
    expect(restored).toBe(pdfUrl)
  })

  it('isolates URLs per project', () => {
    sessionStorage.setItem(STORAGE_KEY('project-1'), '/api/v1/projects/project-1/preview.pdf?v=aaa')
    sessionStorage.setItem(STORAGE_KEY('project-2'), '/api/v1/projects/project-2/preview.pdf?v=bbb')

    expect(sessionStorage.getItem(STORAGE_KEY('project-1'))).toBe(
      '/api/v1/projects/project-1/preview.pdf?v=aaa',
    )
    expect(sessionStorage.getItem(STORAGE_KEY('project-2'))).toBe(
      '/api/v1/projects/project-2/preview.pdf?v=bbb',
    )
  })

  it('overwrites previous URL on recompile', () => {
    sessionStorage.setItem(STORAGE_KEY('project-1'), '/api/v1/projects/project-1/preview.pdf?v=old')
    sessionStorage.setItem(STORAGE_KEY('project-1'), '/api/v1/projects/project-1/preview.pdf?v=new')

    expect(sessionStorage.getItem(STORAGE_KEY('project-1'))).toBe(
      '/api/v1/projects/project-1/preview.pdf?v=new',
    )
  })

  it('preserves shareToken in URL round-trip', () => {
    const url = '/api/v1/projects/project-1/preview.pdf?v=abc&shareToken=tok123'
    sessionStorage.setItem(STORAGE_KEY('project-1'), url)

    const restored = sessionStorage.getItem(STORAGE_KEY('project-1'))
    expect(restored).toBe(url)
    expect(new URL(restored!, 'http://localhost').searchParams.get('shareToken')).toBe('tok123')
  })

  it('removes stored URL when output is cleared', () => {
    sessionStorage.setItem(STORAGE_KEY('project-1'), '/api/v1/projects/project-1/preview.pdf?v=abc123')

    sessionStorage.removeItem(STORAGE_KEY('project-1'))

    expect(sessionStorage.getItem(STORAGE_KEY('project-1'))).toBeNull()
  })
})
