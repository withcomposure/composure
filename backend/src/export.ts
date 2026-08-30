import path from 'path'
import fs from 'fs'
import dns from 'dns'
import https from 'https'
import type net from 'net'
import { v4 as uuid } from 'uuid'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { isPrivateOrLocalHostname, isPrivateOrReservedAddress, isValidProjectId } from './security.js'
import { dispatchExport } from './compile-dispatch.js'
import { extractFiles } from './files.js'
import { findProjectById } from './db/index.js'

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
 * The hostname string check above is not enough on its own: an attacker's
 * domain can pass it and then resolve to 169.254.169.254 or 10.x when
 * git.push re-resolves DNS (rebinding). This lookup validates every address
 * a connection actually uses, at connect time, so a rebind fails closed.
 */
const validatingLookup = ((
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '')
      return
    }
    const list = addresses as dns.LookupAddress[]
    if (list.length === 0 || list.some((a) => isPrivateOrReservedAddress(a.address))) {
      const blockedErr: NodeJS.ErrnoException = new Error(
        `git remote ${hostname} resolves to a blocked address`,
      )
      blockedErr.code = 'ENOTFOUND'
      callback(blockedErr, '')
      return
    }
    if (options.all) {
      callback(null, list)
    } else {
      callback(null, list[0].address, list[0].family)
    }
  })
}) as net.LookupFunction

// https-only agent: a redirect that downgrades to http:// makes Node reject
// the protocol mismatch, which also fails closed.
const gitExportAgent = new https.Agent({ lookup: validatingLookup })

const gitExportHttp: typeof http = {
  request: (config) => http.request({ ...config, agent: gitExportAgent }),
}

/**
 * POST /api/v1/export/:projectId
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

  const project = await findProjectById(projectId)
  if (!project || project.deleted_at != null) {
    reply.status(404).send({ error: 'Project not found' })
    return
  }

  if (project.engine === 'excalidraw') {
    reply.status(400).send({
      error: 'Whiteboard projects support PNG/SVG export from the canvas and are not supported by this export endpoint.',
    })
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
  await git.push({ fs, dir, http: gitExportHttp, remote: 'origin', remoteRef: branch, force: true })

  reply.send({ success: true, branch })
}
