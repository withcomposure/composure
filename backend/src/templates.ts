import fs from 'fs'
import path from 'path'
import { isPathWithin, normalizeRelativePath } from './security.js'

type TemplateEngine = 'latex' | 'typst' | 'markdown' | 'asciidoc'

interface TemplateFileSpec {
  path: string
  source: string
}

interface TemplateDefinition {
  id: string
  name: string
  description: string
  engine: TemplateEngine
  category: string
  tags: string[]
  entrypoint: string
  isBlank: boolean
  files: TemplateFileSpec[]
}

interface RawTemplateDefinition {
  id?: unknown
  name?: unknown
  description?: unknown
  engine?: unknown
  category?: unknown
  tags?: unknown
  entrypoint?: unknown
  isBlank?: unknown
  files?: unknown
}

interface RawTemplateFileSpec {
  path?: unknown
  source?: unknown
}

interface RawTemplateManifest {
  templates?: unknown
}

export interface ProjectTemplateSummary {
  id: string
  name: string
  description: string
  engine: TemplateEngine
  category: string
  tags: string[]
  entrypoint: string
  isBlank: boolean
}

export interface InstantiatedTemplate {
  id: string
  name: string
  engine: TemplateEngine
  rootFile: string
  files: Record<string, string>
}

function resolveTemplatesRoot(): string {
  const envPath = process.env.TEMPLATES_DIR?.trim()
  const candidates = [
    envPath ? path.resolve(envPath) : null,
    path.resolve(process.cwd(), 'templates'),
    path.resolve(import.meta.dirname, '../../templates'),
    path.resolve(import.meta.dirname, '../../../templates'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const indexPath = path.join(candidate, 'index.json')
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return candidate
    }
  }

  throw new Error('Could not locate templates/index.json')
}

const templatesRoot = resolveTemplatesRoot()
const templatesIndexPath = path.join(templatesRoot, 'index.json')

function normalizeEngine(raw: unknown): TemplateEngine | null {
  if (raw === 'latex' || raw === 'typst' || raw === 'markdown' || raw === 'asciidoc') {
    return raw
  }
  return null
}

function readTemplatesManifest(): RawTemplateManifest {
  const raw = fs.readFileSync(templatesIndexPath, 'utf8')
  return JSON.parse(raw) as RawTemplateManifest
}

function normalizeTemplateFiles(rawFiles: unknown): TemplateFileSpec[] {
  if (!Array.isArray(rawFiles)) {
    return []
  }

  const normalized: TemplateFileSpec[] = []
  const seen = new Set<string>()

  for (const entry of rawFiles) {
    const file = entry as RawTemplateFileSpec
    const targetPath = normalizeRelativePath(String(file.path ?? ''))
    if (!targetPath || seen.has(targetPath)) {
      continue
    }

    const sourceCandidate = normalizeRelativePath(String(file.source ?? targetPath))
    if (!sourceCandidate) {
      continue
    }

    seen.add(targetPath)
    normalized.push({
      path: targetPath,
      source: sourceCandidate,
    })
  }

  return normalized
}

function normalizeTemplateDefinition(raw: RawTemplateDefinition): TemplateDefinition | null {
  const id = String(raw.id ?? '').trim()
  const name = String(raw.name ?? '').trim()
  const description = String(raw.description ?? '').trim()
  const engine = normalizeEngine(raw.engine)
  const category = String(raw.category ?? '').trim().toLowerCase()
  const tags = Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
  const entrypoint = normalizeRelativePath(String(raw.entrypoint ?? ''))
  const files = normalizeTemplateFiles(raw.files)
  const isBlank = Boolean(raw.isBlank)

  if (!id || !name || !engine || !category || !entrypoint || files.length === 0) {
    return null
  }

  if (!files.some((file) => file.path === entrypoint)) {
    return null
  }

  return {
    id,
    name,
    description,
    engine,
    category,
    tags,
    entrypoint,
    isBlank,
    files,
  }
}

function loadTemplateDefinitions(): TemplateDefinition[] {
  const manifest = readTemplatesManifest()
  const rawTemplates = Array.isArray(manifest.templates) ? manifest.templates : []
  const templates: TemplateDefinition[] = []

  for (const rawTemplate of rawTemplates) {
    const normalized = normalizeTemplateDefinition(rawTemplate as RawTemplateDefinition)
    if (normalized) {
      templates.push(normalized)
    }
  }

  return templates
}

function resolveTemplateSourceFile(relativeSourcePath: string): string {
  const sourcePath = path.resolve(templatesRoot, relativeSourcePath)
  if (!isPathWithin(templatesRoot, sourcePath)) {
    throw new Error(`Template source path is not allowed: ${relativeSourcePath}`)
  }

  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Template source file missing: ${relativeSourcePath}`)
  }

  return sourcePath
}

export function listProjectTemplates(): ProjectTemplateSummary[] {
  return loadTemplateDefinitions().map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    engine: template.engine,
    category: template.category,
    tags: template.tags,
    entrypoint: template.entrypoint,
    isBlank: template.isBlank,
  }))
}

export function instantiateTemplateById(templateId: string): InstantiatedTemplate {
  const templates = loadTemplateDefinitions()
  const template = templates.find((candidate) => candidate.id === templateId)

  if (!template) {
    throw new Error(`Unknown template: ${templateId}`)
  }

  const files: Record<string, string> = {}
  for (const file of template.files) {
    const sourcePath = resolveTemplateSourceFile(file.source)
    files[file.path] = fs.readFileSync(sourcePath, 'utf8')
  }

  return {
    id: template.id,
    name: template.name,
    engine: template.engine,
    rootFile: template.entrypoint,
    files,
  }
}
