import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { projectFormatLabel } from '@/utils/project-format'
import type { ProjectTemplate } from '@/types'

interface TemplateGalleryProps {
  templates: ProjectTemplate[]
  loading: boolean
  error: string | null
  creating: boolean
  onClose: () => void
  onCreate: (selection: { templateId: string; title: string }) => void
}

function categoryLabel(category: string): string {
  if (category === 'academic') return 'Academic'
  if (category === 'professional') return 'Professional'
  if (category === 'presentation') return 'Presentation'
  if (category === 'minimal') return 'Minimal'
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function sortTemplates(templates: ProjectTemplate[]): ProjectTemplate[] {
  return [...templates].sort((a, b) => {
    if (a.isBlank !== b.isBlank) {
      return a.isBlank ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

export function TemplateGallery({ templates, loading, error, creating, onClose, onCreate }: TemplateGalleryProps) {
  const availableEngines = useMemo(() => {
    const types = new Set<ProjectTemplate['engine']>(templates.map((template) => template.engine))
    const ordered: ProjectTemplate['engine'][] = []
    if (types.has('latex')) ordered.push('latex')
    if (types.has('typst')) ordered.push('typst')
    if (types.has('markdown')) ordered.push('markdown')
    if (types.has('asciidoc')) ordered.push('asciidoc')
    return ordered
  }, [templates])

  const [engine, setEngine] = useState<ProjectTemplate['engine']>('latex')
  const [category, setCategory] = useState<string>('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [title, setTitle] = useState('Untitled')

  const activeEngine = useMemo<ProjectTemplate['engine']>(() => {
    if (availableEngines.includes(engine)) {
      return engine
    }
    return availableEngines[0] ?? 'latex'
  }, [availableEngines, engine])

  const templatesForEngine = useMemo(
    () => sortTemplates(templates.filter((template) => template.engine === activeEngine)),
    [templates, activeEngine],
  )

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const template of templatesForEngine) {
      if (!seen.has(template.category)) {
        seen.add(template.category)
        ordered.push(template.category)
      }
    }
    return ordered
  }, [templatesForEngine])

  const activeCategory = useMemo<string>(() => {
    if (category && categories.includes(category)) {
      return category
    }
    return categories[0] ?? ''
  }, [categories, category])

  const visibleTemplates = useMemo(
    () => sortTemplates(templatesForEngine.filter((template) => template.category === activeCategory)),
    [templatesForEngine, activeCategory],
  )

  const activeSelectedTemplateId = useMemo(() => {
    const selectedTemplate = visibleTemplates.find((template) => template.id === selectedTemplateId)
    if (selectedTemplate) {
      return selectedTemplateId
    }
    return visibleTemplates[0]?.id ?? ''
  }, [visibleTemplates, selectedTemplateId])

  const selectedTemplate = useMemo(
    () => visibleTemplates.find((template) => template.id === activeSelectedTemplateId) ?? null,
    [visibleTemplates, activeSelectedTemplateId],
  )

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-4xl rounded-xl border border-cz-border bg-cz-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-cz-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-cz-text">New project from template</h2>
            <p className="mt-0.5 text-xs text-cz-text-muted">Choose an engine, then a category, then a template.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close template gallery"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-cz-border px-6 py-3">
          <div className="inline-flex rounded-md border border-cz-border bg-cz-bg p-1">
            {availableEngines.map((value) => (
              <button
                key={value}
                onClick={() => setEngine(value)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  value === activeEngine
                    ? 'bg-cz-accent text-white'
                    : 'text-cz-text-muted hover:bg-cz-surface-hover'
                }`}
              >
                {projectFormatLabel(value)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[220px_1fr] gap-4 p-6">
          <div className="rounded-lg border border-cz-border bg-cz-bg/40 p-2">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-cz-text-muted">Categories</div>
            <div className="mt-1 space-y-1">
              {categories.map((value) => (
                <button
                  key={value}
                  onClick={() => setCategory(value)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    value === activeCategory
                      ? 'bg-cz-accent-muted text-cz-accent'
                      : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'
                  }`}
                >
                  {categoryLabel(value)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="rounded-lg border border-cz-border px-4 py-8 text-sm text-cz-text-muted">Loading templates...</div>
            ) : error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
            ) : visibleTemplates.length === 0 ? (
              <div className="rounded-lg border border-cz-border px-4 py-8 text-sm text-cz-text-muted">No templates in this category.</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {visibleTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      setSelectedTemplateId(template.id)
                      setTitle(template.name)
                    }}
                    className={`rounded-lg border p-4 text-left transition-all ${
                      template.id === activeSelectedTemplateId
                        ? 'border-cz-accent bg-cz-accent-muted'
                        : 'border-cz-border hover:border-cz-accent/40 hover:bg-cz-accent-muted'
                    }`}
                  >
                    <div className="mb-1 text-sm font-medium text-cz-text">{template.name}</div>
                    <p className="text-[11px] text-cz-text-muted">{template.description}</p>
                    <div className="mt-2 text-[10px] uppercase tracking-wider text-cz-text-muted">
                      {template.isBlank ? 'Blank starter' : categoryLabel(template.category)}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-cz-border bg-cz-bg/40 p-3">
              <label className="mb-1 block text-xs text-cz-text-muted">Project title</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={!selectedTemplate || creating}
                className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent disabled:opacity-60"
              />
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => {
                    if (!selectedTemplate) return
                    const normalizedTitle = title.trim() || selectedTemplate.name || 'Untitled'
                    onCreate({ templateId: selectedTemplate.id, title: normalizedTitle })
                  }}
                  disabled={!selectedTemplate || creating}
                  className="rounded-md bg-cz-accent px-3 py-2 text-sm font-medium text-white hover:bg-cz-accent-hover disabled:opacity-70"
                >
                  {creating ? 'Creating...' : 'Create project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
