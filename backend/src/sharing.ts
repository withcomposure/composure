import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  addProjectComment,
  canPrincipalModifyComment,
  canAccessProjectChat,
  canAccessProjectWithRole,
  deleteProjectComment,
  getProjectCommentById,
  getProjectRoleForPrincipal,
  findProjectById,
  getChatHistoryRetentionDays,
  getLargeFileThresholdChars,
  getLinkSharingState,
  getMaxTextFileSize,
  listPeopleWithAccess,
  listProjectComments,
  listSharedProjectsForUser,
  listLinkSharedProjectsForPrincipal,
  removePendingProjectMemberInvite,
  removeProjectMember,
  setLinkSharingState,
  touchProjectActivity,
  type Principal,
  type ProjectRole,
  updateProjectCommentBody,
  updatePendingProjectMemberInviteRole,
  updateProjectMemberRole,
  upsertProjectMemberInvite,
} from './db/index.js'
import { isValidEmail, isValidProjectId, isValidUserId, normalizeRole } from './security.js'

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const rounded = Math.floor(value)
  return rounded > 0 ? rounded : null
}

interface ShareTokenQuery {
  share?: string
}

export function getShareTokenFromRequest(req: FastifyRequest): string | undefined {
  const headerValueRaw = req.headers['x-share-token']
  const headerValue = typeof headerValueRaw === 'string' ? headerValueRaw : undefined
  const query = req.query as ShareTokenQuery | undefined
  const queryValue = typeof query?.share === 'string' ? query.share : undefined
  return headerValue ?? queryValue
}

async function requireRole(
  req: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
  requiredRole: ProjectRole,
  principal: Principal,
): Promise<boolean> {
  const access = await canAccessProjectWithRole(projectId, principal, requiredRole)
  if (!access.ok) {
    reply.status(403).send({ error: 'Forbidden' })
    return false
  }

  await touchProjectActivity(projectId)
  return true
}

interface ProjectParams {
  projectId: string
}

interface ProjectMemberParams extends ProjectParams {
  userId: string
}

interface ProjectCommentParams extends ProjectParams {
  commentId: string
}

interface InviteProjectMemberBody {
  email?: string
  role?: string
}

interface PatchProjectMemberBody {
  remove?: boolean
  role?: string
}

interface PatchLinkSharingBody {
  enabled?: boolean
  role?: string
  invalidate?: boolean
}

interface CommentsQuery extends ShareTokenQuery {
  filePath?: string
}

interface AddCommentBody {
  filePath?: string
  startLine?: number
  endLine?: number
  parentCommentId?: string | null
  body?: string
}

interface UpdateCommentBody {
  body?: string
}

export async function getProjectAccessRoute(
  req: FastifyRequest<{ Params: ProjectParams; Querystring: ShareTokenQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  if (!(await requireRole(req, reply, projectId, 'view', req.principal))) {
    return
  }

  const currentRole = await getProjectRoleForPrincipal(projectId, req.principal)
  const canViewChat = (await canAccessProjectChat(projectId, req.principal)).ok
  const requestingIdentityId = req.principal.userId ?? req.principal.guestId
  if (!requestingIdentityId) {
    reply.status(401).send({ error: 'Sign in to view project access details' })
    return
  }

  // Viewers and commenters can see display names but not emails
  const people = await listPeopleWithAccess({
    projectId,
    requestingIdentityId,
    includeEmails: currentRole != null && currentRole !== 'view' && currentRole !== 'comment',
  })
  const linkSharing = await getLinkSharingState(projectId)

  reply.send({
    people,
    linkSharing,
    currentRole,
    canViewChat,
    maxTextFileSizeBytes: await getMaxTextFileSize(),
    largeFileThresholdChars: await getLargeFileThresholdChars(),
    chatHistoryRetentionDays: await getChatHistoryRetentionDays(),
  })
}

export async function inviteProjectMemberRoute(
  req: FastifyRequest<{ Params: ProjectParams; Body: InviteProjectMemberBody }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const userId = req.principal.userId
  if (!req.authUser || !userId) {
    reply.status(401).send({ error: 'Sign in to manage sharing' })
    return
  }

  if (!(await requireRole(req, reply, projectId, 'owner', req.principal))) {
    return
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const role = normalizeRole(req.body?.role)

  if (!email || !isValidEmail(email)) {
    reply.status(400).send({ error: 'Valid email is required' })
    return
  }

  const invite = await upsertProjectMemberInvite({
    projectId,
    requestingUserId: userId,
    invitedByUserId: userId,
    email,
    role,
  })

  reply.status(201).send({
    ok: true,
    status: invite.status,
    userId: invite.userId,
  })
}

export async function patchProjectMemberRoute(
  req: FastifyRequest<{ Params: ProjectMemberParams; Body: PatchProjectMemberBody }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  const memberId = String(req.params.userId ?? '').trim()

  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const targetUserId = isValidUserId(memberId) ? memberId : null
  const targetEmail = targetUserId == null ? memberId.toLowerCase() : null

  if (targetUserId == null && (targetEmail == null || !isValidEmail(targetEmail))) {
    reply.status(400).send({ error: 'Invalid member identifier' })
    return
  }

  if (!req.authUser || !req.principal.userId) {
    reply.status(401).send({ error: 'Sign in to manage sharing' })
    return
  }

  if (!(await requireRole(req, reply, projectId, 'owner', req.principal))) {
    return
  }

  const project = await findProjectById(projectId)
  if (!project || project.deleted_at != null) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  const remove = Boolean(req.body?.remove)
  if (targetUserId == null) {
    if (targetEmail == null) {
      reply.status(400).send({ error: 'Invalid member identifier' })
      return
    }

    if (remove) {
      const ok = await removePendingProjectMemberInvite(projectId, targetEmail)
      if (!ok) {
        reply.status(404).send({ error: 'Member not found' })
        return
      }

      reply.send({ ok: true })
      return
    }

    const role = normalizeRole(req.body?.role)
    const ok = await updatePendingProjectMemberInviteRole(projectId, targetEmail, role)
    if (!ok) {
      reply.status(404).send({ error: 'Member not found' })
      return
    }

    reply.send({ ok: true })
    return
  }

  if (project.owner_user_id === targetUserId) {
    reply.status(400).send({ error: 'Project owner access cannot be changed' })
    return
  }

  if (remove) {
    const ok = await removeProjectMember(projectId, targetUserId)
    if (!ok) {
      reply.status(404).send({ error: 'Member not found' })
      return
    }

    reply.send({ ok: true })
    return
  }

  const role = normalizeRole(req.body?.role)
  const ok = await updateProjectMemberRole(projectId, targetUserId, role)
  if (!ok) {
    reply.status(404).send({ error: 'Member not found' })
    return
  }

  reply.send({ ok: true })
}

export async function patchProjectLinkSharingRoute(
  req: FastifyRequest<{ Params: ProjectParams; Body: PatchLinkSharingBody }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  if (!req.authUser || !req.principal.userId) {
    reply.status(401).send({ error: 'Sign in to manage link sharing' })
    return
  }

  if (!(await requireRole(req, reply, projectId, 'owner', req.principal))) {
    return
  }

  const currentState = await getLinkSharingState(projectId)
  const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : currentState.enabled
  const role = req.body?.role !== undefined
    ? normalizeRole(req.body.role)
    : (currentState.role ?? 'view')
  const invalidate = Boolean(req.body?.invalidate)

  const state = await setLinkSharingState({
    projectId,
    enabled,
    role,
    actorUserId: req.principal.userId,
    invalidate,
  })

  reply.send(state)
}

export async function listProjectCommentsRoute(
  req: FastifyRequest<{ Params: ProjectParams; Querystring: CommentsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  if (!(await requireRole(req, reply, projectId, 'view', req.principal))) {
    return
  }

  const filePath = typeof req.query.filePath === 'string' ? req.query.filePath : undefined
  const comments = await listProjectComments(projectId, filePath)
  reply.send(comments)
}

export async function addProjectCommentRoute(
  req: FastifyRequest<{ Params: ProjectParams; Querystring: ShareTokenQuery; Body: AddCommentBody }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  if (!(await requireRole(req, reply, projectId, 'comment', req.principal))) {
    return
  }

  if (!req.principal.userId) {
    reply.status(401).send({ error: 'Please create an account to comment.' })
    return
  }

  const filePath = String(req.body?.filePath ?? '').trim()
  const startLine = normalizePositiveInt(req.body?.startLine)
  const endLine = normalizePositiveInt(req.body?.endLine)
  const parentCommentId = typeof req.body?.parentCommentId === 'string'
    ? req.body.parentCommentId.trim()
    : null
  const body = String(req.body?.body ?? '').trim()

  if (!filePath) {
    reply.status(400).send({ error: 'filePath is required' })
    return
  }

  if (!body) {
    reply.status(400).send({ error: 'body is required' })
    return
  }

  let created
  try {
    created = await addProjectComment({
      projectId,
      filePath,
      startLine,
      endLine,
      parentCommentId,
      body,
      principal: req.principal,
    })
  } catch (error) {
    reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create comment' })
    return
  }

  reply.status(201).send(created)
}

export async function patchProjectCommentRoute(
  req: FastifyRequest<{ Params: ProjectCommentParams; Querystring: ShareTokenQuery; Body: UpdateCommentBody }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  const commentId = String(req.params.commentId ?? '')

  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  if (!(await requireRole(req, reply, projectId, 'comment', req.principal))) {
    return
  }

  const comment = await getProjectCommentById(projectId, commentId)
  if (!comment) {
    reply.status(404).send({ error: 'Comment not found' })
    return
  }

  const ownerAccess = await canAccessProjectWithRole(projectId, req.principal, 'owner')
  if (!canPrincipalModifyComment(comment, req.principal) && !ownerAccess.ok) {
    reply.status(403).send({ error: 'Only the author or project owner can edit this comment' })
    return
  }

  const body = String(req.body?.body ?? '').trim()
  if (!body) {
    reply.status(400).send({ error: 'body is required' })
    return
  }

  const updated = await updateProjectCommentBody({
    projectId,
    commentId,
    body,
  })

  if (!updated) {
    reply.status(500).send({ error: 'Failed to update comment' })
    return
  }

  reply.send(updated)
}

export async function deleteProjectCommentRoute(
  req: FastifyRequest<{ Params: ProjectCommentParams; Querystring: ShareTokenQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  const commentId = String(req.params.commentId ?? '')

  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  if (!(await requireRole(req, reply, projectId, 'comment', req.principal))) {
    return
  }

  const comment = await getProjectCommentById(projectId, commentId)
  if (!comment) {
    reply.status(404).send({ error: 'Comment not found' })
    return
  }

  const ownerAccess = await canAccessProjectWithRole(projectId, req.principal, 'owner')
  if (!canPrincipalModifyComment(comment, req.principal) && !ownerAccess.ok) {
    reply.status(403).send({ error: 'Only the author or project owner can delete this comment' })
    return
  }

  const deleted = await deleteProjectComment(projectId, commentId)
  if (!deleted) {
    reply.status(500).send({ error: 'Failed to delete comment' })
    return
  }

  reply.send({ ok: true })
}

export async function sharedWithMeRoute(req: FastifyRequest): Promise<unknown[]> {
  const userId = req.principal.userId
  if (!userId) {
    return []
  }

  const memberShared = await listSharedProjectsForUser(userId)
  const linkShared = await listLinkSharedProjectsForPrincipal(req.principal)

  // Merge, deduplicating by project id (member-shared takes precedence)
  const seenIds = new Set(memberShared.map((p) => p.id))
  const merged = [...memberShared]
  for (const project of linkShared) {
    if (!seenIds.has(project.id)) {
      merged.push(project)
      seenIds.add(project.id)
    }
  }

  return merged
}
