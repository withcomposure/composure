import path from 'path'
import fs from 'fs'
import type { Renderer, CompileContext, CompileOutput } from './types.js'
import { runCommand } from './run-command.js'

const typstCache = process.env.TYPST_CACHE ?? '/var/composure/caches/typst'

export const typstRenderer: Renderer = {
  id: 'typst',

  canHandle(rootFile: string): boolean {
    return path.extname(rootFile).toLowerCase() === '.typ'
  },

  async compile(ctx: CompileContext): Promise<CompileOutput> {
    const pdfName = path.basename(ctx.rootFile).replace(/\.[^./]+$/, '.pdf')
    const pdfPath = path.join(ctx.outDir, pdfName)

    // `--` terminates option parsing so a rootFile starting with `-` cannot inject flags.
    const result = await runCommand({
      bin: 'typst',
      args: ['compile', '--root', ctx.srcDir, '--', ctx.rootFile, pdfPath],
      cwd: ctx.srcDir,
      env: {
        ...process.env,
        TYPST_CACHE_DIR: typstCache,
      },
      timeoutMs: ctx.timeoutMs,
    })

    const log = result.stdout + result.stderr

    if (result.spawnError) {
      return { success: false, outputs: [], error: `Failed to start typst: ${result.spawnError}` }
    }
    if (result.timedOut) {
      return { success: false, outputs: [], error: `Compilation timed out (${ctx.timeoutMs}ms)`, log }
    }
    if (result.code !== 0) {
      return { success: false, outputs: [], error: result.stderr || `Typst exited with code ${result.code}`, log }
    }
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
