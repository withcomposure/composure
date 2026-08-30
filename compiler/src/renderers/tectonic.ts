import path from 'path'
import fs from 'fs'
import type { Renderer, CompileContext, CompileOutput } from './types.js'
import { runCommand } from './run-command.js'

const tectonicCache = process.env.TECTONIC_CACHE ?? '/var/composure/caches/tectonic'

export const tectonicRenderer: Renderer = {
  id: 'tectonic',

  canHandle(): boolean {
    return true // Fallback renderer for LaTeX and any unmatched extensions
  },

  async compile(ctx: CompileContext): Promise<CompileOutput> {
    // `--` terminates option parsing so a rootFile starting with `-` cannot inject flags.
    const result = await runCommand({
      bin: 'tectonic',
      args: ['-X', 'compile', '--keep-logs', '--outdir', ctx.outDir, '--', ctx.rootFile],
      cwd: ctx.srcDir,
      env: {
        ...process.env,
        XDG_CACHE_HOME: tectonicCache,
        TECTONIC_CACHE_DIR: tectonicCache,
      },
      timeoutMs: ctx.timeoutMs,
    })

    const log = result.stdout + result.stderr

    if (result.spawnError) {
      return { success: false, outputs: [], error: `Failed to start tectonic: ${result.spawnError}` }
    }
    if (result.timedOut) {
      return { success: false, outputs: [], error: `Compilation timed out (${ctx.timeoutMs}ms)`, log }
    }
    if (result.code !== 0) {
      return { success: false, outputs: [], error: result.stderr || `Tectonic exited with code ${result.code}`, log }
    }

    const pdfName = path.basename(ctx.rootFile).replace(/\.[^./]+$/, '.pdf')
    const pdfPath = path.join(ctx.outDir, pdfName)
    if (!fs.existsSync(pdfPath)) {
      return { success: false, outputs: [], error: 'PDF not generated', log }
    }

    return {
      success: true,
      outputs: [{
        filename: pdfName,
        mimeType: 'application/pdf',
        data: fs.readFileSync(pdfPath),
      }],
      log,
    }
  },
}
