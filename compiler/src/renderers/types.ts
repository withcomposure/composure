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

export interface Renderer {
  id: string
  canHandle(rootFile: string): boolean
  compile(ctx: CompileContext): Promise<CompileOutput>
}
