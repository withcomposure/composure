import type postgres from 'postgres'
import { assetStore } from '../storage.js'
import { getServerSettingValue } from './admin.js'

const defaultTrashRetentionDays = 30

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

async function getTrashRetentionSeconds(): Promise<number> {
  const stored = await getServerSettingValue('trash_retention_days')
  const days = stored ? Number.parseInt(stored, 10) : defaultTrashRetentionDays
  return (Number.isFinite(days) && days >= 1 ? days : defaultTrashRetentionDays) * 24 * 60 * 60
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
  const refreshTokenIntervalMs = 6 * 60 * 60 * 1000
  const trashPurgeIntervalMs = 6 * 60 * 60 * 1000

  setInterval(async () => {
    try {
      const result = await database`
        DELETE FROM refresh_tokens
        WHERE expires_at <= extract(epoch from now())::integer
           OR revoked_at IS NOT NULL
      `
      if (result.count > 0) {
        console.info(`[cleanup] removed expired refresh tokens count=${result.count}`)
      }
    } catch (error) {
      console.warn(`[cleanup] refresh token cleanup tick failed: ${String(error)}`)
    }
  }, refreshTokenIntervalMs)

  setInterval(async () => {
    try {
      await runTrashPurge(database)
    } catch (error) {
      console.warn(`[cleanup] trash purge tick failed: ${String(error)}`)
    }
  }, trashPurgeIntervalMs)
}
