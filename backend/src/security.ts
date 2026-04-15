import path from 'path'

const UID_LIKE_PATTERN = /^[a-f0-9]{32}$/
const SIMPLE_EMAIL_PATTERN = /^\S+@\S+\.\S+$/

/**
 * Normalize user-provided relative paths and reject traversal/absolute paths.
 */
export function normalizeRelativePath(input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (raw.includes('\0')) return null

  const slashNormalized = raw.replace(/\\/g, '/')
  if (path.posix.isAbsolute(slashNormalized)) return null
  if (/^[a-zA-Z]:\//.test(slashNormalized)) return null

  const normalized = path.posix.normalize(slashNormalized)
  if (!normalized || normalized === '.') return null
  if (normalized.startsWith('../') || normalized === '..') return null

  return normalized
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

export function isValidProjectId(id: string): boolean {
  return UID_LIKE_PATTERN.test(id)
}

export function isValidUserId(id: string): boolean {
  return UID_LIKE_PATTERN.test(id)
}

export function normalizeRole(rawRole: unknown): 'view' | 'comment' | 'edit' {
  const role = String(rawRole ?? '').trim().toLowerCase()
  if (role === 'comment' || role === 'edit') {
    return role
  }
  return 'view'
}

export function isValidEmail(email: string): boolean {
  return SIMPLE_EMAIL_PATTERN.test(email)
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.local')) return true

  if (host === '::1') return true
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true

  const parts = host.split('.').map((part) => Number.parseInt(part, 10))
  const isIpv4 = parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  if (!isIpv4) return false

  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}