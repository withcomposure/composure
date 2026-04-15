import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  Calendar,
  FolderKanban,
  Grid3X3,
  History,
  List,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Shield,
  TextCursor,
  Trash2,
} from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { CustomDropdown } from '../components/CustomDropdown'
import { ProfileMenu } from '../components/ProfileMenu'
import type {
  AuthSession,
  DashboardLayout,
  ProjectSummary,
  RecentProjectSummary,
  SortBy,
  TrashedProjectSummary,
} from './types'
import { fmtRelativeTime, guestIdLabel, guestLabel } from './utils'
import { projectTypeLabelFromRootFile } from '../shared/project-format'

interface DashboardViewProps {
  projects: ProjectSummary[]
  sharedProjects: ProjectSummary[]
  recents: RecentProjectSummary[]
  loading: boolean
  session: AuthSession | null
  dashboardSortBy: SortBy
  dashboardLayout: DashboardLayout
  pinnedProjectIds: string[]
  quickAccessPinnedLimit: number
  onOpenTemplatePicker: () => void
  onOpen: (id: string, shareToken?: string) => void
  onRename: (p: ProjectSummary) => void
  onDelete: (p: ProjectSummary) => void
  onTogglePin: (projectId: string) => void
  onSortByChange: (sortBy: SortBy) => void
  onLayoutChange: (layout: DashboardLayout) => void
  onReorderPinned: (nextOrder: string[]) => void
  onClearRecents: () => void
  showAdminLink: boolean
  onOpenAdmin: () => void
  onOpenSettings: () => void
  onLogout: () => void
  onLogin: () => void
  trashedProjects: TrashedProjectSummary[]
  trashRetentionDays: number
  onRestoreProject: (id: string) => void
  onPermanentDeleteProject: (id: string) => void
}

export function DashboardView({
  projects,
  sharedProjects,
  recents,
  loading,
  session,
  dashboardSortBy,
  dashboardLayout,
  pinnedProjectIds,
  quickAccessPinnedLimit,
  onOpenTemplatePicker,
  onOpen,
  onRename,
  onDelete,
  onTogglePin,
  onSortByChange,
  onLayoutChange,
  onReorderPinned,
  onClearRecents,
  showAdminLink,
  onOpenAdmin,
  onOpenSettings,
  onLogout,
  onLogin,
  trashedProjects,
  trashRetentionDays,
  onRestoreProject,
  onPermanentDeleteProject,
}: DashboardViewProps) {
  const [query, setQuery] = useState('')
  const [draggedPinnedId, setDraggedPinnedId] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [dashboardPage, setDashboardPage] = useState<'projects' | 'trash'>(
    () => (window.location.hash === '#recently-deleted' ? 'trash' : 'projects'),
  )
  const hasTrash = trashedProjects.length > 0
  const sortOptions: Array<{ value: SortBy; label: string; icon: typeof History }> = [
    { value: 'last-active', label: 'Last active', icon: History },
    { value: 'created', label: 'Created', icon: Calendar },
    { value: 'title', label: 'Title', icon: TextCursor },
  ]

  const projectById = useMemo(() => {
    const map = new Map<string, ProjectSummary>()
    for (const project of projects) map.set(project.id, project)
    for (const project of sharedProjects) map.set(project.id, project)
    return map
  }, [projects, sharedProjects])

  const pinnedProjects = useMemo(() => {
    const ordered: ProjectSummary[] = []
    for (const id of pinnedProjectIds) {
      const project = projectById.get(id)
      if (project) ordered.push(project)
    }
    return ordered
  }, [pinnedProjectIds, projectById])

  const quickAccessPinnedProjects = useMemo(
    () => pinnedProjects.slice(0, Math.max(1, quickAccessPinnedLimit)),
    [pinnedProjects, quickAccessPinnedLimit],
  )

  const pinnedSet = useMemo(
    () => new Set(pinnedProjects.map((project) => project.id)),
    [pinnedProjects],
  )

  const sortProjects = useCallback(
    (items: ProjectSummary[]) => {
      return [...items].sort((a, b) => {
        if (dashboardSortBy === 'title') {
          return a.title.localeCompare(b.title)
        }
        if (dashboardSortBy === 'created') {
          return b.createdAt - a.createdAt
        }
        return b.lastActiveAt - a.lastActiveAt
      })
    },
    [dashboardSortBy],
  )

  const filter = useCallback(
    (items: ProjectSummary[]) => {
      const q = query.trim().toLowerCase()
      if (!q) return items
      return items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) || item.rootFile.toLowerCase().includes(q),
      )
    },
    [query],
  )

  const filteredPinned = useMemo(() => filter(pinnedProjects), [pinnedProjects, filter])
  const filteredProjects = useMemo(
    () => sortProjects(filter(projects.filter((item) => !pinnedSet.has(item.id)))),
    [projects, filter, pinnedSet, sortProjects],
  )
  const filteredShared = useMemo(
    () => sortProjects(filter(sharedProjects.filter((item) => !pinnedSet.has(item.id)))),
    [sharedProjects, filter, pinnedSet, sortProjects],
  )
  const filteredTrashed = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = !q
      ? trashedProjects
      : trashedProjects.filter((item) => item.title.toLowerCase().includes(q))
    return [...matched].sort((a, b) => {
      if (dashboardSortBy === 'title') {
        return a.title.localeCompare(b.title)
      }
      if (dashboardSortBy === 'created') {
        return b.createdAt - a.createdAt
      }
      // For trash, "last active" maps to most recently deleted.
      return b.deletedAt - a.deletedAt
    })
  }, [trashedProjects, query, dashboardSortBy])

  useEffect(() => {
    const syncPageFromHash = () => {
      if (window.location.hash === '#recently-deleted' && hasTrash) {
        setDashboardPage('trash')
        return
      }
      setDashboardPage('projects')
    }

    syncPageFromHash()
    window.addEventListener('hashchange', syncPageFromHash)
    return () => {
      window.removeEventListener('hashchange', syncPageFromHash)
    }
  }, [hasTrash])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now())
    }, 60000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const reorderPinnedByTarget = useCallback(
    (targetProjectId: string) => {
      if (!draggedPinnedId || draggedPinnedId === targetProjectId) return
      const fromIndex = pinnedProjectIds.indexOf(draggedPinnedId)
      const toIndex = pinnedProjectIds.indexOf(targetProjectId)
      if (fromIndex < 0 || toIndex < 0) return
      const next = [...pinnedProjectIds]
      next.splice(fromIndex, 1)
      next.splice(toIndex, 0, draggedPinnedId)
      onReorderPinned(next)
    },
    [draggedPinnedId, pinnedProjectIds, onReorderPinned],
  )

  const onPinnedDragStart = useCallback((projectId: string) => {
    setDraggedPinnedId(projectId)
  }, [])

  const onPinnedDragEnd = useCallback(() => {
    setDraggedPinnedId(null)
  }, [])

  const onPinnedDragOver = useCallback(
    (event: ReactDragEvent, projectId: string) => {
      event.preventDefault()
      reorderPinnedByTarget(projectId)
    },
    [reorderPinnedByTarget],
  )

  const onProjectCardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, projectId: string, shareToken?: string) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen(projectId, shareToken)
    },
    [onOpen],
  )

  const openProjectsPage = useCallback(() => {
    setDashboardPage('projects')
  }, [])

  const openTrashPage = useCallback(() => {
    if (!hasTrash) return
    setDashboardPage('trash')
    window.location.hash = '#recently-deleted'
  }, [hasTrash])

  const renderPinButton = useCallback(
    (project: ProjectSummary, pinned: boolean) => (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onTogglePin(project.id)
        }}
        className={`rounded p-1 transition ${pinned ? 'text-pm-accent' : 'text-pm-text-muted opacity-0 group-hover:opacity-100 hover:bg-pm-surface-hover hover:text-pm-text'}`}
        title={pinned ? 'Unpin' : 'Pin'}
      >
        <Pin size={13} className={pinned ? 'fill-current' : ''} />
      </button>
    ),
    [onTogglePin],
  )

  const renderGridCommentBadge = useCallback(
    (project: ProjectSummary) => project.topLevelCommentCount > 0 ? (
      <div
        className="pointer-events-none absolute -top-2 -right-2 rounded-full border border-pm-border bg-pm-surface px-2 py-0.5 text-[10px] font-semibold text-pm-text shadow-lg"
        title={`${project.topLevelCommentCount} open comments`}
      >
        {project.topLevelCommentCount}
      </div>
    ) : null,
    [],
  )

  const renderInlineCommentBadge = useCallback(
    (project: ProjectSummary) => project.topLevelCommentCount > 0 ? (
      <span
        className="ml-3 inline-flex shrink-0 items-center rounded-full border border-pm-border bg-pm-bg px-1.5 py-0.5 text-[10px] font-semibold text-pm-text-muted"
        title={`${project.topLevelCommentCount} open comments`}
      >
        {project.topLevelCommentCount}
      </span>
    ) : null,
    [],
  )

  const renderProjectTypeBadge = useCallback(
    (project: ProjectSummary) => (
      <span className="inline-flex items-center rounded-full border border-pm-border bg-pm-bg px-2 py-0.5 text-[10px] font-medium tracking-wide text-pm-text-muted">
        {projectTypeLabelFromRootFile(project.rootFile)}
      </span>
    ),
    [],
  )

  return (
    <div className="flex h-screen bg-pm-bg text-pm-text">
      <aside className="hidden w-72 flex-col border-r border-pm-border bg-pm-surface lg:flex">
        <div className="p-4">
          <div className="mb-8 px-1 text-lg font-semibold tracking-tight text-pm-text">
            <span className="text-pm-accent">P</span>ressmark
          </div>
          <button
            onClick={onOpenTemplatePicker}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-pm-accent px-3 py-2 text-sm font-medium text-white hover:bg-pm-accent-hover"
          >
            <Plus size={14} />
            New Project
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-pm-text-muted">Workspace</div>
          <div className="space-y-1">
            <a
              href="#pins"
              onClick={openProjectsPage}
              className="flex items-center cursor-default gap-2 rounded-md px-2 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
            >
              <Pin size={14} />
              Pinned
            </a>
            <a
              href="#my-projects"
              onClick={openProjectsPage}
              className="flex items-center cursor-default gap-2 rounded-md px-2 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
            >
              <FolderKanban size={14} />
              Projects
            </a>
            <a
              href="#shared-with-me"
              onClick={openProjectsPage}
              className="flex items-center cursor-default gap-2 rounded-md px-2 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
            >
              <Share2 size={14} />
              Shared with Me
            </a>
            {hasTrash && (
              <button
                onClick={openTrashPage}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-pm-surface-hover ${dashboardPage === 'trash' ? 'bg-pm-accent-muted text-pm-accent' : 'text-pm-text-muted hover:text-pm-text'}`}
              >
                <Trash2 size={14} />
                Recently Deleted
              </button>
            )}
          </div>

          <div className="mt-6 mb-2 text-xs uppercase tracking-wider text-pm-text-muted">Pinned</div>
          <div className="space-y-1">
            {quickAccessPinnedProjects.length === 0 && (
              <div className="rounded-md border border-dashed border-pm-border px-2 py-2 text-xs text-pm-text-muted">No pinned projects</div>
            )}
            {quickAccessPinnedProjects.map((project) => (
              <div
                role="button"
                tabIndex={0}
                key={project.id}
                onClick={() => onOpen(project.id, project.shareToken)}
                onKeyDown={(event) => onProjectCardKeyDown(event, project.id, project.shareToken)}
                draggable
                onDragStart={() => onPinnedDragStart(project.id)}
                onDragEnd={onPinnedDragEnd}
                onDragOver={(event) => onPinnedDragOver(event, project.id)}
                className={`group flex w-full items-center justify-between rounded-md px-2 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-pm-accent ${draggedPinnedId === project.id ? 'opacity-70' : 'hover:bg-pm-surface-hover'}`}
              >
                <div className="min-w-0 flex-1 truncate text-sm text-pm-text">{project.title}</div>
                {renderPinButton(project, true)}
              </div>
            ))}
          </div>

          <div className="mt-6 mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-pm-text-muted">
            <span>Recents</span>
            <button
              onClick={onClearRecents}
              className="rounded px-2 py-1 text-[11px] normal-case tracking-normal hover:bg-pm-surface-hover hover:text-pm-text"
            >
              Clear
            </button>
          </div>
          <div className="space-y-1">
            {recents.length === 0 && (
              <div className="rounded-md border border-dashed border-pm-border px-2 py-2 text-xs text-pm-text-muted">No recent projects</div>
            )}
            {recents.map((project) => (
              <button
                key={project.id}
                onClick={() => onOpen(project.id, project.shareToken)}
                className="w-full rounded-md px-2 py-2 text-left hover:bg-pm-surface-hover"
              >
                <div className="flex items-center gap-2">
                  <div className="line-clamp-2 flex-1 text-sm text-pm-text">{project.title}</div>
                  <div className="shrink-0 whitespace-nowrap text-xs text-pm-text-muted">
                    {fmtRelativeTime(project.openedAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-pm-border p-4">
          {showAdminLink && (
            <button
              onClick={onOpenAdmin}
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
            >
              <Shield size={14} />
              Administration
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
          >
            <Settings size={14} />
            Settings
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-pm-border bg-pm-surface px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Search size={16} className="text-pm-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={dashboardPage === 'trash' ? 'Search recently deleted' : 'Search projects'}
              className="w-full max-w-xl rounded-md border border-pm-border bg-pm-bg px-3 py-2 text-sm text-pm-text outline-none focus:border-pm-accent"
            />
            <button
              onClick={onOpenTemplatePicker}
              className="flex items-center gap-2 rounded-lg bg-pm-accent px-3 py-2 text-sm font-medium text-white hover:bg-pm-accent-hover lg:hidden"
            >
              <Plus size={14} />
              New
            </button>
            <div className="ml-auto hidden md:block whitespace-nowrap">
              <ProfileMenu
                name={session?.authenticated ? (session.user?.displayName ?? 'Account') : guestLabel(session?.principal.guestId)}
                email={session?.authenticated ? (session.user?.email ?? null) : guestIdLabel(session?.principal.guestId)}
                imageUrl={session?.user?.profileImageUrl ?? null}
                isGuest={!session?.authenticated}
                onOpenSettings={onOpenSettings}
                onLogout={onLogout}
                onLogin={onLogin}
              />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6">
          {!session?.authenticated && (
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              Guest documents are kept for {session?.guestRetentionDays ?? 30} days of inactivity.
              <button onClick={onLogin} className="ml-2 underline underline-offset-2 hover:text-white">
                Login or create an account to keep them forever.
              </button>
            </div>
          )}

          <div className="mb-3 flex items-center justify-end gap-2 text-xs">
            <CustomDropdown value={dashboardSortBy} options={sortOptions} onChange={onSortByChange} />
            <div className="flex items-center overflow-hidden rounded-md border border-pm-border">
              <button
                onClick={() => onLayoutChange('grid')}
                className={`px-2 py-2 ${dashboardLayout === 'grid' ? 'bg-pm-accent-muted text-pm-accent' : 'text-pm-text-muted hover:bg-pm-surface-hover'}`}
                title="Grid"
              >
                <Grid3X3 size={14} />
              </button>
              <button
                onClick={() => onLayoutChange('list')}
                className={`px-2 py-2 ${dashboardLayout === 'list' ? 'bg-pm-accent-muted text-pm-accent' : 'text-pm-text-muted hover:bg-pm-surface-hover'}`}
                title="List"
              >
                <List size={14} />
              </button>
            </div>
          </div>

          {dashboardPage === 'projects' ? (
            <>
              <section id="pins" className="mb-8">
            <div className="sticky top-0 z-10 mb-3 border-b border-pm-border bg-pm-bg/95 py-2 text-xs uppercase tracking-wider text-pm-text-muted backdrop-blur">
              Pinned
            </div>
            {filteredPinned.length === 0 ? (
              <div className="rounded-xl border border-dashed border-pm-border px-4 py-8 text-center text-sm text-pm-text-muted">
                No pinned projects.
              </div>
            ) : dashboardLayout === 'grid' ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredPinned.map((project) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={project.id}
                    onClick={() => onOpen(project.id, project.shareToken)}
                    onKeyDown={(event) => onProjectCardKeyDown(event, project.id, project.shareToken)}
                    draggable
                    onDragStart={() => onPinnedDragStart(project.id)}
                    onDragEnd={onPinnedDragEnd}
                    onDragOver={(event) => onPinnedDragOver(event, project.id)}
                    className={`group relative rounded-xl border border-pm-border bg-pm-surface p-4 text-left transition hover:border-pm-accent/30 hover:shadow-lg hover:shadow-black/20 focus-visible:outline-2 focus-visible:outline-pm-accent ${draggedPinnedId === project.id ? 'scale-[0.98] opacity-70' : ''}`}
                  >
                    {renderGridCommentBadge(project)}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="line-clamp-1 text-sm font-medium text-pm-text">{project.title}</div>
                        <div className="mt-1">{renderProjectTypeBadge(project)}</div>
                      </div>
                      {renderPinButton(project, true)}
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-xs text-pm-text-muted">Last active {fmtRelativeTime(project.lastActiveAt)}</div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              onRename(project)
                            }}
                            className="rounded p-1 text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
                            title="Rename"
                          >
                            <TextCursor size={13} />
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              onDelete(project)
                            }}
                            className="rounded p-1 text-pm-text-muted hover:bg-red-500/15 hover:text-red-200"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <Avatar
                          name={project.ownerDisplayName}
                          imageUrl={project.ownerProfileImageUrl}
                          isGuest={project.ownerType === 'guest'}
                          size={26}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-pm-border bg-pm-surface">
                {filteredPinned.map((project) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={project.id}
                    onClick={() => onOpen(project.id, project.shareToken)}
                    onKeyDown={(event) => onProjectCardKeyDown(event, project.id, project.shareToken)}
                    draggable
                    onDragStart={() => onPinnedDragStart(project.id)}
                    onDragEnd={onPinnedDragEnd}
                    onDragOver={(event) => onPinnedDragOver(event, project.id)}
                    className={`group flex w-full items-center justify-between border-b border-pm-border px-4 py-3 text-left transition last:border-b-0 hover:bg-pm-surface-hover focus-visible:outline-2 focus-visible:outline-pm-accent ${draggedPinnedId === project.id ? 'opacity-70' : ''}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center">
                        <div className="truncate text-sm text-pm-text">{project.title}</div>
                        {renderInlineCommentBadge(project)}
                      </div>
                      <div className="text-xs text-pm-text-muted">
                        {projectTypeLabelFromRootFile(project.rootFile)} · Last active {fmtRelativeTime(project.lastActiveAt)}
                      </div>
                    </div>
                    <div className="ml-3 flex items-center gap-2">
                      <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onRename(project)
                          }}
                          className="rounded p-1 text-pm-text-muted hover:bg-pm-bg hover:text-pm-text"
                          title="Rename"
                        >
                          <TextCursor size={13} />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onDelete(project)
                          }}
                          className="rounded p-1 text-pm-text-muted hover:bg-red-500/15 hover:text-red-200"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {renderPinButton(project, true)}
                      <Avatar
                        name={project.ownerDisplayName}
                        imageUrl={project.ownerProfileImageUrl}
                        isGuest={project.ownerType === 'guest'}
                        size={26}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="my-projects" className="mb-8">
            <div className="sticky top-0 z-10 mb-3 border-b border-pm-border bg-pm-bg/95 py-2 text-xs uppercase tracking-wider text-pm-text-muted backdrop-blur">
              My Projects
            </div>
            {loading ? (
              <div className="text-sm text-pm-text-muted">Loading projects...</div>
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-pm-border px-4 py-10 text-center text-sm text-pm-text-muted">
                There's nothing here yet.
              </div>
            ) : dashboardLayout === 'grid' ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredProjects.map((project) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={project.id}
                    onClick={() => onOpen(project.id, project.shareToken)}
                    onKeyDown={(event) => onProjectCardKeyDown(event, project.id, project.shareToken)}
                    className="group relative rounded-xl border border-pm-border bg-pm-surface p-4 text-left transition hover:border-pm-accent/30 hover:shadow-lg hover:shadow-black/20 focus-visible:outline-2 focus-visible:outline-pm-accent"
                  >
                    {renderGridCommentBadge(project)}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="line-clamp-1 text-sm font-medium text-pm-text">{project.title}</div>
                        <div className="mt-1">{renderProjectTypeBadge(project)}</div>
                      </div>
                      {renderPinButton(project, false)}
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-xs text-pm-text-muted">Last active {fmtRelativeTime(project.lastActiveAt)}</div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              onRename(project)
                            }}
                            className="rounded p-1 text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
                            title="Rename"
                          >
                            <TextCursor size={13} />
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              onDelete(project)
                            }}
                            className="rounded p-1 text-pm-text-muted hover:bg-red-500/15 hover:text-red-200"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <Avatar
                          name={project.ownerDisplayName}
                          imageUrl={project.ownerProfileImageUrl}
                          isGuest={project.ownerType === 'guest'}
                          size={26}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-pm-border bg-pm-surface">
                {filteredProjects.map((project) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={project.id}
                    onClick={() => onOpen(project.id, project.shareToken)}
                    onKeyDown={(event) => onProjectCardKeyDown(event, project.id, project.shareToken)}
                    className="group flex w-full items-center justify-between border-b border-pm-border px-4 py-3 text-left last:border-b-0 hover:bg-pm-surface-hover focus-visible:outline-2 focus-visible:outline-pm-accent"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center">
                        <div className="truncate text-sm text-pm-text">{project.title}</div>
                        {renderInlineCommentBadge(project)}
                      </div>
                      <div className="text-xs text-pm-text-muted">
                        {projectTypeLabelFromRootFile(project.rootFile)} · Last active {fmtRelativeTime(project.lastActiveAt)}
                      </div>
                    </div>
                    <div className="ml-3 flex items-center gap-2">
                      <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onRename(project)
                          }}
                          className="rounded p-1 text-pm-text-muted hover:bg-pm-bg hover:text-pm-text"
                          title="Rename"
                        >
                          <TextCursor size={13} />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onDelete(project)
                          }}
                          className="rounded p-1 text-pm-text-muted hover:bg-red-500/15 hover:text-red-200"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {renderPinButton(project, false)}
                      <Avatar
                        name={project.ownerDisplayName}
                        imageUrl={project.ownerProfileImageUrl}
                        isGuest={project.ownerType === 'guest'}
                        size={26}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="shared-with-me">
            <div className="sticky top-0 z-10 mb-3 border-b border-pm-border bg-pm-bg/95 py-2 text-xs uppercase tracking-wider text-pm-text-muted backdrop-blur">
              Shared with Me
            </div>
            {loading ? (
              <div className="text-sm text-pm-text-muted">Loading shared projects...</div>
            ) : filteredShared.length === 0 ? (
              <div className="rounded-xl border border-dashed border-pm-border px-4 py-8 text-sm text-pm-text-muted text-center">
                There's nothing here yet.
              </div>
            ) : dashboardLayout === 'grid' ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredShared.map((project) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={project.id}
                    onClick={() => onOpen(project.id, project.shareToken)}
                    onKeyDown={(event) => onProjectCardKeyDown(event, project.id, project.shareToken)}
                    className="group relative rounded-xl border border-pm-border bg-pm-surface p-4 text-left hover:border-pm-accent/30 focus-visible:outline-2 focus-visible:outline-pm-accent"
                  >
                    {renderGridCommentBadge(project)}
                    <div className="flex items-start justify-between gap-2">
                      <div className="line-clamp-1 text-sm font-medium text-pm-text">{project.title}</div>
                      {renderPinButton(project, false)}
                    </div>
                    <div className="mt-2">{renderProjectTypeBadge(project)}</div>
                    <div className="mt-3 text-xs text-pm-text-muted">Last active {fmtRelativeTime(project.lastActiveAt)}</div>
                    <div className="mt-4 flex items-center justify-end">
                      <Avatar
                        name={project.ownerDisplayName}
                        imageUrl={project.ownerProfileImageUrl}
                        isGuest={project.ownerType === 'guest'}
                        size={26}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-pm-border bg-pm-surface">
                {filteredShared.map((project) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={project.id}
                    onClick={() => onOpen(project.id, project.shareToken)}
                    onKeyDown={(event) => onProjectCardKeyDown(event, project.id, project.shareToken)}
                    className="group flex w-full items-center justify-between border-b border-pm-border px-4 py-3 text-left last:border-b-0 hover:bg-pm-surface-hover focus-visible:outline-2 focus-visible:outline-pm-accent"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center">
                        <div className="truncate text-sm text-pm-text">{project.title}</div>
                        {renderInlineCommentBadge(project)}
                      </div>
                      <div className="text-xs text-pm-text-muted">
                        {projectTypeLabelFromRootFile(project.rootFile)} · Last active {fmtRelativeTime(project.lastActiveAt)}
                      </div>
                    </div>
                    <div className="ml-3 flex items-center gap-2">
                      {renderPinButton(project, false)}
                      <Avatar
                        name={project.ownerDisplayName}
                        imageUrl={project.ownerProfileImageUrl}
                        isGuest={project.ownerType === 'guest'}
                        size={26}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
            </>
          ) : (
            <>
              <section id="recently-deleted" className="mb-8">
                <div className="sticky top-0 z-10 mb-3 border-b border-pm-border bg-pm-bg/95 py-2 text-xs uppercase tracking-wider text-pm-text-muted backdrop-blur">
                  Recently Deleted
                </div>
                {filteredTrashed.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-pm-border px-4 py-8 text-center text-sm text-pm-text-muted">
                    No recently deleted projects match your search.
                  </div>
                ) : dashboardLayout === 'grid' ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {filteredTrashed.map((project) => {
                      const purgeDate = new Date((project.deletedAt + trashRetentionDays * 86400) * 1000)
                      const daysLeft = Math.max(0, Math.ceil((purgeDate.getTime() - nowTs) / 86400000))
                      return (
                        <div
                          key={project.id}
                          className="rounded-xl border border-pm-border bg-pm-surface p-4"
                        >
                          <div className="line-clamp-1 text-sm font-medium text-pm-text">{project.title}</div>
                          <div className="mt-1 text-xs text-pm-text-muted">
                            Deleted {fmtRelativeTime(project.deletedAt)}
                          </div>
                          <div className="mt-1 text-xs text-pm-text-muted">
                            Purged in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}
                          </div>
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              onClick={() => onRestoreProject(project.id)}
                              title="Restore project"
                              className="rounded p-1.5 text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              onClick={() => onPermanentDeleteProject(project.id)}
                              title="Delete permanently"
                              className="rounded p-1.5 text-pm-text-muted hover:bg-red-500/20 hover:text-red-400"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-pm-border bg-pm-surface">
                    {filteredTrashed.map((project) => {
                      const purgeDate = new Date((project.deletedAt + trashRetentionDays * 86400) * 1000)
                      const daysLeft = Math.max(0, Math.ceil((purgeDate.getTime() - nowTs) / 86400000))
                      return (
                        <div
                          key={project.id}
                          className="flex w-full items-center justify-between border-b border-pm-border px-4 py-3 last:border-b-0"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm text-pm-text-muted">{project.title}</div>
                            <div className="text-xs text-pm-text-muted">
                              Deleted {fmtRelativeTime(project.deletedAt)} · purged in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}
                            </div>
                          </div>
                          <div className="ml-3 flex shrink-0 items-center gap-2">
                            <button
                              onClick={() => onRestoreProject(project.id)}
                              title="Restore project"
                              className="rounded p-1.5 text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              onClick={() => onPermanentDeleteProject(project.id)}
                              title="Delete permanently"
                              className="rounded p-1.5 text-pm-text-muted hover:bg-red-500/20 hover:text-red-400"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
