import { sql, type Kysely } from 'kysely'

// `projects.engine` was added to the CREATE TABLE baseline in connection.ts
// without a matching migration, so databases created before that edit never
// got the column. This backfills it for existing deployments.
export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS engine TEXT
  `.execute(db)
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE projects
    DROP COLUMN IF EXISTS engine
  `.execute(db)
}
