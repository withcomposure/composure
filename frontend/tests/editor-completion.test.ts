import { describe, expect, it } from 'vitest'
import { suggestLatexFilePaths } from '../src/editor/editor-completion'

describe('suggestLatexFilePaths', () => {
  it('filters includegraphics paths to image-like extensions', () => {
    const suggestions = suggestLatexFilePaths(
      'includegraphics',
      'fi',
      'chapters/ch1.tex',
      [
        'figures/plot.png',
        'figures/plot.pdf',
        'figures/diagram.svg',
        'figures/source.typ',
        'chapters/fig-local.jpg',
      ],
    )

    const labels = suggestions.filter((entry) => entry.kind === 'file').map((entry) => entry.value)

    expect(labels).toContain('fig-local.jpg')
    expect(labels).toContain('figures/plot.png')
    expect(labels).toContain('figures/plot.pdf')
    expect(labels).toContain('figures/diagram.svg')
    expect(labels.some((label) => label.endsWith('.typ'))).toBe(false)
    expect(suggestions.some((entry) => entry.kind === 'directory')).toBe(false)
  })

  it('strips extension for bibliography and input-style commands', () => {
    const bibliography = suggestLatexFilePaths('bibliography', '', 'main.tex', [
      'refs/library.bib',
      'refs/extra.bib',
      'refs/readme.md',
    ])
    const bibliographyFiles = bibliography.filter((entry) => entry.kind === 'file').map((entry) => entry.value)

    expect(bibliographyFiles).toContain('refs/library')
    expect(bibliographyFiles).toContain('refs/extra')
    expect(bibliographyFiles.some((label) => label.endsWith('.bib'))).toBe(false)

    const input = suggestLatexFilePaths('input', '', 'main.tex', ['chapters/intro.tex'])
    const inputFiles = input.filter((entry) => entry.kind === 'file').map((entry) => entry.value)

    expect(inputFiles).toContain('chapters/intro')
    expect(inputFiles.some((label) => label.endsWith('.tex'))).toBe(false)
  })

  it('aligns suggestions with ./ prefix when fragment starts with dot slash', () => {
    const suggestions = suggestLatexFilePaths('input', './sn', 'main.tex', ['snippets/intro.tex'])
    const labels = suggestions.filter((entry) => entry.kind === 'file').map((entry) => entry.value)

    expect(labels).toContain('./snippets/intro')
  })

  it('keeps matching when fragment starts with slash', () => {
    const suggestions = suggestLatexFilePaths('includegraphics', '/abacus', 'main.tex', [
      'aa/bb/abacus.png',
      'aa/bb/other.jpg',
    ])
    const labels = suggestions.filter((entry) => entry.kind === 'file').map((entry) => entry.value)

    expect(labels).toContain('/aa/bb/abacus.png')
    expect(labels.some((label) => label.endsWith('other.jpg'))).toBe(false)
  })

  it('matches fragment anywhere in the file path', () => {
    const suggestions = suggestLatexFilePaths('includegraphics', 'abacus', 'main.tex', [
      'aa/bb/abacus.png',
      'figures/cover.pdf',
    ])
    const labels = suggestions.filter((entry) => entry.kind === 'file').map((entry) => entry.value)

    expect(labels).toContain('aa/bb/abacus.png')
    expect(labels.some((label) => label.includes('cover.pdf'))).toBe(false)
  })
})
