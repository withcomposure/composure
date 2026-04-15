import crypto from 'crypto'

export function createUid(): string {
  return crypto.randomBytes(16).toString('hex')
}
