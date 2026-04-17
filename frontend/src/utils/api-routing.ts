const apiVersion = 'v1'
const defaultApiBasePath = '/api'

interface AbsoluteApiBase {
  mode: 'absolute'
  origin: string
  basePath: string
}

interface RelativeApiBase {
  mode: 'relative'
  basePath: string
}

type ApiBase = AbsoluteApiBase | RelativeApiBase

function normalizeBasePath(value: string | undefined): string {
  const raw = (value ?? defaultApiBasePath).trim()
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

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isAbsoluteWsUrl(value: string): boolean {
  return /^wss?:\/\//i.test(value)
}

function resolveApiBase(rawValue: string | undefined): ApiBase {
  const trimmed = rawValue?.trim()
  if (!trimmed) {
    return { mode: 'relative', basePath: normalizeBasePath(undefined) }
  }

  if (isAbsoluteHttpUrl(trimmed)) {
    const parsed = new URL(trimmed)
    return {
      mode: 'absolute',
      origin: parsed.origin,
      basePath: normalizeBasePath(parsed.pathname),
    }
  }

  return {
    mode: 'relative',
    basePath: normalizeBasePath(trimmed),
  }
}

const apiBase = resolveApiBase(import.meta.env.VITE_API_URL as string | undefined)
const apiRootPath = joinPath(apiBase.basePath || '/', apiVersion)
const currentOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
const isCrossOrigin = apiBase.mode === 'absolute' && apiBase.origin !== currentOrigin;
const defaultApiRequestCredentials: RequestCredentials = isCrossOrigin ? 'include' : 'same-origin'

function appendOptionalShareToken(baseUrl: string, shareToken: string | undefined): string {
  if (!shareToken) {
    return baseUrl
  }

  if (isAbsoluteWsUrl(baseUrl)) {
    const parsed = new URL(baseUrl)
    parsed.searchParams.set('share', shareToken)
    return parsed.toString()
  }

  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}share=${encodeURIComponent(shareToken)}`
}

function joinAbsoluteUrlWithPath(baseUrl: string, pathWithSuffix: string): string {
  const { pathname, suffix } = splitPathSuffix(pathWithSuffix)
  const parsed = new URL(baseUrl)
  parsed.pathname = joinPath(parsed.pathname || '/', pathname)

  if (suffix.startsWith('?')) {
    const hashIndex = suffix.indexOf('#')
    if (hashIndex === -1) {
      parsed.search = suffix
      parsed.hash = ''
    } else {
      parsed.search = suffix.slice(0, hashIndex)
      parsed.hash = suffix.slice(hashIndex)
    }
  } else {
    parsed.search = ''
    parsed.hash = suffix.startsWith('#') ? suffix : ''
  }

  return parsed.toString()
}

function resolveWsBaseUrl(): string {
  const apiEndpoint = apiUrl(wsPath('collaborate'))

  if (isAbsoluteHttpUrl(apiEndpoint)) {
    const parsed = new URL(apiEndpoint)
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
    return parsed.toString()
  }

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}${apiEndpoint}`
}

export function apiPath(path: string): string {
  const { pathname, suffix } = splitPathSuffix(path)
  const normalizedPathname = normalizePathname(pathname)

  if (normalizedPathname === apiRootPath || normalizedPathname.startsWith(`${apiRootPath}/`)) {
    return `${normalizedPathname}${suffix}`
  }

  const absoluteVersionPath = `/${apiVersion}`
  if (normalizedPathname === absoluteVersionPath || normalizedPathname.startsWith(`${absoluteVersionPath}/`)) {
    return `${joinPath(apiBase.basePath || '/', normalizedPathname)}${suffix}`
  }

  return `${joinPath(apiRootPath, normalizedPathname)}${suffix}`
}

export function wsPath(path: string): string {
  const normalizedPath = path.trim().replace(/^\/+/, '')
  return apiPath(`/ws/${normalizedPath}`)
}

export function apiUrl(path: string): string {
  if (isAbsoluteHttpUrl(path)) {
    return path
  }

  const versionedPath = apiPath(path)
  if (apiBase.mode !== 'absolute') {
    return versionedPath
  }

  return joinAbsoluteUrlWithPath(apiBase.origin, versionedPath)
}

export function apiRequestCredentials(): RequestCredentials {
  return defaultApiRequestCredentials
}

export function collaborationWsUrl(shareToken?: string): string {
  return appendOptionalShareToken(resolveWsBaseUrl(), shareToken)
}

export { apiRootPath }
