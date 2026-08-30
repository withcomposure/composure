import { useCallback, useRef, useState } from 'react'
import { KeyRound, Mail, Monitor, Settings, User, UserPlus, Users } from 'lucide-react'
import { BackToProjectsButton } from './BackToProjectsButton'
import { MobileDrawerToolbar } from '@/components/MobileDrawerToolbar'
import { SideDrawer } from '@/components/SideDrawer'
import { EmailSettingsSection } from './administration/EmailSettingsSection'
import { InvitationsSection } from './administration/InvitationsSection'
import { LoginProvidersSection } from './administration/LoginProvidersSection'
import { MonitoringSection } from './administration/MonitoringSection'
import { ServerSettingsSection } from './administration/ServerSettingsSection'
import { UserManagementSection } from './administration/UserManagementSection'
import { useAdminServerSettings } from './administration/use-admin-server-settings'
import { useSectionObserver } from '@/hooks/use-section-observer'
import { navigateToProjects, navigateToSettings } from '@/utils/route'

type AdminSectionId = 'users' | 'server' | 'invitations' | 'email' | 'login-providers' | 'monitoring'

const adminSectionItems: Array<{ id: AdminSectionId; label: string; icon: typeof User }> = [
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'server', label: 'Server Settings', icon: Settings },
  { id: 'invitations', label: 'Invitations', icon: UserPlus },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'login-providers', label: 'Login Providers', icon: KeyRound },
  { id: 'monitoring', label: 'Monitoring', icon: Monitor },
]

interface AdministrationViewProps {
  currentUserId: string
  onForceLogin: (message?: string) => void
}

export function AdministrationView({ currentUserId, onForceLogin }: AdministrationViewProps) {
  const [activeSection, setActiveSection] = useState<AdminSectionId>('users')
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false)

  // Server settings live in the shell because the user modals inherit the
  // default project limit from them.
  const serverSettings = useAdminServerSettings()

  const sectionRefs = useRef<Record<AdminSectionId, HTMLElement | null>>({
    users: null,
    server: null,
    invitations: null,
    email: null,
    'login-providers': null,
    monitoring: null,
  })

  useSectionObserver(sectionRefs, setActiveSection, {
    rootId: 'admin-main-scroll',
    getSectionId: (entry) => {
      const normalizedId = entry.target.id.replace('admin-section-', '')
      return normalizedId as AdminSectionId
    },
  })

  const scrollToSection = useCallback((sectionId: AdminSectionId) => {
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setSidebarDrawerOpen(false)
  }, [])

  const goToProjects = useCallback(() => {
    setSidebarDrawerOpen(false)
    navigateToProjects()
  }, [])

  const backToProjectsButton = (
    <BackToProjectsButton onClick={goToProjects} />
  )

  const sidebarContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 p-4">
        <div className="mb-4 text-xs uppercase tracking-wider text-cz-text-muted">Administration</div>
        <div className="relative ml-2 space-y-4 border-l border-cz-border pl-4">
          {adminSectionItems.map((item) => {
            const Icon = item.icon
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`relative flex items-center gap-2 text-sm ${active ? 'text-cz-text' : 'text-cz-text-muted hover:text-cz-text'}`}
              >
                <span
                  className={`absolute -left-[22px] h-2.5 w-2.5 rounded-full border ${active ? 'border-cz-accent bg-cz-accent' : 'border-cz-border bg-cz-surface'}`}
                />
                <Icon size={14} />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="border-t border-cz-border p-4">
        <button
          onClick={() => {
            setSidebarDrawerOpen(false)
            navigateToSettings()
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
        >
          <Settings size={14} />
          Settings
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-cz-bg text-cz-text">
      <SideDrawer
        open={sidebarDrawerOpen}
        onClose={() => setSidebarDrawerOpen(false)}
        ariaLabel="Administration navigation"
        title={backToProjectsButton}
      >
        {sidebarContent}
      </SideDrawer>

      <aside className="hidden w-72 flex-col border-r border-cz-border bg-cz-surface lg:flex">
        <div className="border-b border-cz-border p-4">
          {backToProjectsButton}
        </div>
        {sidebarContent}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileDrawerToolbar
          title="Administration"
          openLabel="Open administration navigation"
          onOpenDrawer={() => setSidebarDrawerOpen(true)}
        />

        <main id="admin-main-scroll" className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <UserManagementSection
              currentUserId={currentUserId}
              onForceLogin={onForceLogin}
              defaultProjectLimitMode={serverSettings.form.defaultProjectLimitMode}
              defaultProjectLimitValue={serverSettings.form.defaultProjectLimitValue}
              sectionRef={(node) => { sectionRefs.current.users = node }}
            />

            <ServerSettingsSection
              settings={serverSettings}
              sectionRef={(node) => { sectionRefs.current.server = node }}
            />

            <InvitationsSection
              sectionRef={(node) => { sectionRefs.current.invitations = node }}
            />

            <EmailSettingsSection
              sectionRef={(node) => { sectionRefs.current.email = node }}
            />

            <LoginProvidersSection
              sectionRef={(node) => { sectionRefs.current['login-providers'] = node }}
            />

            <MonitoringSection
              sectionRef={(node) => { sectionRefs.current.monitoring = node }}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
