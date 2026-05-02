import { getDomain } from 'tldts'

export type NodeEnv = 'development' | 'production' | 'test'

const defaultDevTrustedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']

export function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === undefined) return 'development'
  
  switch (value) {
    case 'development':
    case 'production':
    case 'test':
      return value
    default:
      throw new Error(`Invalid NODE_ENV: "${value}".`)
  }
}

export function isProductionEnv(value: string | undefined): boolean {
  return parseNodeEnv(value) === 'production'
}

export function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null || value.trim() === '') {
    return defaultValue
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }

  throw new Error(
    `Invalid boolean env value: "${value}". Expected one of: 1, 0, true, false, yes, no, on, off.`,
  )
}

function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

export function normalizeOriginHeader(originHeader: string | string[] | undefined): string | null {
  const raw = firstHeaderValue(originHeader)
  if (typeof raw !== 'string') {
    return null
  }
  return normalizeOrigin(raw)
}

export function parseUrlEnv(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

export function parseTrustedOrigins(
  value: string | undefined,
  nodeEnvValue: string | undefined = process.env.NODE_ENV,
): string[] {
  const trusted = new Set<string>()

  for (const segment of (value ?? '').split(',')) {
    const normalized = normalizeOrigin(segment)
    if (normalized) {
      trusted.add(normalized)
    }
  }

  if (!isProductionEnv(nodeEnvValue)) {
    for (const origin of defaultDevTrustedOrigins) {
      trusted.add(origin)
    }
  }

  return [...trusted]
}

export function inferRequestOrigin(input: {
  hostHeader: string | string[] | undefined
  forwardedProtoHeader: string | string[] | undefined
}): string | null {
  const host = firstHeaderValue(input.hostHeader)?.trim()
  if (!host) {
    return null
  }

  const forwardedProto = firstHeaderValue(input.forwardedProtoHeader)
  const proto = forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https' ? 'https' : 'http'
  return normalizeOrigin(`${proto}://${host}`)
}

function isLocalOrIpHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return true
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    return true
  }

  return normalized.includes(':')
}

export function areOriginsSameSite(leftOrigin: string, rightOrigin: string): boolean {
  try {
    const left = new URL(leftOrigin)
    const right = new URL(rightOrigin)

    if ((left.protocol !== 'http:' && left.protocol !== 'https:')
      || (right.protocol !== 'http:' && right.protocol !== 'https:')) {
      return false
    }

    if (left.protocol !== right.protocol) {
      return false
    }

    const leftHost = left.hostname.toLowerCase()
    const rightHost = right.hostname.toLowerCase()

    if (leftHost === rightHost) {
      return true
    }

    if (isLocalOrIpHostname(leftHost) || isLocalOrIpHostname(rightHost)) {
      return false
    }

    const leftDomain = getDomain(leftHost, { allowPrivateDomains: true })
    const rightDomain = getDomain(rightHost, { allowPrivateDomains: true })

    return leftDomain != null && rightDomain != null && leftDomain === rightDomain
  } catch {
    return false
  }
}

export function isTrustedRequestOrigin(input: {
  originHeader: string | string[] | undefined
  hostHeader: string | string[] | undefined
  forwardedProtoHeader: string | string[] | undefined
  trustedOrigins: ReadonlySet<string>
}): boolean {
  const normalizedOrigin = normalizeOriginHeader(input.originHeader)
  if (!normalizedOrigin) {
    // Allow non-browser clients that don't send Origin.
    return input.originHeader == null
  }

  if (input.trustedOrigins.has(normalizedOrigin)) {
    return true
  }

  const requestOrigin = inferRequestOrigin({
    hostHeader: input.hostHeader,
    forwardedProtoHeader: input.forwardedProtoHeader,
  })

  return requestOrigin != null && requestOrigin === normalizedOrigin
}