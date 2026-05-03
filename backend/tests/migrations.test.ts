import { Kysely } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { up as applyJwtRlsMigration } from '../migrations/003_jwt_rls.js'
import { up as applyRlsHardeningMigration } from '../migrations/004_rls_hardening.js'
import { up as applyRuntimeRoleGrantsMigration } from '../migrations/005_runtime_role_grants.js'
import { up as applyProjectOwnerMembershipRepairMigration } from '../migrations/006_project_owner_membership_repair.js'
import { applySchema, connectDatabase, sql } from '../src/db/connection.js'

const runtimeGrantTestRole = 'composure_runtime_grants_test'
const migratorGrantTestRole = 'composure_migrator_grants_test'
const grantTestPassword = 'test'

function databaseUrlForRole(roleName: string): string {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or TEST_DATABASE_URL is required for migration grant tests.')
  }

  const parsed = new URL(databaseUrl)
  parsed.username = roleName
  parsed.password = grantTestPassword
  return parsed.toString()
}

async function resetSchemaWithoutMigrations(): Promise<void> {
  connectDatabase({ max: 5 })
  await sql.unsafe('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public;')
  await applySchema(sql)
}

describe('database migrations', () => {
  it('widens project member roles before backfilling owner memberships', async () => {
    await resetSchemaWithoutMigrations()

    await sql`ALTER TABLE project_members DROP CONSTRAINT project_members_role_check`
    await sql`
      ALTER TABLE project_members
      ADD CONSTRAINT project_members_role_check CHECK (role IN ('view', 'comment', 'edit'))
    `
    await sql`
      INSERT INTO users (id, email, password_hash, display_name, role, is_guest, created_at)
      VALUES ('legacy-owner', 'legacy-owner@test.com', NULL, 'Legacy Owner', 'user', FALSE, extract(epoch from now())::integer)
    `
    await sql`
      INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at)
      VALUES ('legacy-project', 'Legacy Project', 'main.tex', 'legacy-owner', extract(epoch from now())::integer, extract(epoch from now())::integer)
    `

    const db = new Kysely<never>({
      dialect: new PostgresJSDialect({ postgres: sql }),
    })

    await expect(applyJwtRlsMigration(db)).resolves.toBeUndefined()

    const [member] = await sql<[{ role: string; status: string }?]>`
      SELECT role, status
      FROM project_members
      WHERE project_id = 'legacy-project'
        AND user_id = 'legacy-owner'
    `
    expect(member).toMatchObject({ role: 'owner', status: 'accepted' })
  })

  it('grants the runtime role access to migrator-owned tables and future migration tables', async () => {
    await resetSchemaWithoutMigrations()
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${runtimeGrantTestRole}') THEN
          CREATE ROLE ${runtimeGrantTestRole} LOGIN PASSWORD '${grantTestPassword}' NOSUPERUSER NOBYPASSRLS;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${migratorGrantTestRole}') THEN
          CREATE ROLE ${migratorGrantTestRole} LOGIN PASSWORD '${grantTestPassword}' NOSUPERUSER BYPASSRLS;
        END IF;
      END
      $$;
    `)
    await sql.unsafe(`ALTER ROLE ${runtimeGrantTestRole} LOGIN PASSWORD '${grantTestPassword}' NOSUPERUSER NOBYPASSRLS`)
    await sql.unsafe(`ALTER ROLE ${migratorGrantTestRole} LOGIN PASSWORD '${grantTestPassword}' NOSUPERUSER BYPASSRLS`)
    await sql.unsafe(`ALTER SCHEMA public OWNER TO ${migratorGrantTestRole}`)
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION ${migratorGrantTestRole}`)
    await sql.unsafe(`GRANT USAGE, CREATE ON SCHEMA public, app TO ${migratorGrantTestRole}`)
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${runtimeGrantTestRole}`)
    await sql.unsafe(`
      DO $$
      DECLARE
        table_record record;
        sequence_record record;
      BEGIN
        FOR table_record IN
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = 'public'
        LOOP
          EXECUTE format('ALTER TABLE public.%I OWNER TO ${migratorGrantTestRole}', table_record.tablename);
        END LOOP;

        FOR sequence_record IN
          SELECT sequencename
          FROM pg_sequences
          WHERE schemaname = 'public'
        LOOP
          EXECUTE format('ALTER SEQUENCE public.%I OWNER TO ${migratorGrantTestRole}', sequence_record.sequencename);
        END LOOP;
      END
      $$;
    `)

    await expect(sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${runtimeGrantTestRole}`)
      await tx`SELECT COUNT(1)::integer AS count FROM refresh_tokens`
    })).rejects.toThrow()

    const previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = databaseUrlForRole(runtimeGrantTestRole)

    try {
      const migrationSql = postgres(databaseUrlForRole(migratorGrantTestRole), {
        max: 1,
        transform: { undefined: null },
      })
      const db = new Kysely<never>({
        dialect: new PostgresJSDialect({ postgres: migrationSql }),
      })

      try {
        await applyRuntimeRoleGrantsMigration(db)
        await migrationSql`CREATE TABLE runtime_grants_future_table (id INTEGER PRIMARY KEY)`
      } finally {
        await db.destroy()
        await migrationSql.end({ timeout: 5 })
      }
    } finally {
      if (previousDatabaseUrl == null) {
        delete process.env.DATABASE_URL
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl
      }
    }

    await expect(sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${runtimeGrantTestRole}`)
      await tx`SELECT COUNT(1)::integer AS count FROM refresh_tokens`
      await tx`INSERT INTO runtime_grants_future_table (id) VALUES (1)`
    })).resolves.toBeUndefined()
  })

  it('repairs missing or demoted project owner memberships', async () => {
    await resetSchemaWithoutMigrations()
    await sql`
      INSERT INTO users (id, email, password_hash, display_name, role, is_guest, created_at)
      VALUES ('repair-owner', 'repair-owner@test.com', NULL, 'Repair Owner', 'user', FALSE, extract(epoch from now())::integer)
    `
    await sql`
      INSERT INTO projects (id, title, root_file, owner_user_id, created_at, last_active_at)
      VALUES ('repair-project', 'Repair Project', 'main.tex', 'repair-owner', extract(epoch from now())::integer, extract(epoch from now())::integer)
    `
    await sql`
      INSERT INTO project_members (project_id, user_id, role, status, created_at, updated_at)
      VALUES ('repair-project', 'repair-owner', 'view', 'accepted', extract(epoch from now())::integer, extract(epoch from now())::integer)
    `

    const db = new Kysely<never>({
      dialect: new PostgresJSDialect({ postgres: sql }),
    })

    await applyJwtRlsMigration(db)
    await applyRlsHardeningMigration(db)
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_user_id', '', true)`
      await tx`SELECT set_config('app.current_user_role', 'system', true)`
      await tx`
        UPDATE project_members
        SET role = 'view', updated_at = extract(epoch from now())::integer
        WHERE project_id = 'repair-project'
          AND user_id = 'repair-owner'
      `
    })

    await expect(applyProjectOwnerMembershipRepairMigration(db)).resolves.toBeUndefined()

    const [member] = await sql<[{ role: string; status: string; invited_email: string | null }?]>`
      SELECT role, status, invited_email
      FROM project_members
      WHERE project_id = 'repair-project'
        AND user_id = 'repair-owner'
    `
    expect(member).toMatchObject({ role: 'owner', status: 'accepted', invited_email: null })
  })
})
