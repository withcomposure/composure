import type { Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  // Make password_hash nullable for OAuth-only users
  await db.schema
    .alterTable('users')
    .alterColumn('password_hash', (col) => col.dropNotNull())
    .execute()

  // OAuth provider configuration (admin-managed)
  await db.schema
    .createTable('oauth_providers')
    .addColumn('provider', 'text', (col) => col.primaryKey())
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('client_id', 'text')
    .addColumn('client_secret', 'text')
    .addColumn('updated_at', 'integer')
    .execute()

  // Linked OAuth accounts per user
  await db.schema
    .createTable('oauth_accounts')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('provider_id', 'text', (col) => col.notNull())
    .addColumn('email', 'text')
    .addColumn('linked_at', 'integer')
    .execute()

  await db.schema
    .createIndex('idx_oauth_accounts_user')
    .on('oauth_accounts')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('idx_oauth_accounts_provider_id')
    .on('oauth_accounts')
    .columns(['provider', 'provider_id'])
    .unique()
    .execute()

  // Seed known providers (all disabled by default)
  await db
    .insertInto('oauth_providers' as never)
    .values([
      { provider: 'github', enabled: false, client_id: null, client_secret: null, updated_at: null } as never,
      { provider: 'google', enabled: false, client_id: null, client_secret: null, updated_at: null } as never,
    ])
    .execute()
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable('oauth_accounts').ifExists().execute()
  await db.schema.dropTable('oauth_providers').ifExists().execute()
  await db.schema
    .alterTable('users')
    .alterColumn('password_hash', (col) => col.setNotNull())
    .execute()
}
