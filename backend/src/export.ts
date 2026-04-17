import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { isPrivateOrLocalHostname, isValidProjectId } from './security.js'
import { dispatchExport } from './compile-dispatch.js'
import { extractFiles } from './files.js'

const exportRoot = '/tmp/composure-export'

function validateGitRemote(remote: string): boolean {
  try {
    const url = new URL(remote)
    if (url.protocol !== 'https:') return false
    if (isPrivateOrLocalHostname(url.hostname)) return false
    return true
  } catch {
    return false
  }
}

/**
 * POST /api/export/:projectId
 * Handles:
 *   - { format: "git", remote: "https://github.com/...", branch: "composure" }
 *   - { format: "docx" | "html" }
 */
interface ExportParams {
  projectId: string
}

interface ExportBody {
  format?: 'git' | 'pdf' | 'docx' | 'html' | 'latex' | 'typst' | string
  remote?: string
  branch?: string
  rootFile?: string
  commitSha?: string
}

export async function exportRoute(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = req.params as ExportParams
  const body = (req.body ?? {}) as ExportBody
  const projectId = params.projectId as string
  const { format, remote, branch, rootFile, commitSha } = body

  if (!projectId || !isValidProjectId(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID' })
    return
  }

  if (!format) {
    reply.status(400).send({ error: 'format is required (git, pdf, docx, html, latex, typst)' })
    return
  }

  if (format === 'git') {
    const exportDir = path.join(exportRoot, uuid())
    fs.mkdirSync(exportDir, { recursive: true })
    try {
      await extractFiles(projectId, exportDir)
      await handleGitExport(exportDir, remote, branch ?? 'composure', reply)
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Export failed' })
    } finally {
      fs.rmSync(exportDir, { recursive: true, force: true })
    }
    return
  }

  const validFormats = ['pdf', 'docx', 'html', 'latex', 'typst']
  if (!validFormats.includes(format)) {
    reply.status(400).send({ error: `Unsupported format: ${format}` })
    return
  }

  // For historical exports, get doc state from git commit
  let documentUpdateBase64: string | undefined
  if (commitSha) {
    const { getDocStateAtCommit } = await import('./history.js')
    const docState = await getDocStateAtCommit(projectId, commitSha)
    if (docState) {
      documentUpdateBase64 = Buffer.from(docState).toString('base64')
    }
  }

  await dispatchExport({ projectId, rootFile: rootFile ?? 'main.tex', outputFormat: format, reply, req, documentUpdateBase64 })
}

/** Walk dir recursively, returning paths relative to base (skipping .git) */
function listFiles(dir: string, base: string = dir): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full, base))
    else files.push(path.relative(base, full))
  }
  return files
}

/** One-way Git export: init repo, commit, force-push to remote branch */
async function handleGitExport(
  dir: string,
  remote: string | undefined,
  branch: string,
  reply: FastifyReply,
): Promise<void> {
  if (!remote) {
    reply.status(400).send({ error: 'remote URL is required for git export' })
    return
  }

  if (!validateGitRemote(remote)) {
    reply.status(400).send({ error: 'remote must be a public https URL' })
    return
  }

  await git.init({ fs, dir })
  await git.setConfig({ fs, dir, path: 'user.email', value: 'composure@local' })
  await git.setConfig({ fs, dir, path: 'user.name', value: 'Composure Export' })
  for (const filepath of listFiles(dir)) {
    await git.add({ fs, dir, filepath })
  }
  await git.commit({
    fs,
    dir,
    author: { name: 'Composure Export', email: 'composure@local' },
    message: `Composure snapshot — ${new Date().toISOString()}`,
  })
  await git.addRemote({ fs, dir, remote: 'origin', url: remote })
  await git.push({ fs, dir, http, remote: 'origin', remoteRef: branch, force: true })

  reply.send({ success: true, branch })
}
