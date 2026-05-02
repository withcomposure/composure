import { beforeEach, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { sql } from '../src/db/connection.js'
import { createTestProject, createTestUser, resetTestDatabase } from './helpers/setup.js'

const rlsRole = 'composure_rls_test'

async function prepareRlsRole(): Promise<void> {
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${rlsRole}') THEN
        CREATE ROLE ${rlsRole} LOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END
    $$;
  `)
  await sql.unsafe(`GRANT USAGE ON SCHEMA public, app TO ${rlsRole}`)
  await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${rlsRole}`)
  await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${rlsRole}`)
  await sql.unsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ${rlsRole}`)
}

async function asRlsRole<T>(
  userId: string | null,
  userRole: 'user' | 'admin' | 'guest' | 'system' | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${rlsRole}`)
    await tx`SELECT set_config('app.current_user_id', ${userId ?? ''}, true)`
    await tx`SELECT set_config('app.current_user_role', ${userRole ?? ''}, true)`
    return await fn(tx)
  })
}

beforeEach(async () => {
  await resetTestDatabase()
  await prepareRlsRole()
})

describe('row level security', () => {
  it('allows project members to be selected without recursive project_members policies', async () => {
    const owner = await createTestUser({ email: 'owner@test.com' })
    const projectId = await createTestProject(owner.id)
    const viewer = await createTestUser({ email: 'viewer@test.com' })
    await sql`
      INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
      VALUES (${projectId}, ${viewer.id}, 'view', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)
    `

    const rows = await asRlsRole(owner.id, 'user', async (tx) => await tx`
      SELECT user_id, role
      FROM project_members
      WHERE project_id = ${projectId}
      ORDER BY role
    `)

    expect(rows.map((row) => row.user_id)).toContain(owner.id)
    expect(rows.map((row) => row.user_id)).toContain(viewer.id)
  })

  it('limits users table reads to self unless the identity is admin or system', async () => {
    const current = await createTestUser({ email: 'current@test.com' })
    const other = await createTestUser({ email: 'other@test.com' })

    const rows = await asRlsRole(current.id, 'user', async (tx) => await tx`
      SELECT id, email, password_hash
      FROM users
      ORDER BY email
    `)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(current.id)
    expect(rows[0]?.id).not.toBe(other.id)
  })
})
