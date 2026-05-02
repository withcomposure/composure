import crypto from 'crypto'
import { sql, withUserTransaction } from './connection.js'
import type { SessionSummary, SessionUser } from './types.js'
import { createToken, createUid } from '../ids.js'
import { nowUnix } from './internal.js'

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

function mapSessionUser(row: Record<string, unknown>): SessionUser {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    profileImageUrl: row.profile_image_url as string | null,
    role: row.role as 'user' | 'admin',
    isGuest: row.is_guest === true,
  }
}

export interface IssuedRefreshToken {
  id: string
  token: string
  familyId: string
  expiresAt: number
  lastUsedAt: number
}

export async function issueRefreshToken(
  userId: string,
  maxAgeSeconds: number,
  familyId?: string,
): Promise<IssuedRefreshToken> {
  const id = createUid()
  const token = createToken(48)
  const tokenHash = hashToken(token)
  const now = nowUnix()
  const expiresAt = now + maxAgeSeconds
  const resolvedFamilyId = familyId ?? createUid()

  await sql`
    INSERT INTO refresh_tokens (
      id,
      user_id,
      token_hash,
      family_id,
      last_used_at,
      expires_at,
      created_at
    )
    VALUES (${id}, ${userId}, ${tokenHash}, ${resolvedFamilyId}, ${now}, ${expiresAt}, ${now})
  `

  return {
    id,
    token,
    familyId: resolvedFamilyId,
    expiresAt,
    lastUsedAt: now,
  }
}

export async function revokeRefreshTokenByRawToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken)
  await sql`
    UPDATE refresh_tokens
    SET revoked_at = extract(epoch from now())::integer
    WHERE token_hash = ${tokenHash}
  `
}

export async function revokeUserRefreshToken(userId: string, tokenId: string): Promise<boolean> {
  const result = await sql`
    UPDATE refresh_tokens
    SET revoked_at = extract(epoch from now())::integer
    WHERE id = ${tokenId}
      AND user_id = ${userId}
      AND revoked_at IS NULL
      AND rotated_at IS NULL
  `
  return result.count > 0
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<number> {
  const result = await sql`
    UPDATE refresh_tokens
    SET revoked_at = extract(epoch from now())::integer
    WHERE user_id = ${userId}
      AND revoked_at IS NULL
      AND rotated_at IS NULL
  `
  return result.count
}

export async function listRefreshTokensForUser(userId: string, currentTokenId: string | null): Promise<SessionSummary[]> {
  const rows = await sql`
    SELECT id, created_at, expires_at, last_used_at
    FROM refresh_tokens
    WHERE user_id = ${userId}
      AND revoked_at IS NULL
      AND rotated_at IS NULL
      AND expires_at > extract(epoch from now())::integer
    ORDER BY last_used_at DESC, created_at DESC
  `

  return rows.map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    lastUsedAt: row.last_used_at as number,
    isCurrent: currentTokenId != null && row.id === currentTokenId,
  }))
}

export type RotateRefreshResult =
  | { status: 'invalid' }
  | { status: 'reuse-detected' }
  | { status: 'ok'; user: SessionUser; token: IssuedRefreshToken }

export async function rotateRefreshToken(rawToken: string, maxAgeSeconds: number): Promise<RotateRefreshResult> {
  const tokenHash = hashToken(rawToken)
  const now = nowUnix()

  return await withUserTransaction(async (tx) => {
    const [row] = await tx`
      SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at
      FROM refresh_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `

    if (!row) {
      return { status: 'invalid' }
    }

    const refreshId = row.id as string
    const userId = row.user_id as string
    const familyId = row.family_id as string
    const expiresAt = row.expires_at as number
    const rotatedAt = row.rotated_at as number | null
    const revokedAt = row.revoked_at as number | null

    if (rotatedAt != null) {
      await tx`
        UPDATE refresh_tokens
        SET revoked_at = ${now}
        WHERE family_id = ${familyId}
          AND revoked_at IS NULL
      `
      return { status: 'reuse-detected' }
    }

    if (revokedAt != null || expiresAt <= now) {
      return { status: 'invalid' }
    }

    const [userRow] = await tx`
      SELECT id, email, display_name, profile_image_url, role, is_guest
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `

    if (!userRow) {
      await tx`
        UPDATE refresh_tokens
        SET revoked_at = ${now}
        WHERE id = ${refreshId}
      `
      return { status: 'invalid' }
    }

    const issued = await issueRefreshToken(userId, maxAgeSeconds, familyId)

    await tx`
      UPDATE refresh_tokens
      SET rotated_at = ${now}, last_used_at = ${now}
      WHERE id = ${refreshId}
    `

    return {
      status: 'ok',
      user: mapSessionUser(userRow as Record<string, unknown>),
      token: issued,
    }
  })
}

export async function findActiveRefreshTokenId(rawToken: string): Promise<string | null> {
  const tokenHash = hashToken(rawToken)
  const [row] = await sql`
    SELECT id
    FROM refresh_tokens
    WHERE token_hash = ${tokenHash}
      AND revoked_at IS NULL
      AND rotated_at IS NULL
      AND expires_at > extract(epoch from now())::integer
    LIMIT 1
  `

  return (row as { id: string } | undefined)?.id ?? null
}
