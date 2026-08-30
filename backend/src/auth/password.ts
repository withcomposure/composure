import crypto from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(crypto.scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>

/**
 * Single source of truth for password hashing. Async so the ~50-100ms scrypt
 * derivation runs on the libuv threadpool instead of blocking the event loop.
 * Format: `<hex salt>:<hex scrypt-64>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = (await scrypt(password, salt, 64)).toString('hex')
  return `${salt}:${hash}`
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  if (!passwordHash) return false
  const [salt, expectedHash] = passwordHash.split(':')
  if (!salt || !expectedHash) return false

  const hash = await scrypt(password, salt, 64)
  const expected = Buffer.from(expectedHash, 'hex')

  if (hash.length !== expected.length) return false
  return crypto.timingSafeEqual(hash, expected)
}

/**
 * Password policy shared by every signup/reset/admin flow: at least 8
 * characters after trimming surrounding whitespace, so padding cannot
 * satisfy the minimum. Mirrored by frontend/src/utils/password.ts.
 */
export function passwordMeetsPolicy(password: string): boolean {
  return password.trim().length >= 8
}
