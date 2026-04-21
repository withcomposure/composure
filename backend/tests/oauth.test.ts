import { describe, expect, it } from 'vitest'
import { signState, verifyState } from '../src/auth/oauth.js'

describe('signState / verifyState', () => {
  it('round-trips a payload', () => {
    const payload = { intent: 'login', provider: 'github', ts: Date.now() }
    const token = signState(payload)
    const result = verifyState(token)
    expect(result).toEqual(payload)
  })

  it('returns null for tampered data', () => {
    const token = signState({ intent: 'login', provider: 'github', ts: Date.now() })
    const [data, sig] = token.split('.')
    const tampered = `${data}x.${sig}`
    expect(verifyState(tampered)).toBeNull()
  })

  it('returns null for tampered signature', () => {
    const token = signState({ intent: 'login', provider: 'github', ts: Date.now() })
    const [data, sig] = token.split('.')
    const tampered = `${data}.${sig}x`
    expect(verifyState(tampered)).toBeNull()
  })

  it('returns null for empty or missing parts', () => {
    expect(verifyState('')).toBeNull()
    expect(verifyState('noperiod')).toBeNull()
    expect(verifyState('.onlyperiod')).toBeNull()
  })

  it('preserves nested payload values', () => {
    const payload = { intent: 'link', provider: 'google', userId: 'abc123', ts: 1000 }
    const token = signState(payload)
    const result = verifyState(token)
    expect(result).toEqual(payload)
  })
})
