import { v4 as uuid } from 'uuid'
import { sql } from './connection.js'
import { nowUnix } from './internal.js'

export interface BackgroundJobSummary {
  id: string
  type: string
  status: 'waiting' | 'running' | 'done' | 'failed' | 'invalid' | 'stalled'
  userId: string | null
  userEmail: string | null
  userDisplayName: string | null
  projectId: string | null
  projectTitle: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export interface JobQueueSummary {
  runningCount: number
  waitingCount: number
  lastCompletedAt: number | null
  lastFailedJob: { id: string; type: string; error: string | null; finishedAt: number } | null
  totalDone: number
  totalFailed: number
  totalInvalid: number
  totalStalled: number
}

export async function createJob(type: string, userId: string | null, projectId: string | null): Promise<string> {
  const id = uuid()
  await sql`
    INSERT INTO background_jobs (id, type, status, user_id, project_id, created_at)
    VALUES (${id}, ${type}, 'waiting', ${userId}, ${projectId}, extract(epoch from now())::integer)
  `
  return id
}

export async function markJobRunning(jobId: string): Promise<void> {
  await sql`
    UPDATE background_jobs
    SET status = 'running', started_at = extract(epoch from now())::integer
    WHERE id = ${jobId} AND status = 'waiting'
  `
}

export async function markJobDone(jobId: string): Promise<void> {
  await sql`
    UPDATE background_jobs
    SET status = 'done', finished_at = extract(epoch from now())::integer
    WHERE id = ${jobId} AND status NOT IN ('done', 'failed', 'invalid', 'stalled')
  `
}

export async function markJobFailed(jobId: string, error: string): Promise<void> {
  await sql`
    UPDATE background_jobs
    SET status = 'failed', finished_at = extract(epoch from now())::integer, error = ${error}
    WHERE id = ${jobId} AND status NOT IN ('done', 'failed', 'invalid', 'stalled')
  `
}

export async function markJobInvalid(jobId: string, error: string): Promise<void> {
  await sql`
    UPDATE background_jobs
    SET status = 'invalid', finished_at = extract(epoch from now())::integer, error = ${error}
    WHERE id = ${jobId} AND status NOT IN ('done', 'failed', 'invalid', 'stalled')
  `
}

export async function getJobQueueSummary(sinceSeconds: number = 86400): Promise<JobQueueSummary> {
  const [running] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'running'
  `
  const [waiting] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'waiting'
  `

  const cutoff = nowUnix() - sinceSeconds

  const [lastCompleted] = await sql<[{ finished_at: number }?]>`
    SELECT finished_at FROM background_jobs WHERE status = 'done' AND finished_at >= ${cutoff} ORDER BY finished_at DESC LIMIT 1
  `

  const [lastFailed] = await sql<[{ id: string; type: string; error: string | null; finished_at: number }?]>`
    SELECT id, type, error, finished_at FROM background_jobs WHERE status = 'failed' AND finished_at >= ${cutoff} ORDER BY finished_at DESC LIMIT 1
  `

  const [done] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'done' AND finished_at >= ${cutoff}
  `
  const [failed] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'failed' AND finished_at >= ${cutoff}
  `
  const [invalid] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'invalid' AND finished_at >= ${cutoff}
  `
  const [stalled] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'stalled' AND finished_at >= ${cutoff}
  `

  return {
    runningCount: running.count,
    waitingCount: waiting.count,
    lastCompletedAt: lastCompleted?.finished_at ?? null,
    lastFailedJob: lastFailed
      ? { id: lastFailed.id, type: lastFailed.type, error: lastFailed.error, finishedAt: lastFailed.finished_at }
      : null,
    totalDone: done.count,
    totalFailed: failed.count,
    totalInvalid: invalid.count,
    totalStalled: stalled.count,
  }
}

export async function listRecentJobs(sinceSeconds: number): Promise<BackgroundJobSummary[]> {
  const cutoff = nowUnix() - sinceSeconds
  const rows = await sql<Array<{
    id: string
    type: string
    status: string
    user_id: string | null
    project_id: string | null
    created_at: number
    started_at: number | null
    finished_at: number | null
    error: string | null
    user_email: string | null
    user_display_name: string | null
    project_title: string | null
  }>>`
    SELECT
      j.id, j.type, j.status, j.user_id, j.project_id,
      j.created_at, j.started_at, j.finished_at, j.error,
      u.email AS user_email, u.display_name AS user_display_name,
      p.title AS project_title
    FROM background_jobs j
    LEFT JOIN users u ON u.id = j.user_id
    LEFT JOIN projects p ON p.id = j.project_id
    WHERE j.created_at >= ${cutoff}
    ORDER BY j.created_at DESC
  `

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status as BackgroundJobSummary['status'],
    userId: row.user_id,
    userEmail: row.user_email,
    userDisplayName: row.user_display_name,
    projectId: row.project_id,
    projectTitle: row.project_title,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  }))
}

const stalledThresholdSeconds = 300 // 5 minutes

export async function getHealthStatus(sinceSeconds: number = 86400): Promise<'healthy' | 'degraded' | 'stalled'> {
  const stalledCutoff = nowUnix() - stalledThresholdSeconds
  const [stalled] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'running' AND started_at < ${stalledCutoff}
  `

  if (stalled.count > 0) return 'stalled'

  // Also check for explicitly stalled jobs in the timeframe
  const cutoff = nowUnix() - sinceSeconds
  const [explicitStalled] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'stalled' AND finished_at >= ${cutoff}
  `

  if (explicitStalled.count > 0) return 'stalled'

  const [recentFailed] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM background_jobs WHERE status = 'failed' AND finished_at >= ${cutoff}
  `

  if (recentFailed.count > 0) return 'degraded'

  return 'healthy'
}

export async function markStalledJobs(): Promise<number> {
  const stalledCutoff = nowUnix() - stalledThresholdSeconds
  const result = await sql`
    UPDATE background_jobs SET status = 'stalled', finished_at = extract(epoch from now())::integer, error = 'Job stalled (exceeded 5 minute timeout)' WHERE status = 'running' AND started_at < ${stalledCutoff}
  `
  return result.count
}
