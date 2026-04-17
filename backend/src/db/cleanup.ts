import type postgres from 'postgres'
import { assetStore } from '../storage.js'
import { getServerSettingValue } from './admin.js'

const guestInactivityTtlSeconds = 30 * 24 * 60 * 60
const defaultTrashRetentionDays = 30

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

async function getTrashRetentionSeconds(): Promise<number> {
  const stored = await getServerSettingValue('trash_retention_days')
  const days = stored ? Number.parseInt(stored, 10) : defaultTrashRetentionDays
  return (Number.isFinite(days) && days >= 1 ? days : defaultTrashRetentionDays) * 24 * 60 * 60
}

async function runGuestCleanup(database: postgres.Sql): Promise<void> {
  const cutoff = nowUnix() - guestInactivityTtlSeconds

  const staleRows = await database`
    SELECT id
    FROM projects
    WHERE owner_guest_id IS NOT NULL
      AND owner_user_id IS NULL
      AND last_active_at < ${cutoff}
      AND deleted_at IS NULL
  `

  if (staleRows.length === 0) {
    console.info('[cleanup] no stale guest projects found')
    return
  }

  const ids = staleRows.map((row) => row.id as string)

  await database.begin(async (tx) => {
    for (const id of ids) {
      await tx`
        UPDATE projects
        SET deleted_at = extract(epoch from now())::integer
        WHERE id = ${id} AND owner_guest_id IS NOT NULL AND owner_user_id IS NULL
      `
      await tx`DELETE FROM documents WHERE name = ${id}`
    }
  })

  for (const id of ids) {
    assetStore.deleteProject(id)
  }

  console.info(`[cleanup] removed stale guest projects count=${ids.length}`)
}

async function runTrashPurge(database: postgres.Sql): Promise<void> {
  const retentionSeconds = await getTrashRetentionSeconds()
  const cutoff = nowUnix() - retentionSeconds

  const expiredRows = await database`
    SELECT id
    FROM projects
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `

  if (expiredRows.length === 0) {
    return
  }

  const ids = expiredRows.map((row) => row.id as string)

  await database.begin(async (tx) => {
    for (const id of ids) {
      await tx`DELETE FROM documents WHERE name = ${id}`
      await tx`DELETE FROM project_comments WHERE project_id = ${id}`
      await tx`DELETE FROM project_members WHERE project_id = ${id}`
      await tx`DELETE FROM share_tokens WHERE project_id = ${id}`
      await tx`DELETE FROM project_recents WHERE project_id = ${id}`
      await tx`DELETE FROM projects WHERE id = ${id}`
    }
  })

  for (const id of ids) {
    assetStore.deleteProject(id)
  }

  console.info(`[cleanup] purged expired trash projects count=${ids.length}`)
}

export function scheduleCleanupTasks(database: postgres.Sql): void {
  const sessionIntervalMs = 6 * 60 * 60 * 1000
  const guestCleanupIntervalMs = 24 * 60 * 60 * 1000
  const trashPurgeIntervalMs = 6 * 60 * 60 * 1000

  setInterval(async () => {
    try {
      const result = await database`DELETE FROM sessions WHERE expires_at <= extract(epoch from now())::integer`
      if (result.count > 0) {
        console.info(`[cleanup] removed expired sessions count=${result.count}`)
      }
    } catch (error) {
      console.warn(`[cleanup] session cleanup tick failed: ${String(error)}`)
    }
  }, sessionIntervalMs)

  setInterval(async () => {
    try {
      await runGuestCleanup(database)
    } catch (error) {
      console.warn(`[cleanup] guest cleanup tick failed: ${String(error)}`)
    }
  }, guestCleanupIntervalMs)

  setInterval(async () => {
    try {
      await runTrashPurge(database)
    } catch (error) {
      console.warn(`[cleanup] trash purge tick failed: ${String(error)}`)
    }
  }, trashPurgeIntervalMs)
}
