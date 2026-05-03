import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Need to mock Excalidraw for tests, since it runs browser-specific DOM code
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => null,
  CaptureUpdateAction: {
    NEVER: 'NEVER',
    IMMEDIATELY: 'IMMEDIATELY',
    EVENTUALLY: 'EVENTUALLY',
  },
  exportToBlob: vi.fn(),
  serializeAsJSON: vi.fn(),
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
  // whatever else WhiteboardCanvas imports
}))