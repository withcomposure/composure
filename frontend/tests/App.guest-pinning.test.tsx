import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'

const guestId = 'guest-1'
const projectId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('App guest dashboard pinning', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.setItem('pressmark.auth-entry', 'granted')
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

      if (url === '/api/auth/session') {
        return json({
          authenticated: false,
          user: null,
          principal: { userId: null, guestId },
          guestRetentionDays: 30,
          userCount: 1,
          signupMode: 'open',
        })
      }

      if (url === '/api/projects') {
        return json([
          {
            id: projectId,
            title: 'Guest Project',
            rootFile: 'main.tex',
            createdAt: 1710000000,
            lastActiveAt: 1710000100,
            topLevelCommentCount: 0,
            ownerType: 'guest',
            ownerDisplayName: 'Guest Owner',
            ownerProfileImageUrl: null,
          },
        ])
      }

      if (url === '/api/projects/shared-with-me') {
        return json([])
      }

      if (url === '/api/projects/recents') {
        return json([])
      }

      if (url === '/api/projects/trash') {
        return json({ projects: [], retentionDays: 30 })
      }

      if (url === '/api/preferences') {
        return json({
          appearance: 'system',
          recentItemsLimit: 10,
          autoCompileDefault: false,
          autoCompileTimeoutSeconds: 2,
          editorBraceMatching: true,
          editorHighlightSelectionMatches: true,
          editorInEditorFind: true,
          editorAutocomplete: true,
          editorAutoCloseLatexBeginEnd: true,
          dashboardSortBy: 'last-active',
          dashboardLayout: 'grid',
          pinnedProjectIds: [],
          quickAccessPinnedLimit: 8,
          autoVersionIntervalMinutes: 5,
          autoSaveOnCompile: true,
          autoSaveOnExport: true,
        })
      }

      return json({ error: `Unhandled request: ${url}` }, 500)
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('keeps pinned projects for guests after toggling pin', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('Guest Project')

    const pinButton = screen.getAllByTitle('Pin')[0]
    await user.click(pinButton)

    await waitFor(() => {
      const raw = window.localStorage.getItem('pressmark.dashboard-preferences.v1:guest:guest-1')
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw as string) as { pinnedProjectIds?: string[] }
      expect(parsed.pinnedProjectIds).toContain(projectId)
    })
  })
})
