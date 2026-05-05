import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { HtmlPreview } from '../src/preview/HtmlPreview'

describe('HtmlPreview', () => {
  const createObjectUrlMock = vi.fn<(obj: Blob | MediaSource) => string>(() => 'blob:preview-test-url')
  const revokeObjectUrlMock = vi.fn()

  beforeEach(() => {
    createObjectUrlMock.mockClear()
    revokeObjectUrlMock.mockClear()
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectUrlMock)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectUrlMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the iframe from a blob URL', async () => {
    render(
      <HtmlPreview
        html={'<h2 id="section">Section</h2><p><a href="#section">Jump</a></p>'}
        error={null}
      />,
    )

    const iframe = screen.getByTitle('Document preview') as HTMLIFrameElement

    await waitFor(() => {
      expect(iframe.getAttribute('src')).toBe('blob:preview-test-url')
    })

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1)
  })

  it('uses a full-width root layout for fit mode', async () => {
    render(<HtmlPreview html={'<p>Preview</p>'} error={null} />)

    expect(createObjectUrlMock).toHaveBeenCalled()
    const firstBlobArg = createObjectUrlMock.mock.calls[0][0]
    if (!(firstBlobArg instanceof Blob)) {
      throw new Error('Expected HtmlPreview to generate a Blob document')
    }

    const srcdoc = typeof firstBlobArg.text === 'function'
      ? await firstBlobArg.text()
      : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read preview blob'))
        reader.readAsText(firstBlobArg)
      })
    expect(srcdoc).toContain('width: 100%;')
    expect(srcdoc).toContain('max-width: 100%;')
  })

  it('hides fit button in HTML preview toolbar', () => {
    render(<HtmlPreview html={'<p>Preview</p>'} error={null} />)

    expect(screen.queryByRole('button', { name: 'Fit' })).toBeNull()
    expect(screen.getByTitle('Zoom out')).toBeInTheDocument()
    expect(screen.getByTitle('Zoom in')).toBeInTheDocument()
  })

  it('revokes the blob URL when unmounted', () => {
    const { unmount } = render(<HtmlPreview html={'<p>Preview</p>'} error={null} />)

    unmount()

    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:preview-test-url')
  })
})
