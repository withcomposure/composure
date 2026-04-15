import * as Y from 'yjs'

export interface TextSizeViolation {
  filePath: string
  sizeBytes: number
  limitBytes: number
}

function isTextFileMetadata(rawMeta: string): boolean {
  if (!rawMeta) {
    return true
  }

  try {
    const parsed = JSON.parse(rawMeta) as { type?: unknown }
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed.type === 'text'
    }
  } catch {
    // Legacy format: map value used to be plain text content.
  }

  return true
}

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function textByteLengthWithinLimit(text: Y.Text, limitBytes: number): { exceeds: boolean; sizeBytes: number } {
  const charLength = text.length

  // UTF-8 is at least one byte per code point.
  if (charLength > limitBytes) {
    return { exceeds: true, sizeBytes: charLength }
  }

  // UTF-8 is at most four bytes per code point, so very small strings can be
  // accepted without allocating full string content.
  if (charLength <= Math.floor(limitBytes / 4)) {
    return { exceeds: false, sizeBytes: charLength }
  }

  const sizeBytes = utf8ByteLength(text.toString())
  return { exceeds: sizeBytes > limitBytes, sizeBytes }
}

export function findTextSizeViolation(doc: Y.Doc, limitBytes: number): TextSizeViolation | null {
  const filesMap = doc.getMap<string>('files')
  const checkedPaths = new Set<string>()

  const checkFilePath = (filePath: string): TextSizeViolation | null => {
    const text = doc.getText(`file:${filePath}`)
    const { exceeds, sizeBytes } = textByteLengthWithinLimit(text, limitBytes)
    if (!exceeds) {
      return null
    }
    return {
      filePath,
      sizeBytes,
      limitBytes,
    }
  }

  for (const [filePath, rawMeta] of filesMap.entries()) {
    if (!isTextFileMetadata(rawMeta)) {
      continue
    }

    checkedPaths.add(filePath)
    const violation = checkFilePath(filePath)
    if (violation) {
      return violation
    }
  }

  // Defensive fallback: in rare mismatch scenarios, there may be `file:` Y.Text
  // entries with missing/invalid metadata. Treat them as text for safety.
  for (const key of doc.share.keys()) {
    if (!key.startsWith('file:')) {
      continue
    }

    const filePath = key.slice(5)
    if (!filePath || checkedPaths.has(filePath)) {
      continue
    }

    const violation = checkFilePath(filePath)
    if (violation) {
      return violation
    }
  }

  return null
}

export function textSizeViolationMessage(violation: TextSizeViolation): string {
  return `Text file '${violation.filePath}' exceeds the text size limit (${violation.sizeBytes} bytes > ${violation.limitBytes} bytes).`
}
