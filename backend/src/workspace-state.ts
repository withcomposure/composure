import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  canAccessProjectWithRole,
  getProjectWorkspaceState,
  setProjectWorkspaceState,
} from './db/index.js'
import { isValidProjectId } from './security.js'
import { getShareTokenFromRequest } from './sharing.js'

interface ProjectParams {
  projectId: string
}

interface PatchWorkspaceStateBody {
  state?: unknown
}

export async function getProjectWorkspaceStateRoute(
  req: FastifyRequest<{ Params: ProjectParams }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const shareToken = getShareTokenFromRequest(req)
  const access = await canAccessProjectWithRole(projectId, req.principal, 'view', shareToken)
  if (!access.ok) {
    reply.status(403).send({ error: 'Forbidden' })
    return
  }

  const state = await getProjectWorkspaceState(projectId, req.principal)
  reply.send({ state })
}

export async function patchProjectWorkspaceStateRoute(
  req: FastifyRequest<{ Params: ProjectParams; Body: PatchWorkspaceStateBody }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const shareToken = getShareTokenFromRequest(req)
  const access = await canAccessProjectWithRole(projectId, req.principal, 'view', shareToken)
  if (!access.ok) {
    reply.status(403).send({ error: 'Forbidden' })
    return
  }

  if (!req.principal.userId && !req.principal.guestId) {
    reply.status(401).send({ error: 'Please create an account to continue.' })
    return
  }

  const state = req.body?.state
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    reply.status(400).send({ error: 'state must be an object' })
    return
  }

  await setProjectWorkspaceState(projectId, req.principal, state as Record<string, unknown>)
  reply.send({ ok: true })
}
