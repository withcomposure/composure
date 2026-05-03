import '@testing-library/jest-dom'

// Need to mock Excalidraw for tests, since it runs browser-specific DOM code
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => null,
  LiveCollaborationTrigger: () => null,
  exportToBlob: vi.fn(),
  serializeAsJSON: vi.fn(),
  // whatever else WhiteboardCanvas imports
}))