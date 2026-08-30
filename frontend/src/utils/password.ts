/**
 * Mirrors the backend's password rule (raw length, no trimming — see
 * backend/src/auth.ts and backend/src/admin.ts) so the frontend never
 * accepts what the server rejects or vice versa.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.'
  }
  return null
}
