import type { RouteState } from '@/types'

export function isValidProjectId(id: string): boolean {
  return /^[a-f0-9]{32}$/.test(id)
}

function parseTokenRoute(pathname: string, query: URLSearchParams): RouteState | null {
  if (pathname === '/reset-password') {
    const token = query.get('token') ?? undefined
    if (token) return { kind: 'reset-password', token }
  }

  if (pathname === '/invite') {
    const token = query.get('token') ?? undefined
    if (token) return { kind: 'invite', token }
  }

  return null
}

export function parseRoute(): RouteState {
  const pathname = window.location.pathname || '/'
  const query = new URLSearchParams(window.location.search)

  const tokenRoute = parseTokenRoute(pathname, query)
  if (tokenRoute) {
    return tokenRoute
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/projects') {
    return { kind: 'projects' }
  }

  if (pathname === '/settings' || pathname === '/account') {
    return { kind: 'settings' }
  }

  if (pathname === '/admin') {
    return { kind: 'admin' }
  }

  const projectMatch = pathname.match(/^\/project\/([a-f0-9]{32})$/)
  if (projectMatch) {
    const shareToken = query.get('share') ?? undefined
    return { kind: 'project', projectId: projectMatch[1], shareToken }
  }

  return { kind: 'not-found', path: pathname }
}

function dispatchRouteChange(): void {
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function navigateToProjects(): void {
  history.pushState(null, '', '/')
  dispatchRouteChange()
}

export function navigateToSettings(): void {
  history.pushState(null, '', '/settings')
  dispatchRouteChange()
}

export function navigateToAdmin(): void {
  history.pushState(null, '', '/admin')
  dispatchRouteChange()
}

export function navigateToProject(projectId: string, shareToken?: string): void {
  history.pushState(null, '', makeProjectUrl(projectId, shareToken))
  dispatchRouteChange()
}

export function makeProjectUrl(projectId: string, shareToken?: string): string {
  if (!shareToken) {
    return `/project/${projectId}`
  }
  return `/project/${projectId}?share=${encodeURIComponent(shareToken)}`
}
