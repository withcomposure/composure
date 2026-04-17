const utf8Encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).byteLength
}

export function evaluateUtf8Limit(
  charLength: number,
  limitBytes: number,
  readText: () => string,
): { exceeds: boolean; sizeBytes: number } {
  // UTF-8 is at least one byte per code point.
  if (charLength > limitBytes) {
    return { exceeds: true, sizeBytes: charLength }
  }

  // UTF-8 is at most four bytes per code point.
  if (charLength <= Math.floor(limitBytes / 4)) {
    return { exceeds: false, sizeBytes: charLength }
  }

  const sizeBytes = utf8ByteLength(readText())
  return {
    exceeds: sizeBytes > limitBytes,
    sizeBytes,
  }
}

export function formatBinarySize(bytes: number): string {
  const absolute = Math.max(0, bytes)
  const kb = 1024
  const mb = 1024 * kb

  if (absolute >= mb) {
    const value = absolute / mb
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MB`
  }

  if (absolute >= kb) {
    const value = absolute / kb
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} KB`
  }

  return `${absolute} B`
}
