import crypto from 'crypto'

export const UID_HEX_PATTERN = /^[a-f0-9]{32}$/

export function createUid(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function createToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex')
}
