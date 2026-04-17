import { apiRequestCredentials, apiUrl } from '@/utils/api-routing'

export { apiUrl }

function resolveRequestCredentials(requested: RequestCredentials | undefined): RequestCredentials {
  if (requested === 'include' || requested === 'omit') {
    return requested
  }

  // Treat implicit same-origin requests as credentialed when API base is absolute.
  return apiRequestCredentials()
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(apiUrl(path), {
    ...init,
    credentials: resolveRequestCredentials(init?.credentials),
  })
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init)

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'Request failed' }))) as {
      error?: string
    }
    throw new Error(String(body.error ?? 'Request failed'))
  }

  return (await res.json()) as T
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
