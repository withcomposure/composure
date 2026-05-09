import { sql, type Kysely } from 'kysely'

const normalizedProjectIdExpression = `
  CASE
    WHEN right(documents.name, 5) = ':chat' THEN left(documents.name, length(documents.name) - 5)
    ELSE documents.name
  END
`

export async function up(db: Kysely<never>): Promise<void> {
  await sql`DROP POLICY IF EXISTS rls_documents_policy ON documents`.execute(db)
  await sql.raw(`
    CREATE POLICY rls_documents_policy
    ON documents
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR app.has_project_access(${normalizedProjectIdExpression})
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR app.has_project_access(${normalizedProjectIdExpression})
    )
  `).execute(db)
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DROP POLICY IF EXISTS rls_documents_policy ON documents`.execute(db)
  await sql`
    CREATE POLICY rls_documents_policy
    ON documents
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR app.has_project_access(documents.name)
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR app.has_project_access(documents.name)
    )
  `.execute(db)
}
