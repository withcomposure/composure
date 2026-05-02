import { apiUrl } from '@/utils/fetch'

export type OAuthIntent = 'login' | 'link'

export function oauthIntentUrl(provider: string, intent: OAuthIntent): string {
  const safeProvider = encodeURIComponent(provider)
  const endpointPath = `/auth/via/${safeProvider}/${intent}`

  if (typeof window === 'undefined') {
    return apiUrl(endpointPath)
  }

  return apiUrl(`${endpointPath}?return_to=${encodeURIComponent(window.location.href)}`)
}
