import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS reference_lookup_format TEXT NOT NULL DEFAULT 'bibtex'
  `.execute(db)
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE projects
    DROP COLUMN IF EXISTS reference_lookup_format
  `.execute(db)
}
