export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
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
