import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  canAccessProjectWithRole,
  clearRecentProjectsForPrincipal,
  countProjectsOwnedByUser,
  createProjectForPrincipal,
  getMaxProjectsPerUser,
  getTrashRetentionDays,
  getUserMaxProjects,
  listRecentProjectsForPrincipal,
  listProjectsForPrincipal,
  listTrashForPrincipal,
  recordRecentProjectOpen,
  renameProject,
  storeDocument,
  softDeleteProject,
  restoreProject,
  permanentDeleteProject,
  touchProjectActivity,
  ensureProjectAccess,
  findProjectById,
} from './db/index.js'
import { getShareTokenFromRequest } from './sharing.js'
import { createUid } from './ids.js'
import { isValidProjectId, normalizeRelativePath } from './security.js'
import { instantiateTemplateById, listProjectTemplates } from './templates.js'
import { assetStore } from './storage.js'
import * as Y from 'yjs'

function sanitizeRootFile(rootFile: unknown): string {
  return normalizeRelativePath(rootFile) ?? 'main.tex'
}

export async function listProjectsRoute(req: FastifyRequest): Promise<unknown> {
  const projects = await listProjectsForPrincipal(req.principal)
  return projects
}

export async function listRecentProjectsRoute(req: FastifyRequest): Promise<unknown> {
  return await listRecentProjectsForPrincipal(req.principal)
}

export async function clearRecentProjectsRoute(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await clearRecentProjectsForPrincipal(req.principal)
  reply.send({ ok: true })
}

export async function markProjectOpenedRoute(
  req: FastifyRequest<{ Params: { projectId: string } }>,
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

  await recordRecentProjectOpen(req.principal, projectId, shareToken)
  await touchProjectActivity(projectId)
  reply.send({ ok: true })
}

interface CreateProjectBody {
  title?: string
  rootFile?: string
  templateId?: string
}

function buildDocumentState(files: Record<string, string>): Uint8Array {
  const doc = new Y.Doc()
  try {
    const fileMap = doc.getMap<string>('files')
    const paths = Object.keys(files).sort()
    for (const filePath of paths) {
      const content = files[filePath] ?? ''
      fileMap.set(filePath, JSON.stringify({ type: 'text' }))
      const text = doc.getText(`file:${filePath}`)
      text.insert(0, content)
    }
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

export async function createProjectRoute(
  req: FastifyRequest<{ Body: CreateProjectBody }>,
  reply: FastifyReply,
): Promise<void> {
  if (!req.principal.userId) {
    reply.status(401).send({ error: 'Please create an account to continue.' })
    return
  }

  // Enforce per-user project limit for authenticated users
  if (req.principal.userId) {
    const userOverride = await getUserMaxProjects(req.principal.userId)
    const effectiveLimit = userOverride != null ? (userOverride === 0 ? 'unlimited' : String(userOverride)) : await getMaxProjectsPerUser()
    if (effectiveLimit !== 'unlimited') {
      const max = Number.parseInt(effectiveLimit, 10)
      const current = await countProjectsOwnedByUser(req.principal.userId)
      if (current >= max) {
        reply.status(403).send({ error: `Project limit reached (${max}). Contact a server administrator.` })
        return
      }
    }
  }

  const projectId = createUid()
  const title = String(req.body?.title ?? '').trim() || 'Untitled'
  const templateId = String(req.body?.templateId ?? '').trim()

  let rootFile = sanitizeRootFile(req.body?.rootFile)
  let templateFiles: Record<string, string> | null = null
  let engine: string | null = null

  if (templateId) {
    try {
      const instantiated = instantiateTemplateById(templateId)
      templateFiles = instantiated.files
      engine = instantiated.engine
      if (!req.body?.rootFile) {
        rootFile = sanitizeRootFile(instantiated.rootFile)
      }
    } catch {
      reply.status(400).send({ error: 'Unknown template ID' })
      return
    }
  }

  const project = await createProjectForPrincipal({
    projectId,
    principal: req.principal,
    title,
    rootFile,
    engine,
  })

  if (templateFiles) {
    const update = buildDocumentState(templateFiles)
    await storeDocument(projectId, Buffer.from(update))
  }

  reply.status(201).send(project)
}

export function listTemplatesRoute(_req: FastifyRequest, reply: FastifyReply): void {
  try {
    const templates = listProjectTemplates()
    reply.send({ templates })
  } catch (err) {
    console.error(`[templates] load-failed ${String(err)}`)
    reply.status(500).send({ error: 'Failed to load templates' })
  }
}

interface ProjectParams {
  projectId: string
}

interface RenameProjectBody {
  title?: string
}

export async function renameProjectRoute(
  req: FastifyRequest<{ Params: ProjectParams; Body: RenameProjectBody }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')
  const title = String(req.body?.title ?? '').trim()

  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  if (!title) {
    reply.status(400).send({ error: 'title is required' })
    return
  }

  const access = await ensureProjectAccess(projectId, req.principal, false)
  if (!access.ok) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  await renameProject(projectId, title)
  await touchProjectActivity(projectId)

  reply.send({ ok: true })
}

export async function deleteProjectRoute(
  req: FastifyRequest<{ Params: ProjectParams }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')

  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const access = await ensureProjectAccess(projectId, req.principal, false)
  if (!access.ok) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  await softDeleteProject(projectId)
  reply.send({ ok: true })
}

export async function listTrashRoute(req: FastifyRequest): Promise<unknown> {
  return {
    projects: await listTrashForPrincipal(req.principal),
    retentionDays: await getTrashRetentionDays(),
  }
}

export async function restoreProjectRoute(
  req: FastifyRequest<{ Params: ProjectParams }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')

  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const project = await findProjectById(projectId)
  if (!project || project.deleted_at == null) {
    reply.status(404).send({ error: 'Project not found in trash' })
    return
  }

  // Only owner can restore
  const isOwner = req.principal.userId != null && project.owner_user_id === req.principal.userId
  if (!isOwner) {
    reply.status(403).send({ error: 'Forbidden' })
    return
  }

  await restoreProject(projectId)
  reply.send({ ok: true })
}

export async function permanentDeleteProjectRoute(
  req: FastifyRequest<{ Params: ProjectParams }>,
  reply: FastifyReply,
): Promise<void> {
  const projectId = String(req.params.projectId ?? '')

  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const project = await findProjectById(projectId)
  if (!project || project.deleted_at == null) {
    reply.status(404).send({ error: 'Project not found in trash' })
    return
  }

  const isOwner = req.principal.userId != null && project.owner_user_id === req.principal.userId
  if (!isOwner) {
    reply.status(403).send({ error: 'Forbidden' })
    return
  }

  await permanentDeleteProject(projectId)
  assetStore.deleteProject(projectId)
  reply.send({ ok: true })
}
