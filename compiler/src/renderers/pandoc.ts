import path from 'path'
import fs from 'fs'
import type { Renderer, CompileContext, CompileOutput } from './types.js'
import { runCommand } from './run-command.js'

const outputFormatToExt: Record<string, string> = {
  pdf: '.pdf',
  docx: '.docx',
  html: '.html',
  latex: '.tex',
  typst: '.typ',
}

const outputFormatToMime: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html',
  latex: 'text/x-tex',
  typst: 'text/x-typst',
}

export interface PandocCompileContext extends CompileContext {
  outputFormat: string
}

export const pandocRenderer: Renderer = {
  id: 'pandoc',

  canHandle(): boolean {
    // Pandoc is only invoked explicitly for exports, not auto-selected
    return false
  },

  async compile(ctx: CompileContext): Promise<CompileOutput> {
    const pandocCtx = ctx as PandocCompileContext
    const format = pandocCtx.outputFormat ?? 'pdf'

    const ext = outputFormatToExt[format] ?? `.${format}`
    const mime = outputFormatToMime[format] ?? 'application/octet-stream'
    const outputName = path.basename(ctx.rootFile).replace(/\.[^./]+$/, ext)
    const outputPath = path.join(ctx.outDir, outputName)

    // All options first, then `--`, then the user-controlled input file. The
    // terminator prevents a rootFile like `--lua-filter=evil.lua` from being
    // parsed as a pandoc option (which could execute arbitrary code).
    const pandocArgs = ['-o', outputPath]

    if (format === 'html') {
      pandocArgs.push('--standalone')
    }

    // Add citeproc if .bib files are present
    const bibFiles = fs.readdirSync(ctx.srcDir).filter(f => f.endsWith('.bib'))
    if (bibFiles.length > 0) {
      pandocArgs.push('--citeproc')
      for (const bib of bibFiles) {
        pandocArgs.push('--bibliography', path.join(ctx.srcDir, bib))
      }
    }

    pandocArgs.push('--', ctx.rootFile)

    const result = await runCommand({
      bin: 'pandoc',
      args: pandocArgs,
      cwd: ctx.srcDir,
      timeoutMs: ctx.timeoutMs,
    })

    const log = result.stdout + result.stderr

    if (result.spawnError) {
      return { success: false, outputs: [], error: `Failed to start pandoc: ${result.spawnError}` }
    }
    if (result.timedOut) {
      return { success: false, outputs: [], error: `Pandoc timed out (${ctx.timeoutMs}ms)`, log }
    }
    if (result.code !== 0 || !fs.existsSync(outputPath)) {
      return { success: false, outputs: [], error: result.stderr || `Pandoc exited with code ${result.code}`, log }
    }

    return {
      success: true,
      outputs: [{
        filename: outputName,
        mimeType: mime,
        data: fs.readFileSync(outputPath),
      }],
      log,
    }
  },
}
