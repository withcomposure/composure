import type { ProjectEngine } from '@/types'

export type ProjectFormat = 'latex' | 'typst' | 'markdown' | 'asciidoc'

const projectFormatLabels: Record<ProjectEngine, string> = {
  latex: 'LaTeX',
  typst: 'Typst',
  markdown: 'Markdown',
  asciidoc: 'AsciiDoc',
  excalidraw: 'Whiteboard',
}

const projectFormatByExtension: Record<string, ProjectFormat> = {
  tex: 'latex',
  ltx: 'latex',
  latex: 'latex',
  typ: 'typst',
  md: 'markdown',
  markdown: 'markdown',
  adoc: 'asciidoc',
  asciidoc: 'asciidoc',
}

const latexAuxiliaryExtensions = new Set(['bib', 'sty', 'cls'])

export function fileExtension(filename: string): string | null {
  const ext = filename.split('.').pop()?.trim().toLowerCase()
  return ext && ext.length > 0 ? ext : null
}

export function detectProjectFormatFromFilename(
  filename: string,
  includeLatexAuxiliaryExtensions = false,
): ProjectFormat | null {
  const ext = fileExtension(filename)
  if (!ext) return null

  const format = projectFormatByExtension[ext]
  if (format) return format

  if (includeLatexAuxiliaryExtensions && latexAuxiliaryExtensions.has(ext)) {
    return 'latex'
  }

  return null
}

function formatUsesBrowserLivePreview(format: ProjectFormat): boolean {
  return format === 'markdown' || format === 'asciidoc'
}

/**
 * Whether collaborative doc edits should schedule auto-compile
 *
 * - With an entrypoint: schedule when compile root is compile-capable (LaTeX, Typst)
 * - Without an entrypoint: same root check, but skip when the user is currently editing 
 *   a live-preview format (Markdown, AsciiDoc) with the preview pane open on that file
 */
export function shouldScheduleAutoCompileForDocChange(input: {
  hasEntrypoint: boolean
  compileRootPath: string
  activeEditorPath: string
  rightPreviewPath: string
  previewPaneOpen: boolean
}): boolean {
  const root = input.compileRootPath.trim()
  if (!root) {
    return false
  }

  if (detectProjectFormatFromFilename(root, false) === null) {
    return false
  }

  if (input.hasEntrypoint) {
    return true
  }

  const { activeEditorPath, rightPreviewPath, previewPaneOpen } = input
  if (
    previewPaneOpen &&
    activeEditorPath &&
    rightPreviewPath &&
    activeEditorPath === rightPreviewPath
  ) {
    const activeFmt = detectProjectFormatFromFilename(activeEditorPath, false)
    if (activeFmt && formatUsesBrowserLivePreview(activeFmt)) {
      return false
    }
  }

  return true
}

export function projectFormatLabel(format: ProjectEngine): string {
  return projectFormatLabels[format]
}

export function projectTypeLabel(input: { engine: ProjectEngine | null; rootFile: string }): string {
  if (input.engine) {
    return projectFormatLabel(input.engine)
  }

  return projectTypeLabelFromRootFile(input.rootFile)
}

export function projectTypeLabelFromRootFile(rootFile: string): string {
  const format = detectProjectFormatFromFilename(rootFile)
  if (format) {
    return projectFormatLabel(format)
  }

  const ext = fileExtension(rootFile)
  return ext ?? 'text'
}