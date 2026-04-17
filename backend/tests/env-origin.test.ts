import { describe, expect, it } from 'vitest'
import {
  isTrustedRequestOrigin,
  normalizeOriginHeader,
  parseTrustedOrigins,
} from '../src/env.js'

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
