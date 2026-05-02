import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Kysely, Migrator, FileMigrationProvider } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import postgres from 'postgres'
import { sql } from './connection.js'

export async function runMigrations(): Promise<void> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL
  const migrationSql = migrationDatabaseUrl
    ? postgres(migrationDatabaseUrl, { max: 1, transform: { undefined: null } })
    : null
  const db = new Kysely<Record<string, never>>({
    dialect: new PostgresJSDialect({ postgres: migrationSql ?? sql }),
  })

  try {
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs,
        path,
        // Resolve against the compiled module location, not process cwd.
        migrationFolder: path.resolve(moduleDir, '../../migrations'),
      }),
    })

    const { error, results } = await migrator.migrateToLatest()

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        console.info(`[migrate] applied ${result.migrationName}`)
      } else if (result.status === 'Error') {
        console.error(`[migrate] failed ${result.migrationName}`)
      }
    }

    if (error) {
      console.error('[migrate] migration error:', error)
      throw error
    }
  } finally {
    if (migrationSql) {
      await db.destroy()
      await migrationSql.end({ timeout: 5 })
    }
  }
}
