import { sql } from './connection.js'
import { createUid } from '../ids.js'
import type { SessionUser } from './types.js'
import { deleteOAuthAccountsForUser } from './oauth.js'

export async function deleteUserAccount(userId: string): Promise<boolean> {
  await deleteOAuthAccountsForUser(userId)
  const result = await sql`DELETE FROM users WHERE id = ${userId}`
  return result.count > 0
}

export async function createUser(input: {
  email: string
  passwordHash: string
  displayName: string
  role?: 'user' | 'admin'
  emailVerified?: boolean
}): Promise<SessionUser | null> {
  const id = createUid()
  const email = input.email.trim().toLowerCase()
  const displayName = input.displayName.trim() || 'Composure User'
  const explicitRole = input.role === 'admin' ? 'admin' : 'user'
  const emailVerified = input.emailVerified === true

  try {
    return await sql.begin(async (tx) => {
      // Serialize the first-user-becomes-admin check: without the lock, two
      // concurrent first registrations can both count zero users and both
      // become admin.
      await tx`SELECT pg_advisory_xact_lock(hashtext('composure:first-user-admin'))`
      const [{ count }] = await tx<[{ count: number }]>`SELECT COUNT(1)::integer AS count FROM users WHERE is_guest = FALSE`
      const role = count === 0 ? 'admin' : explicitRole

      await tx`
        INSERT INTO users (id, email, email_verified, password_hash, display_name, role, is_guest, created_at)
        VALUES (${id}, ${email}, ${emailVerified}, ${input.passwordHash}, ${displayName}, ${role}, FALSE, extract(epoch from now())::integer)
      `

      return { id, email, displayName, profileImageUrl: null, role, isGuest: false }
    })
  } catch (err) {
    // Only a duplicate email means "already registered"; anything else is a
    // real failure the caller must not mistake for a conflict.
    if ((err as { code?: string })?.code === '23505') {
      return null
    }
    throw err
  }
}

export async function countUsers(): Promise<number> {
  const [{ count }] = await sql<[{ count: number }]>`SELECT COUNT(1)::integer AS count FROM users WHERE is_guest = FALSE`
  return count
}

export async function findUserByEmail(email: string): Promise<{
  id: string
  email: string
  email_verified: boolean
  display_name: string
  password_hash: string | null
  profile_image_url: string | null
  role: 'user' | 'admin'
  is_suspended: boolean
  is_guest: boolean
} | null> {
  const [row] = await sql`
    SELECT id, email, email_verified, display_name, password_hash, profile_image_url, role, is_suspended, is_guest
    FROM users WHERE email = ${email.trim().toLowerCase()} AND is_guest = FALSE
  `
  return (row as typeof row & {
    id: string
    email: string
    email_verified: boolean
    display_name: string
    password_hash: string | null
    profile_image_url: string | null
    role: 'user' | 'admin'
    is_suspended: boolean
    is_guest: boolean
  }) ?? null
}

export async function findUserById(id: string): Promise<SessionUser | null> {
  const [row] = await sql`
    SELECT id, email, display_name, profile_image_url, role, is_guest
    FROM users WHERE id = ${id}
  `
  if (!row) return null
  return {
    id: (row as Record<string, string>).id,
    email: (row as Record<string, string>).email,
    displayName: (row as Record<string, string>).display_name,
    profileImageUrl: (row as Record<string, string | null>).profile_image_url,
    role: (row as Record<string, string>).role as 'user' | 'admin',
    isGuest: (row as Record<string, boolean>).is_guest,
  }
}

export async function findGuestUserByCookieId(guestCookieId: string): Promise<SessionUser | null> {
  const [row] = await sql`
    SELECT id, email, display_name, profile_image_url, role, is_guest
    FROM users
    WHERE guest_cookie_id = ${guestCookieId}
      AND is_guest = TRUE
    LIMIT 1
  `

  if (!row) {
    return null
  }

  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    profileImageUrl: row.profile_image_url as string | null,
    role: row.role as 'user' | 'admin',
    isGuest: true,
  }
}

export async function createGuestUser(guestCookieId: string): Promise<SessionUser> {
  const id = createUid()
  const guestKey = guestCookieId.trim() || createUid()
  const email = `guest+${id}@guest.local`
  const displayName = `Guest ${guestKey.slice(0, 8)}`

  await sql`
    INSERT INTO users (
      id,
      email,
      password_hash,
      display_name,
      role,
      is_guest,
      guest_cookie_id,
      created_at
    )
    VALUES (
      ${id},
      ${email},
      NULL,
      ${displayName},
      'user',
      TRUE,
      ${guestKey},
      extract(epoch from now())::integer
    )
    ON CONFLICT (guest_cookie_id)
    WHERE guest_cookie_id IS NOT NULL
    DO NOTHING
  `

  const existing = await findGuestUserByCookieId(guestKey)
  if (!existing) {
    throw new Error('Failed to create guest user')
  }

  return existing
}

export async function findOrCreateGuestUserByCookieId(guestCookieId: string): Promise<SessionUser> {
  const existing = await findGuestUserByCookieId(guestCookieId)
  if (existing) {
    return existing
  }

  return await createGuestUser(guestCookieId)
}

export async function updateUserDisplayName(userId: string, displayName: string): Promise<boolean> {
  const normalized = (displayName.trim() || 'Composure User').slice(0, 80)
  const result = await sql`UPDATE users SET display_name = ${normalized} WHERE id = ${userId}`
  return result.count > 0
}

export async function updateUserEmail(userId: string, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  const result = await sql`
    UPDATE users
    SET email = ${normalized},
        email_verified = CASE WHEN email = ${normalized} THEN email_verified ELSE FALSE END
    WHERE id = ${userId}
  `
  return result.count > 0
}

export async function updateUserProfileImage(userId: string, profileImageUrl: string | null): Promise<boolean> {
  const normalized = profileImageUrl?.trim() || null
  const result = await sql`UPDATE users SET profile_image_url = ${normalized} WHERE id = ${userId}`
  return result.count > 0
}

export async function updateUserPasswordHash(userId: string, passwordHash: string): Promise<boolean> {
  const result = await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}`
  return result.count > 0
}

export async function updateUserRole(userId: string, role: 'user' | 'admin'): Promise<boolean> {
  const result = await sql`UPDATE users SET role = ${role} WHERE id = ${userId}`
  return result.count > 0
}

export async function updateUserSuspended(userId: string, suspended: boolean): Promise<boolean> {
  const result = await sql`UPDATE users SET is_suspended = ${suspended} WHERE id = ${userId}`
  return result.count > 0
}

export async function markUserLoggedIn(userId: string): Promise<void> {
  await sql`UPDATE users SET last_login_at = extract(epoch from now())::integer WHERE id = ${userId}`
}

export async function countAdminUsers(): Promise<number> {
  const [{ count }] = await sql<[{ count: number }]>`SELECT COUNT(1)::integer AS count FROM users WHERE role = 'admin' AND is_guest = FALSE`
  return count
}

export async function updateUserMaxProjects(userId: string, maxProjects: number | null): Promise<boolean> {
  const result = await sql`UPDATE users SET max_projects = ${maxProjects} WHERE id = ${userId}`
  return result.count > 0
}

export async function getUserMaxProjects(userId: string): Promise<number | null> {
  const [row] = await sql`SELECT max_projects FROM users WHERE id = ${userId}`
  return (row as { max_projects: number | null } | undefined)?.max_projects ?? null
}
