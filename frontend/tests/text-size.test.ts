import { describe, expect, it } from 'vitest'
import { evaluateUtf8Limit, formatBinarySize, utf8ByteLength } from '../src/shared/text-size'

describe('text-size helpers', () => {
  it('calculates UTF-8 byte length', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('é')).toBe(2)
  })

  it('flags oversized text with quick char-length checks', () => {
    const result = evaluateUtf8Limit(120, 100, () => 'x'.repeat(120))
    expect(result.exceeds).toBe(true)
    expect(result.sizeBytes).toBeGreaterThan(100)
  })

  it('uses full UTF-8 sizing when char-length is ambiguous', () => {
    const text = 'é'.repeat(80)
    const result = evaluateUtf8Limit(text.length, 100, () => text)
    expect(result.exceeds).toBe(true)
    expect(result.sizeBytes).toBe(160)
  })

  it('formats byte labels in binary units', () => {
    expect(formatBinarySize(900)).toBe('900 B')
    expect(formatBinarySize(2048)).toBe('2.0 KB')
    expect(formatBinarySize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
