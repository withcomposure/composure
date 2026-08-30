import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/**
 * Normalize user-provided relative paths and reject traversal/absolute paths.
 */
export function normalizeRelativePath(input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (raw.includes('\u0000')) return null

  const slashNormalized = raw.replace(/\\/g, '/')
  if (path.posix.isAbsolute(slashNormalized)) return null
  if (/^[a-zA-Z]:\//.test(slashNormalized)) return null

  const normalized = path.posix.normalize(slashNormalized)
  if (!normalized || normalized === '.') return null
  if (normalized.startsWith('../') || normalized === '..') return null

  return normalized
}

/**
 * True when any path segment begins with '-'. Such a name could be parsed as a
 * command-line flag by a compiler. Renderers also pass user paths after a `--`
 * terminator; this rejects the input outright as a second layer.
 */
export function hasLeadingDashSegment(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('-'))
}

/**
 * True when candidate path stays inside baseDir (or equals it).
 */
export function isPathWithin(baseDir: string, candidatePath: string): boolean {
  const base = path.resolve(baseDir)
  const candidate = path.resolve(candidatePath)
  const rel = path.relative(base, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Sanitize compile logs by removing filesystem paths.
 */
export function sanitizeCompileLog(
  log: string | undefined,
  projectDir: string,
  compileDir: string,
  tectonicCache: string,
  typstCache: string,
): string | undefined {
  if (!log) return log
  return log
    .replaceAll(projectDir, '<build>')
    .replaceAll(compileDir, '<build>')
    .replaceAll(tectonicCache, '<cache>')
    .replaceAll(typstCache, '<cache>')
}

function sha1(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex')
}

function listFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return []

  const out: string[] = []
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(absPath)
      } else if (entry.isFile()) {
        out.push(path.relative(rootDir, absPath))
      }
    }
  }

  walk(rootDir)
  return out
}

/**
 * Sync desired file contents to a source directory, writing changed files,
 * skipping unchanged, and removing stale files.
 */
export function syncProjectSource(
  srcDir: string,
  desiredFiles: Map<string, string>,
): { written: number; unchanged: number; removed: number } {
  fs.mkdirSync(srcDir, { recursive: true })

  const existingFiles = listFilesRecursive(srcDir)
  const seen = new Set<string>()

  let written = 0
  let unchanged = 0
  let removed = 0

  for (const [relPath, content] of desiredFiles.entries()) {
    const absPath = path.resolve(srcDir, relPath)
    if (!isPathWithin(srcDir, absPath)) {
      continue
    }

    seen.add(relPath)

    const exists = fs.existsSync(absPath)
    if (exists && fs.statSync(absPath).isFile()) {
      const existing = fs.readFileSync(absPath, 'utf8')
      if (sha1(existing) === sha1(content)) {
        unchanged++
        continue
      }
    }

    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, content, 'utf8')
    written++
  }

  for (const relPath of existingFiles) {
    if (seen.has(relPath)) continue

    const absPath = path.resolve(srcDir, relPath)
    if (!isPathWithin(srcDir, absPath)) continue

    fs.rmSync(absPath, { force: true })
    removed++
  }

  return { written, unchanged, removed }
}
