export interface OutputFile {
  filename: string
  mimeType: string
  data: Buffer
}

export interface CompileOutput {
  success: boolean
  outputs: OutputFile[]
  log?: string
  error?: string
}

export interface CompileContext {
  rootFile: string
  srcDir: string
  outDir: string
  timeoutMs: number
}

export interface RendererCapabilities {
  /** Output formats this renderer can produce (e.g. ['pdf'], ['html', 'pdf']) */
  outputFormats: string[]
  /** Whether the renderer requires a persistent background process (e.g. Jupyter kernel) */
  needsPersistentProcess: boolean
  /** Whether the frontend can render a live preview client-side without a compile round-trip */
  supportsClientPreview: boolean
}

export interface Renderer {
  id: string
  capabilities: RendererCapabilities
  canHandle(rootFile: string): boolean
  compile(ctx: CompileContext): Promise<CompileOutput>
}
