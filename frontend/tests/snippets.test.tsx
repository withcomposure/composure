import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expandTemplate } from '../src/editor/snippets/engine'
import { getAdapter } from '../src/editor/snippets/adapters/registry'
import { FormatToolbar } from '../src/editor/FormatToolbar'

// ── Snippet engine ───────────────────────────────────────────────────────────

describe('expandTemplate', () => {
  it('inserts template at cursor when no selection', () => {
    const result = expandTemplate('\\textbf{${selection}${cursor}}', '', true)
    expect(result.text).toBe('\\textbf{}')
    expect(result.cursorOffset).toBe(8)
  })

  it('wraps selected text', () => {
    const result = expandTemplate('**${selection}${cursor}**', 'hello', true)
    expect(result.text).toBe('**hello**')
    expect(result.cursorOffset).toBe(7)
  })

  it('ignores selection when wrapSelection is false', () => {
    const result = expandTemplate('\\includegraphics{${cursor}}', 'ignored', false)
    expect(result.text).toBe('\\includegraphics{}')
    expect(result.cursorOffset).toBe(17)
  })

  it('places cursor at end when no ${cursor} marker', () => {
    const result = expandTemplate('---', '', false)
    expect(result.text).toBe('---')
    expect(result.cursorOffset).toBe(3)
  })

  it('handles multiline templates', () => {
    const result = expandTemplate('\\begin{quote}\n${selection}${cursor}\n\\end{quote}', 'text', true)
    expect(result.text).toBe('\\begin{quote}\ntext\n\\end{quote}')
    expect(result.cursorOffset).toBe(18)
  })
})

// ── Format adapter registry ─────────────────────────────────────────────────

describe('adapter registry', () => {
  it.each(['latex', 'typst', 'markdown', 'asciidoc'] as const)('%s adapter has bold, italic, and code-inline', (lang) => {
    const adapter = getAdapter(lang)
    const ids = adapter.snippets.map((s) => s.id)
    expect(ids).toContain('bold')
    expect(ids).toContain('italic')
    expect(ids).toContain('code-inline')
  })

  it('latex adapter has environment-style bold', () => {
    const snippet = getAdapter('latex').snippets.find((s) => s.id === 'bold')!
    expect(snippet.template).toContain('\\textbf')
  })

  it('markdown adapter omits underline (not supported)', () => {
    const ids = getAdapter('markdown').snippets.map((s) => s.id)
    expect(ids).not.toContain('underline')
  })

  it('each adapter toolbar references only defined snippet IDs', () => {
    for (const lang of ['latex', 'typst', 'markdown', 'asciidoc'] as const) {
      const adapter = getAdapter(lang)
      const defined = new Set(adapter.snippets.map((s) => s.id))
      for (const slot of adapter.toolbar) {
        if (typeof slot === 'string') {
          expect(defined.has(slot), `${lang}: toolbar references unknown snippet "${slot}"`).toBe(true)
        } else {
          for (const id of slot.snippetIds) {
            expect(defined.has(id), `${lang}: group "${slot.id}" references unknown snippet "${id}"`).toBe(true)
          }
        }
      }
    }
  })
})

// ── FormatToolbar rendering ─────────────────────────────────────────────────

describe('FormatToolbar', () => {
  const viewRef = { current: null }

  it('renders pinned buttons for latex', () => {
    render(<FormatToolbar language="latex" editorViewRef={viewRef} disabled={false} />)
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByTitle('Bold')).toBeInTheDocument()
    expect(screen.getByTitle('Italic')).toBeInTheDocument()
    expect(screen.getByTitle('Inline Code')).toBeInTheDocument()
  })

  it('renders group dropdowns', () => {
    render(<FormatToolbar language="markdown" editorViewRef={viewRef} disabled={false} />)
    expect(screen.getByTitle('Headings')).toBeInTheDocument()
    expect(screen.getByTitle('Lists')).toBeInTheDocument()
    expect(screen.getByTitle('Math')).toBeInTheDocument()
  })

  it('disables all buttons when disabled prop is true', () => {
    render(<FormatToolbar language="latex" editorViewRef={viewRef} disabled={true} />)
    const toolbar = screen.getByRole('toolbar')
    const buttons = within(toolbar).getAllByRole('button')
    for (const button of buttons) {
      expect(button).toBeDisabled()
    }
  })

  it('opens headings dropdown on click', async () => {
    const user = userEvent.setup()
    render(<FormatToolbar language="latex" editorViewRef={viewRef} disabled={false} />)
    await user.click(screen.getByTitle('Headings'))
    expect(screen.getByText('Section')).toBeInTheDocument()
    expect(screen.getByText('Subsection')).toBeInTheDocument()
    expect(screen.getByText('Subsubsection')).toBeInTheDocument()
  })

  it('switches adapter when language changes', () => {
    const { rerender } = render(<FormatToolbar language="latex" editorViewRef={viewRef} disabled={false} />)
    // Latex has Link icon (pinned)
    expect(screen.getByTitle('Link')).toBeInTheDocument()
    rerender(<FormatToolbar language="markdown" editorViewRef={viewRef} disabled={false} />)
    // Still has Link for markdown
    expect(screen.getByTitle('Link')).toBeInTheDocument()
  })
})
