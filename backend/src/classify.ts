const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * Classify a byte buffer as text or binary.
 * Uses null-byte scanning + UTF-8 validation as fallback.
 */
export function classifyBuffer(bytes: Uint8Array): 'text' | 'binary' {
  if (bytes.length === 0) return 'text'

  // Quick scan for null bytes — a strong indicator of binary content
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return 'binary'
  }

  // Validate UTF-8
  try {
    decoder.decode(bytes)
    return 'text'
  } catch {
    return 'binary'
  }
}
