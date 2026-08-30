/**
 * Mirrors the backend's password policy (passwordMeetsPolicy in
 * backend/src/auth/password.ts): at least 8 characters after trimming
 * surrounding whitespace, so padding cannot satisfy the minimum.
 */
export function validatePassword(password: string): string | null {
  if (password.trim().length < 8) {
    return 'Password must be at least 8 characters.'
  }
  return null
}
