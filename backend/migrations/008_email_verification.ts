import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE
  `.execute(db)

  // Backfill trusted emails from existing OAuth links.
  await sql`
    UPDATE users u
    SET email_verified = TRUE
    WHERE u.is_guest = FALSE
      AND EXISTS (
        SELECT 1
        FROM oauth_accounts oa
        WHERE oa.user_id = u.id
          AND oa.email IS NOT NULL
          AND LOWER(oa.email) = LOWER(u.email)
      )
  `.execute(db)
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE users
    DROP COLUMN IF EXISTS email_verified
  `.execute(db)
}
