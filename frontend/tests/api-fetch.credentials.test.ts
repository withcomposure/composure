import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiUrlMock, apiRequestCredentialsMock, fetchMock } = vi.hoisted(() => ({
  apiUrlMock: vi.fn((path: string) => path),
  apiRequestCredentialsMock: vi.fn<() => RequestCredentials>(() => 'same-origin'),
  fetchMock: vi.fn(),
}))

vi.mock('@/utils/api-routing', () => ({
  apiUrl: apiUrlMock,
  apiRequestCredentials: apiRequestCredentialsMock,
}))

import { apiFetch, fetchJson } from '../src/utils/fetch'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiFetch credentials', () => {
  beforeEach(() => {
    apiUrlMock.mockReset()
    apiUrlMock.mockImplementation((path: string) => path)
    apiRequestCredentialsMock.mockReset()
    apiRequestCredentialsMock.mockReturnValue('same-origin')
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('upgrades same-origin to include when API base is absolute', async () => {
    apiRequestCredentialsMock.mockReturnValue('include')

    await apiFetch('/auth/session', {
      method: 'GET',
      credentials: 'same-origin',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/session',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('uses same-origin for relative API base by default', async () => {
    await apiFetch('/auth/session', { method: 'GET' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/session',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
      }),
    )
  })

  it('preserves explicit omit credentials', async () => {
    apiRequestCredentialsMock.mockReturnValue('include')

    await apiFetch('/auth/session', {
      method: 'GET',
      credentials: 'omit',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/session',
      expect.objectContaining({
        credentials: 'omit',
      }),
    )
  })

  it('fetchJson also uses default API credential mode', async () => {
    apiRequestCredentialsMock.mockReturnValue('include')
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: true }))

    await fetchJson<{ authenticated: boolean }>('/auth/session')

    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/session',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })
})
