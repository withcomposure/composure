import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

describe('App backend health gating', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/api/v1/auth/session' || url === '/api/v1/health') {
        throw new TypeError('fetch failed')
      }

      throw new Error(`Unhandled request: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('shows service unavailable page when backend is unreachable', async () => {
    render(<App />)

    expect(await screen.findByText('Service Unavailable')).toBeInTheDocument()
    expect(screen.getByText(/backend service is currently unreachable/i)).toBeInTheDocument()
    expect(screen.queryByText(/no accounts exist yet/i)).not.toBeInTheDocument()
  })
})
