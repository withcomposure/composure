import { sql, type Kysely } from 'kysely'

async function columnExists(db: Kysely<never>, tableName: string, columnName: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `.execute(db)

  return result.rows[0]?.exists === true
}

export async function up(db: Kysely<never>): Promise<void> {
  await sql`DROP TABLE IF EXISTS sessions`.execute(db)

  await sql`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`.execute(db)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE`.execute(db)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_cookie_id TEXT`.execute(db)
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_guest_cookie_id
      ON users(guest_cookie_id)
      WHERE guest_cookie_id IS NOT NULL
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      family_id TEXT NOT NULL,
      last_used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      rotated_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    )
  `.execute(db)

  await sql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id)`.execute(db)

  const hasProjectsOwnerGuestId = await columnExists(db, 'projects', 'owner_guest_id')
  const hasCommentsAuthorGuestId = await columnExists(db, 'project_comments', 'author_guest_id')
  const hasRecentsGuestId = await columnExists(db, 'project_recents', 'guest_id')
  const hasWorkspaceStatesGuestId = await columnExists(db, 'project_workspace_states', 'guest_id')

  const hasAnyLegacyGuestColumn =
    hasProjectsOwnerGuestId || hasCommentsAuthorGuestId || hasRecentsGuestId || hasWorkspaceStatesGuestId

  if (hasAnyLegacyGuestColumn) {
    await sql`CREATE TEMP TABLE _guest_keys (guest_key TEXT PRIMARY KEY) ON COMMIT DROP`.execute(db)

    if (hasProjectsOwnerGuestId) {
      await sql`
        INSERT INTO _guest_keys (guest_key)
        SELECT owner_guest_id
        FROM projects
        WHERE owner_guest_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `.execute(db)
    }

    if (hasCommentsAuthorGuestId) {
      await sql`
        INSERT INTO _guest_keys (guest_key)
        SELECT author_guest_id
        FROM project_comments
        WHERE author_guest_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `.execute(db)
    }

    if (hasRecentsGuestId) {
      await sql`
        INSERT INTO _guest_keys (guest_key)
        SELECT guest_id
        FROM project_recents
        WHERE guest_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `.execute(db)
    }

    if (hasWorkspaceStatesGuestId) {
      await sql`
        INSERT INTO _guest_keys (guest_key)
        SELECT guest_id
        FROM project_workspace_states
        WHERE guest_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `.execute(db)
    }

    await sql`
      INSERT INTO users (
        id,
        email,
        password_hash,
        display_name,
        role,
        is_guest,
        guest_cookie_id,
        created_at
      )
      SELECT
        md5('guest:' || guest_key),
        'guest+' || md5('guest:' || guest_key) || '@guest.local',
        NULL,
        'Guest ' || substring(guest_key from 1 for 8),
        'user',
        TRUE,
        guest_key,
        extract(epoch from now())::integer
      FROM _guest_keys
      WHERE guest_key IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM users u WHERE u.guest_cookie_id = _guest_keys.guest_key
        )
    `.execute(db)
  }

  if (hasProjectsOwnerGuestId) {
    await sql`
      UPDATE projects p
      SET owner_user_id = u.id
      FROM users u
      WHERE p.owner_user_id IS NULL
        AND p.owner_guest_id IS NOT NULL
        AND u.guest_cookie_id = p.owner_guest_id
    `.execute(db)
  }

  if (hasCommentsAuthorGuestId) {
    await sql`
      UPDATE project_comments c
      SET author_user_id = u.id
      FROM users u
      WHERE c.author_user_id IS NULL
        AND c.author_guest_id IS NOT NULL
        AND u.guest_cookie_id = c.author_guest_id
    `.execute(db)
  }

  if (hasRecentsGuestId) {
    await sql`
      UPDATE project_recents r
      SET user_id = u.id
      FROM users u
      WHERE r.user_id IS NULL
        AND r.guest_id IS NOT NULL
        AND u.guest_cookie_id = r.guest_id
    `.execute(db)
  }

  if (hasWorkspaceStatesGuestId) {
    await sql`
      UPDATE project_workspace_states w
      SET user_id = u.id
      FROM users u
      WHERE w.user_id IS NULL
        AND w.guest_id IS NOT NULL
        AND u.guest_cookie_id = w.guest_id
    `.execute(db)
  }

  await sql`ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_check`.execute(db)
  await sql`ALTER TABLE project_members ADD CONSTRAINT project_members_role_check CHECK (role IN ('owner', 'view', 'comment', 'edit'))`.execute(db)

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
    ON CONFLICT(project_id, user_id) WHERE user_id IS NOT NULL
    DO UPDATE SET role = 'owner', status = 'accepted', updated_at = excluded.updated_at
  `.execute(db)

  await sql`
    DELETE FROM project_recents
    WHERE id IN (
      SELECT id FROM (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY user_id, project_id
            ORDER BY opened_at DESC, id DESC
          ) AS rn
        FROM project_recents
        WHERE user_id IS NOT NULL
      ) ranked
      WHERE ranked.rn > 1
    )
  `.execute(db)

  await sql`
    DELETE FROM project_workspace_states
    WHERE ctid IN (
      SELECT ctid FROM (
        SELECT
          ctid,
          row_number() OVER (
            PARTITION BY project_id, user_id
            ORDER BY updated_at DESC
          ) AS rn
        FROM project_workspace_states
        WHERE user_id IS NOT NULL
      ) ranked
      WHERE ranked.rn > 1
    )
  `.execute(db)

  await sql`DROP INDEX IF EXISTS idx_projects_owner_guest`.execute(db)
  await sql`ALTER TABLE projects DROP COLUMN IF EXISTS owner_guest_id`.execute(db)
  await sql`ALTER TABLE projects ALTER COLUMN owner_user_id SET NOT NULL`.execute(db)

  await sql`ALTER TABLE project_comments DROP CONSTRAINT IF EXISTS project_comments_check`.execute(db)
  await sql`ALTER TABLE project_comments DROP COLUMN IF EXISTS author_guest_id`.execute(db)
  await sql`ALTER TABLE project_comments ALTER COLUMN author_user_id SET NOT NULL`.execute(db)

  await sql`DROP INDEX IF EXISTS idx_project_recents_guest_project`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_project_recents_guest_opened`.execute(db)
  await sql`ALTER TABLE project_recents DROP CONSTRAINT IF EXISTS project_recents_check`.execute(db)
  await sql`ALTER TABLE project_recents DROP COLUMN IF EXISTS guest_id`.execute(db)
  await sql`ALTER TABLE project_recents ALTER COLUMN user_id SET NOT NULL`.execute(db)

  await sql`DROP INDEX IF EXISTS idx_workspace_states_guest_project`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_workspace_states_guest_updated`.execute(db)
  await sql`ALTER TABLE project_workspace_states DROP CONSTRAINT IF EXISTS project_workspace_states_check`.execute(db)
  await sql`ALTER TABLE project_workspace_states DROP COLUMN IF EXISTS guest_id`.execute(db)
  await sql`ALTER TABLE project_workspace_states ALTER COLUMN user_id SET NOT NULL`.execute(db)

  await sql`CREATE SCHEMA IF NOT EXISTS app`.execute(db)
  await sql`
    CREATE OR REPLACE FUNCTION app.current_user_id()
    RETURNS TEXT
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('app.current_user_id', true), '')::text
    $$
  `.execute(db)
  await sql`
    CREATE OR REPLACE FUNCTION app.current_user_role()
    RETURNS TEXT
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('app.current_user_role', true), '')::text
    $$
  `.execute(db)

  await sql`ALTER TABLE projects ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE projects FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_projects_select ON projects`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_projects_write ON projects`.execute(db)
  await sql`
    CREATE POLICY rls_projects_select
    ON projects
    FOR SELECT
    USING (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = projects.id
          AND pm.user_id = app.current_user_id()
          AND pm.status = 'accepted'
      )
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_projects_write
    ON projects
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = projects.id
          AND pm.user_id = app.current_user_id()
          AND pm.status = 'accepted'
          AND pm.role = 'owner'
      )
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR owner_user_id = app.current_user_id()
    )
  `.execute(db)

  await sql`ALTER TABLE project_members ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE project_members FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_members_select ON project_members`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_members_write ON project_members`.execute(db)
  await sql`
    CREATE POLICY rls_project_members_select
    ON project_members
    FOR SELECT
    USING (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members self_pm
        WHERE self_pm.project_id = project_members.project_id
          AND self_pm.user_id = app.current_user_id()
          AND self_pm.status = 'accepted'
      )
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_project_members_write
    ON project_members
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members owner_pm
        WHERE owner_pm.project_id = project_members.project_id
          AND owner_pm.user_id = app.current_user_id()
          AND owner_pm.status = 'accepted'
          AND owner_pm.role = 'owner'
      )
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR (
        user_id = app.current_user_id()
        AND role = 'owner'
        AND status = 'accepted'
        AND EXISTS (
          SELECT 1 FROM projects p
          WHERE p.id = project_members.project_id
            AND p.owner_user_id = app.current_user_id()
        )
      )
      OR EXISTS (
        SELECT 1
        FROM project_members owner_pm
        WHERE owner_pm.project_id = project_members.project_id
          AND owner_pm.user_id = app.current_user_id()
          AND owner_pm.status = 'accepted'
          AND owner_pm.role = 'owner'
      )
    )
  `.execute(db)

  await sql`ALTER TABLE documents ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE documents FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_documents_policy ON documents`.execute(db)
  await sql`
    CREATE POLICY rls_documents_policy
    ON documents
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = documents.name
          AND pm.user_id = app.current_user_id()
          AND pm.status = 'accepted'
      )
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = documents.name
          AND pm.user_id = app.current_user_id()
          AND pm.status = 'accepted'
      )
    )
  `.execute(db)

  await sql`ALTER TABLE project_comments ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE project_comments FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_comments_select ON project_comments`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_comments_write ON project_comments`.execute(db)
  await sql`
    CREATE POLICY rls_project_comments_select
    ON project_comments
    FOR SELECT
    USING (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = project_comments.project_id
          AND pm.user_id = app.current_user_id()
          AND pm.status = 'accepted'
      )
    )
  `.execute(db)
  await sql`
    CREATE POLICY rls_project_comments_write
    ON project_comments
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR author_user_id = app.current_user_id()
      OR EXISTS (
        SELECT 1
        FROM project_members owner_pm
        WHERE owner_pm.project_id = project_comments.project_id
          AND owner_pm.user_id = app.current_user_id()
          AND owner_pm.status = 'accepted'
          AND owner_pm.role = 'owner'
      )
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR (
        author_user_id = app.current_user_id()
        AND EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = project_comments.project_id
            AND pm.user_id = app.current_user_id()
            AND pm.status = 'accepted'
            AND pm.role IN ('owner', 'edit', 'comment')
        )
      )
    )
  `.execute(db)

  await sql`ALTER TABLE project_recents ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE project_recents FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_recents_policy ON project_recents`.execute(db)
  await sql`
    CREATE POLICY rls_project_recents_policy
    ON project_recents
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

  await sql`ALTER TABLE project_workspace_states ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE project_workspace_states FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_workspace_states_policy ON project_workspace_states`.execute(db)
  await sql`
    CREATE POLICY rls_project_workspace_states_policy
    ON project_workspace_states
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

  await sql`ALTER TABLE share_tokens ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE share_tokens FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_share_tokens_policy ON share_tokens`.execute(db)
  await sql`
    CREATE POLICY rls_share_tokens_policy
    ON share_tokens
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members owner_pm
        WHERE owner_pm.project_id = share_tokens.project_id
          AND owner_pm.user_id = app.current_user_id()
          AND owner_pm.status = 'accepted'
          AND owner_pm.role = 'owner'
      )
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members owner_pm
        WHERE owner_pm.project_id = share_tokens.project_id
          AND owner_pm.user_id = app.current_user_id()
          AND owner_pm.status = 'accepted'
          AND owner_pm.role = 'owner'
      )
    )
  `.execute(db)

  await sql`ALTER TABLE project_link_sharing_state ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE project_link_sharing_state FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_project_link_sharing_state_policy ON project_link_sharing_state`.execute(db)
  await sql`
    CREATE POLICY rls_project_link_sharing_state_policy
    ON project_link_sharing_state
    FOR ALL
    USING (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members owner_pm
        WHERE owner_pm.project_id = project_link_sharing_state.project_id
          AND owner_pm.user_id = app.current_user_id()
          AND owner_pm.status = 'accepted'
          AND owner_pm.role = 'owner'
      )
    )
    WITH CHECK (
      app.current_user_role() = 'system'
      OR EXISTS (
        SELECT 1
        FROM project_members owner_pm
        WHERE owner_pm.project_id = project_link_sharing_state.project_id
          AND owner_pm.user_id = app.current_user_id()
          AND owner_pm.status = 'accepted'
          AND owner_pm.role = 'owner'
      )
    )
  `.execute(db)

  await sql`ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_user_preferences_policy ON user_preferences`.execute(db)
  await sql`
    CREATE POLICY rls_user_preferences_policy
    ON user_preferences
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

  await sql`ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY`.execute(db)
  await sql`DROP POLICY IF EXISTS rls_refresh_tokens_policy ON refresh_tokens`.execute(db)
  await sql`
    CREATE POLICY rls_refresh_tokens_policy
    ON refresh_tokens
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
  await sql`DROP TABLE IF EXISTS refresh_tokens`.execute(db)

  await sql`ALTER TABLE users DROP COLUMN IF EXISTS guest_cookie_id`.execute(db)
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS is_guest`.execute(db)

  await sql`DROP FUNCTION IF EXISTS app.current_user_id`.execute(db)
  await sql`DROP FUNCTION IF EXISTS app.current_user_role`.execute(db)
}
