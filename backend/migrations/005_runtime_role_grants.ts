import { sql, type Kysely } from 'kysely'

const defaultDatabaseUrl = 'postgres://composure_runtime:super_secret_password@localhost:5433/composure'

function runtimeRoleFromDatabaseUrl(): string | null {
  const databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl

  try {
    const username = new URL(databaseUrl).username
    return username ? decodeURIComponent(username) : null
  } catch {
    return null
  }
}

function quoteIdentifier(identifier: string): string {
  if (identifier.includes('\0')) {
    throw new Error('Invalid PostgreSQL identifier.')
  }

  return `"${identifier.replaceAll('"', '""')}"`
}

async function roleExists(db: Kysely<never>, roleName: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = ${roleName}
    ) AS exists
  `.execute(db)

  return result.rows[0]?.exists === true
}

export async function up(db: Kysely<never>): Promise<void> {
  const runtimeRole = runtimeRoleFromDatabaseUrl()
  if (!runtimeRole || !(await roleExists(db, runtimeRole))) {
    return
  }

  const runtimeRoleIdentifier = sql.raw(quoteIdentifier(runtimeRole))

  await sql`GRANT USAGE ON SCHEMA public, app TO ${runtimeRoleIdentifier}`.execute(db)
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeRoleIdentifier}`.execute(db)
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${runtimeRoleIdentifier}`.execute(db)
  await sql`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ${runtimeRoleIdentifier}`.execute(db)

  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtimeRoleIdentifier}
  `.execute(db)
  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${runtimeRoleIdentifier}
  `.execute(db)
  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA app
    GRANT EXECUTE ON FUNCTIONS TO ${runtimeRoleIdentifier}
  `.execute(db)
}

export async function down(_db: Kysely<never>): Promise<void> {
  // Intentionally do not revoke runtime privileges on rollback. Removing these
  // grants can break a running deployment that has already switched roles.
}
