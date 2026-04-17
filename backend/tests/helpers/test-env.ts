/**
 * Vitest setup file — runs before any test module is imported.
 *
 * Validates TEST_DATABASE_URL is explicitly set with a test-like database name,
 * then promotes it to DATABASE_URL so the application code is environment-agnostic.
 */

const TEST_DB_NAME_PATTERN = /(^|[_-])test([_-]|$)/i

const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl) {
  throw new Error(
    '[test-env] TEST_DATABASE_URL is not set. Tests require an explicit test database URL. ' +
    'Never fall back to DATABASE_URL — set TEST_DATABASE_URL in your environment or .env file.',
  )
}

function extractDatabaseName(url: string): string | null {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\/+/, '')
    if (!path) return null
    return decodeURIComponent(path.split('/')[0] ?? '')
  } catch {
    return null
  }
}

const dbName = extractDatabaseName(testUrl)
if (!dbName || !TEST_DB_NAME_PATTERN.test(dbName)) {
  throw new Error(
    `[test-env] TEST_DATABASE_URL database name "${dbName ?? '<unknown>'}" does not look like a test database ` +
    `(must match ${TEST_DB_NAME_PATTERN}). Refusing to proceed to protect production data.`,
  )
}

// Swap so the application code sees the test database via its normal DATABASE_URL path.
process.env.DATABASE_URL = testUrl
