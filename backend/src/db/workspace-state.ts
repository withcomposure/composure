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
  if (principal.userId) {
    const [row] = await sql`
      SELECT state_json
      FROM project_workspace_states
      WHERE project_id = ${projectId} AND user_id = ${principal.userId}
      LIMIT 1
    `

    return row ? parseStateJson(row.state_json as string) : null
  }

  if (principal.guestId) {
    const [row] = await sql`
      SELECT state_json
      FROM project_workspace_states
      WHERE project_id = ${projectId} AND guest_id = ${principal.guestId}
      LIMIT 1
    `

    return row ? parseStateJson(row.state_json as string) : null
  }

  return null
}

export async function setProjectWorkspaceState(
  projectId: string,
  principal: Principal,
  state: Record<string, unknown>,
): Promise<void> {
  const stateJson = JSON.stringify(state)

  if (principal.userId) {
    const updated = await sql`
      UPDATE project_workspace_states
      SET state_json = ${stateJson}, updated_at = extract(epoch from now())::integer
      WHERE project_id = ${projectId} AND user_id = ${principal.userId}
    `

    if (updated.count === 0) {
      await sql`
        INSERT INTO project_workspace_states (project_id, user_id, guest_id, state_json, updated_at)
        VALUES (${projectId}, ${principal.userId}, NULL, ${stateJson}, extract(epoch from now())::integer)
      `
    }
    return
  }

  if (principal.guestId) {
    const updated = await sql`
      UPDATE project_workspace_states
      SET state_json = ${stateJson}, updated_at = extract(epoch from now())::integer
      WHERE project_id = ${projectId} AND guest_id = ${principal.guestId}
    `

    if (updated.count === 0) {
      await sql`
        INSERT INTO project_workspace_states (project_id, user_id, guest_id, state_json, updated_at)
        VALUES (${projectId}, NULL, ${principal.guestId}, ${stateJson}, extract(epoch from now())::integer)
      `
    }
  }
}

export async function migrateGuestWorkspaceStatesToUser(guestId: string, userId: string): Promise<number> {
  if (!guestId || !userId) {
    return 0
  }

  const guestRows = await sql`
    SELECT project_id, state_json, updated_at
    FROM project_workspace_states
    WHERE guest_id = ${guestId}
    ORDER BY updated_at DESC
  `

  let migrated = 0

  for (const guestRow of guestRows) {
    const [existingUserRow] = await sql`
      SELECT project_id, updated_at
      FROM project_workspace_states
      WHERE project_id = ${guestRow.project_id} AND user_id = ${userId}
      LIMIT 1
    `

    if (!existingUserRow) {
      await sql`
        UPDATE project_workspace_states
        SET user_id = ${userId}, guest_id = NULL
        WHERE project_id = ${guestRow.project_id} AND guest_id = ${guestId}
      `
      migrated += 1
      continue
    }

    if ((guestRow.updated_at as number) > (existingUserRow.updated_at as number)) {
      await sql`
        UPDATE project_workspace_states
        SET state_json = ${guestRow.state_json}, updated_at = ${guestRow.updated_at}, user_id = ${userId}, guest_id = NULL
        WHERE project_id = ${guestRow.project_id} AND user_id = ${userId}
      `
    }

    await sql`
      DELETE FROM project_workspace_states
      WHERE project_id = ${guestRow.project_id} AND guest_id = ${guestId}
    `
    migrated += 1
  }

  return migrated
}
