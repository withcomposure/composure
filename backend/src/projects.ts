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
  updateProjectMetadataDefaults,
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
import { hasLeadingDashSegment, isValidProjectId, normalizeRelativePath } from './security.js'
import { instantiateTemplateById, listProjectTemplates } from './templates.js'
import { assetStore } from './storage.js'
import * as Y from 'yjs'

function sanitizeRootFile(rootFile: unknown): string {
  const normalized = normalizeRelativePath(rootFile)
  if (!normalized || hasLeadingDashSegment(normalized)) return 'main.tex'
  return normalized
}

function sanitizeDefaultBibliographyFile(defaultBibliographyFile: unknown): string | null {
  return normalizeRelativePath(defaultBibliographyFile) ?? null
}

function sanitizeReferenceLookupFormat(raw: unknown): 'bibtex' | 'biblatex' {
  return String(raw ?? '').trim().toLowerCase() === 'biblatex' ? 'biblatex' : 'bibtex'
}

export async function listProjectsRoute(req: FastifyRequest): Promise<unknown> {
  const projects = await listProjectsForPrincipal(req.principal)
  return projects
}

export async function getProjectMetadataRoute(
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

  const project = await findProjectById(projectId)
  if (!project || project.deleted_at != null) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  reply.send({
    id: project.id,
    title: project.title,
    rootFile: project.root_file,
    defaultBibliographyFile: project.default_bibliography_file,
    referenceLookupFormat: project.reference_lookup_format,
    engine: project.engine,
  })
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
  defaultBibliographyFile?: string
  referenceLookupFormat?: string
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
  let defaultBibliographyFile = sanitizeDefaultBibliographyFile(req.body?.defaultBibliographyFile)
  const referenceLookupFormat = sanitizeReferenceLookupFormat(req.body?.referenceLookupFormat)
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
      if (!req.body?.defaultBibliographyFile) {
        defaultBibliographyFile = instantiated.defaultBibliographyFile
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
    defaultBibliographyFile,
    referenceLookupFormat,
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

interface PatchProjectMetadataBody {
  rootFile?: string | null
  defaultBibliographyFile?: string | null
  referenceLookupFormat?: string
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

export async function patchProjectMetadataRoute(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = (req.params ?? {}) as Partial<ProjectParams>
  const body = (req.body ?? {}) as PatchProjectMetadataBody
  const projectId = String(params.projectId ?? '')

  if (!isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  const hasRootFile = Object.prototype.hasOwnProperty.call(body, 'rootFile')
  const hasDefaultBibliographyFile = Object.prototype.hasOwnProperty.call(body, 'defaultBibliographyFile')
  const hasReferenceLookupFormat = Object.prototype.hasOwnProperty.call(body, 'referenceLookupFormat')

  if (!hasRootFile && !hasDefaultBibliographyFile && !hasReferenceLookupFormat) {
    reply.status(400).send({ error: 'No metadata fields supplied' })
    return
  }

  let normalizedRootFile: string | undefined
  if (hasRootFile) {
    if (body.rootFile == null) {
      normalizedRootFile = ''
    } else {
      const nextRootFile = normalizeRelativePath(body.rootFile)
      if (!nextRootFile || hasLeadingDashSegment(nextRootFile)) {
        reply.status(400).send({ error: 'Invalid rootFile path' })
        return
      }
      normalizedRootFile = nextRootFile
    }
  }

  let normalizedDefaultBibliographyFile: string | null | undefined
  if (hasDefaultBibliographyFile) {
    normalizedDefaultBibliographyFile = body.defaultBibliographyFile == null
      ? null
      : normalizeRelativePath(body.defaultBibliographyFile)
    if (body.defaultBibliographyFile != null && !normalizedDefaultBibliographyFile) {
      reply.status(400).send({ error: 'Invalid defaultBibliographyFile path' })
      return
    }
  }

  let normalizedReferenceLookupFormat: 'bibtex' | 'biblatex' | undefined
  if (hasReferenceLookupFormat) {
    if (typeof body.referenceLookupFormat !== 'string') {
      reply.status(400).send({ error: 'Invalid referenceLookupFormat value' })
      return
    }
    const nextReferenceLookupFormat = body.referenceLookupFormat.trim().toLowerCase()
    if (nextReferenceLookupFormat !== 'bibtex' && nextReferenceLookupFormat !== 'biblatex') {
      reply.status(400).send({ error: 'Invalid referenceLookupFormat value' })
      return
    }
    normalizedReferenceLookupFormat = nextReferenceLookupFormat
  }

  const access = await ensureProjectAccess(projectId, req.principal, false)
  if (!access.ok) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  const updated = await updateProjectMetadataDefaults({
    projectId,
    ...(hasRootFile ? { rootFile: normalizedRootFile } : {}),
    ...(hasDefaultBibliographyFile ? { defaultBibliographyFile: normalizedDefaultBibliographyFile } : {}),
    ...(hasReferenceLookupFormat ? { referenceLookupFormat: normalizedReferenceLookupFormat } : {}),
  })

  if (!updated) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  const project = await findProjectById(projectId)
  if (!project || project.deleted_at != null) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  reply.send({
    id: project.id,
    title: project.title,
    rootFile: project.root_file,
    defaultBibliographyFile: project.default_bibliography_file,
    referenceLookupFormat: project.reference_lookup_format,
    engine: project.engine,
  })
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

  const project = await findProjectById(projectId)
  if (!project || project.deleted_at != null) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  // Only the owner may trash a project; collaborators (even editors) cannot.
  const isOwner = req.principal.userId != null && project.owner_user_id === req.principal.userId
  if (!isOwner) {
    reply.status(403).send({ error: 'Forbidden' })
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
