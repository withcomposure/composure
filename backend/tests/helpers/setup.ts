import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import { connectDatabase, applySchema, sql } from '../../src/db/connection.js'
import { runMigrations } from '../../src/db/migrate.js'
import { buildApp } from '../../src/app.js'
import { createToken, createUid } from '../../src/ids.js'
import type { SessionUser } from '../../src/db/types.js'

const TEST_DB_NAME_PATTERN = /(^|[_-])test([_-]|$)/i

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
  role?: 'user' | 'admin'
} = {}): Promise<SessionUser & { passwordHash: string }> {
  const id = createUid()
  const email = overrides.email ?? `user-${id.slice(0, 8)}@test.com`
  const password = overrides.password ?? 'testpassword123'
  const displayName = overrides.displayName ?? `Test User ${id.slice(0, 8)}`

  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  const passwordHash = `${salt}:${hash}`

  // Determine role: first user is always admin
  const [{ count }] = await sql`SELECT COUNT(1)::integer AS count FROM users`
  const role = count === 0 ? 'admin' : (overrides.role ?? 'user')

  await sql`INSERT INTO users (id, email, password_hash, display_name, role, created_at) VALUES (${id}, ${email}, ${passwordHash}, ${displayName}, ${role}, extract(epoch from now())::integer)`

  return { id, email, displayName, profileImageUrl: null, role, passwordHash }
}

/**
 * Create a session for a user and return the session ID.
 */
export async function createTestSession(userId: string, maxAgeSeconds = 30 * 24 * 60 * 60): Promise<string> {
  const sessionId = createUid()
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds

  await sql`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${sessionId}, ${userId}, ${expiresAt}, extract(epoch from now())::integer)`

  return sessionId
}

/**
 * Create a project owned by given principal.
 */
export async function createTestProject(ownerId: string, overrides: {
  title?: string
  rootFile?: string
  isGuest?: boolean
} = {}): Promise<string> {
  const projectId = createUid()
  const title = overrides.title ?? 'Test Project'
  const rootFile = overrides.rootFile ?? 'main.tex'

  if (overrides.isGuest) {
    await sql`INSERT INTO projects (id, title, root_file, owner_guest_id, created_at, last_active_at) VALUES (${projectId}, ${title}, ${rootFile}, ${ownerId}, extract(epoch from now())::integer, extract(epoch from now())::integer)`
  } else {
    await sql`INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at) VALUES (${projectId}, ${title}, ${rootFile}, ${ownerId}, extract(epoch from now())::integer, extract(epoch from now())::integer)`
  }

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
  return `composure_session=${sessionId}`
}

/**
 * Helper to make a request with a guest cookie.
 */
export function guestCookie(guestId: string): string {
  return `guest_id=${guestId}`
}
