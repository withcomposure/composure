import {
  exportToBlob,
  exportToSvg,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

export async function exportWhiteboardAsPng(api: ExcalidrawImperativeAPI, title: string): Promise<void> {
  const elements = api.getSceneElements()
  const files = api.getFiles()
  const appState = api.getAppState()

  if (elements.length === 0) {
    throw new Error('Add at least one element before exporting PNG.')
  }

  const blob = await exportToBlob({
    elements,
    files,
    appState,
    mimeType: 'image/png',
    exportPadding: 16,
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title || 'whiteboard'}.png`
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportWhiteboardAsSvg(api: ExcalidrawImperativeAPI, title: string): Promise<void> {
  const elements = api.getSceneElements()
  const files = api.getFiles()
  const appState = api.getAppState()

  if (elements.length === 0) {
    throw new Error('Add at least one element before exporting SVG.')
  }

  const svg = await exportToSvg({
    elements,
    files,
    appState,
    exportPadding: 16,
  })

  const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title || 'whiteboard'}.svg`
  link.click()
  URL.revokeObjectURL(url)
}
