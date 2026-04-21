import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Kysely, Migrator, FileMigrationProvider } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import { sql } from './connection.js'

export async function runMigrations(): Promise<void> {
  const db = new Kysely<Record<string, never>>({
    dialect: new PostgresJSDialect({ postgres: sql }),
  })

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve(import.meta.dirname, '../../migrations'),
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
}
