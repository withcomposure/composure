import { describe, expect, it } from 'vitest'
import {
  isTrustedRequestOrigin,
  normalizeOriginHeader,
  parseBooleanEnv,
  parseTrustedOrigins,
  parseUrlEnv,
} from '../src/env.js'

describe('parseBooleanEnv', () => {
  it('returns default for missing values', () => {
    expect(parseBooleanEnv(undefined, true)).toBe(true)
    expect(parseBooleanEnv('', false)).toBe(false)
  })

  it('parses truthy and falsy values', () => {
    expect(parseBooleanEnv('true', false)).toBe(true)
    expect(parseBooleanEnv('1', false)).toBe(true)
    expect(parseBooleanEnv('yes', false)).toBe(true)
    expect(parseBooleanEnv('on', false)).toBe(true)

    expect(parseBooleanEnv('false', true)).toBe(false)
    expect(parseBooleanEnv('0', true)).toBe(false)
    expect(parseBooleanEnv('no', true)).toBe(false)
    expect(parseBooleanEnv('off', true)).toBe(false)
  })

  it('throws on invalid values', () => {
    expect(() => parseBooleanEnv('sometimes', true)).toThrow('Invalid boolean env value')
  })
})

describe('parseTrustedOrigins', () => {
  it('includes local vite defaults in non-production environments', () => {
    const origins = new Set(parseTrustedOrigins(undefined, 'development'))
    expect(origins.has('http://localhost:5173')).toBe(true)
    expect(origins.has('http://127.0.0.1:5173')).toBe(true)
  })

  it('does not include local vite defaults in production', () => {
    const origins = new Set(parseTrustedOrigins(undefined, 'production'))
    expect(origins.has('http://localhost:5173')).toBe(false)
    expect(origins.has('http://127.0.0.1:5173')).toBe(false)
  })

  it('normalizes, deduplicates, and filters invalid values', () => {
    const origins = parseTrustedOrigins(
      'https://composure.pages.dev/, invalid, https://composure.pages.dev,https://example.com ',
      'production',
    )

    expect(origins).toEqual([
      'https://composure.pages.dev',
      'https://example.com',
    ])
  })
})

describe('normalizeOriginHeader', () => {
  it('normalizes valid origin header', () => {
    expect(normalizeOriginHeader('https://example.com/')).toBe('https://example.com')
  })

  it('returns null for invalid origin header', () => {
    expect(normalizeOriginHeader('not-an-origin')).toBeNull()
  })
})

describe('isTrustedRequestOrigin', () => {
  it('allows configured trusted origin', () => {
    const trusted = new Set(['https://composure.pages.dev'])
    const allowed = isTrustedRequestOrigin({
      originHeader: 'https://composure.pages.dev',
      hostHeader: 'api.example.com',
      forwardedProtoHeader: 'https',
      trustedOrigins: trusted,
    })
    expect(allowed).toBe(true)
  })

  it('allows same-origin websocket requests without explicit allowlist', () => {
    const trusted = new Set<string>()
    const allowed = isTrustedRequestOrigin({
      originHeader: 'https://api.example.com',
      hostHeader: 'api.example.com',
      forwardedProtoHeader: 'https',
      trustedOrigins: trusted,
    })
    expect(allowed).toBe(true)
  })

  it('rejects unknown cross-origin websocket requests', () => {
    const trusted = new Set<string>()
    const allowed = isTrustedRequestOrigin({
      originHeader: 'https://untrusted.example',
      hostHeader: 'api.example.com',
      forwardedProtoHeader: 'https',
      trustedOrigins: trusted,
    })
    expect(allowed).toBe(false)
  })

  it('allows requests without an origin header', () => {
    const trusted = new Set<string>()
    const allowed = isTrustedRequestOrigin({
      originHeader: undefined,
      hostHeader: 'api.example.com',
      forwardedProtoHeader: 'https',
      trustedOrigins: trusted,
    })
    expect(allowed).toBe(true)
  })
})

describe('parseUrlEnv', () => {
  it('returns null for undefined or empty values', () => {
    expect(parseUrlEnv(undefined)).toBeNull()
    expect(parseUrlEnv('')).toBeNull()
    expect(parseUrlEnv('   ')).toBeNull()
  })

  it('parses valid http and https URLs and returns only the origin', () => {
    expect(parseUrlEnv('https://example.com')).toBe('https://example.com')
    expect(parseUrlEnv('http://localhost:8080')).toBe('http://localhost:8080')
    expect(parseUrlEnv('https://app.pages.dev/')).toBe('https://app.pages.dev')
  })

  it('strips paths and returns only the origin', () => {
    expect(parseUrlEnv('https://example.com/some/path')).toBe('https://example.com')
    expect(parseUrlEnv('http://localhost:5173/api')).toBe('http://localhost:5173')
  })

  it('trims whitespace', () => {
    expect(parseUrlEnv('  https://example.com  ')).toBe('https://example.com')
  })

  it('rejects non-http protocols', () => {
    expect(parseUrlEnv('ftp://example.com')).toBeNull()
    expect(parseUrlEnv('file:///etc/passwd')).toBeNull()
  })

  it('rejects invalid URLs', () => {
    expect(parseUrlEnv('not-a-url')).toBeNull()
    expect(parseUrlEnv('://missing-protocol')).toBeNull()
  })
})
