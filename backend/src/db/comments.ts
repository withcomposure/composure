import { normalizeRelativePath } from '../security.js'
import { createUid } from '../ids.js'
import { sql } from './connection.js'
import type { Principal, ProjectComment } from './types.js'

export async function listProjectComments(projectId: string, filePath?: string): Promise<ProjectComment[]> {
  const hasFile = Boolean(filePath && filePath.trim().length > 0)
  const rows = hasFile
    ? await sql`
      SELECT
        c.id,
        c.project_id,
        c.file_path,
        c.start_line,
        c.end_line,
        c.parent_comment_id,
        c.body,
        c.author_user_id,
        c.created_at,
        c.updated_at,
        COALESCE(u.display_name, 'Deleted User') AS author_display_name,
        COALESCE(u.profile_image_url, NULL) AS author_profile_image_url
       FROM project_comments c
       LEFT JOIN users u ON u.id = c.author_user_id
       WHERE c.project_id = ${projectId} AND c.file_path = ${filePath!}
       ORDER BY c.created_at ASC
    `
    : await sql`
      SELECT
        c.id,
        c.project_id,
        c.file_path,
        c.start_line,
        c.end_line,
        c.parent_comment_id,
        c.body,
        c.author_user_id,
        c.created_at,
        c.updated_at,
        COALESCE(u.display_name, 'Deleted User') AS author_display_name,
        COALESCE(u.profile_image_url, NULL) AS author_profile_image_url
       FROM project_comments c
       LEFT JOIN users u ON u.id = c.author_user_id
       WHERE c.project_id = ${projectId}
       ORDER BY c.created_at ASC
    `

  return rows.map((row) => ({
    id: row.id as string,
    projectId: row.project_id as string,
    filePath: row.file_path as string,
    startLine: row.start_line as number | null,
    endLine: row.end_line as number | null,
    parentCommentId: row.parent_comment_id as string | null,
    body: row.body as string,
    authorUserId: row.author_user_id as string | null,
    authorGuestId: null,
    authorDisplayName: row.author_display_name as string,
    authorProfileImageUrl: row.author_profile_image_url as string | null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }))
}

export async function addProjectComment(input: {
  projectId: string
  filePath: string
  startLine?: number | null
  endLine?: number | null
  parentCommentId?: string | null
  body: string
  principal: Principal
}): Promise<ProjectComment> {
  const id = createUid()
  const normalizedBody = input.body.trim().slice(0, 4000)
  const normalizedPath = normalizeRelativePath(input.filePath) ?? 'main.tex'
  const startLine = input.startLine && input.startLine > 0
    ? Math.floor(input.startLine)
    : null
  const endLineRaw = input.endLine && input.endLine > 0
    ? Math.floor(input.endLine)
    : startLine
  const endLine = startLine && endLineRaw && endLineRaw >= startLine ? endLineRaw : startLine
  const parentCommentId = input.parentCommentId?.trim() ? input.parentCommentId.trim() : null

  if (parentCommentId) {
    const [parent] = await sql`
      SELECT id, file_path
      FROM project_comments
      WHERE id = ${parentCommentId} AND project_id = ${input.projectId}
      LIMIT 1
    `

    if (!parent || parent.file_path !== normalizedPath) {
      throw new Error('Invalid parent comment')
    }
  }

  await sql`
    INSERT INTO project_comments (
      id, project_id, file_path, start_line, end_line, parent_comment_id, body, author_user_id, created_at, updated_at
    ) VALUES (${id}, ${input.projectId}, ${normalizedPath}, ${startLine}, ${endLine}, ${parentCommentId}, ${normalizedBody}, ${input.principal.userId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
  `

  const all = await listProjectComments(input.projectId)
  const created = all.find((comment) => comment.id === id)
  if (!created) {
    throw new Error('Failed to create comment')
  }

  return created
}

export async function getProjectCommentById(projectId: string, commentId: string): Promise<ProjectComment | null> {
  const all = await listProjectComments(projectId)
  return all.find((entry) => entry.id === commentId) ?? null
}

export function canPrincipalModifyComment(comment: ProjectComment, principal: Principal): boolean {
  return Boolean(comment.authorUserId && principal.userId && comment.authorUserId === principal.userId)
}

export async function updateProjectCommentBody(input: {
  projectId: string
  commentId: string
  body: string
}): Promise<ProjectComment | null> {
  const normalizedBody = input.body.trim().slice(0, 4000)
  if (!normalizedBody) {
    return null
  }

  const result = await sql`
    UPDATE project_comments
    SET body = ${normalizedBody}, updated_at = extract(epoch from now())::integer
    WHERE id = ${input.commentId} AND project_id = ${input.projectId}
  `

  if (result.count === 0) {
    return null
  }

  return getProjectCommentById(input.projectId, input.commentId)
}

export async function deleteProjectComment(projectId: string, commentId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM project_comments WHERE id = ${commentId} AND project_id = ${projectId}
  `
  return result.count > 0
}
