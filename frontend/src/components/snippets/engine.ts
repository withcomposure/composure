import type { EditorView } from '@codemirror/view'
import type { Snippet } from './types'

/**
 * Expand a snippet template against the current selection and compute the
 * resulting text + cursor offset.
 *
 * Exported for testing — UI code should call {@link applySnippet} instead.
 */
export function expandTemplate(
  template: string,
  selectedText: string,
  wrapSelection: boolean,
): { text: string; cursorOffset: number } {
  let expanded = template

  if (wrapSelection && selectedText) {
    expanded = expanded.replace('${selection}', selectedText)
  } else {
    expanded = expanded.replace('${selection}', '')
  }

  const cursorMarker = '${cursor}'
  const cursorIndex = expanded.indexOf(cursorMarker)
  if (cursorIndex >= 0) {
    expanded = expanded.replace(cursorMarker, '')
    return { text: expanded, cursorOffset: cursorIndex }
  }

  return { text: expanded, cursorOffset: expanded.length }
}

/** Apply a snippet to the given CodeMirror EditorView. */
export function applySnippet(view: EditorView, snippet: Snippet): void {
  const { state } = view
  const range = state.selection.main
  const selectedText = state.sliceDoc(range.from, range.to)

  const { text, cursorOffset } = expandTemplate(
    snippet.template,
    selectedText,
    snippet.wrapSelection,
  )

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + cursorOffset },
  })

  view.focus()
}
