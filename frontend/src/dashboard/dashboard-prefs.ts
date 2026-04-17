import type {
  AuthSession,
  DashboardLayout,
  DashboardPreferencesState,
  SortBy,
} from '@/types'

export const DASHBOARD_PREFS_STORAGE_KEY = 'composure.dashboard-preferences.v1'

export function validateSortBy(input: unknown): SortBy {
  return input === 'created' || input === 'title' || input === 'last-active'
    ? input
    : 'last-active'
}

export function validateLayout(input: unknown): DashboardLayout {
  return input === 'list' || input === 'grid' ? input : 'grid'
}

export function loadDashboardPreferences(principalKey: string): DashboardPreferencesState {
  const defaults: DashboardPreferencesState = {
    sortBy: 'last-active',
    layout: 'grid',
    pinnedProjectIds: [],
  }

  try {
    const raw = window.localStorage.getItem(`${DASHBOARD_PREFS_STORAGE_KEY}:${principalKey}`)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<DashboardPreferencesState>
    const pinned = Array.isArray(parsed.pinnedProjectIds)
      ? parsed.pinnedProjectIds.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        )
      : []
    return {
      sortBy: validateSortBy(parsed.sortBy),
      layout: validateLayout(parsed.layout),
      pinnedProjectIds: pinned,
    }
  } catch {
    return defaults
  }
}

export function saveDashboardPreferences(
  principalKey: string,
  preferences: DashboardPreferencesState,
): void {
  window.localStorage.setItem(
    `${DASHBOARD_PREFS_STORAGE_KEY}:${principalKey}`,
    JSON.stringify(preferences),
  )
}

export function getDashboardPrincipalKey(session: AuthSession | null): string {
  if (session?.authenticated && session.user?.id) {
    return `user:${session.user.id}`
  }

  const guestId = session?.principal.guestId
  return guestId ? `guest:${guestId}` : 'guest:anonymous'
}
