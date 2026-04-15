import { sql } from './connection.js'
import type { LinkSharingState, ProjectRole } from './types.js'
import { createToken, createUid } from '../ids.js'

interface StoredLinkSharingState {
  enabled: boolean
  role: Exclude<ProjectRole, 'owner'>
  token: string
}

async function getStoredLinkSharingState(projectId: string): Promise<StoredLinkSharingState | null> {
  const [stateRow] = await sql`
    SELECT token, role, enabled
    FROM project_link_sharing_state
    WHERE project_id = ${projectId}
    LIMIT 1
  `

  if (!stateRow) {
    return null
  }

  return {
    enabled: stateRow.enabled as boolean,
    role: stateRow.role as Exclude<ProjectRole, 'owner'>,
    token: stateRow.token as string,
  }
}

export async function getLinkSharingState(projectId: string): Promise<LinkSharingState> {
  const state = await getStoredLinkSharingState(projectId)
  if (!state) {
    return { enabled: false, role: null, token: null }
  }

  return {
    enabled: state.enabled,
    role: state.role,
    token: state.enabled ? state.token : null,
  }
}

export async function setLinkSharingState(input: {
  projectId: string
  enabled: boolean
  role: Exclude<ProjectRole, 'owner'>
  actorUserId: string | null
  invalidate?: boolean
}): Promise<LinkSharingState> {
  const current = await getStoredLinkSharingState(input.projectId)
  const token = input.invalidate ? createToken(32) : (current?.token ?? createToken(32))

  await sql`
    INSERT INTO project_link_sharing_state (
      project_id,
      token,
      role,
      enabled,
      created_by_user_id,
      created_at,
      updated_at
    )
    VALUES (${input.projectId}, ${token}, ${input.role}, ${input.enabled}, ${input.actorUserId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
    ON CONFLICT(project_id)
    DO UPDATE SET
      token = excluded.token,
      role = excluded.role,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `

  if (!input.enabled) {
    await sql`DELETE FROM share_tokens WHERE project_id = ${input.projectId}`
    return { enabled: false, role: input.role, token: null }
  }

  const [existing] = await sql`SELECT id FROM share_tokens WHERE project_id = ${input.projectId}`
  const id = (existing?.id as string) ?? createUid()

  await sql`
    INSERT INTO share_tokens (id, project_id, token, role, created_by_user_id, created_at, updated_at)
    VALUES (${id}, ${input.projectId}, ${token}, ${input.role}, ${input.actorUserId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
    ON CONFLICT(project_id)
    DO UPDATE SET token = excluded.token, role = excluded.role, updated_at = excluded.updated_at
  `

  return { enabled: true, role: input.role, token }
}
