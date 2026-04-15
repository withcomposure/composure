export type ProjectFormat = 'latex' | 'typst' | 'markdown' | 'asciidoc'

const PROJECT_FORMAT_LABELS: Record<ProjectFormat, string> = {
  latex: 'LaTeX',
  typst: 'Typst',
  markdown: 'Markdown',
  asciidoc: 'AsciiDoc',
}

const PROJECT_FORMAT_BY_EXTENSION: Record<string, ProjectFormat> = {
  tex: 'latex',
  ltx: 'latex',
  latex: 'latex',
  typ: 'typst',
  md: 'markdown',
  markdown: 'markdown',
  adoc: 'asciidoc',
  asciidoc: 'asciidoc',
}

const LATEX_AUXILIARY_EXTENSIONS = new Set(['bib', 'sty', 'cls'])

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

  const format = PROJECT_FORMAT_BY_EXTENSION[ext]
  if (format) return format

  if (includeLatexAuxiliaryExtensions && LATEX_AUXILIARY_EXTENSIONS.has(ext)) {
    return 'latex'
  }

  return null
}

export function projectFormatLabel(format: ProjectFormat): string {
  return PROJECT_FORMAT_LABELS[format]
}

export function projectTypeLabelFromRootFile(rootFile: string): string {
  const format = detectProjectFormatFromFilename(rootFile)
  if (format) {
    return projectFormatLabel(format)
  }

  const ext = fileExtension(rootFile)
  return ext ?? 'text'
}