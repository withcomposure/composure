import type { Renderer } from './types.js'
import { typstRenderer } from './typst.js'
import { tectonicRenderer } from './tectonic.js'
export { pandocRenderer } from './pandoc.js'

export type { Renderer, CompileContext, CompileOutput, OutputFile, RendererCapabilities } from './types.js'

// Ordered list — first match wins. Specific renderers before fallbacks.
const renderers: Renderer[] = [
  typstRenderer,
  tectonicRenderer, // Fallback: handles everything not matched above
]

export function selectRenderer(rootFile: string): Renderer {
  const renderer = renderers.find((r) => r.canHandle(rootFile))
  if (!renderer) {
    throw new Error(`No renderer available for: ${rootFile}`)
  }
  return renderer
}
