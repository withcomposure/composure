import { sql } from './connection.js'

export const PASSKEY_LOGIN_ENABLED_KEY = 'passkey_login_enabled'

export async function getPasskeyLoginEnabled(): Promise<boolean> {
  const [row] = await sql<[{ value: string }?]>`
    SELECT value FROM server_settings WHERE key = ${PASSKEY_LOGIN_ENABLED_KEY}
  `
  return row?.value !== 'false'
}

export async function setPasskeyLoginEnabled(enabled: boolean): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await sql`
    INSERT INTO server_settings (key, value, updated_at)
    VALUES (${PASSKEY_LOGIN_ENABLED_KEY}, ${String(enabled)}, ${now})
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `
}

export interface PasskeyCredentialRow {
  id: string
  user_id: string
  public_key: string
  counter: number
  transports: string | null
  created_at: number
  last_used_at: number | null
}

export async function createPasskeyCredential(input: {
  id: string
  userId: string
  publicKey: string
  counter: number
  transports: string | null
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await sql`
    INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports, created_at)
    VALUES (${input.id}, ${input.userId}, ${input.publicKey}, ${input.counter}, ${input.transports}, ${now})
  `
}

export async function findPasskeyCredential(credentialId: string): Promise<PasskeyCredentialRow | null> {
  const [row] = await sql`
    SELECT id, user_id, public_key, counter::integer AS counter, transports, created_at, last_used_at
    FROM webauthn_credentials
    WHERE id = ${credentialId}
  `
  return (row as unknown as PasskeyCredentialRow) ?? null
}

export interface PasskeyCredentialWithUser extends PasskeyCredentialRow {
  user_email: string
  user_display_name: string
  user_profile_image_url: string | null
  user_role: 'user' | 'admin'
  user_is_suspended: boolean
  user_is_guest: boolean
}

export async function findPasskeyCredentialWithUser(credentialId: string): Promise<PasskeyCredentialWithUser | null> {
  const [row] = await sql`
    SELECT wc.id, wc.user_id, wc.public_key, wc.counter::integer AS counter, wc.transports, wc.created_at, wc.last_used_at,
      u.email AS user_email,
      u.display_name AS user_display_name,
      u.profile_image_url AS user_profile_image_url,
      u.role AS user_role,
      u.is_suspended AS user_is_suspended,
      u.is_guest AS user_is_guest
    FROM webauthn_credentials wc
    JOIN users u ON u.id = wc.user_id
    WHERE wc.id = ${credentialId}
  `
  return (row as unknown as PasskeyCredentialWithUser) ?? null
}

export async function listPasskeyCredentialsForUser(userId: string): Promise<PasskeyCredentialRow[]> {
  const rows = await sql`
    SELECT id, user_id, public_key, counter::integer AS counter, transports, created_at, last_used_at
    FROM webauthn_credentials
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `
  return rows as unknown as PasskeyCredentialRow[]
}

export async function countPasskeyCredentialsForUser(userId: string): Promise<number> {
  const [{ count }] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM webauthn_credentials WHERE user_id = ${userId}
  `
  return count
}

export async function markPasskeyCredentialUsed(credentialId: string, counter: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await sql`
    UPDATE webauthn_credentials
    SET counter = ${counter}, last_used_at = ${now}
    WHERE id = ${credentialId}
  `
}

export async function deletePasskeyCredentialsForUser(userId: string): Promise<number> {
  const result = await sql`
    DELETE FROM webauthn_credentials WHERE user_id = ${userId}
  `
  return result.count
}
