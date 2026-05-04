import { normalizeRelativePath } from '../security.js'
import { sql } from './connection.js'
import { runWithIdentityContext } from './request-context.js'
import { findUserById } from './users.js'
import type { Principal, ProjectRow, ProjectSummary } from './types.js'
import { normalizeTitle, nowUnix } from './internal.js'

export async function findProjectById(projectId: string): Promise<ProjectRow | null> {
  const [row] = await sql`SELECT * FROM projects WHERE id = ${projectId}`
  return (row as ProjectRow | undefined) ?? null
}

export async function listProjectsForPrincipal(principal: Principal): Promise<ProjectSummary[]> {
  const userId = principal.userId
  if (!userId) {
    return []
  }

  const rows = await sql`
    SELECT
      p.id,
      p.title,
      p.root_file,
      p.default_bibliography_file,
      p.engine,
      p.created_at,
      p.last_active_at,
      (
        SELECT COUNT(1)::integer
        FROM project_comments pc
        WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
      ) AS top_level_comment_count,
      COALESCE(owner.display_name, 'Deleted User') AS owner_display_name,
      owner.profile_image_url AS owner_profile_image_url,
      COALESCE(owner.is_guest, FALSE) AS owner_is_guest
    FROM projects p
    LEFT JOIN users owner ON owner.id = p.owner_user_id
    WHERE p.owner_user_id = ${userId}
      AND p.deleted_at IS NULL
    ORDER BY p.last_active_at DESC
  `

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    rootFile: row.root_file as string,
    defaultBibliographyFile: row.default_bibliography_file as string | null,
    engine: row.engine as string | null,
    createdAt: row.created_at as number,
    lastActiveAt: row.last_active_at as number,
    topLevelCommentCount: row.top_level_comment_count as number,
    ownerType: (row.owner_is_guest as boolean) ? 'guest' : 'user',
    ownerDisplayName: row.owner_display_name as string,
    ownerProfileImageUrl: row.owner_profile_image_url as string | null,
  }))
}

export async function createProjectForPrincipal(input: {
  projectId: string
  principal: Principal
  title?: string
  rootFile?: string
  defaultBibliographyFile?: string | null
  engine?: string | null
}): Promise<ProjectSummary> {
  const { projectId, principal } = input
  const userId = principal.userId
  if (!userId) {
    throw new Error('Authenticated principal is required to create a project')
  }

  const title = normalizeTitle(input.title)
  const rootFile = normalizeRelativePath(input.rootFile) ?? 'main.tex'
  const defaultBibliographyFile = normalizeRelativePath(input.defaultBibliographyFile) ?? null
  const engine = input.engine ?? null

  await runWithIdentityContext(null, 'system', async () => {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO projects (
          id, title, root_file, default_bibliography_file, engine, owner_user_id, created_at, last_active_at
        ) VALUES (${projectId}, ${title}, ${rootFile}, ${defaultBibliographyFile}, ${engine}, ${userId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
      `

      await tx`
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
        VALUES (${projectId}, ${userId}, NULL, 'owner', 'accepted', ${userId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
        ON CONFLICT (project_id, user_id)
        WHERE user_id IS NOT NULL
        DO UPDATE SET
          role = 'owner',
          status = 'accepted',
          invited_email = NULL,
          updated_at = excluded.updated_at
      `
    })
  })

  const owner = await findUserById(userId)

  return {
    id: projectId,
    title,
    rootFile,
    defaultBibliographyFile,
    engine,
    createdAt: nowUnix(),
    lastActiveAt: nowUnix(),
    topLevelCommentCount: 0,
    ownerType: owner?.isGuest ? 'guest' : 'user',
    ownerDisplayName: owner?.displayName ?? 'User',
    ownerProfileImageUrl: owner?.profileImageUrl ?? null,
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

export async function updateProjectMetadataDefaults(input: {
  projectId: string
  rootFile?: string | null
  defaultBibliographyFile?: string | null
}): Promise<boolean> {
  const updates: string[] = []
  const values: Array<string | null> = []

  if (Object.prototype.hasOwnProperty.call(input, 'rootFile')) {
    const normalized = normalizeRelativePath(input.rootFile)
    updates.push(`root_file = $${updates.length + 1}`)
    values.push(normalized)
  }

  if (Object.prototype.hasOwnProperty.call(input, 'defaultBibliographyFile')) {
    const normalized = normalizeRelativePath(input.defaultBibliographyFile)
    updates.push(`default_bibliography_file = $${updates.length + 1}`)
    values.push(normalized)
  }

  if (updates.length === 0) {
    return false
  }

  const result = await sql.unsafe(
    `UPDATE projects SET ${updates.join(', ')}, last_active_at = extract(epoch from now())::integer WHERE id = $${updates.length + 1} AND deleted_at IS NULL`,
    [...values, input.projectId],
  )

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

export async function migrateGuestProjectsToUser(fromUserId: string, userId: string): Promise<number> {
  if (!fromUserId || fromUserId === userId) return 0

  const result = await sql`
    UPDATE projects
    SET owner_user_id = ${userId}, last_active_at = extract(epoch from now())::integer
    WHERE owner_user_id = ${fromUserId} AND deleted_at IS NULL
  `

  await sql`
    DELETE FROM project_members pm
    USING project_members existing
    WHERE pm.project_id = existing.project_id
      AND pm.user_id = ${fromUserId}
      AND existing.user_id = ${userId}
  `

  await sql`
    UPDATE project_members
    SET user_id = ${userId}, updated_at = extract(epoch from now())::integer
    WHERE user_id = ${fromUserId}
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
  if (!userId) {
    return []
  }

  const rows = await sql`
    SELECT
      p.id,
      p.title,
      p.root_file,
      p.default_bibliography_file,
      p.engine,
      p.created_at,
      p.last_active_at,
      p.deleted_at,
      COALESCE(owner.display_name, 'Deleted User') AS owner_display_name,
      owner.profile_image_url AS owner_profile_image_url,
      COALESCE(owner.is_guest, FALSE) AS owner_is_guest
    FROM projects p
    LEFT JOIN users owner ON owner.id = p.owner_user_id
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
    WHERE (
        p.owner_user_id = ${userId}
        OR pm.status = 'accepted'
      )
      AND p.deleted_at IS NOT NULL
    ORDER BY p.deleted_at DESC
  `

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    rootFile: row.root_file as string,
    defaultBibliographyFile: row.default_bibliography_file as string | null,
    engine: row.engine as string | null,
    createdAt: row.created_at as number,
    lastActiveAt: row.last_active_at as number,
    topLevelCommentCount: 0,
    ownerType: (row.owner_is_guest as boolean) ? 'guest' : 'user',
    ownerDisplayName: row.owner_display_name as string,
    ownerProfileImageUrl: row.owner_profile_image_url as string | null,
    deletedAt: row.deleted_at as number,
  }))
}
