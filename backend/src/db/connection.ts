import postgres from 'postgres'
import { scheduleCleanupTasks } from './cleanup.js'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/composure'
const testDatabaseNamePattern = /(^|[_-])test([_-]|$)/i

export let sql: postgres.Sql

function maskDatabaseUrl(databaseUrl: string): string {
  return databaseUrl.replace(/\/\/.*@/, '//<credentials>@')
}

function extractDatabaseName(databaseUrl: string): string | null {
  try {
    const parsed = new URL(databaseUrl)
    const path = parsed.pathname.replace(/^\/+/, '')
    if (!path) return null
    return decodeURIComponent(path.split('/')[0] ?? '')
  } catch {
    return null
  }
}

function assertSafeTestDatabaseReset(databaseUrl: string): void {
  const nodeEnv = process.env.NODE_ENV ?? ''
  const dbName = extractDatabaseName(databaseUrl)
  const hasTestLikeName = dbName != null && testDatabaseNamePattern.test(dbName)

  if (nodeEnv === 'test' && hasTestLikeName) {
    return
  }

  throw new Error(
    `[db] refusing destructive test reset; requires NODE_ENV=test and test-like db name (pattern ${testDatabaseNamePattern}). NODE_ENV=${nodeEnv || '<unset>'} dbName=${dbName ?? '<unknown>'} url=${maskDatabaseUrl(databaseUrl)}`,
  )
}

/** Apply the full schema to a postgres instance */
export async function applySchema(instance: postgres.Sql): Promise<void> {
  await instance.unsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      profile_image_url TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
      max_projects INTEGER,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY,
      state BYTEA NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      root_file TEXT NOT NULL DEFAULT 'main.tex',
      engine TEXT,
      owner_user_id TEXT,
      owner_guest_id TEXT,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      last_active_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      deleted_at INTEGER,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_owner_user
      ON projects(owner_user_id, last_active_at DESC);

    CREATE INDEX IF NOT EXISTS idx_projects_owner_guest
      ON projects(owner_guest_id, last_active_at DESC);

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id
      ON sessions(user_id);

    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS project_members (
      id SERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT,
      invited_email TEXT,
      role TEXT NOT NULL CHECK (role IN ('view', 'comment', 'edit')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
      invited_by_user_id TEXT,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_project_user
      ON project_members(project_id, user_id) WHERE user_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_project_email
      ON project_members(project_id, invited_email) WHERE invited_email IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_project_members_user
      ON project_members(user_id, status);

    CREATE TABLE IF NOT EXISTS share_tokens (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('view', 'comment', 'edit')),
      created_by_user_id TEXT,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_share_tokens_token
      ON share_tokens(token);

    CREATE TABLE IF NOT EXISTS project_link_sharing_state (
      project_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('view', 'comment', 'edit')),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id TEXT,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS project_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      parent_comment_id TEXT,
      body TEXT NOT NULL,
      author_user_id TEXT,
      author_guest_id TEXT,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_comment_id) REFERENCES project_comments(id) ON DELETE CASCADE,
      CHECK (author_user_id IS NOT NULL OR author_guest_id IS NOT NULL)
    );

    CREATE INDEX IF NOT EXISTS idx_project_comments_project
      ON project_comments(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_project_comments_project_file
      ON project_comments(project_id, file_path, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_project_comments_parent
      ON project_comments(project_id, parent_comment_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS project_recents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT,
      guest_id TEXT,
      opened_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      share_token TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_recents_user_project
      ON project_recents(user_id, project_id)
      WHERE user_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_recents_guest_project
      ON project_recents(guest_id, project_id)
      WHERE guest_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_project_recents_user_opened
      ON project_recents(user_id, opened_at DESC)
      WHERE user_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_project_recents_guest_opened
      ON project_recents(guest_id, opened_at DESC)
      WHERE guest_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS project_workspace_states (
      project_id TEXT NOT NULL,
      user_id TEXT,
      guest_id TEXT,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_states_user_project
      ON project_workspace_states(project_id, user_id)
      WHERE user_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_states_guest_project
      ON project_workspace_states(project_id, guest_id)
      WHERE guest_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_workspace_states_user_updated
      ON project_workspace_states(user_id, updated_at DESC)
      WHERE user_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_workspace_states_guest_updated
      ON project_workspace_states(guest_id, updated_at DESC)
      WHERE guest_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      appearance TEXT NOT NULL DEFAULT 'system' CHECK (appearance IN ('light', 'dark', 'system')),
      recent_items_limit INTEGER NOT NULL DEFAULT 10,
      auto_compile_default BOOLEAN NOT NULL DEFAULT FALSE,
      auto_compile_timeout_seconds INTEGER NOT NULL DEFAULT 2,
      editor_brace_matching BOOLEAN NOT NULL DEFAULT TRUE,
      editor_highlight_selection_matches BOOLEAN NOT NULL DEFAULT TRUE,
      editor_in_editor_find BOOLEAN NOT NULL DEFAULT TRUE,
      editor_autocomplete BOOLEAN NOT NULL DEFAULT TRUE,
      editor_auto_close_latex_begin_end BOOLEAN NOT NULL DEFAULT TRUE,
      dashboard_sort_by TEXT NOT NULL DEFAULT 'last-active' CHECK (dashboard_sort_by IN ('last-active', 'created', 'title')),
      dashboard_layout TEXT NOT NULL DEFAULT 'grid' CHECK (dashboard_layout IN ('grid', 'list')),
      pinned_project_ids TEXT NOT NULL DEFAULT '[]',
      quick_access_pinned_limit INTEGER NOT NULL DEFAULT 8,
      auto_version_interval_minutes INTEGER NOT NULL DEFAULT 5,
      auto_save_on_compile BOOLEAN NOT NULL DEFAULT TRUE,
      auto_save_on_export BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      expires_at INTEGER NOT NULL,
      expired_early_at INTEGER,
      used_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
      ON password_reset_tokens(user_id);

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
      ON password_reset_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS invite_tokens (
      token TEXT PRIMARY KEY,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      email TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_invite_tokens_expires
      ON invite_tokens(expires_at);

    CREATE INDEX IF NOT EXISTS idx_invite_tokens_email
      ON invite_tokens(email);

    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'running', 'done', 'failed', 'invalid', 'stalled')),
      user_id TEXT,
      project_id TEXT,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_background_jobs_status
      ON background_jobs(status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_background_jobs_created
      ON background_jobs(created_at DESC);
  `)

  await instance`
    INSERT INTO server_settings (key, value, updated_at)
    VALUES ('password_reset_expiry_seconds', '86400', extract(epoch from now())::integer)
    ON CONFLICT(key) DO NOTHING
  `
}

/** Initialize PostgreSQL database with schema */
export async function initDatabase(): Promise<void> {
  console.info(`[db] init url=${maskDatabaseUrl(databaseUrl)}`)

  sql = postgres(databaseUrl, { transform: { undefined: null } })

  await applySchema(sql)

  // On startup, mark any 'running' or 'waiting' jobs as 'stalled' since the server restarted.
  const stalledOnRestart = await sql`
    UPDATE background_jobs
    SET status = 'stalled', finished_at = extract(epoch from now())::integer, error = 'Server restarted'
    WHERE status IN ('running', 'waiting')
  `
  if (stalledOnRestart.count > 0) {
    console.info(`[db] marked ${stalledOnRestart.count} in-flight jobs as stalled on startup`)
  }

  // Claim unowned legacy projects for a pseudo guest owner so they remain visible.
  await sql`
    UPDATE projects
    SET owner_guest_id = 'legacy:' || id
    WHERE owner_user_id IS NULL AND owner_guest_id IS NULL
  `

  scheduleCleanupTasks(sql)
  console.info('[db] schema-ready and cleanup tasks scheduled')
}

/** Initialize a test PostgreSQL database. No cleanup timers are scheduled. */
export async function initTestDatabase(): Promise<postgres.Sql> {
  const testUrl = process.env.TEST_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? 'postgres://postgres:postgres@localhost:5433/composure_test'

  assertSafeTestDatabaseReset(testUrl)

  if (sql) {
    try {
      await sql.end({ timeout: 1 })
    } catch (error) {
      console.warn(`[db] failed to close previous sql pool before test reset: ${String(error)}`)
    }
  }

  const testSql = postgres(testUrl, { max: 5, transform: { undefined: null } })

  // Clean slate
  await testSql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await applySchema(testSql)

  sql = testSql
  return testSql
}
