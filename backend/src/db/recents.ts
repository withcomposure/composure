import { sql } from './connection.js'
import { getUserPreferences } from './preferences.js'
import type { Principal, ProjectSummary, RecentProjectSummary } from './types.js'
import { canAccessProjectWithRole } from './access.js'
import { createUid } from '../ids.js'

export async function recordRecentProjectOpen(principal: Principal, projectId: string, shareToken?: string): Promise<void> {
  const userId = principal.userId
  if (!userId) {
    return
  }

  const updated = await sql`
    UPDATE project_recents
    SET opened_at = extract(epoch from now())::integer, share_token = ${shareToken ?? null}
    WHERE user_id = ${userId} AND project_id = ${projectId}
  `

  if (updated.count === 0) {
    await sql`
      INSERT INTO project_recents (id, project_id, user_id, opened_at, share_token)
      VALUES (${createUid()}, ${projectId}, ${userId}, extract(epoch from now())::integer, ${shareToken ?? null})
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
}

export async function listRecentProjectsForPrincipal(principal: Principal): Promise<RecentProjectSummary[]> {
  const userId = principal.userId
  if (!userId) {
    return []
  }

  const limit = (await getUserPreferences(userId)).recentItemsLimit

  const rows = await sql`
    SELECT
      p.id,
      p.title,
      p.root_file,
      p.engine,
      p.created_at,
      p.last_active_at,
      (
        SELECT COUNT(1)::integer
        FROM project_comments pc
        WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
      ) AS top_level_comment_count,
      p.owner_user_id,
      r.opened_at,
      r.share_token,
      owner.display_name AS owner_display_name,
      owner.profile_image_url AS owner_profile_image_url,
      COALESCE(owner.is_guest, FALSE) AS owner_is_guest
    FROM project_recents r
    JOIN projects p ON p.id = r.project_id
    LEFT JOIN users owner ON owner.id = p.owner_user_id
    WHERE r.user_id = ${userId}
      AND p.deleted_at IS NULL
    ORDER BY r.opened_at DESC
    LIMIT ${limit}
  `

  const validRows: (typeof rows)[number][] = []
  for (const row of rows) {
    if ((await canAccessProjectWithRole(row.id as string, principal, 'view', (row.share_token as string | null) ?? undefined)).ok) {
      validRows.push(row)
      continue
    }

    await sql`DELETE FROM project_recents WHERE user_id = ${userId} AND project_id = ${row.id}`
  }

  return validRows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    rootFile: row.root_file as string,
    engine: row.engine as string | null,
    createdAt: row.created_at as number,
    lastActiveAt: row.last_active_at as number,
    topLevelCommentCount: row.top_level_comment_count as number,
    ownerType: (row.owner_is_guest as boolean) ? 'guest' : 'user',
    ownerDisplayName: (row.owner_display_name as string) ?? 'Deleted User',
    ownerProfileImageUrl: row.owner_profile_image_url as string | null,
    openedAt: row.opened_at as number,
    shareToken: (row.share_token as string | null) ?? undefined,
  }))
}

export async function clearRecentProjectsForPrincipal(principal: Principal): Promise<void> {
  if (!principal.userId) {
    return
  }

  await sql`DELETE FROM project_recents WHERE user_id = ${principal.userId}`
}

export async function migrateGuestRecentsToUser(fromUserId: string, userId: string): Promise<number> {
  if (!fromUserId || !userId || fromUserId === userId) {
    return 0
  }

  const sourceRows = await sql`
    SELECT id, project_id, opened_at, share_token
    FROM project_recents
    WHERE user_id = ${fromUserId}
    ORDER BY opened_at DESC
  `

  let migrated = 0
  for (const sourceRow of sourceRows) {
    const [existingUserRow] = await sql`
      SELECT id, opened_at, share_token
      FROM project_recents
      WHERE user_id = ${userId} AND project_id = ${sourceRow.project_id}
    `

    if (!existingUserRow) {
      await sql`
        UPDATE project_recents
        SET user_id = ${userId}
        WHERE id = ${sourceRow.id}
      `
      migrated += 1
      continue
    }

    const newestOpenedAt = Math.max(existingUserRow.opened_at as number, sourceRow.opened_at as number)
    const mergedShareToken = (existingUserRow.opened_at as number) >= (sourceRow.opened_at as number)
      ? ((existingUserRow.share_token as string | null) ?? (sourceRow.share_token as string | null))
      : ((sourceRow.share_token as string | null) ?? (existingUserRow.share_token as string | null))

    await sql`
      UPDATE project_recents
      SET opened_at = ${newestOpenedAt}, share_token = ${mergedShareToken}
      WHERE id = ${existingUserRow.id}
    `

    await sql`DELETE FROM project_recents WHERE id = ${sourceRow.id}`
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
  if (!userId) return []

  const rows = await sql`
    SELECT
      p.id,
      p.title,
      p.root_file,
      p.engine,
      p.created_at,
      p.last_active_at,
      (
        SELECT COUNT(1)::integer
        FROM project_comments pc
        WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
      ) AS top_level_comment_count,
      p.owner_user_id,
      r.share_token,
      owner.display_name AS owner_display_name,
      owner.profile_image_url AS owner_profile_image_url,
      COALESCE(owner.is_guest, FALSE) AS owner_is_guest
    FROM project_recents r
    JOIN projects p ON p.id = r.project_id
    JOIN share_tokens st ON st.project_id = p.id AND st.token = r.share_token
    LEFT JOIN users owner ON owner.id = p.owner_user_id
    WHERE r.user_id = ${userId}
      AND r.share_token IS NOT NULL
      AND p.deleted_at IS NULL
      AND (p.owner_user_id IS NULL OR p.owner_user_id != ${userId})
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
    ownerType: (row.owner_is_guest as boolean) ? 'guest' : 'user',
    ownerDisplayName: (row.owner_display_name as string) ?? 'Deleted User',
    ownerProfileImageUrl: row.owner_profile_image_url as string | null,
    shareToken: (row.share_token as string | null) ?? undefined,
  }))
}
