import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@excalidraw/excalidraw', () => ({
  exportToBlob: vi.fn(),
  exportToSvg: vi.fn(),
  useHandleLibrary: vi.fn(),
  serializeLibraryAsJSON: vi.fn((libraryItems: unknown) =>
    JSON.stringify({
      type: 'excalidrawlib',
      version: 2,
      source: 'https://withcomposure.com',
      libraryItems,
    }),
  ),
  loadLibraryFromBlob: vi.fn(async () => []),
}))

vi.mock('../src/whiteboard/useWhiteboardCollab', () => ({
  useWhiteboardCollab: () => ({
    connectionState: 'connected',
    collaborators: new Map(),
    activeCollaborators: [
      {
        clientId: 2,
        socketId: 'client:2' as import('@excalidraw/excalidraw/types').SocketId,
        name: 'Peer',
        profileImageUrl: null,
        hasPointer: true,
        userId: 'peer-user',
        guestId: null,
      },
    ],
    isCollaborating: true,
    isSynced: true,
    excalidrawApi: null,
    setExcalidrawApi: vi.fn(),
    handleSceneChange: vi.fn(),
    handlePointerUpdate: vi.fn(),
  }),
}))

vi.mock('../src/whiteboard/WhiteboardCanvas', () => ({
  WhiteboardCanvas: () => <div data-testid="whiteboard-canvas">Canvas</div>,
}))

import { WhiteboardWorkspace } from '../src/whiteboard/WhiteboardWorkspace'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('WhiteboardWorkspace layout', () => {
  beforeEach(() => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/api/v1/projects/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/access') {
        return json({
          people: [],
          linkSharing: {
            enabled: false,
            role: null,
            token: null,
          },
          currentRole: 'owner',
          maxTextFileSizeBytes: 5 * 1024 * 1024,
          largeFileThresholdChars: 500000,
        })
      }

      if (url === '/api/v1/excalidraw-library') {
        return json({ library: null })
      }

      return json({ error: `Unhandled request: ${url}` }, 500)
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders whiteboard top bar controls and full-canvas workspace surface', async () => {
    render(
      <WhiteboardWorkspace
        projectId="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        projectTitle="Roadmap Board"
        rootFile="scene.excalidraw"
        onBackToProjects={() => undefined}
        session={{
          accountLabel: 'Owner',
          accountEmail: 'owner@test.com',
          accountImageUrl: null,
          accountIsGuest: false,
          user: {
            id: 'user-1',
            email: 'owner@test.com',
            displayName: 'Owner',
            profileImageUrl: null,
            role: 'user',
          },
          principal: {
            userId: 'user-1',
            guestId: null,
          },
        }}
        onPopupAlert={() => undefined}
        onOpenSettings={() => undefined}
        onLogout={() => undefined}
        onLogin={() => undefined}
      />,
    )

    expect(await screen.findByTestId('whiteboard-canvas')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /View|Edit/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument()

    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
    expect(screen.queryByText('Compile')).not.toBeInTheDocument()
  })
})
