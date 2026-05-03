import { apiUrl } from '@/utils/fetch'

export type OAuthIntent = 'login' | 'link'

export function oauthIntentUrl(
  provider: string,
  intent: OAuthIntent,
  options?: { inviteToken?: string },
): string {
  const safeProvider = encodeURIComponent(provider)
  const endpointPath = `/auth/via/${safeProvider}/${intent}`

  if (typeof window === 'undefined') {
    return apiUrl(endpointPath)
  }

  const query = new URLSearchParams({
    return_to: window.location.href,
  })
  const inviteToken = options?.inviteToken?.trim()
  if (inviteToken) {
    query.set('invite_token', inviteToken)
  }
  return apiUrl(`${endpointPath}?${query.toString()}`)
}
