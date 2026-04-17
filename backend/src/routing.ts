export const API_VERSION = 'v1'
export const DEFAULT_API_BASE_PATH = '/api'

function normalizeBasePath(value: string | undefined): string {
  const raw = (value ?? DEFAULT_API_BASE_PATH).trim()
  if (!raw || raw === '/') {
    return ''
  }

  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withLeadingSlash.replace(/\/+$/, '')
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '')
}

function joinPath(basePath: string, nextPath: string): string {
  const base = normalizePathname(basePath)
  const next = normalizePathname(nextPath)

  if (base === '/') {
    return next
  }
  if (next === '/') {
    return base
  }
  return `${base}${next}`
}

function splitPathSuffix(pathWithSuffix: string): { pathname: string; suffix: string } {
  const queryOrHashIndex = pathWithSuffix.search(/[?#]/)
  if (queryOrHashIndex === -1) {
    return { pathname: pathWithSuffix, suffix: '' }
  }

  return {
    pathname: pathWithSuffix.slice(0, queryOrHashIndex),
    suffix: pathWithSuffix.slice(queryOrHashIndex),
  }
}

export function pathnameFromRawUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return '/'
  }

  try {
    const parsed = new URL(rawUrl, 'http://localhost')
    return normalizePathname(parsed.pathname || '/')
  } catch {
    const [pathOnly] = rawUrl.split(/[?#]/, 1)
    return normalizePathname(pathOnly || '/')
  }
}

export function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  const normalizedPathname = normalizePathname(pathname)
  const normalizedPrefix = normalizePathname(prefix)
  if (normalizedPrefix === '/') {
    return true
  }

  return normalizedPathname === normalizedPrefix || normalizedPathname.startsWith(`${normalizedPrefix}/`)
}

export interface ApiRouting {
  apiVersion: string
  apiPrefixPath: string
  apiRootPath: string
  adminApiPath: string
  wsPath: (path: string) => string
  wsCollaborationPath: string
  apiPath: (path: string) => string
}

export function resolveApiRouting(env: NodeJS.ProcessEnv = process.env): ApiRouting {
  const apiPrefixPath = normalizeBasePath(env.API_BASE_PATH)
  const apiRootPath = joinPath(apiPrefixPath || '/', API_VERSION)

  const apiPath = (path: string): string => {
    const { pathname, suffix } = splitPathSuffix(path)
    const normalizedPath = normalizePathname(pathname)
    return `${joinPath(apiRootPath, normalizedPath)}${suffix}`
  }

  const wsPath = (path: string): string => {
    const normalizedPath = path.trim().replace(/^\/+/, '')
    return apiPath(`/ws/${normalizedPath}`)
  }

  return {
    apiVersion: API_VERSION,
    apiPrefixPath,
    apiRootPath,
    adminApiPath: apiPath('/admin'),
    wsPath,
    wsCollaborationPath: wsPath('collaborate'),
    apiPath,
  }
}
