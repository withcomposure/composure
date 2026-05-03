import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    INSERT INTO oauth_providers (provider, enabled, client_id, client_secret, updated_at)
    VALUES ('orcid', false, NULL, NULL, NULL)
    ON CONFLICT (provider) DO NOTHING
  `.execute(db)
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    DELETE FROM oauth_providers
    WHERE provider = 'orcid'
  `.execute(db)
}
