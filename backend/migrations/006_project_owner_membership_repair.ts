import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  await sql`SELECT set_config('app.current_user_id', '', true)`.execute(db)
  await sql`SELECT set_config('app.current_user_role', 'system', true)`.execute(db)

  await sql`
    INSERT INTO project_members (
      project_id,
      user_id,
      invited_email,
      role,
      status,
      invited_by_user_id,
      created_at,
      updated_at
    )
    SELECT
      p.id,
      p.owner_user_id,
      NULL,
      'owner',
      'accepted',
      p.owner_user_id,
      extract(epoch from now())::integer,
      extract(epoch from now())::integer
    FROM projects p
    WHERE p.owner_user_id IS NOT NULL
    ON CONFLICT (project_id, user_id)
    WHERE user_id IS NOT NULL
    DO UPDATE SET
      role = 'owner',
      status = 'accepted',
      invited_email = NULL,
      updated_at = excluded.updated_at
  `.execute(db)

  await sql`DROP POLICY IF EXISTS rls_projects_select ON projects`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_projects_insert ON projects`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_projects_update ON projects`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_projects_delete ON projects`.execute(db)
  await sql`
    CREATE POLICY rls_projects_select
    ON projects
    FOR SELECT
    USING (
      app.current_user_role() = 'system'
      OR owner_user_id = app.current_user_id()
      OR app.has_project_access(projects.id)
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_projects_insert
    ON projects
    FOR INSERT
    WITH CHECK (
      app.current_user_role() = 'system'
      OR owner_user_id = app.current_user_id()
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_projects_update
    ON projects
    FOR UPDATE
    USING (
      app.current_user_role() = 'system'
      OR owner_user_id = app.current_user_id()
      OR app.has_project_role(projects.id, ARRAY['owner'])
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR owner_user_id = app.current_user_id()
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_projects_delete
    ON projects
    FOR DELETE
    USING (
      app.current_user_role() = 'system'
      OR owner_user_id = app.current_user_id()
      OR app.has_project_role(projects.id, ARRAY['owner'])
    )
  `.execute(db)

  await sql`DROP POLICY IF EXISTS rls_project_members_select ON project_members`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_members_insert ON project_members`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_members_update ON project_members`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_members_delete ON project_members`.execute(db)
  await sql`
    CREATE POLICY rls_project_members_select
    ON project_members
    FOR SELECT
    USING (
      app.current_user_role() = 'system'
      OR app.project_owner_id(project_members.project_id) = app.current_user_id()
      OR app.has_project_access(project_members.project_id)
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_project_members_insert
    ON project_members
    FOR INSERT
    WITH CHECK (
      app.current_user_role() = 'system'
      OR (
        user_id = app.current_user_id()
        AND role = 'owner'
        AND status = 'accepted'
        AND app.project_owner_id(project_id) = app.current_user_id()
      )
      OR (
        (
          app.project_owner_id(project_id) = app.current_user_id()
          OR app.has_project_role(project_id, ARRAY['owner'])
        )
        AND role <> 'owner'
      )
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_project_members_update
    ON project_members
    FOR UPDATE
    USING (
      app.current_user_role() = 'system'
      OR (
        (
          app.project_owner_id(project_members.project_id) = app.current_user_id()
          OR app.has_project_role(project_members.project_id, ARRAY['owner'])
        )
        AND app.project_owner_id(project_members.project_id) IS DISTINCT FROM project_members.user_id
      )
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR (
        (
          app.project_owner_id(project_id) = app.current_user_id()
          OR app.has_project_role(project_id, ARRAY['owner'])
        )
        AND app.project_owner_id(project_id) IS DISTINCT FROM user_id
        AND role <> 'owner'
      )
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_project_members_delete
    ON project_members
    FOR DELETE
    USING (
      app.current_user_role() = 'system'
      OR (
        (
          app.project_owner_id(project_members.project_id) = app.current_user_id()
          OR app.has_project_role(project_members.project_id, ARRAY['owner'])
        )
        AND app.project_owner_id(project_members.project_id) IS DISTINCT FROM project_members.user_id
      )
    )
  `.execute(db)
}

export async function down(_db: Kysely<never>): Promise<void> {
  // Keep repaired owner memberships and hardened policies in place on rollback.
}
