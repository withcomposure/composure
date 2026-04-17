import type { EditorLanguage } from '../../editor-completion'
import type { FormatAdapter } from '@/types'
import { latexAdapter } from './latex'
import { typstAdapter } from './typst'
import { markdownAdapter } from './markdown'
import { asciidocAdapter } from './asciidoc'

const adapters: Record<EditorLanguage, FormatAdapter> = {
  latex: latexAdapter,
  typst: typstAdapter,
  markdown: markdownAdapter,
  asciidoc: asciidocAdapter,
}

export function getAdapter(language: EditorLanguage): FormatAdapter {
  return adapters[language]
}
