import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<never>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS app`.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION app.has_project_access(target_project_id text)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = target_project_id
          AND pm.user_id = app.current_user_id()
          AND pm.status = 'accepted'
      )
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION app.has_project_role(target_project_id text, allowed_roles text[])
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = target_project_id
          AND pm.user_id = app.current_user_id()
          AND pm.status = 'accepted'
          AND pm.role = ANY(allowed_roles)
      )
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION app.project_owner_id(target_project_id text)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      SELECT p.owner_user_id
      FROM projects p
      WHERE p.id = target_project_id
      LIMIT 1
    $$
  `.execute(db)

  await sql`REVOKE ALL ON FUNCTION app.has_project_access(text) FROM PUBLIC`.execute(db)
  await sql`REVOKE ALL ON FUNCTION app.has_project_role(text, text[]) FROM PUBLIC`.execute(db)
  await sql`REVOKE ALL ON FUNCTION app.project_owner_id(text) FROM PUBLIC`.execute(db)
  await sql`GRANT EXECUTE ON FUNCTION app.has_project_access(text) TO PUBLIC`.execute(db)
  await sql`GRANT EXECUTE ON FUNCTION app.has_project_role(text, text[]) TO PUBLIC`.execute(db)
  await sql`GRANT EXECUTE ON FUNCTION app.project_owner_id(text) TO PUBLIC`.execute(db)

  await sql`ALTER TABLE users ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE users FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_users_select ON users`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_users_insert ON users`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_users_update ON users`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_users_delete ON users`.execute(db)
  await sql`
    CREATE POLICY rls_users_select
    ON users
    FOR SELECT
    USING (
      app.current_user_role() IN ('system', 'admin')
      OR id = app.current_user_id()
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_users_insert
    ON users
    FOR INSERT
    WITH CHECK (app.current_user_role() IN ('system', 'admin'))
  `.execute(db)
  await sql`
    CREATE POLICY rls_users_update
    ON users
    FOR UPDATE
    USING (
      app.current_user_role() IN ('system', 'admin')
      OR id = app.current_user_id()
    )
    WITH CHECK (
      app.current_user_role() IN ('system', 'admin')
      OR id = app.current_user_id()
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_users_delete
    ON users
    FOR DELETE
    USING (
      app.current_user_role() IN ('system', 'admin')
      OR id = app.current_user_id()
    )
  `.execute(db)
  await sql`
    CREATE OR REPLACE FUNCTION app.enforce_safe_users_self_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      IF app.current_user_role() IN ('system', 'admin') THEN
        RETURN NEW;
      END IF;

      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.role IS DISTINCT FROM OLD.role
        OR NEW.is_guest IS DISTINCT FROM OLD.is_guest
        OR NEW.guest_cookie_id IS DISTINCT FROM OLD.guest_cookie_id
        OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
        OR NEW.max_projects IS DISTINCT FROM OLD.max_projects
        OR NEW.last_login_at IS DISTINCT FROM OLD.last_login_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'sensitive users columns require system or admin context'
          USING ERRCODE = '42501';
      END IF;

      RETURN NEW;
    END
    $$
  `.execute(db)
  await sql`DROP TRIGGER IF EXISTS trg_users_safe_self_update ON users`.execute(db)
  await sql`
    CREATE TRIGGER trg_users_safe_self_update
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION app.enforce_safe_users_self_update()
  `.execute(db)

  await sql`DROP POLICY IF EXISTS rls_projects_select ON projects`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_projects_write ON projects`.execute(db)
  await sql`
    CREATE POLICY rls_projects_select
    ON projects
    FOR SELECT
    USING (
      app.current_user_role() = 'system'
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
      OR app.has_project_role(projects.id, ARRAY['owner'])
    )
  `.execute(db)

  await sql`DROP POLICY IF EXISTS rls_project_members_select ON project_members`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_members_write ON project_members`.execute(db)
  await sql`
    CREATE POLICY rls_project_members_select
    ON project_members
    FOR SELECT
    USING (
      app.current_user_role() = 'system'
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
      OR app.has_project_role(project_id, ARRAY['owner'])
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_project_members_update
    ON project_members
    FOR UPDATE
    USING (
      app.current_user_role() = 'system'
      OR app.has_project_role(project_members.project_id, ARRAY['owner'])
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR app.has_project_role(project_id, ARRAY['owner'])
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_project_members_delete
    ON project_members
    FOR DELETE
    USING (
      app.current_user_role() = 'system'
      OR app.has_project_role(project_members.project_id, ARRAY['owner'])
    )
  `.execute(db)

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

  await sql`DROP POLICY IF EXISTS rls_project_comments_select ON project_comments`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_comments_write ON project_comments`.execute(db)
  await sql`
    CREATE POLICY rls_project_comments_select
    ON project_comments
    FOR SELECT
    USING (
      app.current_user_role() = 'system'
      OR app.has_project_access(project_comments.project_id)
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_project_comments_write
    ON project_comments
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR author_user_id = app.current_user_id()
      OR app.has_project_role(project_comments.project_id, ARRAY['owner'])
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR (
        author_user_id = app.current_user_id()
        AND app.has_project_role(project_comments.project_id, ARRAY['owner', 'edit', 'comment'])
      )
    )
  `.execute(db)

  await sql`DROP POLICY IF EXISTS rls_share_tokens_policy ON share_tokens`.execute(db)
  await sql`
    CREATE POLICY rls_share_tokens_policy
    ON share_tokens
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR app.has_project_role(share_tokens.project_id, ARRAY['owner'])
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR app.has_project_role(share_tokens.project_id, ARRAY['owner'])
    )
  `.execute(db)

  await sql`DROP POLICY IF EXISTS rls_project_link_sharing_state_policy ON project_link_sharing_state`.execute(db)
  await sql`
    CREATE POLICY rls_project_link_sharing_state_policy
    ON project_link_sharing_state
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR app.has_project_role(project_link_sharing_state.project_id, ARRAY['owner'])
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR app.has_project_role(project_link_sharing_state.project_id, ARRAY['owner'])
    )
  `.execute(db)
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_users_safe_self_update ON users`.execute(db)
  await sql`DROP FUNCTION IF EXISTS app.enforce_safe_users_self_update()`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_users_select ON users`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_users_insert ON users`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_users_update ON users`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_users_delete ON users`.execute(db)
  await sql`ALTER TABLE users DISABLE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP FUNCTION IF EXISTS app.has_project_access(text)`.execute(db)
  await sql`DROP FUNCTION IF EXISTS app.has_project_role(text, text[])`.execute(db)
  await sql`DROP FUNCTION IF EXISTS app.project_owner_id(text)`.execute(db)
}
