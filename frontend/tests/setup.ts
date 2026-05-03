import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Need to mock Excalidraw for tests, since it runs browser-specific DOM code
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => null,
  exportToBlob: vi.fn(),
  serializeAsJSON: vi.fn(),
  // whatever else WhiteboardCanvas imports
}))