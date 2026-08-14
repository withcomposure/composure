import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import type { AuthSession } from '@/types'
import { fetchJson } from '@/utils/fetch'

/** True when the user dismissed the browser's passkey prompt rather than hitting a real error. */
export function isPasskeyCancellation(err: unknown): boolean {
  return err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError')
}

/** Register a new passkey for the currently authenticated user. */
export async function registerPasskey(): Promise<void> {
  const { options, token } = await fetchJson<{
    options: PublicKeyCredentialCreationOptionsJSON
    token: string
  }>('/auth/passkey/register/options', { method: 'POST' })

  const response = await startRegistration({ optionsJSON: options })

  await fetchJson<{ ok: boolean }>('/auth/passkey/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, response }),
  })
}

/** Run the passkey login ceremony and return the new session. */
export async function loginWithPasskey(): Promise<AuthSession> {
  const { options, token } = await fetchJson<{
    options: PublicKeyCredentialRequestOptionsJSON
    token: string
  }>('/auth/passkey/login/options', { method: 'POST' })

  const response = await startAuthentication({ optionsJSON: options })

  return await fetchJson<AuthSession>('/auth/passkey/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, response }),
  })
}
