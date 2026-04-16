import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const chalky = '#e5c07b',
  coral = '#e06c75',
  cyan = '#56b6c2',
  invalid = '#ffffff',
  ivory = '#cdd6e4',
  stone = '#7d8799',
  malibu = '#61afef',
  sage = '#98c379',
  whiskey = '#d19a66',
  violet = '#c678dd'

/** Dark theme for CodeMirror matching Composure's design tokens */
const oneDarkTheme = EditorView.theme(
  {
    '&': {
      color: ivory,
      backgroundColor: '#0a0a0f',
    },
    '.cm-content': {
      caretColor: '#6366f1',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#6366f1',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
      },
    '.cm-panels': { backgroundColor: '#12121a', color: ivory },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #1e1e2e' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid #1e1e2e' },
    '.cm-searchMatch': {
      backgroundColor: '#72a1ff59',
      outline: '1px solid #457dff',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#6199ff2f',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(99, 102, 241, 0.06)' },
    '.cm-selectionMatch': { backgroundColor: '#aafe661a' },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: '#bad0f847',
    },
    '.cm-gutters': {
      backgroundColor: '#12121a',
      color: '#7a7a8e',
      border: 'none',
      borderRight: '1px solid #1e1e2e',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(99, 102, 241, 0.08)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: 'none',
      color: '#7a7a8e',
    },
    '.cm-tooltip': {
      border: '1px solid #1e1e2e',
      backgroundColor: '#12121a',
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: '#12121a',
      borderBottomColor: '#12121a',
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        color: ivory,
      },
    },
  },
  { dark: true },
)

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: violet },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: coral },
  { tag: [tags.function(tags.variableName), tags.labelName], color: malibu },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: whiskey },
  { tag: [tags.definition(tags.name), tags.separator], color: ivory },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: chalky },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: cyan },
  { tag: [tags.meta, tags.comment], color: stone },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: stone, textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold', color: coral },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: whiskey },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: sage },
  { tag: tags.invalid, color: invalid },
])

export const oneDark = [oneDarkTheme, syntaxHighlighting(highlightStyle)]
