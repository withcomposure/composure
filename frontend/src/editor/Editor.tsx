import { createElement, useCallback, useEffect, useRef, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  panels,
  rectangularSelection,
  runScopeHandlers,
  type Panel,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { StreamLanguage, bracketMatching } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { yCollab } from 'y-codemirror.next'
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search'
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ListChecks,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { oneDark } from './editor-theme'
import { detectEditorLanguage, languageAwareCompletion } from './editor-completion'
import { FormatToolbar } from './FormatToolbar'
import type { ProjectComment } from '@/types'
import { evaluateUtf8Limit } from '@/utils/text-size'
import { fmtTime } from '@/utils/format-time'

interface EditorProps {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  activeFile: string
  availableFilePaths: readonly string[]
  maxTextFileSizeBytes: number | 'unlimited'
  largeFileThresholdChars: number
  showFormatToolbar: boolean
  canEdit: boolean
  canComment: boolean
  editorBraceMatching: boolean
  editorHighlightSelectionMatches: boolean
  editorInEditorFind: boolean
  editorAutocomplete: boolean
  editorAutoCloseLatexBeginEnd: boolean
  presenceName: string
  presenceUserId: string | null
  presenceGuestId: string | null
  presenceImageUrl: string | null
  comments: ProjectComment[]
  activeCommentId: string | null
  activeCommentRevision: number
  focusCollaboratorRequest: { clientId: number; revision: number } | null
  onFocusChange?: (isFocused: boolean) => void
  onCreateComment: (input: {
    filePath: string
    startLine: number | null
    endLine: number | null
    parentCommentId: string | null
    body: string
  }) => Promise<void>
  onTextLimitExceeded?: (input: {
    filePath: string
    sizeBytes: number
    limitBytes: number
  }) => void
  onCommentLineNumbersChange: (lineNumbersById: Record<string, {
    startLine: number | null
    endLine: number | null
  }>) => void
}

interface SelectedLines {
  startLine: number
  endLine: number
}

interface DraftState {
  startLine: number
  endLine: number
  restorePosition: number
  top: number
  left: number
}

interface CommentAnchor {
  id: string
  from: number
  to: number
  preview: string
}

interface CommentAnchorState {
  anchors: Map<string, CommentAnchor>
  comments: ProjectComment[]
}

type RangeEdge = 'single' | 'start' | 'middle' | 'end'

interface AnchoredCommentRange {
  id: string
  from: number
  to: number
  startLine: number
  endLine: number
  comment: ProjectComment
}

interface UnionRange {
  rangeId: string
  from: number
  to: number
  startLine: number
  endLine: number
  commentIds: string[]
  comments: ProjectComment[]
}

interface RangeMarkerEntry {
  rangeId: string
  edge: RangeEdge
  startLine: number
  endLine: number
}

interface ActiveRangeOverlay {
  rangeId: string
  top: number
  comments: ProjectComment[]
}

interface ActiveSpanContext {
  span: SelectedLines
  union: SelectedLines
}

const commentOverlayLeftPx = 56

const syncCommentsEffect = StateEffect.define<ProjectComment[]>()

function selectedLines(state: EditorState): SelectedLines | null {
  const nonEmptyRanges = state.selection.ranges.filter((range) => !range.empty)
  if (nonEmptyRanges.length === 0) return null

  let fromLine = Number.POSITIVE_INFINITY
  let toLine = Number.NEGATIVE_INFINITY
  for (const range of nonEmptyRanges) {
    const span = selectionLineSpan(state, range)
    fromLine = Math.min(fromLine, span.startLine)
    toLine = Math.max(toLine, span.endLine)
  }

  return {
    startLine: Math.min(fromLine, toLine),
    endLine: Math.max(fromLine, toLine),
  }
}

function clampLine(state: EditorState, lineNumber: number): number {
  return Math.min(Math.max(1, lineNumber), state.doc.lines)
}

function selectionRestorePosition(state: EditorState, range: SelectedLines): number {
  const sel = state.selection.main
  if (!sel.empty) {
    const headLine = state.doc.lineAt(sel.head).number
    if (headLine >= range.startLine && headLine <= range.endLine) {
      return sel.head
    }

    const forward = sel.head >= sel.anchor
    const targetLine = forward ? range.endLine : range.startLine
    return state.doc.line(clampLine(state, targetLine)).from
  }

  return state.doc.line(clampLine(state, range.endLine)).from
}

function selectionLineSpan(state: EditorState, range: EditorSelection['main']): SelectedLines {
  const anchorLine = state.doc.lineAt(range.anchor).number
  const adjustedHead = range.head > range.anchor ? Math.max(0, range.head - 1) : range.head
  const headLine = state.doc.lineAt(adjustedHead).number
  return {
    startLine: Math.min(anchorLine, headLine),
    endLine: Math.max(anchorLine, headLine),
  }
}

function insertTabCharacter(view: EditorView): boolean {
  if (view.state.facet(EditorState.readOnly)) {
    return false
  }
  view.dispatch(view.state.replaceSelection('\t'))
  return true
}

function expandLineSelection(direction: 'up' | 'down') {
  return (view: EditorView): boolean => {
    const state = view.state
    const ranges = state.selection.ranges.map((range) => {
      const span = selectionLineSpan(state, range)
      const startLine = direction === 'up'
        ? Math.max(1, span.startLine - 1)
        : span.startLine
      const endLine = direction === 'down'
        ? Math.min(state.doc.lines, span.endLine + 1)
        : span.endLine

      const forward = range.head >= range.anchor
      const anchor = forward ? state.doc.line(startLine).from : state.doc.line(endLine).to
      const head = forward ? state.doc.line(endLine).to : state.doc.line(startLine).from
      return EditorSelection.range(anchor, head)
    })

    view.dispatch({
      selection: EditorSelection.create(ranges),
      scrollIntoView: true,
    })
    return true
  }
}

function restoreEditorSelectionAndFocus(view: EditorView, restorePosition: number): void {
  const clampedPosition = Math.min(Math.max(restorePosition, 0), view.state.doc.length)
  view.dispatch({ selection: { anchor: clampedPosition } })
  view.focus()
}

function commentRangeFromLines(comment: ProjectComment, state: EditorState): { from: number; to: number } | null {
  const startRaw = comment.startLine
  const endRaw = comment.endLine ?? startRaw

  if (!startRaw || !endRaw) {
    return null
  }

  // During initial collaborative sync the doc can still be empty; anchoring here
  // would map a placeholder range across the whole document on first insert.
  if (state.doc.length === 0) {
    return null
  }

  const minLine = Math.min(startRaw, endRaw)
  const maxLine = Math.max(startRaw, endRaw)
  if (maxLine > state.doc.lines) {
    return null
  }

  const start = clampLine(state, minLine)
  const end = clampLine(state, maxLine)

  const from = state.doc.line(start).from
  const to = state.doc.line(end).to

  return { from, to }
}

function shouldResetAnchor(
  state: EditorState,
  existing: CommentAnchor,
  expected: { from: number; to: number },
): boolean {
  const existingFrom = Math.min(existing.from, existing.to)
  const existingTo = Math.max(existing.from, existing.to)
  const expectedFrom = Math.min(expected.from, expected.to)
  const expectedTo = Math.max(expected.from, expected.to)

  const existingIsWholeDocument = state.doc.length > 0 && existingFrom === 0 && existingTo === state.doc.length
  const expectedIsWholeDocument = expectedFrom === 0 && expectedTo === state.doc.length
  const existingIsCollapsed = existingFrom === existingTo
  const expectedIsCollapsed = expectedFrom === expectedTo

  if (existingIsWholeDocument && !expectedIsWholeDocument) {
    return true
  }
  if (existingIsCollapsed && !expectedIsCollapsed) {
    return true
  }
  return false
}

function createAnchors(comments: ProjectComment[], state: EditorState, previous?: Map<string, CommentAnchor>): Map<string, CommentAnchor> {
  const anchors = new Map<string, CommentAnchor>()

  for (const comment of comments) {
    const expectedRange = commentRangeFromLines(comment, state)
    const existing = previous?.get(comment.id)
    if (existing) {
      const nextRange = expectedRange && shouldResetAnchor(state, existing, expectedRange)
        ? expectedRange
        : { from: existing.from, to: existing.to }
      anchors.set(comment.id, {
        ...existing,
        from: nextRange.from,
        to: nextRange.to,
        preview: `${comment.authorDisplayName}: ${comment.body}`,
      })
      continue
    }

    if (!expectedRange) continue

    anchors.set(comment.id, {
      id: comment.id,
      from: expectedRange.from,
      to: expectedRange.to,
      preview: `${comment.authorDisplayName}: ${comment.body}`,
    })
  }

  return anchors
}

function createCommentAnchorField(initialComments: ProjectComment[]): StateField<CommentAnchorState> {
  return StateField.define<CommentAnchorState>({
    create(state) {
      return {
        anchors: createAnchors(initialComments, state),
        comments: initialComments,
      }
    },
    update(value, tr) {
      let mapped = new Map<string, CommentAnchor>()
      for (const [id, anchor] of value.anchors.entries()) {
        const fromAssoc = -1
        const toAssoc = anchor.from === anchor.to ? -1 : 1
        mapped.set(id, {
          ...anchor,
          from: tr.changes.mapPos(anchor.from, fromAssoc),
          to: tr.changes.mapPos(anchor.to, toAssoc),
        })
      }

      let currentComments = value.comments

      for (const effect of tr.effects) {
        if (effect.is(syncCommentsEffect)) {
          currentComments = effect.value
          mapped = createAnchors(effect.value, tr.state, mapped)
        }
      }

      if (tr.docChanged) {
        mapped = createAnchors(currentComments, tr.state, mapped)
      }

      return {
        anchors: mapped,
        comments: currentComments,
      }
    },
  })
}

function buildCommentLineNumbers(
  state: EditorState,
  anchorField: StateField<CommentAnchorState>,
  comments: ProjectComment[],
): Record<string, { startLine: number | null; endLine: number | null }> {
  const anchors = state.field(anchorField).anchors
  const result: Record<string, { startLine: number | null; endLine: number | null }> = {}

  for (const comment of comments) {
    const anchor = anchors.get(comment.id)
    if (!anchor) {
      const start = comment.startLine
      const end = comment.endLine ?? start
      result[comment.id] = {
        startLine: start,
        endLine: end,
      }
      continue
    }

    const from = Math.min(anchor.from, anchor.to)
    const to = Math.max(anchor.from, anchor.to)
    const startLine = state.doc.lineAt(from).number
    const endLine = state.doc.lineAt(to).number
    result[comment.id] = {
      startLine,
      endLine,
    }
  }

  return result
}

function buildAnchoredCommentRanges(
  state: EditorState,
  anchorField: StateField<CommentAnchorState>,
  comments: ProjectComment[],
): AnchoredCommentRange[] {
  const anchors = state.field(anchorField).anchors
  const byId = new Map<string, ProjectComment>(comments.map((comment) => [comment.id, comment]))
  const ranges: AnchoredCommentRange[] = []

  for (const [commentId, anchor] of anchors.entries()) {
    const comment = byId.get(commentId)
    if (!comment) continue

    const from = Math.min(anchor.from, anchor.to)
    const to = Math.max(anchor.from, anchor.to)
    ranges.push({
      id: comment.id,
      from,
      to,
      startLine: state.doc.lineAt(from).number,
      endLine: state.doc.lineAt(to).number,
      comment,
    })
  }

  return ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.id.localeCompare(b.id))
}

function buildUnionRanges(
  state: EditorState,
  anchorField: StateField<CommentAnchorState>,
  comments: ProjectComment[],
): UnionRange[] {
  const anchored = buildAnchoredCommentRanges(state, anchorField, comments)
  if (anchored.length === 0) {
    return []
  }

  const unions: UnionRange[] = []
  let current: UnionRange | null = null

  for (const range of anchored) {
    if (!current) {
      current = {
        rangeId: `${range.startLine}:${range.endLine}`,
        from: range.from,
        to: range.to,
        startLine: range.startLine,
        endLine: range.endLine,
        commentIds: [range.id],
        comments: [range.comment],
      }
      continue
    }

    if (range.startLine <= current.endLine) {
      current.from = Math.min(current.from, range.from)
      current.to = Math.max(current.to, range.to)
      current.startLine = Math.min(current.startLine, range.startLine)
      current.endLine = Math.max(current.endLine, range.endLine)
      current.commentIds.push(range.id)
      current.comments.push(range.comment)
      current.rangeId = `${current.startLine}:${current.endLine}`
      continue
    }

    unions.push(current)
    current = {
      rangeId: `${range.startLine}:${range.endLine}`,
      from: range.from,
      to: range.to,
      startLine: range.startLine,
      endLine: range.endLine,
      commentIds: [range.id],
      comments: [range.comment],
    }
  }

  if (current) {
    unions.push(current)
  }

  return unions.map((union) => ({
    ...union,
    commentIds: [...union.commentIds].sort((a, b) => a.localeCompare(b)),
    comments: [...union.comments].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
  }))
}

function rangeEdgeForLine(lineNumber: number, startLine: number, endLine: number): RangeEdge {
  if (startLine === endLine) {
    return 'single'
  }
  if (lineNumber === startLine) {
    return 'start'
  }
  if (lineNumber === endLine) {
    return 'end'
  }
  return 'middle'
}

function lineCoverage(lineNumber: number, unionRanges: UnionRange[]): RangeMarkerEntry | null {
  const union = unionRanges.find((range) => lineNumber >= range.startLine && lineNumber <= range.endLine)
  if (!union) {
    return null
  }
  return {
    rangeId: union.rangeId,
    edge: rangeEdgeForLine(lineNumber, union.startLine, union.endLine),
    startLine: union.startLine,
    endLine: union.endLine,
  }
}

function activeSpanEdgeForLine(lineNumber: number, active: ActiveSpanContext): RangeEdge {
  const startsAtUnionBoundary = active.span.startLine === active.union.startLine
  const endsAtUnionBoundary = active.span.endLine === active.union.endLine
  const isStart = lineNumber === active.span.startLine && startsAtUnionBoundary
  const isEnd = lineNumber === active.span.endLine && endsAtUnionBoundary
  if (isStart && isEnd) {
    return 'single'
  }
  if (isStart) {
    return 'start'
  }
  if (isEnd) {
    return 'end'
  }
  return 'middle'
}

function lineNumberDigits(lineCount: number): number {
  return String(Math.max(1, lineCount)).length
}

function createCommentTriggerIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')

  const bubble = document.createElementNS(ns, 'path')
  bubble.setAttribute('d', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z')
  bubble.setAttribute('fill', 'none')
  bubble.setAttribute('stroke', 'currentColor')
  bubble.setAttribute('stroke-width', '1.8')
  bubble.setAttribute('stroke-linecap', 'round')
  bubble.setAttribute('stroke-linejoin', 'round')

  svg.append(bubble)
  return svg
}

class PlainLineMarker extends GutterMarker {
  private readonly textValue: string

  constructor(value: number | string) {
    super()
    this.textValue = String(value)
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cz-line-number'
    span.textContent = this.textValue
    return span
  }
}

class CommentRangeMarker extends GutterMarker {
  private readonly value: number
  private readonly rangeValue: RangeMarkerEntry
  private readonly onHoverRangeValue: (rangeId: string | null) => void
  private readonly onPinRangeValue: (rangeId: string) => void

  constructor(
    number: number,
    range: RangeMarkerEntry,
    onHoverRange: (rangeId: string | null) => void,
    onPinRange: (rangeId: string) => void,
  ) {
    super()
    this.value = number
    this.rangeValue = range
    this.onHoverRangeValue = onHoverRange
    this.onPinRangeValue = onPinRange
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cz-comment-range-marker'

    const number = document.createElement('span')
    number.className = 'cz-line-number'
    number.textContent = String(this.value)

    const stripe = document.createElement('span')
    stripe.className = `cz-comment-line-stripe is-${this.rangeValue.edge}`
    stripe.dataset.rangeId = this.rangeValue.rangeId
    stripe.dataset.lineNumber = String(this.value)
    stripe.onmouseenter = () => {
      this.onHoverRangeValue(this.rangeValue.rangeId)
    }
    stripe.onmouseleave = (event) => {
      const related = event.relatedTarget as HTMLElement | null
      const relatedStripe = related?.closest('.cz-comment-line-stripe') as HTMLElement | null
      if (relatedStripe?.dataset.rangeId === stripe.dataset.rangeId) {
        return
      }
      this.onHoverRangeValue(null)
    }
    stripe.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onPinRangeValue(this.rangeValue.rangeId)
    }

    wrapper.append(number, stripe)
    return wrapper
  }
}

class SelectionStripeMarker extends GutterMarker {
  private readonly value: number
  private readonly edgeValue: RangeEdge

  constructor(number: number, edge: RangeEdge) {
    super()
    this.value = number
    this.edgeValue = edge
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cz-selection-stripe-marker'

    const number = document.createElement('span')
    number.className = 'cz-line-number'
    number.textContent = String(this.value)

    const stripe = document.createElement('span')
    stripe.className = `cz-selection-line-stripe is-${this.edgeValue}`
    wrapper.append(number, stripe)

    return wrapper
  }
}

class SelectionTriggerMarker extends GutterMarker {
  private readonly startLineValue: number
  private readonly endLineValue: number
  private readonly onTriggerValue: (range: SelectedLines) => void

  constructor(
    startLine: number,
    endLine: number,
    onTrigger: (range: SelectedLines) => void,
  ) {
    super()
    this.startLineValue = startLine
    this.endLineValue = endLine
    this.onTriggerValue = onTrigger
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cz-selection-trigger-marker'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cz-selection-trigger-row'
    button.tabIndex = -1
    button.title = 'Add comment'
    button.setAttribute('aria-label', 'Add comment')

    const icon = createCommentTriggerIcon()
    icon.classList.add('cz-selection-trigger-icon')
    button.append(icon)

    button.onmousedown = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onTriggerValue({ startLine: this.startLineValue, endLine: this.endLineValue })
    }

    wrapper.append(button)
    return wrapper
  }
}

/** Detect language from filename */
function langExtension(filename: string) {
  switch (detectEditorLanguage(filename)) {
    case 'latex':
      return StreamLanguage.define(stex)
    case 'typst':
      // Typst uses markdown-like syntax as a reasonable fallback
      return markdown()
    case 'markdown':
    case 'asciidoc':
      return markdown()
  }
}

function autoCloseLatexBeginEnd(view: EditorView): boolean {
  const selection = view.state.selection.main
  if (!selection.empty) {
    return false
  }

  const cursor = selection.head
  const line = view.state.doc.lineAt(cursor)
  const cursorInLine = cursor - line.from
  const beforeCursor = line.text.slice(0, cursorInLine)
  const afterCursor = line.text.slice(cursorInLine)
  const completeMatch = beforeCursor.match(/^(\s*)\\begin\{([^}\s]+)\}\s*$/)
  const partialMatch = beforeCursor.match(/^(\s*)\\begin\{([^}\s]+)$/)
  let baseIndent = ''
  let environmentName = ''
  const replaceFrom = cursor
  let replaceTo = cursor
  let insertPrefix = ''

  if (completeMatch) {
    if (afterCursor.trim().length > 0) {
      return false
    }
    baseIndent = completeMatch[1] ?? ''
    environmentName = completeMatch[2]
  } else if (partialMatch && /^}\s*$/.test(afterCursor)) {
    baseIndent = partialMatch[1] ?? ''
    environmentName = partialMatch[2]
    replaceTo = cursor + 1
    insertPrefix = '}'
  } else {
    return false
  }

  const existingNextLine = line.number < view.state.doc.lines
    ? view.state.doc.line(line.number + 1).text.trim()
    : ''
  if (existingNextLine === `\\end{${environmentName}}`) {
    return false
  }

  const insert = `${insertPrefix}\n${baseIndent}\n${baseIndent}\\end{${environmentName}}`
  const nextCursor = replaceFrom + insertPrefix.length + 1 + baseIndent.length

  view.dispatch({
    changes: { from: replaceFrom, to: replaceTo, insert },
    selection: { anchor: nextCursor },
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

/** Random guest color for presence cursors */
const guestColors = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#f43f5e', '#84cc16', '#3b82f6', '#e11d48',
]
function randomColor(): string {
  return guestColors[Math.floor(Math.random() * guestColors.length)]
}

const guestName = `Guest ${Math.floor(Math.random() * 9000 + 1000)}`
const guestColor = randomColor()

function renderPanelIcon(icon: LucideIcon): string {
  return renderToStaticMarkup(createElement(icon, {
    size: 12,
    strokeWidth: 2.25,
    'aria-hidden': true,
  }))
}

const panelIcons = {
  caseSensitive: renderPanelIcon(CaseSensitive),
  wholeWord: renderPanelIcon(WholeWord),
  regexp: renderPanelIcon(Regex),
  next: renderPanelIcon(ArrowDown),
  previous: renderPanelIcon(ArrowUp),
  all: renderPanelIcon(ListChecks),
  replace: renderPanelIcon(Replace),
  replaceAll: renderPanelIcon(ReplaceAll),
  close: renderPanelIcon(X),
}

class ComposureSearchPanel implements Panel {
  private readonly view: EditorView
  private query: SearchQuery
  readonly dom: HTMLElement
  private readonly searchField: HTMLInputElement
  private readonly replaceField: HTMLInputElement
  private readonly caseField: HTMLInputElement
  private readonly reField: HTMLInputElement
  private readonly wordField: HTMLInputElement
  private readonly caseButton: HTMLButtonElement
  private readonly reButton: HTMLButtonElement
  private readonly wordButton: HTMLButtonElement

  constructor(view: EditorView) {
    this.view = view
    this.query = getSearchQuery(view.state)
    this.commit = this.commit.bind(this)

    this.searchField = document.createElement('input')
    this.searchField.className = 'cz-search-input cm-textfield'
    this.searchField.name = 'search'
    this.searchField.placeholder = view.state.phrase('Find')
    this.searchField.setAttribute('aria-label', view.state.phrase('Find'))
    this.searchField.setAttribute('main-field', 'true')
    this.searchField.value = this.query.search
    this.searchField.onchange = this.commit
    this.searchField.onkeyup = this.commit

    this.replaceField = document.createElement('input')
    this.replaceField.className = 'cz-search-input cm-textfield'
    this.replaceField.name = 'replace'
    this.replaceField.placeholder = view.state.phrase('Replace')
    this.replaceField.setAttribute('aria-label', view.state.phrase('Replace'))
    this.replaceField.value = this.query.replace
    this.replaceField.onchange = this.commit
    this.replaceField.onkeyup = this.commit

    this.caseField = document.createElement('input')
    this.caseField.type = 'checkbox'
    this.caseField.checked = this.query.caseSensitive

    this.reField = document.createElement('input')
    this.reField.type = 'checkbox'
    this.reField.checked = this.query.regexp

    this.wordField = document.createElement('input')
    this.wordField.type = 'checkbox'
    this.wordField.checked = this.query.wholeWord

    this.caseButton = this.createToggleButton('Match Case', panelIcons.caseSensitive, this.caseField)
    this.reButton = this.createToggleButton('Regexp', panelIcons.regexp, this.reField)
    this.wordButton = this.createToggleButton('Match Whole Word', panelIcons.wholeWord, this.wordField)

    const findInputWrap = document.createElement('div')
    findInputWrap.className = 'cz-search-input-wrap'

    const findToggleWrap = document.createElement('div')
    findToggleWrap.className = 'cz-search-inline-toggles'
    findToggleWrap.append(this.caseButton, this.wordButton, this.reButton)
    findInputWrap.append(this.searchField, findToggleWrap)

    const findActions = document.createElement('div')
    findActions.className = 'cz-search-actions'
    findActions.append(
      this.createActionButton('Next', panelIcons.next, () => {
        findNext(view)
      }),
      this.createActionButton('Previous', panelIcons.previous, () => {
        findPrevious(view)
      }),
      this.createActionButton('All', panelIcons.all, () => {
        selectMatches(view)
      }),
      this.createActionButton('Close', panelIcons.close, () => {
        closeSearchPanel(view)
      }),
    )

    const findRow = document.createElement('div')
    findRow.className = 'cz-search-row'
    findRow.append(findInputWrap, findActions)

    const replaceInputWrap = document.createElement('div')
    replaceInputWrap.className = 'cz-search-input-wrap'
    replaceInputWrap.append(this.replaceField)

    const replaceActions = document.createElement('div')
    replaceActions.className = 'cz-search-actions'
    replaceActions.append(
      this.createActionButton('replace', panelIcons.replace, () => {
        replaceNext(view)
      }),
      this.createActionButton('replace all', panelIcons.replaceAll, () => {
        replaceAll(view)
      }),
    )

    const replaceRow = document.createElement('div')
    replaceRow.className = 'cz-search-row cz-search-row-replace'
    replaceRow.append(replaceInputWrap, replaceActions)

    this.dom = document.createElement('div')
    this.dom.className = 'cm-search cz-search-panel'
    this.dom.onkeydown = (event) => this.keydown(event)
    this.dom.append(findRow)
    if (!view.state.readOnly) {
      this.dom.append(replaceRow)
    }

    this.syncToggleButtons()
  }

  private createActionButton(label: string, iconMarkup: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cz-search-button cm-button'
    button.setAttribute('aria-label', this.view.state.phrase(label))
    button.title = this.view.state.phrase(label)
    button.innerHTML = iconMarkup
    button.onclick = (event) => {
      event.preventDefault()
      onClick()
    }
    return button
  }

  private createToggleButton(label: string, iconMarkup: string, source: HTMLInputElement): HTMLButtonElement {
    const button = this.createActionButton(label, iconMarkup, () => {
      source.checked = !source.checked
      this.syncToggleButtons()
      this.commit()
    })
    button.classList.add('cz-search-toggle')
    return button
  }

  private syncToggleButtons(): void {
    this.caseButton.classList.toggle('is-active', this.caseField.checked)
    this.reButton.classList.toggle('is-active', this.reField.checked)
    this.wordButton.classList.toggle('is-active', this.wordField.checked)
  }

  private commit(): void {
    const query = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.reField.checked,
      wholeWord: this.wordField.checked,
    })
    if (!query.eq(this.query)) {
      this.query = query
      this.view.dispatch({ effects: setSearchQuery.of(query) })
    }
  }

  private keydown(event: KeyboardEvent): void {
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault()
      return
    }

    if (event.key === 'Enter' && event.target === this.searchField) {
      event.preventDefault()
      ;(event.shiftKey ? findPrevious : findNext)(this.view)
      return
    }

    if (event.key === 'Enter' && event.target === this.replaceField) {
      event.preventDefault()
      replaceNext(this.view)
    }
  }

  update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value)
        }
      }
    }
  }

  private setQuery(query: SearchQuery): void {
    this.query = query
    this.searchField.value = query.search
    this.replaceField.value = query.replace
    this.caseField.checked = query.caseSensitive
    this.reField.checked = query.regexp
    this.wordField.checked = query.wholeWord
    this.syncToggleButtons()
  }

  mount(): void {
    this.searchField.select()
  }

  get top(): boolean {
    return true
  }
}

function createComposureSearchPanel(view: EditorView): Panel {
  return new ComposureSearchPanel(view)
}

export function Editor({
  ydoc,
  provider,
  activeFile,
  availableFilePaths,
  maxTextFileSizeBytes,
  largeFileThresholdChars,
  showFormatToolbar,
  canEdit,
  canComment,
  editorBraceMatching,
  editorHighlightSelectionMatches,
  editorInEditorFind,
  editorAutocomplete,
  editorAutoCloseLatexBeginEnd,
  presenceName,
  presenceUserId,
  presenceGuestId,
  presenceImageUrl,
  comments,
  activeCommentId,
  activeCommentRevision,
  focusCollaboratorRequest,
  onFocusChange,
  onCreateComment,
  onTextLimitExceeded,
  onCommentLineNumbersChange,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const preservedSelectionByFileRef = useRef<Map<string, number>>(new Map())
  const rangeContextRef = useRef<{ anchorField: StateField<CommentAnchorState>; comments: ProjectComment[] } | null>(null)
  const pinnedRangeIdRef = useRef<string | null>(null)
  const hoveredRangeIdRef = useRef<string | null>(null)
  const focusedCommentIdRef = useRef<string | null>(null)
  const fileCommentsRef = useRef<ProjectComment[]>([])
  const onCommentLineNumbersChangeRef = useRef(onCommentLineNumbersChange)
  const onFocusChangeRef = useRef(onFocusChange)
  const onTextLimitExceededRef = useRef(onTextLimitExceeded)
  const availableFilePathsRef = useRef<readonly string[]>(availableFilePaths)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [draftBody, setDraftBody] = useState('')
  const [draftSubmitting, setDraftSubmitting] = useState(false)
  const [hoveredRangeId, setHoveredRangeId] = useState<string | null>(null)
  const [pinnedRangeId, setPinnedRangeId] = useState<string | null>(null)
  const [focusedCommentSpan, setFocusedCommentSpan] = useState<SelectedLines | null>(null)
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null)
  const [activeRangeOverlay, setActiveRangeOverlay] = useState<ActiveRangeOverlay | null>(null)
  const [deferredLoading, setDeferredLoading] = useState(false)
  const [largeFileMode, setLargeFileMode] = useState(false)
  const draftRef = useRef<DraftState | null>(null)

  // Get or create a Y.Text for the active file
  const ytext = useMemo(() => ydoc.getText(`file:${activeFile}`), [ydoc, activeFile])

  const fileComments = useMemo(
    () => comments.filter((comment) => comment.filePath === activeFile),
    [comments, activeFile],
  )

  useEffect(() => {
    availableFilePathsRef.current = availableFilePaths
  }, [availableFilePaths])

  useEffect(() => {
    fileCommentsRef.current = fileComments
  }, [fileComments])

  const refreshActiveRangeOverlay = useCallback((rangeId: string | null) => {
    const view = viewRef.current
    const container = containerRef.current
    const context = rangeContextRef.current
    if (!view || !container || !context || !rangeId) {
      setActiveRangeOverlay(null)
      return
    }

    const unionRanges = buildUnionRanges(view.state, context.anchorField, context.comments)
    const selectedUnion = unionRanges.find((range) => range.rangeId === rangeId)
    if (!selectedUnion) {
      setActiveRangeOverlay(null)
      return
    }

    const focusCommentId = focusedCommentIdRef.current
    const focusedRange = focusCommentId
      ? buildAnchoredCommentRanges(view.state, context.anchorField, context.comments)
        .find((entry) => entry.id === focusCommentId)
      : null
    const overlayComments = focusCommentId
      ? selectedUnion.comments.filter((comment) => comment.id === focusCommentId)
      : selectedUnion.comments
    if (overlayComments.length === 0) {
      setActiveRangeOverlay(null)
      return
    }

    const anchorFrom = focusedRange?.from ?? selectedUnion.from
    const line = view.state.doc.lineAt(anchorFrom)
    const coords = view.coordsAtPos(line.from)
    const containerRect = container.getBoundingClientRect()
    setActiveRangeOverlay({
      rangeId,
      top: coords ? coords.top - containerRect.top : 12,
      comments: overlayComments,
    })
  }, [])

  const openDraftAtSelection = useCallback((range: SelectedLines) => {
    const view = viewRef.current
    const container = containerRef.current
    if (!view || !container) return

    const line = view.state.doc.line(clampLine(view.state, range.startLine))
    const coords = view.coordsAtPos(line.from)
    const containerRect = container.getBoundingClientRect()

    setDraft({
      startLine: range.startLine,
      endLine: range.endLine,
      restorePosition: selectionRestorePosition(view.state, range),
      top: coords ? coords.top - containerRect.top : 12,
      left: commentOverlayLeftPx,
    })
    setDraftBody('')
  }, [])

  useEffect(() => {
    setDraft(null)
    setDraftBody('')
    setHoveredRangeId(null)
    setPinnedRangeId(null)
    setFocusedCommentSpan(null)
    setFocusedCommentId(null)
    setActiveRangeOverlay(null)
  }, [activeFile])

  useEffect(() => {
    if (!canComment) {
      setDraft(null)
      setDraftBody('')
    }
  }, [canComment])

  useEffect(() => {
    pinnedRangeIdRef.current = pinnedRangeId
  }, [pinnedRangeId])

  useEffect(() => {
    hoveredRangeIdRef.current = hoveredRangeId
  }, [hoveredRangeId])

  useEffect(() => {
    focusedCommentIdRef.current = focusedCommentId
  }, [focusedCommentId])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    onCommentLineNumbersChangeRef.current = onCommentLineNumbersChange
  }, [onCommentLineNumbersChange])

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange
  }, [onFocusChange])

  useEffect(() => {
    onTextLimitExceededRef.current = onTextLimitExceeded
  }, [onTextLimitExceeded])

  useEffect(() => {
    const activeRangeId = pinnedRangeId ?? hoveredRangeId
    refreshActiveRangeOverlay(activeRangeId)
  }, [pinnedRangeId, hoveredRangeId, refreshActiveRangeOverlay, fileComments])

  useEffect(() => {
    const view = viewRef.current
    const context = rangeContextRef.current
    if (!view || !context) return

    const rangeIds = new Set(buildUnionRanges(view.state, context.anchorField, context.comments).map((entry) => entry.rangeId))
    if (pinnedRangeId && !rangeIds.has(pinnedRangeId)) {
      setPinnedRangeId(null)
      setFocusedCommentSpan(null)
    }
    if (hoveredRangeId && !rangeIds.has(hoveredRangeId)) {
      setHoveredRangeId(null)
    }
  }, [fileComments, pinnedRangeId, hoveredRangeId])

  useEffect(() => {
    if (!activeCommentId) {
      setPinnedRangeId(null)
      setHoveredRangeId(null)
      setFocusedCommentSpan(null)
      setFocusedCommentId(null)
      setActiveRangeOverlay(null)
      return
    }

    const view = viewRef.current
    const context = rangeContextRef.current
    if (!view || !context) return

    const anchored = buildAnchoredCommentRanges(view.state, context.anchorField, context.comments)
    const selectedComment = anchored.find((entry) => entry.id === activeCommentId)
    if (!selectedComment) return

    const range = buildUnionRanges(view.state, context.anchorField, context.comments)
      .find((entry) => selectedComment.startLine >= entry.startLine && selectedComment.endLine <= entry.endLine)
    if (!range) return

    setPinnedRangeId(range.rangeId)
    setHoveredRangeId(range.rangeId)
    setFocusedCommentId(selectedComment.id)
    setFocusedCommentSpan({
      startLine: selectedComment.startLine,
      endLine: selectedComment.endLine,
    })

    view.dispatch({
      effects: EditorView.scrollIntoView(selectedComment.from, { y: 'center' }),
    })
  }, [activeCommentId, activeCommentRevision, refreshActiveRangeOverlay, fileComments])

  useEffect(() => {
    const activeRangeId = pinnedRangeId ?? hoveredRangeId
    refreshActiveRangeOverlay(activeRangeId)
  }, [focusedCommentId, pinnedRangeId, hoveredRangeId, refreshActiveRangeOverlay])

  useEffect(() => {
    const container = containerRef.current
    const view = viewRef.current
    const context = rangeContextRef.current
    if (!container) return

    const activeRangeId = pinnedRangeId ?? hoveredRangeId
    const activeUnion = activeRangeId && view && context
      ? buildUnionRanges(view.state, context.anchorField, context.comments)
        .find((range) => range.rangeId === activeRangeId)
      : null
    const active = activeUnion
      ? {
        span: focusedCommentSpan ?? { startLine: activeUnion.startLine, endLine: activeUnion.endLine },
        union: { startLine: activeUnion.startLine, endLine: activeUnion.endLine },
      }
      : null

    const stripes = container.querySelectorAll<HTMLElement>('.cz-comment-line-stripe')
    for (const stripe of stripes) {
      const lineNumber = Number(stripe.dataset.lineNumber)
      const isInActiveSpan = active !== null
        && Number.isFinite(lineNumber)
        && lineNumber >= active.span.startLine
        && lineNumber <= active.span.endLine

      stripe.classList.toggle('is-active', isInActiveSpan)
      stripe.classList.toggle('is-pinned', isInActiveSpan && pinnedRangeId !== null)
      stripe.classList.toggle('is-active-span', isInActiveSpan)
      stripe.classList.remove('is-span-start', 'is-span-middle', 'is-span-end', 'is-span-single')

      if (isInActiveSpan) {
        const spanEdge = activeSpanEdgeForLine(lineNumber, active)
        stripe.classList.add(`is-span-${spanEdge}`)
      }
    }
  }, [pinnedRangeId, hoveredRangeId, focusedCommentSpan, activeRangeOverlay, fileComments])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      if (target.closest('.cz-comment-line-stripe') || target.closest('.cz-comment-range-cards')) {
        return
      }

      setPinnedRangeId(null)
      setFocusedCommentSpan(null)
      setFocusedCommentId(null)
      if (pinnedRangeIdRef.current) {
        setHoveredRangeId(null)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (rangeContextRef.current) {
      rangeContextRef.current.comments = fileComments
    }
    view.dispatch({ effects: syncCommentsEffect.of(fileComments) })
  }, [fileComments])

  // Keep the awareness `user` field up-to-date without tearing down the editor.
  useEffect(() => {
    const localUser = {
      name: presenceName || guestName,
      color: guestColor,
      userId: presenceUserId ?? null,
      guestId: presenceGuestId ?? null,
      profileImageUrl: presenceImageUrl ?? null,
    }
    provider.awareness!.setLocalStateField('user', localUser)
    console.info('[editor] awareness-local-set', localUser)
  }, [provider, presenceName, presenceUserId, presenceGuestId, presenceImageUrl])

  useEffect(() => {
    if (!focusCollaboratorRequest) return

    const view = viewRef.current
    if (!view) return

    const state = provider.awareness!.getStates().get(focusCollaboratorRequest.clientId) as
      | { cursor?: { anchor?: unknown; head?: unknown } }
      | undefined

    const cursor = state?.cursor
    if (!cursor?.head) return

    const absoluteHead = Y.createAbsolutePositionFromRelativePosition(cursor.head as Y.RelativePosition, ydoc)
    if (!absoluteHead || absoluteHead.type !== ytext) return

    view.dispatch({
      effects: EditorView.scrollIntoView(absoluteHead.index, {
        y: 'center',
        yMargin: 48,
      }),
    })
  }, [focusCollaboratorRequest, provider, ydoc, ytext])

  useEffect(() => {
    if (!containerRef.current) return

    const isLargeDoc = ytext.length >= largeFileThresholdChars
    let mountedView: EditorView | null = null
    let mountedFloatingPanel: HTMLDivElement | null = null
    let cancelled = false
    setLargeFileMode(isLargeDoc)

    const handleAwarenessChange = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const states = provider.awareness!.getStates()
      console.info('[editor] awareness-change added=%o updated=%o removed=%o totalStates=%d', added, updated, removed, states.size)
      states.forEach((state, clientId) => {
        if (clientId !== provider.awareness!.clientID) {
          console.info('[editor] remote-state clientId=%d user=%o', clientId, state.user ?? null)
        }
      })
    }
    provider.awareness!.on('change', handleAwarenessChange)

    const initialComments = fileCommentsRef.current
    const anchorField = createCommentAnchorField(initialComments)
    rangeContextRef.current = { anchorField, comments: initialComments }

    const emitCommentLineNumbers = (state: EditorState) => {
      const currentComments = state.field(anchorField).comments
      onCommentLineNumbersChangeRef.current(buildCommentLineNumbers(state, anchorField, currentComments))
    }

    const handleRangeHover = (rangeId: string | null) => {
      if (pinnedRangeIdRef.current) {
        return
      }
      setFocusedCommentSpan(null)
      setFocusedCommentId(null)
      setHoveredRangeId(rangeId)
    }

    const handleRangePin = (rangeId: string) => {
      setFocusedCommentSpan(null)
      setFocusedCommentId(null)
      setPinnedRangeId((current) => (current === rangeId ? null : rangeId))
      setHoveredRangeId(rangeId)
    }

    const commentGutter = gutter({
      class: 'cm-cz-comment-gutter',
      renderEmptyElements: false,
      lineMarkerChange(update) {
        return update.selectionSet
          || update.focusChanged
          || update.docChanged
          || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(syncCommentsEffect)))
      },
      lineMarker(view, line) {
        const lineNumber = view.state.doc.lineAt(line.from).number
        const selection = canComment && view.hasFocus ? selectedLines(view.state) : null
        if (selection && lineNumber >= selection.startLine && lineNumber <= selection.endLine) {
          const edge: RangeEdge = selection.startLine === selection.endLine
            ? 'single'
            : lineNumber === selection.startLine
              ? 'start'
              : lineNumber === selection.endLine
                ? 'end'
                : 'middle'
          if (lineNumber === selection.startLine) {
            return new SelectionTriggerMarker(selection.startLine, selection.endLine, openDraftAtSelection)
          }
          return new SelectionStripeMarker(lineNumber, edge)
        }

        const currentComments = view.state.field(anchorField).comments
        const unionRanges = buildUnionRanges(view.state, anchorField, currentComments)
        const coverage = lineCoverage(lineNumber, unionRanges)
        if (coverage) {
          return new CommentRangeMarker(lineNumber, coverage, handleRangeHover, handleRangePin)
        }

        return new PlainLineMarker(lineNumber)
      },
      initialSpacer: () => new PlainLineMarker('9'),
      updateSpacer(spacer, update) {
        const nextDigits = lineNumberDigits(update.state.doc.lines)
        const prevDigits = lineNumberDigits(update.startState.doc.lines)
        if (nextDigits === prevDigits) {
          return spacer
        }
        return new PlainLineMarker('9'.repeat(nextDigits))
      },
    })

    const docText = ytext.toString()
    const editorLanguage = detectEditorLanguage(activeFile)
    const preservedSelection = preservedSelectionByFileRef.current.get(activeFile)
    const initialSelection = typeof preservedSelection === 'number'
      ? Math.min(Math.max(preservedSelection, 0), docText.length)
      : null
    let lastTextLimitAlertAt = 0

    const editorKeymap = [
      { key: 'Tab', run: insertTabCharacter },
      { key: 'Mod-Shift-ArrowUp', run: expandLineSelection('up') },
      { key: 'Mod-Shift-ArrowDown', run: expandLineSelection('down') },
      ...(!isLargeDoc && editorAutoCloseLatexBeginEnd && editorLanguage === 'latex'
        ? [{ key: 'Enter', run: autoCloseLatexBeginEnd }]
        : []),
      ...defaultKeymap,
      ...historyKeymap,
      ...(!isLargeDoc && editorBraceMatching ? closeBracketsKeymap : []),
      ...(!isLargeDoc && editorInEditorFind ? searchKeymap : []),
    ]

    const extensions = [
      anchorField,
      commentGutter,
      highlightActiveLine(),
      highlightActiveLineGutter(),
      EditorState.allowMultipleSelections.of(true),
      drawSelection(),
      EditorView.clickAddsSelectionRange.of((event) => event.altKey),
      rectangularSelection({ eventFilter: (event) => event.altKey && event.shiftKey }),
      history(),
      keymap.of(editorKeymap),
      ...(!isLargeDoc ? [langExtension(activeFile)] : []),
      oneDark,
      yCollab(ytext, provider.awareness!),
      EditorState.readOnly.of(!canEdit),
      // Keep comment mode read-only while still allowing focus/selection events.
      EditorView.editable.of(canEdit || canComment),
      ...(canEdit && typeof maxTextFileSizeBytes === 'number'
        ? [
            EditorState.transactionFilter.of((tr) => {
              if (!tr.docChanged || tr.annotation(Transaction.remote)) {
                return tr
              }

              const evaluation = evaluateUtf8Limit(
                tr.newDoc.length,
                maxTextFileSizeBytes,
                () => tr.newDoc.toString(),
              )

              if (!evaluation.exceeds) {
                return tr
              }

              const now = Date.now()
              if (now - lastTextLimitAlertAt >= 750) {
                lastTextLimitAlertAt = now
                onTextLimitExceededRef.current?.({
                  filePath: activeFile,
                  sizeBytes: evaluation.sizeBytes,
                  limitBytes: maxTextFileSizeBytes,
                })
              }

              return []
            }),
          ]
        : []),
      ...(!isLargeDoc ? [EditorView.lineWrapping] : []),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.focusChanged) {
          if (update.focusChanged) {
            onFocusChangeRef.current?.(update.view.hasFocus)
          }
          const hasSelection = canComment && selectedLines(update.state)
          if (!hasSelection) {
            // Preserve an active draft while focus moves to the draft textarea.
            if (!(draftRef.current && !update.view.hasFocus)) {
              setDraft(null)
              setDraftBody('')
            }
          }
          if (update.focusChanged && !update.view.hasFocus) {
            setPinnedRangeId(null)
            setHoveredRangeId(null)
            setFocusedCommentId(null)
            setActiveRangeOverlay(null)
          }
        }

        if (update.selectionSet || update.focusChanged || update.docChanged || update.viewportChanged) {
          const activeRangeId = pinnedRangeIdRef.current ?? hoveredRangeIdRef.current
          if (activeRangeId) {
            refreshActiveRangeOverlay(activeRangeId)
          }
        }

        if (update.docChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(syncCommentsEffect)))) {
          emitCommentLineNumbers(update.state)
        }
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ]

    if (!isLargeDoc && editorBraceMatching) {
      extensions.push(bracketMatching(), closeBrackets())
    }
    if (!isLargeDoc && editorHighlightSelectionMatches) {
      extensions.push(highlightSelectionMatches())
    }
    let floatingPanelContainer: HTMLDivElement | null = null
    if (!isLargeDoc && editorInEditorFind) {
      floatingPanelContainer = document.createElement('div')
      floatingPanelContainer.className = 'cz-floating-search-container'
      extensions.push(
        panels({ topContainer: floatingPanelContainer }),
        search({ top: true, createPanel: createComposureSearchPanel }),
      )
    }
    if (!isLargeDoc && editorAutocomplete) {
      extensions.push(autocompletion({
        override: [
          (context) => languageAwareCompletion(context, editorLanguage, {
            activeFilePath: activeFile,
            availableFilePaths: availableFilePathsRef.current,
          }),
        ],
      }))
    }

    const createView = () => {
      if (cancelled || !containerRef.current) return

      const state = EditorState.create({
        doc: docText,
        ...(initialSelection !== null ? { selection: { anchor: initialSelection } } : {}),
        extensions,
      })

      const view = new EditorView({
        state,
        parent: containerRef.current,
      })

      if (floatingPanelContainer) {
        containerRef.current.appendChild(floatingPanelContainer)
      }

      mountedView = view
      mountedFloatingPanel = floatingPanelContainer
      viewRef.current = view
      const latestComments = fileCommentsRef.current
      rangeContextRef.current!.comments = latestComments
      view.dispatch({ effects: syncCommentsEffect.of(latestComments) })
      emitCommentLineNumbers(view.state)
      setDeferredLoading(false)
    }

    let rafId: number | undefined
    if (isLargeDoc) {
      setDeferredLoading(true)
      rafId = requestAnimationFrame(createView)
    } else {
      createView()
    }

    const preservedSelectionByFile = preservedSelectionByFileRef.current

    return () => {
      cancelled = true
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId)
      }
      setDeferredLoading(false)
      const view = mountedView
      if (view) {
        const head = view.state.selection.main.head
        preservedSelectionByFile.set(activeFile, Math.min(Math.max(head, 0), view.state.doc.length))
        view.destroy()
      }
      onFocusChangeRef.current?.(false)
      provider.awareness!.off('change', handleAwarenessChange)
      mountedFloatingPanel?.remove()
      viewRef.current = null
      rangeContextRef.current = null
    }
  }, [
    ytext,
    provider,
    activeFile,
    maxTextFileSizeBytes,
    canEdit,
    canComment,
    editorBraceMatching,
    editorHighlightSelectionMatches,
    editorInEditorFind,
    editorAutocomplete,
    editorAutoCloseLatexBeginEnd,
    largeFileThresholdChars,
    openDraftAtSelection,
    refreshActiveRangeOverlay,
  ])

  const submitDraft = async () => {
    if (!draft) return
    const body = draftBody.trim()
    if (!body) return

    const draftSnapshot = {
      startLine: draft.startLine,
      endLine: draft.endLine,
      restorePosition: draft.restorePosition,
      body,
    }

    setDraft(null)
    setDraftBody('')

    const view = viewRef.current
    if (view) {
      restoreEditorSelectionAndFocus(view, draftSnapshot.restorePosition)
    }

    setDraftSubmitting(true)
    try {
      await onCreateComment({
        filePath: activeFile,
        startLine: draftSnapshot.startLine,
        endLine: draftSnapshot.endLine,
        parentCommentId: null,
        body: draftSnapshot.body,
      })
    } finally {
      const latestView = viewRef.current
      if (latestView) {
        restoreEditorSelectionAndFocus(latestView, draftSnapshot.restorePosition)
      }
      setDraftSubmitting(false)
    }
  }

  const handleDraftKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      void submitDraft()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
      setDraftBody('')
    }
  }

  const editorLanguage = detectEditorLanguage(activeFile)

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {showFormatToolbar && <FormatToolbar language={editorLanguage} editorViewRef={viewRef} disabled={!canEdit} />}
      {largeFileMode && (
        <div className="flex items-center gap-1.5 border-b border-cz-border bg-cz-surface px-3 py-1 text-[11px] text-cz-text-muted">
          <Zap size={11} className="shrink-0 opacity-60" />
          <span>
            In Large File Mode, features like syntax highlighting, line wrapping, and autocomplete are disabled
          </span>
        </div>
      )}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {deferredLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-cz-bg">
            <span className="text-sm text-cz-text-muted">Loading large file…</span>
          </div>
        )}
        <div
          ref={containerRef}
          id="editor-container"
          className="relative h-full w-full overflow-hidden"
        />

      {draft && canComment && (
        <div
          className="absolute z-20 w-[260px] rounded-lg border border-cz-border bg-cz-surface p-3 shadow-xl"
          style={{ top: `${Math.max(8, draft.top)}px`, left: `${draft.left}px` }}
        >
          <div className="mb-2 text-[11px] text-cz-text-muted">
            Comment on {draft.startLine === draft.endLine ? `line ${draft.startLine}` : `lines ${draft.startLine}-${draft.endLine}`}
          </div>
          <textarea
            autoFocus
            data-cz-comment-input="true"
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            onKeyDown={handleDraftKeyDown}
            className="h-20 w-full resize-none rounded-md border border-cz-border bg-cz-bg px-2 py-1.5 text-xs text-cz-text outline-none focus:border-cz-accent"
            placeholder="Add a comment"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void submitDraft()
              }}
              disabled={draftSubmitting || draftBody.trim().length === 0}
              className="rounded-md bg-cz-accent px-2 py-1 text-[11px] text-white disabled:opacity-60"
            >
              {draftSubmitting ? 'Posting...' : 'Comment'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null)
                setDraftBody('')
              }}
              className="rounded-md border border-cz-border px-2 py-1 text-[11px] text-cz-text-muted hover:bg-cz-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeRangeOverlay && (
        <div
          className="cz-comment-range-cards absolute z-20 w-[300px] space-y-2"
          style={{ top: `${Math.max(8, activeRangeOverlay.top)}px`, left: `${commentOverlayLeftPx}px` }}
        >
          {activeRangeOverlay.comments.map((comment) => (
            <div key={comment.id} className="rounded-lg border border-cz-border bg-cz-surface p-3 shadow-xl">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-xs font-medium text-cz-text">{comment.authorDisplayName}</div>
                <div className="ml-auto text-[11px] text-cz-text-muted">{fmtTime(comment.createdAt)}</div>
              </div>
              <div className="whitespace-pre-wrap text-xs text-cz-text-muted">{comment.body}</div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
