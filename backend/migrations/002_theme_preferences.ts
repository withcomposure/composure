import type { Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .alterTable('user_preferences')
    .addColumn('theme', 'text', (col) => col.notNull().defaultTo('default'))
    .execute()
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema
    .alterTable('user_preferences')
    .dropColumn('theme')
    .execute()
}
