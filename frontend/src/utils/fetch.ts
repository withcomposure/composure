const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined
const apiBaseUrl = configuredApiUrl?.trim().replace(/\/+$/, '') ?? ''

export function apiUrl(path: string): string {
  if (!apiBaseUrl || /^https?:\/\//i.test(path)) {
    return path
  }

  return path.startsWith('/') ? `${apiBaseUrl}${path}` : `${apiBaseUrl}/${path}`
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(apiUrl(path), init)
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    credentials: 'same-origin',
    ...init,
  })

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
