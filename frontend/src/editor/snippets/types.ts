import type { EditorLanguage } from '../editor-completion'

export interface Snippet {
  id: string
  label: string
  icon?: string
  /** Template using ${selection} and ${cursor} placeholders. */
  template: string
  /** When true the template wraps the current selection; when false it inserts at the cursor. */
  wrapSelection: boolean
}

export interface SnippetGroup {
  id: string
  label: string
  icon?: string
  snippetIds: string[]
}

/** A toolbar slot is either a single snippet ID or a group of related snippets. */
export type ToolbarSlot = string | SnippetGroup

export interface FormatAdapter {
  id: EditorLanguage
  snippets: Snippet[]
  /** Ordered toolbar layout — each entry is a snippet ID (pinned button) or a SnippetGroup (dropdown). */
  toolbar: ToolbarSlot[]
}
