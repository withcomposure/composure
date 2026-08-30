import { spawn } from 'child_process'

export interface RunCommandOptions {
  bin: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  /** Cap on captured bytes per stream. Protects against unbounded log growth. */
  maxOutputBytes?: number
}

export interface RunCommandResult {
  code: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  /** Set when the process could not be spawned at all. */
  spawnError?: string
}

const defaultMaxOutput = 1024 * 1024 // 1 MiB per stream

/**
 * Spawn a subprocess with a hard timeout, bounded output capture, and
 * whole-process-group termination.
 *
 * The child is started as its own process-group leader (`detached`) so a
 * timeout kill reaches grandchildren too — e.g. a program a pandoc filter
 * spawns — instead of orphaning them.
 *
 * Callers build the argument array; a `--` end-of-options terminator must be
 * placed before any user-controlled positional (see the renderers) so a
 * filename beginning with `-` can never be parsed as a flag.
 */
export function runCommand(opts: RunCommandOptions): Promise<RunCommandResult> {
  const maxOutput = opts.maxOutputBytes ?? defaultMaxOutput

  return new Promise((resolve) => {
    const proc = spawn(opts.bin, opts.args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      detached: true,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const append = (buf: string, chunk: Buffer): string => {
      if (buf.length >= maxOutput) return buf
      return (buf + chunk.toString()).slice(0, maxOutput)
    }
    proc.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    proc.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })

    const killGroup = (signal: NodeJS.Signals) => {
      const pid = proc.pid
      if (pid == null) return
      try {
        process.kill(-pid, signal) // negative pid targets the whole process group
      } catch {
        try { proc.kill(signal) } catch { /* already exited */ }
      }
    }

    const timeout = setTimeout(() => {
      timedOut = true
      killGroup('SIGKILL')
    }, opts.timeoutMs)

    const finish = (result: RunCommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    proc.on('close', (code) => {
      finish({ code, timedOut, stdout, stderr })
    })

    proc.on('error', (err) => {
      finish({ code: null, timedOut, stdout, stderr, spawnError: err.message })
    })
  })
}
