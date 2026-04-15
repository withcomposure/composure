import type { ProjectRole } from './types.js'

export const ROLE_RANK: Record<ProjectRole, number> = {
  view: 1,
  comment: 2,
  edit: 3,
  owner: 4,
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

export function guestDisplayName(guestId: string | null | undefined): string {
  const normalized = String(guestId ?? '').trim()
  if (!normalized) return 'Guest'
  return `Guest ${normalized.slice(0, 8)}`
}

export function guestIdLabel(guestId: string | null | undefined): string {
  const normalized = String(guestId ?? '').trim()
  if (!normalized) return 'Guest ID: unknown'
  return `Guest ID: ${normalized}`
}

export function normalizeTitle(title: string | undefined): string {
  const raw = (title ?? '').trim()
  if (!raw) return 'Untitled'
  return raw.slice(0, 120)
}
