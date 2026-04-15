import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardView } from '../src/pages/DashboardView'
import type { AuthSession, ProjectSummary, RecentProjectSummary } from '../src/pages/types'

const now = Math.floor(Date.now() / 1000)

function makeProject(
  id: string,
  title: string,
  shareToken?: string,
  rootFile = 'main.tex',
): ProjectSummary {
  return {
    id,
    title,
    rootFile,
    createdAt: now,
    lastActiveAt: now,
    topLevelCommentCount: 0,
    ownerType: 'user',
    ownerDisplayName: 'Owner',
    ownerProfileImageUrl: null,
    shareToken,
  }
}

function makeRecent(id: string, title: string, shareToken?: string): RecentProjectSummary {
  return {
    ...makeProject(id, title, shareToken),
    openedAt: now,
  }
}

function makeSession(): AuthSession {
  return {
    authenticated: true,
    user: {
      id: 'user-1',
      email: 'user@test.com',
      displayName: 'User',
      profileImageUrl: null,
      role: 'user',
    },
    principal: {
      userId: 'user-1',
      guestId: null,
    },
    guestRetentionDays: 90,
    userCount: 2,
    signupMode: 'open',
    guestSignupsEnabled: true,
  }
}

function renderDashboard(props?: {
  projects?: ProjectSummary[]
  sharedProjects?: ProjectSummary[]
  recents?: RecentProjectSummary[]
  onOpen?: (id: string, shareToken?: string) => void
  dashboardLayout?: 'grid' | 'list'
}) {
  render(
    <DashboardView
      projects={props?.projects ?? []}
      sharedProjects={props?.sharedProjects ?? []}
      recents={props?.recents ?? []}
      loading={false}
      session={makeSession()}
      dashboardSortBy="last-active"
      dashboardLayout={props?.dashboardLayout ?? 'grid'}
      pinnedProjectIds={[]}
      quickAccessPinnedLimit={8}
      onOpenTemplatePicker={() => {}}
      onOpen={props?.onOpen ?? (() => {})}
      onRename={() => {}}
      onDelete={() => {}}
      onTogglePin={() => {}}
      onSortByChange={() => {}}
      onLayoutChange={() => {}}
      onReorderPinned={() => {}}
      onClearRecents={() => {}}
      showAdminLink={false}
      onOpenAdmin={() => {}}
      onOpenSettings={() => {}}
      onLogout={() => {}}
      onLogin={() => {}}
      trashedProjects={[]}
      trashRetentionDays={30}
      onRestoreProject={() => {}}
      onPermanentDeleteProject={() => {}}
    />,
  )
}

describe('DashboardView share-token opens', () => {
  it('shows a project-type badge in grid view instead of the root filename', () => {
    renderDashboard({
      projects: [makeProject('project-grid', 'Grid Type Project', undefined, 'paper.typ')],
    })

    expect(screen.getByText('Typst')).toBeInTheDocument()
    expect(screen.queryByText('paper.typ')).not.toBeInTheDocument()
  })

  it('shows project type and last-active text in list view metadata', () => {
    renderDashboard({
      projects: [makeProject('project-list', 'List Type Project', undefined, 'main.tex')],
      dashboardLayout: 'list',
    })

    expect(screen.getByText(/LaTeX · Last active/i)).toBeInTheDocument()
  })

  it('passes recents share token to onOpen', async () => {
    const user = userEvent.setup()
    const calls: Array<{ id: string; token: string | undefined }> = []

    renderDashboard({
      recents: [makeRecent('project-recent', 'Recent Token Project', 'recent-token')],
      onOpen: (id, shareToken) => {
        calls.push({ id, token: shareToken })
      },
    })

    await user.click(screen.getByRole('button', { name: /recent token project/i }))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ id: 'project-recent', token: 'recent-token' })
  })

  it('passes shared-with-me share token to onOpen', async () => {
    const user = userEvent.setup()
    const calls: Array<{ id: string; token: string | undefined }> = []

    renderDashboard({
      sharedProjects: [makeProject('project-shared', 'Shared Token Project', 'shared-token')],
      onOpen: (id, shareToken) => {
        calls.push({ id, token: shareToken })
      },
    })

    await user.click(screen.getByRole('button', { name: /shared token project/i }))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ id: 'project-shared', token: 'shared-token' })
  })
})
