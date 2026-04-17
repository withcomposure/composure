import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import type { Renderer, CompileContext, CompileOutput } from './types.js'

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

  capabilities: {
    outputFormats: ['pdf', 'docx', 'html', 'latex', 'typst'],
    needsPersistentProcess: false,
    supportsClientPreview: false,
  },

  canHandle(): boolean {
    // Pandoc is only invoked explicitly for exports, not auto-selected
    return false
  },

  compile(ctx: CompileContext): Promise<CompileOutput> {
    const pandocCtx = ctx as PandocCompileContext
    const format = pandocCtx.outputFormat ?? 'pdf'

    const ext = outputFormatToExt[format] ?? `.${format}`
    const mime = outputFormatToMime[format] ?? 'application/octet-stream'
    const outputName = path.basename(ctx.rootFile).replace(/\.[^./]+$/, ext)
    const outputPath = path.join(ctx.outDir, outputName)

    const pandocArgs = [ctx.rootFile, '-o', outputPath]

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

    return new Promise((resolve) => {
      const proc = spawn('pandoc', pandocArgs, {
        cwd: ctx.srcDir,
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      const timeout = setTimeout(() => {
        timedOut = true
        proc.kill('SIGKILL')
      }, ctx.timeoutMs)

      proc.on('close', (code) => {
        clearTimeout(timeout)

        if (timedOut) {
          resolve({
            success: false,
            outputs: [],
            error: `Pandoc timed out (${ctx.timeoutMs}ms)`,
            log: stdout + stderr,
          })
          return
        }

        const log = stdout + stderr
        if (code !== 0 || !fs.existsSync(outputPath)) {
          resolve({
            success: false,
            outputs: [],
            error: stderr || `Pandoc exited with code ${code}`,
            log,
          })
          return
        }

        resolve({
          success: true,
          outputs: [{
            filename: outputName,
            mimeType: mime,
            data: fs.readFileSync(outputPath),
          }],
          log,
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, outputs: [], error: `Failed to start pandoc: ${err.message}` })
      })
    })
  },
}
