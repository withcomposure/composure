import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS default_bibliography_file TEXT
  `.execute(db)
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE projects
    DROP COLUMN IF EXISTS default_bibliography_file
  `.execute(db)
}
