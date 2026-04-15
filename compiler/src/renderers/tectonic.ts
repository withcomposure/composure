import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import type { Renderer, CompileContext, CompileOutput } from './types.js'

const TECTONIC_CACHE = process.env.TECTONIC_CACHE ?? '/var/pressmark/caches/tectonic'

export const tectonicRenderer: Renderer = {
  id: 'tectonic',

  capabilities: {
    outputFormats: ['pdf'],
    needsPersistentProcess: false,
    supportsClientPreview: false,
  },

  canHandle(): boolean {
    return true // Fallback renderer for LaTeX and any unmatched extensions
  },

  compile(ctx: CompileContext): Promise<CompileOutput> {
    return new Promise((resolve) => {
      const proc = spawn(
        'tectonic',
        ['-X', 'compile', ctx.rootFile, '--keep-logs', '--outdir', ctx.outDir],
        {
          cwd: ctx.srcDir,
          env: {
            ...process.env,
            XDG_CACHE_HOME: TECTONIC_CACHE,
            TECTONIC_CACHE_DIR: TECTONIC_CACHE,
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
            error: stderr || `Tectonic exited with code ${code}`,
            log,
          })
          return
        }

        const pdfName = path.basename(ctx.rootFile).replace(/\.[^./]+$/, '.pdf')
        const pdfPath = path.join(ctx.outDir, pdfName)
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
        resolve({ success: false, outputs: [], error: `Failed to start tectonic: ${err.message}` })
      })
    })
  },
}
