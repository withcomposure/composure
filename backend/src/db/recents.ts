import { sql } from './connection.js'
import { getUserPreferences } from './preferences.js'
import type { Principal, ProjectSummary, RecentProjectSummary } from './types.js'
import { guestDisplayName } from './internal.js'
import { canAccessProjectWithRole } from './access.js'
import { createUid } from '../ids.js'

export async function recordRecentProjectOpen(principal: Principal, projectId: string, shareToken?: string): Promise<void> {
  const userId = principal.userId
  const guestId = principal.guestId
  if (!userId && !guestId) {
    return
  }

  if (userId) {
    const updated = await sql`
      UPDATE project_recents
      SET opened_at = extract(epoch from now())::integer, share_token = ${shareToken ?? null}
      WHERE user_id = ${userId} AND project_id = ${projectId}
    `

    if (updated.count === 0) {
      await sql`
        INSERT INTO project_recents (id, project_id, user_id, guest_id, opened_at, share_token)
        VALUES (${createUid()}, ${projectId}, ${userId}, NULL, extract(epoch from now())::integer, ${shareToken ?? null})
      `
    }

    const limit = (await getUserPreferences(userId)).recentItemsLimit
    await sql`
      DELETE FROM project_recents
      WHERE user_id = ${userId}
        AND id NOT IN (
          SELECT id
          FROM project_recents
          WHERE user_id = ${userId}
          ORDER BY opened_at DESC
          LIMIT ${limit}
        )
    `
    return
  }

  const updated = await sql`
    UPDATE project_recents
    SET opened_at = extract(epoch from now())::integer, share_token = ${shareToken ?? null}
    WHERE guest_id = ${guestId} AND project_id = ${projectId}
  `

  if (updated.count === 0) {
    await sql`
      INSERT INTO project_recents (id, project_id, user_id, guest_id, opened_at, share_token)
      VALUES (${createUid()}, ${projectId}, NULL, ${guestId}, extract(epoch from now())::integer, ${shareToken ?? null})
    `
  }

  await sql`
    DELETE FROM project_recents
    WHERE guest_id = ${guestId}
      AND id NOT IN (
        SELECT id
        FROM project_recents
        WHERE guest_id = ${guestId}
        ORDER BY opened_at DESC
        LIMIT 10
      )
  `
}

export async function listRecentProjectsForPrincipal(principal: Principal): Promise<RecentProjectSummary[]> {
  const userId = principal.userId
  const guestId = principal.guestId
  if (!userId && !guestId) {
    return []
  }

  const limit = userId ? (await getUserPreferences(userId)).recentItemsLimit : 10

  const rows = userId
    ? await sql`
      SELECT p.id, p.title, p.root_file, p.engine, p.created_at, p.last_active_at,
             (
               SELECT COUNT(1)::integer
               FROM project_comments pc
               WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
             ) AS top_level_comment_count,
             p.owner_user_id, p.owner_guest_id, r.opened_at, r.share_token,
             owner.display_name AS owner_display_name,
             owner.profile_image_url AS owner_profile_image_url
      FROM project_recents r
      JOIN projects p ON p.id = r.project_id
      LEFT JOIN users owner ON owner.id = p.owner_user_id
      WHERE r.user_id = ${userId}
        AND p.deleted_at IS NULL
      ORDER BY r.opened_at DESC
      LIMIT ${limit}
    `
    : await sql`
      SELECT p.id, p.title, p.root_file, p.engine, p.created_at, p.last_active_at,
             (
               SELECT COUNT(1)::integer
               FROM project_comments pc
               WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
             ) AS top_level_comment_count,
             p.owner_user_id, p.owner_guest_id, r.opened_at, r.share_token,
             owner.display_name AS owner_display_name,
             owner.profile_image_url AS owner_profile_image_url
      FROM project_recents r
      JOIN projects p ON p.id = r.project_id
      LEFT JOIN users owner ON owner.id = p.owner_user_id
      WHERE r.guest_id = ${guestId}
        AND p.deleted_at IS NULL
      ORDER BY r.opened_at DESC
      LIMIT 10
    `

  const validRows: (typeof rows)[number][] = []
  for (const row of rows) {
    if ((await canAccessProjectWithRole(row.id as string, principal, 'view', (row.share_token as string | null) ?? undefined)).ok) {
      validRows.push(row)
      continue
    }

    if (userId) {
      await sql`DELETE FROM project_recents WHERE user_id = ${userId} AND project_id = ${row.id}`
    } else if (guestId) {
      await sql`DELETE FROM project_recents WHERE guest_id = ${guestId} AND project_id = ${row.id}`
    }
  }

  return validRows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    rootFile: row.root_file as string,
    engine: row.engine as string | null,
    createdAt: row.created_at as number,
    lastActiveAt: row.last_active_at as number,
    topLevelCommentCount: row.top_level_comment_count as number,
    ownerType: row.owner_user_id ? 'user' as const : 'guest' as const,
    ownerDisplayName: row.owner_user_id ? ((row.owner_display_name as string) ?? 'Deleted User') : guestDisplayName(row.owner_guest_id as string | null),
    ownerProfileImageUrl: row.owner_profile_image_url as string | null,
    openedAt: row.opened_at as number,
    shareToken: (row.share_token as string | null) ?? undefined,
  }))
}

export async function clearRecentProjectsForPrincipal(principal: Principal): Promise<void> {
  if (principal.userId) {
    await sql`DELETE FROM project_recents WHERE user_id = ${principal.userId}`
    return
  }
  if (principal.guestId) {
    await sql`DELETE FROM project_recents WHERE guest_id = ${principal.guestId}`
  }
}

export async function migrateGuestRecentsToUser(guestId: string, userId: string): Promise<number> {
  if (!guestId || !userId) {
    return 0
  }

  const guestRows = await sql`
    SELECT id, project_id, opened_at, share_token
    FROM project_recents
    WHERE guest_id = ${guestId}
    ORDER BY opened_at DESC
  `

  let migrated = 0
  for (const guestRow of guestRows) {
    const [existingUserRow] = await sql`
      SELECT id, opened_at, share_token
      FROM project_recents
      WHERE user_id = ${userId} AND project_id = ${guestRow.project_id}
    `

    if (!existingUserRow) {
      await sql`
        UPDATE project_recents
        SET user_id = ${userId}, guest_id = NULL
        WHERE id = ${guestRow.id}
      `
      migrated += 1
      continue
    }

    const newestOpenedAt = Math.max(existingUserRow.opened_at as number, guestRow.opened_at as number)
    const mergedShareToken = (existingUserRow.opened_at as number) >= (guestRow.opened_at as number)
      ? ((existingUserRow.share_token as string | null) ?? (guestRow.share_token as string | null))
      : ((guestRow.share_token as string | null) ?? (existingUserRow.share_token as string | null))

    await sql`
      UPDATE project_recents
      SET opened_at = ${newestOpenedAt}, share_token = ${mergedShareToken}
      WHERE id = ${existingUserRow.id}
    `

    await sql`DELETE FROM project_recents WHERE id = ${guestRow.id}`
    migrated += 1
  }

  const limit = (await getUserPreferences(userId)).recentItemsLimit
  await sql`
    DELETE FROM project_recents
    WHERE user_id = ${userId}
      AND id NOT IN (
        SELECT id
        FROM project_recents
        WHERE user_id = ${userId}
        ORDER BY opened_at DESC
        LIMIT ${limit}
      )
  `

  return migrated
}

export async function listLinkSharedProjectsForPrincipal(principal: Principal): Promise<ProjectSummary[]> {
  const userId = principal.userId
  const guestId = principal.guestId
  if (!userId && !guestId) return []

  const principalId = userId ?? guestId!
  const ownerExclude = userId ?? ''

  const rows = userId
    ? await sql`
      SELECT p.id, p.title, p.root_file, p.engine, p.created_at, p.last_active_at,
             (
               SELECT COUNT(1)::integer
               FROM project_comments pc
               WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
             ) AS top_level_comment_count,
             p.owner_user_id, p.owner_guest_id,
             r.share_token,
             owner.display_name AS owner_display_name,
             owner.profile_image_url AS owner_profile_image_url
      FROM project_recents r
      JOIN projects p ON p.id = r.project_id
      JOIN share_tokens st ON st.project_id = p.id AND st.token = r.share_token
      LEFT JOIN users owner ON owner.id = p.owner_user_id
      WHERE r.user_id = ${principalId}
        AND r.share_token IS NOT NULL
        AND p.deleted_at IS NULL
        AND (p.owner_user_id IS NULL OR p.owner_user_id != ${ownerExclude})
      ORDER BY p.last_active_at DESC
    `
    : await sql`
      SELECT p.id, p.title, p.root_file, p.engine, p.created_at, p.last_active_at,
             (
               SELECT COUNT(1)::integer
               FROM project_comments pc
               WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
             ) AS top_level_comment_count,
             p.owner_user_id, p.owner_guest_id,
             r.share_token,
             owner.display_name AS owner_display_name,
             owner.profile_image_url AS owner_profile_image_url
      FROM project_recents r
      JOIN projects p ON p.id = r.project_id
      JOIN share_tokens st ON st.project_id = p.id AND st.token = r.share_token
      LEFT JOIN users owner ON owner.id = p.owner_user_id
      WHERE r.guest_id = ${principalId}
        AND r.share_token IS NOT NULL
        AND p.deleted_at IS NULL
        AND (p.owner_user_id IS NULL OR p.owner_user_id != ${ownerExclude})
      ORDER BY p.last_active_at DESC
    `

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    rootFile: row.root_file as string,
    engine: row.engine as string | null,
    createdAt: row.created_at as number,
    lastActiveAt: row.last_active_at as number,
    topLevelCommentCount: row.top_level_comment_count as number,
    ownerType: row.owner_user_id ? 'user' as const : 'guest' as const,
    ownerDisplayName: row.owner_user_id ? ((row.owner_display_name as string) ?? 'Deleted User') : guestDisplayName(row.owner_guest_id as string | null),
    ownerProfileImageUrl: row.owner_profile_image_url as string | null,
    shareToken: (row.share_token as string | null) ?? undefined,
  }))
}
