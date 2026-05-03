import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import { connectDatabase, applySchema, sql } from '../../src/db/connection.js'
import { runMigrations } from '../../src/db/migrate.js'
import { buildApp } from '../../src/app.js'
import { createToken, createUid } from '../../src/ids.js'
import { issueRefreshToken } from '../../src/db/refresh-tokens.js'
import { setJwtIssuer, signAccessToken } from '../../src/auth/jwt.js'
import type { SessionUser } from '../../src/db/types.js'

const TEST_DB_NAME_PATTERN = /(^|[_-])test([_-]|$)/i
const testSessionCookies = new Map<string, { accessToken: string; refreshToken: string }>()

/**
 * Guard: ensure DATABASE_URL points to a test-like database.
 * This is a last-resort safety net — the vitest setup file should have
 * already validated and swapped TEST_DATABASE_URL into DATABASE_URL.
 */
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  let dbName: string | null = null
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\/+/, '')
    if (path) dbName = decodeURIComponent(path.split('/')[0] ?? '')
  } catch { /* ignore */ }

  if (!dbName || !TEST_DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `[test] DATABASE_URL database "${dbName ?? '<unknown>'}" does not look like a test database ` +
      `(must match ${TEST_DB_NAME_PATTERN}). Refusing destructive reset.`,
    )
  }
}

/**
 * Reset the database to a clean state for testing.
 * Drops and recreates the public schema, then applies the full app schema.
 */
export async function resetTestDatabase(): Promise<void> {
  assertTestDatabase()
  connectDatabase({ max: 5 })
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await applySchema(sql)
  await runMigrations()
}

/**
 * Initialize a fresh database and build a Fastify app for testing.
 * Returns the app instance (use `app.inject()` to make requests).
 */
export async function createTestApp(): Promise<FastifyInstance> {
  await resetTestDatabase()
  testSessionCookies.clear()
  const app = await buildApp({ hocuspocus: null, isProduction: false })
  return app
}

/**
 * Create a user directly in the test database.
 * The first user created will become admin (matches production behavior).
 */
export async function createTestUser(overrides: {
  email?: string
  password?: string
  displayName?: string
  profileImageUrl?: string | null
  role?: 'user' | 'admin'
} = {}): Promise<SessionUser & { passwordHash: string }> {
  const id = createUid()
  const email = overrides.email ?? `user-${id.slice(0, 8)}@test.com`
  const password = overrides.password ?? 'testpassword123'
  const displayName = overrides.displayName ?? `Test User ${id.slice(0, 8)}`
  const profileImageUrl = overrides.profileImageUrl ?? null

  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  const passwordHash = `${salt}:${hash}`

  // Determine role: first user is always admin
  const [{ count }] = await sql`SELECT COUNT(1)::integer AS count FROM users WHERE is_guest = FALSE`
  const role = count === 0 ? 'admin' : (overrides.role ?? 'user')

  await sql`
    INSERT INTO users (id, email, password_hash, display_name, profile_image_url, role, is_guest, created_at)
    VALUES (${id}, ${email}, ${passwordHash}, ${displayName}, ${profileImageUrl}, ${role}, FALSE, extract(epoch from now())::integer)
  `

  return { id, email, displayName, profileImageUrl, role, passwordHash }
}

/**
 * Create a session for a user and return the session ID.
 */
export async function createTestSession(userId: string, maxAgeSeconds = 30 * 24 * 60 * 60): Promise<string> {
  setJwtIssuer('http://localhost')
  const access = maxAgeSeconds > 0
    ? await signAccessToken(userId)
    : { token: 'invalid', expiresAt: 0 }
  const refresh = await issueRefreshToken(userId, maxAgeSeconds)
  testSessionCookies.set(refresh.id, {
    accessToken: access.token,
    refreshToken: refresh.token,
  })
  return refresh.id
}

/**
 * Create a project owned by given principal.
 */
export async function createTestProject(ownerId: string, overrides: {
  title?: string
  rootFile?: string
  engine?: string | null
  isGuest?: boolean
} = {}): Promise<string> {
  const projectId = createUid()
  const title = overrides.title ?? 'Test Project'
  const rootFile = overrides.rootFile ?? 'main.tex'
  const engine = overrides.engine ?? null

  void overrides.isGuest
  await sql`
    INSERT INTO projects (id, title, root_file, engine, owner_user_id, created_at, last_active_at)
    VALUES (${projectId}, ${title}, ${rootFile}, ${engine}, ${ownerId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
  `
  await sql`
    INSERT INTO project_members (
      project_id,
      user_id,
      invited_email,
      role,
      status,
      invited_by_user_id,
      created_at,
      updated_at
    )
    VALUES (${projectId}, ${ownerId}, NULL, 'owner', 'accepted', ${ownerId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
    ON CONFLICT (project_id, user_id)
    WHERE user_id IS NOT NULL
    DO UPDATE SET role = 'owner', status = 'accepted', updated_at = excluded.updated_at
  `

  return projectId
}

/**
 * Create an invite token directly in the database.
 */
export async function createTestInviteToken(overrides: {
  createdBy?: string
  email?: string | null
  expiresInSeconds?: number
} = {}): Promise<string> {
  const token = createToken(24)
  const expiresAt = Math.floor(Date.now() / 1000) + (overrides.expiresInSeconds ?? 3600)

  await sql`INSERT INTO invite_tokens (token, created_by, created_at, expires_at, email) VALUES (${token}, ${overrides.createdBy ?? null}, extract(epoch from now())::integer, ${expiresAt}, ${overrides.email ?? null})`

  return token
}

/**
 * Helper to set the signup mode in server settings.
 */
export async function setTestSignupMode(mode: 'open' | 'invite-only'): Promise<void> {
  await sql`INSERT INTO server_settings (key, value, updated_at)
     VALUES ('signup_mode', ${mode}, extract(epoch from now())::integer)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = extract(epoch from now())::integer`
}

/**
 * Helper to set whether guest signups are enabled.
 */
export async function setTestGuestSignups(enabled: boolean): Promise<void> {
  await sql`INSERT INTO server_settings (key, value, updated_at)
     VALUES ('guest_signups_enabled', ${String(enabled)}, extract(epoch from now())::integer)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = extract(epoch from now())::integer`
}

/**
 * Helper to make a request with a session cookie.
 */
export function sessionCookie(sessionId: string): string {
  const pair = testSessionCookies.get(sessionId)
  if (!pair) {
    return `composure_access=invalid; composure_refresh=${sessionId}`
  }

  return `composure_access=${pair.accessToken}; composure_refresh=${pair.refreshToken}`
}

/**
 * Helper to make a request with a guest cookie.
 */
export function guestCookie(guestId: string): string {
  return `guest_id=${guestId}`
}
