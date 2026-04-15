import { isValidProjectId } from '../security.js'
import { sql } from './connection.js'
import type { UserPreferences } from './types.js'

function normalizeRecentLimit(limit: number): number {
  return Math.max(3, Math.min(50, Math.floor(limit)))
}

function normalizeQuickAccessPinnedLimit(limit: number): number {
  return Math.max(1, Math.min(30, Math.floor(limit)))
}

function normalizeAutoVersionInterval(minutes: number): number {
  const val = Math.floor(minutes)
  if (val <= 0) return 0
  return Math.max(1, Math.min(60, val))
}

function normalizeAutoCompileTimeout(seconds: number): number {
  const val = Math.floor(seconds)
  return Math.max(1, Math.min(30, val))
}

function normalizeAutoSaveOnCompile(value: unknown): boolean {
  if (value === false || value === 0 || value === 'off') return false
  return true
}

function normalizeDashboardSortBy(sortBy: unknown): 'last-active' | 'created' | 'title' {
  return sortBy === 'created' || sortBy === 'title' ? sortBy : 'last-active'
}

function normalizeDashboardLayout(layout: unknown): 'grid' | 'list' {
  return layout === 'list' ? 'list' : 'grid'
}

function normalizePinnedProjectIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const result: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!id) continue
    if (!isValidProjectId(id)) continue
    if (!result.includes(id)) {
      result.push(id)
    }
  }
  return result
}

export async function getUserPreferences(userId: string | null): Promise<UserPreferences> {
  if (!userId) {
    return {
      appearance: 'system',
      recentItemsLimit: 10,
      autoCompileDefault: false,
      autoCompileTimeoutSeconds: 2,
      editorBraceMatching: true,
      editorHighlightSelectionMatches: true,
      editorInEditorFind: true,
      editorAutocomplete: true,
      editorAutoCloseLatexBeginEnd: true,
      dashboardSortBy: 'last-active',
      dashboardLayout: 'grid',
      pinnedProjectIds: [],
      quickAccessPinnedLimit: 8,
      autoVersionIntervalMinutes: 5,
      autoSaveOnCompile: true,
      autoSaveOnExport: true,
    }
  }

  const [row] = await sql`
    SELECT appearance, recent_items_limit, auto_compile_default, auto_compile_timeout_seconds,
           editor_brace_matching, editor_highlight_selection_matches, editor_in_editor_find, editor_autocomplete,
           editor_auto_close_latex_begin_end,
           dashboard_sort_by, dashboard_layout, pinned_project_ids, quick_access_pinned_limit,
           auto_version_interval_minutes, auto_save_on_compile, auto_save_on_export
    FROM user_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `

  if (!row) {
    return {
      appearance: 'system',
      recentItemsLimit: 10,
      autoCompileDefault: false,
      autoCompileTimeoutSeconds: 2,
      editorBraceMatching: true,
      editorHighlightSelectionMatches: true,
      editorInEditorFind: true,
      editorAutocomplete: true,
      editorAutoCloseLatexBeginEnd: true,
      dashboardSortBy: 'last-active',
      dashboardLayout: 'grid',
      pinnedProjectIds: [],
      quickAccessPinnedLimit: 8,
      autoVersionIntervalMinutes: 5,
      autoSaveOnCompile: true,
      autoSaveOnExport: true,
    }
  }

  let parsedPinnedIds: unknown = []
  try {
    parsedPinnedIds = JSON.parse(row.pinned_project_ids as string)
  } catch {
    parsedPinnedIds = []
  }

  return {
    appearance: row.appearance as 'light' | 'dark' | 'system',
    recentItemsLimit: normalizeRecentLimit(row.recent_items_limit as number),
    autoCompileDefault: row.auto_compile_default as boolean,
    autoCompileTimeoutSeconds: normalizeAutoCompileTimeout((row.auto_compile_timeout_seconds as number) ?? 2),
    editorBraceMatching: row.editor_brace_matching as boolean,
    editorHighlightSelectionMatches: row.editor_highlight_selection_matches as boolean,
    editorInEditorFind: row.editor_in_editor_find as boolean,
    editorAutocomplete: row.editor_autocomplete as boolean,
    editorAutoCloseLatexBeginEnd: row.editor_auto_close_latex_begin_end as boolean,
    dashboardSortBy: normalizeDashboardSortBy(row.dashboard_sort_by),
    dashboardLayout: normalizeDashboardLayout(row.dashboard_layout),
    pinnedProjectIds: normalizePinnedProjectIds(parsedPinnedIds),
    quickAccessPinnedLimit: normalizeQuickAccessPinnedLimit(row.quick_access_pinned_limit as number),
    autoVersionIntervalMinutes: normalizeAutoVersionInterval((row.auto_version_interval_minutes as number) ?? 5),
    autoSaveOnCompile: normalizeAutoSaveOnCompile(row.auto_save_on_compile),
    autoSaveOnExport: row.auto_save_on_export as boolean,
  }
}

export async function updateUserPreferences(userId: string, patch: {
  appearance?: 'light' | 'dark' | 'system'
  recentItemsLimit?: number
  autoCompileDefault?: boolean
  autoCompileTimeoutSeconds?: number
  editorBraceMatching?: boolean
  editorHighlightSelectionMatches?: boolean
  editorInEditorFind?: boolean
  editorAutocomplete?: boolean
  editorAutoCloseLatexBeginEnd?: boolean
  dashboardSortBy?: 'last-active' | 'created' | 'title'
  dashboardLayout?: 'grid' | 'list'
  pinnedProjectIds?: string[]
  quickAccessPinnedLimit?: number
  autoVersionIntervalMinutes?: number
  autoSaveOnCompile?: boolean
  autoSaveOnExport?: boolean
}): Promise<UserPreferences> {
  const current = await getUserPreferences(userId)
  const next: UserPreferences = {
    appearance: patch.appearance ?? current.appearance,
    recentItemsLimit: patch.recentItemsLimit != null
      ? normalizeRecentLimit(patch.recentItemsLimit)
      : current.recentItemsLimit,
    autoCompileDefault: patch.autoCompileDefault ?? current.autoCompileDefault,
    autoCompileTimeoutSeconds: patch.autoCompileTimeoutSeconds != null
      ? normalizeAutoCompileTimeout(patch.autoCompileTimeoutSeconds)
      : current.autoCompileTimeoutSeconds,
    editorBraceMatching: patch.editorBraceMatching ?? current.editorBraceMatching,
    editorHighlightSelectionMatches: patch.editorHighlightSelectionMatches ?? current.editorHighlightSelectionMatches,
    editorInEditorFind: patch.editorInEditorFind ?? current.editorInEditorFind,
    editorAutocomplete: patch.editorAutocomplete ?? current.editorAutocomplete,
    editorAutoCloseLatexBeginEnd: patch.editorAutoCloseLatexBeginEnd ?? current.editorAutoCloseLatexBeginEnd,
    dashboardSortBy: patch.dashboardSortBy != null
      ? normalizeDashboardSortBy(patch.dashboardSortBy)
      : current.dashboardSortBy,
    dashboardLayout: patch.dashboardLayout != null
      ? normalizeDashboardLayout(patch.dashboardLayout)
      : current.dashboardLayout,
    pinnedProjectIds: patch.pinnedProjectIds != null
      ? normalizePinnedProjectIds(patch.pinnedProjectIds)
      : current.pinnedProjectIds,
    quickAccessPinnedLimit: patch.quickAccessPinnedLimit != null
      ? normalizeQuickAccessPinnedLimit(patch.quickAccessPinnedLimit)
      : current.quickAccessPinnedLimit,
    autoVersionIntervalMinutes: patch.autoVersionIntervalMinutes != null
      ? normalizeAutoVersionInterval(patch.autoVersionIntervalMinutes)
      : current.autoVersionIntervalMinutes,
    autoSaveOnCompile: patch.autoSaveOnCompile != null
      ? normalizeAutoSaveOnCompile(patch.autoSaveOnCompile)
      : current.autoSaveOnCompile,
    autoSaveOnExport: patch.autoSaveOnExport ?? current.autoSaveOnExport,
  }

  await sql`
    INSERT INTO user_preferences (
        user_id,
        appearance,
        recent_items_limit,
        auto_compile_default,
        auto_compile_timeout_seconds,
        editor_brace_matching,
        editor_highlight_selection_matches,
        editor_in_editor_find,
        editor_autocomplete,
        editor_auto_close_latex_begin_end,
        dashboard_sort_by,
        dashboard_layout,
        pinned_project_ids,
        quick_access_pinned_limit,
        auto_version_interval_minutes,
        auto_save_on_compile,
        auto_save_on_export,
        updated_at
      )
    VALUES (${userId}, ${next.appearance}, ${next.recentItemsLimit}, ${next.autoCompileDefault}, ${next.autoCompileTimeoutSeconds}, ${next.editorBraceMatching}, ${next.editorHighlightSelectionMatches}, ${next.editorInEditorFind}, ${next.editorAutocomplete}, ${next.editorAutoCloseLatexBeginEnd}, ${next.dashboardSortBy}, ${next.dashboardLayout}, ${JSON.stringify(next.pinnedProjectIds)}, ${next.quickAccessPinnedLimit}, ${next.autoVersionIntervalMinutes}, ${next.autoSaveOnCompile}, ${next.autoSaveOnExport}, extract(epoch from now())::integer)
    ON CONFLICT(user_id)
    DO UPDATE SET appearance = excluded.appearance,
                  recent_items_limit = excluded.recent_items_limit,
                  auto_compile_default = excluded.auto_compile_default,
                  auto_compile_timeout_seconds = excluded.auto_compile_timeout_seconds,
                  editor_brace_matching = excluded.editor_brace_matching,
                  editor_highlight_selection_matches = excluded.editor_highlight_selection_matches,
                  editor_in_editor_find = excluded.editor_in_editor_find,
                  editor_autocomplete = excluded.editor_autocomplete,
                  editor_auto_close_latex_begin_end = excluded.editor_auto_close_latex_begin_end,
                  dashboard_sort_by = excluded.dashboard_sort_by,
                  dashboard_layout = excluded.dashboard_layout,
                  pinned_project_ids = excluded.pinned_project_ids,
                  quick_access_pinned_limit = excluded.quick_access_pinned_limit,
                  auto_version_interval_minutes = excluded.auto_version_interval_minutes,
                  auto_save_on_compile = excluded.auto_save_on_compile,
                  auto_save_on_export = excluded.auto_save_on_export,
                  updated_at = excluded.updated_at
  `

  return next
}
