import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/workspace/ProjectWorkspace', () => ({
  ProjectWorkspace: () => <div data-testid="text-workspace">Text Workspace</div>,
}))

vi.mock('@/whiteboard/WhiteboardWorkspace', () => ({
  WhiteboardWorkspace: () => <div data-testid="whiteboard-workspace">Whiteboard Workspace</div>,
}))

import App from '../src/App'

const projectId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetchForProjectEngine(engine: 'excalidraw' | 'latex'): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    if (url === '/api/v1/auth/session') {
      return json({
        authenticated: true,
        user: {
          id: 'user-1',
          email: 'user@test.com',
          displayName: 'User',
          profileImageUrl: null,
          role: 'user',
        },
        principal: { userId: 'user-1', guestId: null },
        guestRetentionDays: 30,
        userCount: 1,
        signupMode: 'open',
        guestSignupsEnabled: true,
        enabledLoginProviders: ['password'],
      })
    }

    if (url === '/api/v1/projects') {
      return json([])
    }

    if (url === '/api/v1/projects/shared-with-me') {
      return json([])
    }

    if (url === '/api/v1/projects/recents') {
      return json([])
    }

    if (url === '/api/v1/projects/trash') {
      return json({ projects: [], retentionDays: 30 })
    }

    if (url === '/api/v1/preferences') {
      return json({
        appearance: 'system',
        theme: 'default',
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

    if (url === `/api/v1/projects/${projectId}/metadata`) {
      return json({
        id: projectId,
        title: engine === 'excalidraw' ? 'Board' : 'Paper',
        rootFile: engine === 'excalidraw' ? 'scene.excalidraw' : 'main.tex',
        engine,
      })
    }

    if (url === `/api/v1/projects/${projectId}/open` && init?.method === 'POST') {
      return json({ ok: true })
    }

    return json({ error: `Unhandled request: ${url}` }, 500)
  })

  vi.stubGlobal('fetch', fetchMock)
}

describe('App project workspace routing', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('composure.auth-entry', 'granted')
    window.history.replaceState(null, '', `/project/${projectId}`)
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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('routes excalidraw engine projects to whiteboard workspace', async () => {
    stubFetchForProjectEngine('excalidraw')

    render(<App />)

    expect(await screen.findByTestId('whiteboard-workspace')).toBeInTheDocument()
    expect(screen.queryByTestId('text-workspace')).not.toBeInTheDocument()
  })

  it('routes non-excalidraw projects to text workspace', async () => {
    stubFetchForProjectEngine('latex')

    render(<App />)

    expect(await screen.findByTestId('text-workspace')).toBeInTheDocument()
    expect(screen.queryByTestId('whiteboard-workspace')).not.toBeInTheDocument()
  })
})
