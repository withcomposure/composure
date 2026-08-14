/** Single source of truth for login-provider display names. */
export const PROVIDER_LABELS: Record<string, string> = {
  password: 'Password',
  passkey: 'Passkey',
  github: 'GitHub',
  google: 'Google',
  orcid: 'ORCID',
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}
