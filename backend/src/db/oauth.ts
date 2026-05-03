import { sql } from './connection.js'
import { createUid } from '../ids.js'
import type { SessionUser } from './types.js'

// ---------------------------------------------------------------------------
// OAuth provider configuration (admin-managed)
// ---------------------------------------------------------------------------

export const PASSWORD_LOGIN_ENABLED_KEY = 'password_login_enabled'

export async function getPasswordLoginEnabled(): Promise<boolean> {
  const [row] = await sql<[{ value: string }?]>`
    SELECT value FROM server_settings WHERE key = ${PASSWORD_LOGIN_ENABLED_KEY}
  `
  return row?.value !== 'false'
}

export async function setPasswordLoginEnabled(enabled: boolean): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await sql`
    INSERT INTO server_settings (key, value, updated_at)
    VALUES (${PASSWORD_LOGIN_ENABLED_KEY}, ${String(enabled)}, ${now})
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `
}

export interface OAuthProviderRow {
  provider: string
  enabled: boolean
  client_id: string | null
  client_secret: string | null
  updated_at: number | null
}

export async function listOAuthProviders(): Promise<OAuthProviderRow[]> {
  const rows = await sql`SELECT provider, enabled, client_id, client_secret, updated_at FROM oauth_providers ORDER BY provider`
  return rows as unknown as OAuthProviderRow[]
}

export async function getEnabledOAuthProviders(): Promise<OAuthProviderRow[]> {
  const rows = await sql`
    SELECT provider, enabled, client_id, client_secret, updated_at
    FROM oauth_providers
    WHERE enabled = true AND client_id IS NOT NULL AND client_secret IS NOT NULL
  `
  return rows as unknown as OAuthProviderRow[]
}

export async function upsertOAuthProvider(
  provider: string,
  enabled: boolean,
  clientId: string | null,
  clientSecret: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await sql`
    INSERT INTO oauth_providers (provider, enabled, client_id, client_secret, updated_at)
    VALUES (${provider}, ${enabled}, ${clientId}, ${clientSecret}, ${now})
    ON CONFLICT (provider) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      client_id = COALESCE(EXCLUDED.client_id, oauth_providers.client_id),
      client_secret = COALESCE(EXCLUDED.client_secret, oauth_providers.client_secret),
      updated_at = EXCLUDED.updated_at
  `
}

export async function setOAuthProviderEnabled(provider: string, enabled: boolean): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  const result = await sql`
    UPDATE oauth_providers SET enabled = ${enabled}, updated_at = ${now}
    WHERE provider = ${provider}
  `
  return result.count > 0
}

// ---------------------------------------------------------------------------
// OAuth accounts (per-user linked accounts)
// ---------------------------------------------------------------------------

export interface OAuthAccountRow {
  id: string
  user_id: string
  provider: string
  provider_id: string
  email: string | null
  linked_at: number | null
}

export async function findOAuthAccount(provider: string, providerId: string): Promise<OAuthAccountRow | null> {
  const [row] = await sql`
    SELECT id, user_id, provider, provider_id, email, linked_at
    FROM oauth_accounts
    WHERE provider = ${provider} AND provider_id = ${providerId}
  `
  return (row as unknown as OAuthAccountRow) ?? null
}

export async function listOAuthAccountsForUser(userId: string): Promise<OAuthAccountRow[]> {
  const rows = await sql`
    SELECT id, user_id, provider, provider_id, email, linked_at
    FROM oauth_accounts
    WHERE user_id = ${userId}
    ORDER BY linked_at ASC
  `
  return rows as unknown as OAuthAccountRow[]
}

export async function linkOAuthAccount(
  userId: string,
  provider: string,
  providerId: string,
  email: string | null,
): Promise<OAuthAccountRow> {
  const id = createUid()
  const now = Math.floor(Date.now() / 1000)
  await sql`
    INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, linked_at)
    VALUES (${id}, ${userId}, ${provider}, ${providerId}, ${email}, ${now})
  `
  return { id, user_id: userId, provider, provider_id: providerId, email, linked_at: now }
}

export async function unlinkOAuthAccount(userId: string, provider: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM oauth_accounts WHERE user_id = ${userId} AND provider = ${provider}
  `
  return result.count > 0
}

export async function deleteOAuthAccountsForUser(userId: string): Promise<number> {
  const result = await sql`
    DELETE FROM oauth_accounts WHERE user_id = ${userId}
  `
  return result.count
}

export async function countOAuthAccountsForUser(userId: string): Promise<number> {
  const [{ count }] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM oauth_accounts WHERE user_id = ${userId}
  `
  return count
}

export async function userHasPasswordAuthMethod(userId: string): Promise<boolean> {
  const [row] = await sql<[{
    has_password: boolean
  }?]>`
    SELECT password_hash IS NOT NULL AS has_password
    FROM users
    WHERE id = ${userId}
  `
  return row?.has_password === true
}

export async function disableUserPasswordAuthMethod(userId: string): Promise<boolean> {
  const result = await sql`
    UPDATE users
    SET password_hash = NULL
    WHERE id = ${userId}
      AND password_hash IS NOT NULL
  `
  return result.count > 0
}

// ---------------------------------------------------------------------------
// Find-or-create user for OAuth login
// ---------------------------------------------------------------------------

export async function findUserByOAuth(
  provider: string,
  providerId: string,
  providerEmail: string | null,
  options: {
    createIfMissing?: boolean
  } = {},
): Promise<{ user: SessionUser; isNew: boolean } | null> {
  // 1. Exact match on provider + providerId → return user
  const existingLink = await findOAuthAccount(provider, providerId)
  if (existingLink) {
    const [row] = await sql`
      SELECT id, email, display_name, profile_image_url, role
      FROM users WHERE id = ${existingLink.user_id}
    `
    if (row) {
      return {
        user: {
          id: (row as Record<string, string>).id,
          email: (row as Record<string, string>).email,
          displayName: (row as Record<string, string>).display_name,
          profileImageUrl: (row as Record<string, string | null>).profile_image_url,
          role: (row as Record<string, string>).role as 'user' | 'admin',
        },
        isNew: false,
      }
    }
  }

  // 2. Email matches existing user → link oauth_accounts + return user
  if (providerEmail) {
    const normalizedEmail = providerEmail.trim().toLowerCase()
    const [existingUser] = await sql`
      SELECT id, email, display_name, profile_image_url, role, is_suspended
      FROM users WHERE email = ${normalizedEmail}
    `
    if (existingUser) {
      const u = existingUser as Record<string, unknown>
      if (u.is_suspended === true) {
        return null // Don't auto-link to suspended accounts
      }
      await linkOAuthAccount(u.id as string, provider, providerId, providerEmail)
      return {
        user: {
          id: u.id as string,
          email: u.email as string,
          displayName: u.display_name as string,
          profileImageUrl: u.profile_image_url as string | null,
          role: u.role as 'user' | 'admin',
        },
        isNew: false,
      }
    }
  }

  if (options.createIfMissing === false) {
    return null
  }

  // 3. Neither → create user + oauth_accounts row
  const id = createUid()
  const email = providerEmail?.trim().toLowerCase() ?? `${provider}-${providerId}@oauth.local`
  const displayName = providerEmail?.split('@')[0] ?? `${provider} user`

  const [{ count }] = await sql<[{ count: number }]>`SELECT COUNT(1)::integer AS count FROM users`
  const role = count === 0 ? 'admin' : 'user'

  try {
    await sql`
      INSERT INTO users (id, email, password_hash, display_name, role, created_at)
      VALUES (${id}, ${email}, ${null}, ${displayName}, ${role}, extract(epoch from now())::integer)
    `
  } catch {
    // email collision – shouldn't happen because we checked above, but handle race
    return null
  }

  await linkOAuthAccount(id, provider, providerId, providerEmail)

  return {
    user: { id, email, displayName, profileImageUrl: null, role },
    isNew: true,
  }
}

// ---------------------------------------------------------------------------
// Provider count helpers (for "stranded users" check)
// ---------------------------------------------------------------------------

/** Count how many enabled auth methods a user has. */
export async function countUserAuthMethods(userId: string): Promise<number> {
  const passwordEnabled = await getPasswordLoginEnabled()
  const hasPassword = passwordEnabled && (await userHasPasswordAuthMethod(userId))

  const [{ count: oauthCount }] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count
    FROM oauth_accounts oa
    JOIN oauth_providers op ON op.provider = oa.provider
    WHERE oa.user_id = ${userId}
      AND op.enabled = true
      AND op.client_id IS NOT NULL
      AND op.client_secret IS NOT NULL
  `

  return (hasPassword ? 1 : 0) + oauthCount
}

/** For the "stranded users" admin check: returns counts of users who rely on specific providers. */
export async function getStrandedUserCounts(
  providersToDisable: string[],
): Promise<{ strandedUserIds: string[]; totalUsers: number }> {
  if (providersToDisable.length === 0) {
    const [{ count }] = await sql<[{ count: number }]>`SELECT COUNT(1)::integer AS count FROM users`
    return { strandedUserIds: [], totalUsers: count }
  }

  // A user is stranded if all currently enabled auth methods are being disabled.
  const passwordEnabled = await getPasswordLoginEnabled()

  const rows = await sql`
    WITH user_methods AS (
      SELECT u.id,
        CASE WHEN ${passwordEnabled} = true AND u.password_hash IS NOT NULL THEN 'password' ELSE NULL END AS method
      FROM users u
      UNION ALL
      SELECT oa.user_id AS id, oa.provider AS method
      FROM oauth_accounts oa
      JOIN oauth_providers op ON op.provider = oa.provider
      WHERE op.enabled = true
        AND op.client_id IS NOT NULL
        AND op.client_secret IS NOT NULL
    ),
    user_remaining AS (
      SELECT id,
        COUNT(*) FILTER (WHERE method IS NOT NULL AND method != ALL(${providersToDisable}::text[])) AS remaining
      FROM user_methods
      GROUP BY id
    )
    SELECT id FROM user_remaining WHERE remaining = 0
  `

  const [{ count }] = await sql<[{ count: number }]>`SELECT COUNT(1)::integer AS count FROM users`
  return {
    strandedUserIds: rows.map((r) => (r as Record<string, string>).id),
    totalUsers: count,
  }
}

/** Return stranded user details for CSV export. */
export async function getStrandedUserDetails(
  userIds: string[],
): Promise<Array<{ id: string; email: string; displayName: string }>> {
  if (userIds.length === 0) return []
  const rows = await sql`
    SELECT id, email, display_name FROM users WHERE id = ANY(${userIds}::text[])
  `
  return rows.map((r) => ({
    id: (r as Record<string, string>).id,
    email: (r as Record<string, string>).email,
    displayName: (r as Record<string, string>).display_name,
  }))
}
