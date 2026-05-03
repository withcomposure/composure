import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS user_excalidraw_libraries (
      user_id TEXT PRIMARY KEY,
      library_json JSONB NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `.execute(db)

  await sql`ALTER TABLE user_excalidraw_libraries ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE user_excalidraw_libraries FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_user_excalidraw_libraries_policy ON user_excalidraw_libraries`.execute(db)
  await sql`
    CREATE POLICY rls_user_excalidraw_libraries_policy
    ON user_excalidraw_libraries
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR user_id = app.current_user_id()
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR user_id = app.current_user_id()
    )
  `.execute(db)
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DROP TABLE IF EXISTS user_excalidraw_libraries`.execute(db)
}
