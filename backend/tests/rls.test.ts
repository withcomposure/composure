import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type postgres from 'postgres'
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  applyPasswordResetRoute,
} from '../src/auth.js'
import { createPasswordResetToken } from '../src/db/admin.js'
import { sql } from '../src/db/connection.js'
import { issueRefreshToken } from '../src/db/refresh-tokens.js'
import { runWithIdentityContext, type RequestUserRole } from '../src/db/request-context.js'
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
  const result = await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${rlsRole}`)
    await tx`SELECT set_config('app.current_user_id', ${userId ?? ''}, true)`
    await tx`SELECT set_config('app.current_user_role', ${userRole ?? ''}, true)`
    return await fn(tx)
  })
  return result as T
}

async function withRlsRequestContext<T>(
  userId: string | null,
  userRole: RequestUserRole,
  fn: () => Promise<T>,
): Promise<T> {
  const result = await runWithIdentityContext(userId, userRole, async () => await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${rlsRole}`)
    return await fn()
  }))
  return result as T
}

function createReplyRecorder(): {
  reply: FastifyReply
  getStatusCode: () => number
  getPayload: () => unknown
  cookies: Array<{ name: string; value: string }>
} {
  let statusCode = 200
  let payload: unknown
  const cookies: Array<{ name: string; value: string }> = []
  const reply = {
    status(code: number) {
      statusCode = code
      return reply
    },
    send(body: unknown) {
      payload = body
      return reply
    },
    setCookie(name: string, value: string) {
      cookies.push({ name, value })
      return reply
    },
    clearCookie() {
      return reply
    },
  } as unknown as FastifyReply

  return {
    reply,
    getStatusCode: () => statusCode,
    getPayload: () => payload,
    cookies,
  }
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

  it('allows project owners to insert their own initial membership row under RLS', async () => {
    const owner = await createTestUser({ email: 'bootstrap-owner@test.com' })
    const projectId = 'rls-bootstrap-project'

    await asRlsRole(owner.id, 'user', async (tx) => {
      await tx`
        INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at)
        VALUES (${projectId}, 'RLS Bootstrap Project', 'main.tex', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)
      `
      await tx`
        INSERT INTO project_members (project_id, user_id, role, status, invited_by_user_id, created_at, updated_at)
        VALUES (${projectId}, ${owner.id}, 'owner', 'accepted', ${owner.id}, extract(epoch from now())::integer, extract(epoch from now())::integer)
      `
    })

    const [member] = await sql<[{ user_id: string; role: string; status: string }?]>`
      SELECT user_id, role, status
      FROM project_members
      WHERE project_id = ${projectId}
    `
    expect(member).toMatchObject({ user_id: owner.id, role: 'owner', status: 'accepted' })
  })

  it('keeps project recents and workspace state scoped to the current user on shared projects', async () => {
    const owner = await createTestUser({ email: 'owner-private-state@test.com' })
    const projectId = await createTestProject(owner.id)
    const collaborator = await createTestUser({ email: 'collaborator-private-state@test.com' })
    await sql`
      INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
      VALUES (${projectId}, ${collaborator.id}, 'edit', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)
    `
    await sql`
      INSERT INTO project_recents (id, project_id, user_id, opened_at, share_token)
      VALUES
        ('owner-recent-private-state', ${projectId}, ${owner.id}, extract(epoch from now())::integer, NULL),
        ('collaborator-recent-private-state', ${projectId}, ${collaborator.id}, extract(epoch from now())::integer, NULL)
    `
    await sql`
      INSERT INTO project_workspace_states (project_id, user_id, state_json, updated_at)
      VALUES
        (${projectId}, ${owner.id}, '{"cursor":"owner"}', extract(epoch from now())::integer),
        (${projectId}, ${collaborator.id}, '{"cursor":"collaborator"}', extract(epoch from now())::integer)
    `

    const ownerRecents = await asRlsRole(owner.id, 'user', async (tx) => await tx`
      SELECT user_id
      FROM project_recents
      WHERE project_id = ${projectId}
      ORDER BY user_id
    `)
    const ownerStates = await asRlsRole(owner.id, 'user', async (tx) => await tx`
      SELECT user_id, state_json
      FROM project_workspace_states
      WHERE project_id = ${projectId}
      ORDER BY user_id
    `)

    expect(ownerRecents.map((row) => row.user_id)).toEqual([owner.id])
    expect(ownerStates).toMatchObject([{ user_id: owner.id, state_json: '{"cursor":"owner"}' }])
    await expect(asRlsRole(owner.id, 'user', async (tx) => await tx`
      INSERT INTO project_recents (id, project_id, user_id, opened_at, share_token)
      VALUES ('owner-writing-collaborator-recent', ${projectId}, ${collaborator.id}, extract(epoch from now())::integer, NULL)
    `)).rejects.toThrow()
    await expect(asRlsRole(owner.id, 'user', async (tx) => await tx`
      INSERT INTO project_workspace_states (project_id, user_id, state_json, updated_at)
      VALUES (${projectId}, ${collaborator.id}, '{"cursor":"written-by-owner"}', extract(epoch from now())::integer)
    `)).rejects.toThrow()
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

  it('keeps refresh tokens scoped to the current user under RLS', async () => {
    const current = await createTestUser({ email: 'current-refresh@test.com' })
    const other = await createTestUser({ email: 'other-refresh@test.com' })
    const currentToken = await runWithIdentityContext(null, 'system', async () => await issueRefreshToken(current.id, 3600))
    const otherToken = await runWithIdentityContext(null, 'system', async () => await issueRefreshToken(other.id, 3600))

    const rows = await asRlsRole(current.id, 'user', async (tx) => await tx`
      SELECT id, user_id
      FROM refresh_tokens
      ORDER BY user_id
    `)

    expect(rows).toMatchObject([{ id: currentToken.id, user_id: current.id }])
    expect(rows.map((row) => row.id)).not.toContain(otherToken.id)

    await expect(asRlsRole(current.id, 'user', async (tx) => await tx`
      INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, last_used_at, expires_at, created_at)
      VALUES (
        'rls-refresh-for-other',
        ${other.id},
        'rls-refresh-for-other-hash',
        'rls-refresh-family-for-other',
        extract(epoch from now())::integer,
        extract(epoch from now())::integer + 3600,
        extract(epoch from now())::integer
      )
    `)).rejects.toThrow()
  })

  it('blocks regular users from escalating sensitive users columns through self updates', async () => {
    await createTestUser({ email: 'admin-seed@test.com' })
    const current = await createTestUser({ email: 'self-update@test.com', role: 'user' })

    await expect(asRlsRole(current.id, 'user', async (tx) => await tx`
      UPDATE users
      SET role = 'admin'
      WHERE id = ${current.id}
    `)).rejects.toThrow()

    const [row] = await sql<[{ role: 'user' | 'admin' }?]>`
      SELECT role FROM users WHERE id = ${current.id}
    `
    expect(row?.role).toBe('user')
  })

  it('lets password reset apply under anonymous RLS by elevating trusted reset work', async () => {
    const user = await createTestUser({ email: 'reset-rls@test.com', password: 'oldpassword123' })
    const { token } = await createPasswordResetToken(user.id, 3600)
    const recorder = createReplyRecorder()
    const req = {
      params: { token },
      body: { newPassword: 'newpassword456' },
      headers: {},
      protocol: 'http',
      principal: { userId: null, guestId: null },
      authUser: null,
      currentRefreshTokenId: null,
    } as unknown as FastifyRequest<{ Params: { token?: string }; Body: { newPassword?: string } }>

    await withRlsRequestContext(null, null, async () => {
      await applyPasswordResetRoute(req, recorder.reply)
    })

    expect(recorder.getStatusCode()).toBe(200)
    const payload = recorder.getPayload() as { authenticated?: boolean; user?: { id?: string } } | undefined
    expect(payload?.authenticated).toBe(true)
    expect(payload?.user?.id).toBe(user.id)
    expect(recorder.cookies.some((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toBe(true)
    expect(recorder.cookies.some((cookie) => cookie.name === REFRESH_COOKIE_NAME)).toBe(true)
  })
})
