import { sql } from './connection.js'
import type { SessionSummary, SessionUser } from './types.js'
import { nowUnix } from './internal.js'
import { createUid } from '../ids.js'

export async function createSession(userId: string, maxAgeSeconds: number): Promise<{ id: string; expiresAt: number }> {
  const id = createUid()
  const expiresAt = nowUnix() + maxAgeSeconds

  await sql`
    INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES (${id}, ${userId}, ${expiresAt}, extract(epoch from now())::integer)
  `

  return { id, expiresAt }
}

export async function deleteSession(sessionId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE id = ${sessionId}`
}

export async function resolveSession(sessionId: string): Promise<SessionUser | null> {
  const [row] = await sql`
    SELECT u.id, u.email, u.display_name, u.profile_image_url, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > extract(epoch from now())::integer
  `

  if (!row) return null

  return {
    id: (row as Record<string, string>).id,
    email: (row as Record<string, string>).email,
    displayName: (row as Record<string, string>).display_name,
    profileImageUrl: (row as Record<string, string | null>).profile_image_url,
    role: (row as Record<string, string>).role as 'user' | 'admin',
  }
}

export async function listSessionsForUser(userId: string, currentSessionId: string | null): Promise<SessionSummary[]> {
  const rows = await sql`
    SELECT id, created_at, expires_at
    FROM sessions
    WHERE user_id = ${userId} AND expires_at > extract(epoch from now())::integer
    ORDER BY created_at DESC
  `

  return rows.map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    isCurrent: currentSessionId != null && row.id === currentSessionId,
  }))
}

export async function deleteUserSession(userId: string, sessionId: string): Promise<boolean> {
  const result = await sql`DELETE FROM sessions WHERE id = ${sessionId} AND user_id = ${userId}`
  return result.count > 0
}

export async function deleteAllUserSessions(userId: string): Promise<number> {
  const result = await sql`DELETE FROM sessions WHERE user_id = ${userId}`
  return result.count
}

export async function deleteAllUserSessionsExcept(userId: string, keepSessionId: string): Promise<number> {
  const result = await sql`DELETE FROM sessions WHERE user_id = ${userId} AND id != ${keepSessionId}`
  return result.count
}
