import { normalizeRelativePath } from '../security.js'
import { sql } from './connection.js'
import { findUserById } from './users.js'
import type { Principal, ProjectRow, ProjectSummary } from './types.js'
import { guestDisplayName, normalizeTitle, nowUnix } from './internal.js'

export async function findProjectById(projectId: string): Promise<ProjectRow | null> {
  const [row] = await sql`SELECT * FROM projects WHERE id = ${projectId}`
  return (row as ProjectRow | undefined) ?? null
}

export async function listProjectsForPrincipal(principal: Principal): Promise<ProjectSummary[]> {
  const userId = principal.userId
  const guestId = principal.guestId
  if (userId) {
    const rows = await sql`
      SELECT p.id, p.title, p.root_file, p.engine, p.created_at, p.last_active_at,
             (
               SELECT COUNT(1)::integer
               FROM project_comments pc
               WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
             ) AS top_level_comment_count,
             COALESCE(u.display_name, 'Deleted User') AS owner_display_name,
             u.profile_image_url AS owner_profile_image_url
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_user_id
      WHERE owner_user_id = ${userId} AND deleted_at IS NULL
      ORDER BY last_active_at DESC
    `

    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      rootFile: row.root_file as string,
      engine: row.engine as string | null,
      createdAt: row.created_at as number,
      lastActiveAt: row.last_active_at as number,
      topLevelCommentCount: row.top_level_comment_count as number,
      ownerType: 'user' as const,
      ownerDisplayName: row.owner_display_name as string,
      ownerProfileImageUrl: row.owner_profile_image_url as string | null,
    }))
  }

  if (!guestId) {
    return []
  }

  const rows = await sql`
    SELECT id, title, root_file, engine, created_at, last_active_at,
           (
             SELECT COUNT(1)::integer
             FROM project_comments pc
             WHERE pc.project_id = projects.id AND pc.parent_comment_id IS NULL
           ) AS top_level_comment_count
    FROM projects
    WHERE owner_guest_id = ${guestId} AND deleted_at IS NULL
    ORDER BY last_active_at DESC
  `

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    rootFile: row.root_file as string,
    engine: row.engine as string | null,
    createdAt: row.created_at as number,
    lastActiveAt: row.last_active_at as number,
    topLevelCommentCount: row.top_level_comment_count as number,
    ownerType: 'guest' as const,
    ownerDisplayName: guestDisplayName(guestId),
    ownerProfileImageUrl: null,
  }))
}

export async function createProjectForPrincipal(input: {
  projectId: string
  principal: Principal
  title?: string
  rootFile?: string
  engine?: string | null
}): Promise<ProjectSummary> {
  const { projectId, principal } = input
  const userId = principal.userId
  const guestId = principal.guestId

  const title = normalizeTitle(input.title)
  const rootFile = normalizeRelativePath(input.rootFile) ?? 'main.tex'
  const engine = input.engine ?? null

  await sql`
    INSERT INTO projects (
      id, title, root_file, engine, owner_user_id, owner_guest_id, created_at, last_active_at
    ) VALUES (${projectId}, ${title}, ${rootFile}, ${engine}, ${userId}, ${userId ? null : guestId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
  `

  return {
    id: projectId,
    title,
    rootFile,
    engine,
    createdAt: nowUnix(),
    lastActiveAt: nowUnix(),
    topLevelCommentCount: 0,
    ownerType: userId ? 'user' : 'guest',
    ownerDisplayName: userId ? ((await findUserById(userId))?.displayName ?? 'User') : guestDisplayName(guestId),
    ownerProfileImageUrl: userId ? ((await findUserById(userId))?.profileImageUrl ?? null) : null,
  }
}

export async function touchProjectActivity(projectId: string): Promise<void> {
  await sql`UPDATE projects SET last_active_at = extract(epoch from now())::integer WHERE id = ${projectId} AND deleted_at IS NULL`
}

export async function renameProject(projectId: string, title: string): Promise<boolean> {
  const normalized = normalizeTitle(title)
  const result = await sql`
    UPDATE projects SET title = ${normalized}, last_active_at = extract(epoch from now())::integer WHERE id = ${projectId} AND deleted_at IS NULL
  `
  return result.count > 0
}

export async function softDeleteProject(projectId: string): Promise<boolean> {
  const result = await sql`
    UPDATE projects SET deleted_at = extract(epoch from now())::integer, last_active_at = extract(epoch from now())::integer WHERE id = ${projectId} AND deleted_at IS NULL
  `
  return result.count > 0
}

export async function softDeleteProjectsOwnedByUser(userId: string): Promise<number> {
  const result = await sql`
    UPDATE projects SET deleted_at = extract(epoch from now())::integer, last_active_at = extract(epoch from now())::integer WHERE owner_user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count
}

export async function migrateGuestProjectsToUser(guestId: string, userId: string): Promise<number> {
  if (!guestId) return 0

  const result = await sql`
    UPDATE projects
    SET owner_user_id = ${userId}, owner_guest_id = NULL, last_active_at = extract(epoch from now())::integer
    WHERE owner_guest_id = ${guestId} AND deleted_at IS NULL
  `

  return result.count
}

export async function restoreProject(projectId: string): Promise<boolean> {
  const result = await sql`
    UPDATE projects SET deleted_at = NULL WHERE id = ${projectId} AND deleted_at IS NOT NULL
  `
  return result.count > 0
}

export async function permanentDeleteProject(projectId: string): Promise<boolean> {
  const result = await sql`DELETE FROM projects WHERE id = ${projectId}`
  await sql`DELETE FROM documents WHERE name = ${projectId}`
  await sql`DELETE FROM project_comments WHERE project_id = ${projectId}`
  await sql`DELETE FROM project_members WHERE project_id = ${projectId}`
  await sql`DELETE FROM share_tokens WHERE project_id = ${projectId}`
  await sql`DELETE FROM project_recents WHERE project_id = ${projectId}`
  return result.count > 0
}

export async function listTrashForPrincipal(principal: Principal): Promise<Array<ProjectSummary & { deletedAt: number }>> {
  const userId = principal.userId
  const guestId = principal.guestId

  if (userId) {
    const rows = await sql`
      SELECT p.id, p.title, p.root_file, p.engine, p.created_at, p.last_active_at, p.deleted_at,
             COALESCE(u.display_name, 'Deleted User') AS owner_display_name,
             u.profile_image_url AS owner_profile_image_url
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_user_id
      WHERE owner_user_id = ${userId} AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `

    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      rootFile: row.root_file as string,
      engine: row.engine as string | null,
      createdAt: row.created_at as number,
      lastActiveAt: row.last_active_at as number,
      topLevelCommentCount: 0,
      ownerType: 'user' as const,
      ownerDisplayName: row.owner_display_name as string,
      ownerProfileImageUrl: row.owner_profile_image_url as string | null,
      deletedAt: row.deleted_at as number,
    }))
  }

  if (!guestId) return []

  const rows = await sql`
    SELECT id, title, root_file, engine, created_at, last_active_at, deleted_at
    FROM projects
    WHERE owner_guest_id = ${guestId} AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    rootFile: row.root_file as string,
    engine: row.engine as string | null,
    createdAt: row.created_at as number,
    lastActiveAt: row.last_active_at as number,
    topLevelCommentCount: 0,
    ownerType: 'guest' as const,
    ownerDisplayName: guestDisplayName(guestId),
    ownerProfileImageUrl: null,
    deletedAt: row.deleted_at as number,
  }))
}
