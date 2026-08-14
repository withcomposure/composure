import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import type { Renderer, CompileContext, CompileOutput } from './types.js'

const typstCache = process.env.TYPST_CACHE ?? '/var/composure/caches/typst'

export const typstRenderer: Renderer = {
  id: 'typst',

  canHandle(rootFile: string): boolean {
    return path.extname(rootFile).toLowerCase() === '.typ'
  },

  compile(ctx: CompileContext): Promise<CompileOutput> {
    return new Promise((resolve) => {
      const pdfName = path.basename(ctx.rootFile).replace(/\.[^./]+$/, '.pdf')
      const pdfPath = path.join(ctx.outDir, pdfName)

      const proc = spawn(
        'typst',
        ['compile', ctx.rootFile, pdfPath, '--root', ctx.srcDir],
        {
          cwd: ctx.srcDir,
          env: {
            ...process.env,
            TYPST_CACHE_DIR: typstCache,
          },
        },
      )

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
            error: `Compilation timed out (${ctx.timeoutMs}ms)`,
            log: stdout + stderr,
          })
          return
        }

        const log = stdout + stderr
        if (code !== 0) {
          resolve({
            success: false,
            outputs: [],
            error: stderr || `Typst exited with code ${code}`,
            log,
          })
          return
        }

        if (!fs.existsSync(pdfPath)) {
          resolve({ success: false, outputs: [], error: 'PDF not generated', log })
          return
        }

        resolve({
          success: true,
          outputs: [{
            filename: pdfName,
            mimeType: 'application/pdf',
            data: fs.readFileSync(pdfPath),
          }],
          log,
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, outputs: [], error: `Failed to start typst: ${err.message}` })
      })
    })
  },
}
