import { sql } from './connection.js'
import type { Principal } from './types.js'

function parseStateJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export async function getProjectWorkspaceState(
  projectId: string,
  principal: Principal,
): Promise<Record<string, unknown> | null> {
  if (!principal.userId) {
    return null
  }

  const [row] = await sql`
    SELECT state_json
    FROM project_workspace_states
    WHERE project_id = ${projectId} AND user_id = ${principal.userId}
    LIMIT 1
  `

  return row ? parseStateJson(row.state_json as string) : null
}

export async function setProjectWorkspaceState(
  projectId: string,
  principal: Principal,
  state: Record<string, unknown>,
): Promise<void> {
  if (!principal.userId) {
    return
  }

  const stateJson = JSON.stringify(state)

  const updated = await sql`
    UPDATE project_workspace_states
    SET state_json = ${stateJson}, updated_at = extract(epoch from now())::integer
    WHERE project_id = ${projectId} AND user_id = ${principal.userId}
  `

  if (updated.count === 0) {
    await sql`
      INSERT INTO project_workspace_states (project_id, user_id, state_json, updated_at)
      VALUES (${projectId}, ${principal.userId}, ${stateJson}, extract(epoch from now())::integer)
    `
  }
}

export async function migrateGuestWorkspaceStatesToUser(fromUserId: string, userId: string): Promise<number> {
  if (!fromUserId || !userId || fromUserId === userId) {
    return 0
  }

  const sourceRows = await sql`
    SELECT project_id, state_json, updated_at
    FROM project_workspace_states
    WHERE user_id = ${fromUserId}
    ORDER BY updated_at DESC
  `

  let migrated = 0

  for (const sourceRow of sourceRows) {
    const [targetRow] = await sql`
      SELECT project_id, updated_at
      FROM project_workspace_states
      WHERE project_id = ${sourceRow.project_id} AND user_id = ${userId}
      LIMIT 1
    `

    if (!targetRow) {
      await sql`
        UPDATE project_workspace_states
        SET user_id = ${userId}
        WHERE project_id = ${sourceRow.project_id} AND user_id = ${fromUserId}
      `
      migrated += 1
      continue
    }

    if ((sourceRow.updated_at as number) > (targetRow.updated_at as number)) {
      await sql`
        UPDATE project_workspace_states
        SET state_json = ${sourceRow.state_json}, updated_at = ${sourceRow.updated_at}
        WHERE project_id = ${sourceRow.project_id} AND user_id = ${userId}
      `
    }

    await sql`
      DELETE FROM project_workspace_states
      WHERE project_id = ${sourceRow.project_id} AND user_id = ${fromUserId}
    `
    migrated += 1
  }

  return migrated
}
