import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { citationCompletion } from './citation-plugin'
import { detectProjectFormatFromFilename, type ProjectFormat } from '../shared/project-format'

export type EditorLanguage = ProjectFormat

const LATEX_COMMANDS = Array.from(new Set([
  'begin',
  'end',
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
  'appendix',
  'frontmatter',
  'mainmatter',
  'backmatter',
  'documentclass',
  'usepackage',
  'title',
  'author',
  'date',
  'maketitle',
  'tableofcontents',
  'listoffigures',
  'listoftables',
  'pagenumbering',
  'pagestyle',
  'thispagestyle',
  'setlength',
  'addtolength',
  'setcounter',
  'addtocounter',
  'newcommand',
  'renewcommand',
  'providecommand',
  'newenvironment',
  'renewenvironment',
  'newtheorem',
  'emph',
  'textbf',
  'textit',
  'texttt',
  'textrm',
  'textsf',
  'textsc',
  'textsl',
  'underline',
  'sout',
  'uline',
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
  'noindent',
  'indent',
  'centering',
  'raggedright',
  'raggedleft',
  'linebreak',
  'pagebreak',
  'newpage',
  'clearpage',
  'newline',
  'hspace',
  'vspace',
  'hfill',
  'vfill',
  'hline',
  'smallskip',
  'medskip',
  'bigskip',
  'par',
  'item',
  'label',
  'ref',
  'pageref',
  'eqref',
  'nameref',
  'autoref',
  'vref',
  'cref',
  'Cref',
  'url',
  'href',
  'hyperref',
  'hypertarget',
  'hyperlink',
  'path',
  'footnote',
  'footnotemark',
  'footnotetext',
  'marginpar',
  'includegraphics',
  'caption',
  'captionof',
  'subcaption',
  'subfloat',
  'multicolumn',
  'multirow',
  'cline',
  'toprule',
  'midrule',
  'bottomrule',
  'arrayrulecolor',
  'cite',
  'citet',
  'citep',
  'citealt',
  'citealp',
  'citeauthor',
  'citeyear',
  'citeyearpar',
  'citenum',
  'nocite',
  'bibliography',
  'bibliographystyle',
  'addbibresource',
  'printbibliography',
  'input',
  'include',
  'includeonly',
  'subfile',
  'import',
  'subimport',
  'includesvg',
  'includepdf',
  'lstinputlisting',
  'verbatiminput',
  'inputminted',
  'DTLloaddb',
  'pgfplotstableread',
  'frac',
  'dfrac',
  'tfrac',
  'cfrac',
  'sqrt',
  'sum',
  'prod',
  'int',
  'oint',
  'iint',
  'iiint',
  'lim',
  'inf',
  'sup',
  'max',
  'min',
  'log',
  'ln',
  'exp',
  'sin',
  'cos',
  'tan',
  'sec',
  'csc',
  'cot',
  'arcsin',
  'arccos',
  'arctan',
  'binom',
  'tbinom',
  'dbinom',
  'partial',
  'nabla',
  'infty',
  'cdot',
  'cdots',
  'ldots',
  'ddots',
  'vdots',
  'times',
  'div',
  'pm',
  'mp',
  'leq',
  'geq',
  'neq',
  'approx',
  'equiv',
  'sim',
  'simeq',
  'subset',
  'supset',
  'subseteq',
  'supseteq',
  'in',
  'notin',
  'cup',
  'cap',
  'setminus',
  'emptyset',
  'varnothing',
  'forall',
  'exists',
  'nexists',
  'neg',
  'land',
  'lor',
  'to',
  'Rightarrow',
  'Leftrightarrow',
  'leftarrow',
  'rightarrow',
  'Leftarrow',
  'leftrightarrow',
  'mapsto',
  'hookrightarrow',
  'uparrow',
  'downarrow',
  'updownarrow',
  'overline',
  'underbrace',
  'overbrace',
  'hat',
  'tilde',
  'bar',
  'vec',
  'dot',
  'ddot',
  'acute',
  'grave',
  'left',
  'right',
  'bigl',
  'bigr',
  'Bigl',
  'Bigr',
  'langle',
  'rangle',
  'lfloor',
  'rfloor',
  'lceil',
  'rceil',
  'mathbb',
  'mathbf',
  'mathrm',
  'mathit',
  'mathsf',
  'mathtt',
  'mathcal',
  'mathscr',
  'mathfrak',
  'boldsymbol',
  'text',
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'scriptscriptstyle',
  'tag',
  'notag',
  'nonumber',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'varpi',
  'rho',
  'varrho',
  'sigma',
  'varsigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
  'color',
  'textcolor',
  'colorbox',
  'fcolorbox',
  'definecolor',
  'draw',
  'fill',
  'node',
  'coordinate',
  'pgfplotsset',
  'today',
  'LaTeX',
  'TeX',
  'dots',
  'protect',
  'ensuremath',
  'mbox',
  'makebox',
  'framebox',
  'fbox',
  'rule',
  'phantom',
  'hphantom',
  'vphantom',
  'index',
  'glossary',
]))

const LATEX_FILE_ARGUMENT_COMMANDS = [
  'input',
  'include',
  'subfile',
  'import',
  'subimport',
  'includegraphics',
  'includesvg',
  'includepdf',
  'lstinputlisting',
  'verbatiminput',
  'inputminted',
  'bibliography',
  'addbibresource',
  'DTLloaddb',
  'pgfplotstableread',
  'includeonly',
] as const

const LATEX_FILE_COMMAND_EXTENSIONS: Record<string, readonly string[]> = {
  includegraphics: ['.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg'],
  includesvg: ['.svg'],
  includepdf: ['.pdf'],
  lstinputlisting: ['.py', '.js', '.ts', '.c', '.cpp', '.java', '.sh', '.txt'],
  verbatiminput: ['.txt', '.log'],
  inputminted: ['.py', '.js', '.ts', '.c', '.cpp', '.java', '.sh', '.rb'],
  bibliography: ['.bib'],
  addbibresource: ['.bib'],
}

const LATEX_FILE_COMMANDS_STRIP_EXTENSIONS = new Set(['input', 'include', 'subfile', 'bibliography'])

const latexFileCommandsRegexSource = LATEX_FILE_ARGUMENT_COMMANDS
  .map((command) => command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

const LATEX_FILE_ARGUMENT_MATCH_PATTERN = new RegExp(
  String.raw`\\(?:${latexFileCommandsRegexSource})(?:\[[^\]]*\])?\{[^}]*$`,
)

const LATEX_FILE_ARGUMENT_EXTRACT_PATTERN = new RegExp(
  String.raw`^\\(${latexFileCommandsRegexSource})(?:\[[^\]]*\])?\{([^}]*)$`,
)

const LATEX_ENVIRONMENTS = [
  'document',
  'abstract',
  'figure',
  'table',
  'tabular',
  'equation',
  'align',
  'align*',
  'gather',
  'multline',
  'thebibliography',
  'itemize',
  'enumerate',
  'description',
  'quote',
  'quotation',
  'verbatim',
  'lstlisting',
  'tikzpicture',
  'center',
]

const TYPST_DIRECTIVES = [
  'set',
  'show',
  'let',
  'if',
  'else',
  'for',
  'while',
  'break',
  'continue',
  'return',
  'import',
  'include',
  'context',
  'align(',
  'box(',
  'columns(',
  'figure(',
  'grid(',
  'heading(',
  'image(',
  'link(',
  'list(',
  'numbering(',
  'page(',
  'par(',
  'quote(',
  'raw(',
  'rect(',
  'ref(',
  'table(',
  'text(',
]

interface PathCompletionContext {
  activeFilePath: string
  availableFilePaths: readonly string[]
}

type PathSuggestionKind = 'directory' | 'file'

export interface PathSuggestion {
  value: string
  kind: PathSuggestionKind
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function normalizeFragmentSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function dirname(path: string): string {
  const normalized = normalizeSlashes(path)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function stripFileExtension(path: string): string {
  return path.replace(/\.[^./]+$/, '')
}

function toRelativePath(fromFilePath: string, toFilePath: string): string {
  const fromDir = dirname(fromFilePath)
  const fromParts = fromDir ? fromDir.split('/') : []
  const toParts = normalizeSlashes(toFilePath).split('/').filter(Boolean)

  let commonPrefix = 0
  while (
    commonPrefix < fromParts.length
    && commonPrefix < toParts.length
    && fromParts[commonPrefix] === toParts[commonPrefix]
  ) {
    commonPrefix += 1
  }

  const up = fromParts.slice(commonPrefix).map(() => '..')
  const down = toParts.slice(commonPrefix)
  return [...up, ...down].join('/')
}

function hasAllowedExtension(filePath: string, command: string): boolean {
  const allowed = LATEX_FILE_COMMAND_EXTENSIONS[command]
  if (!allowed) return true
  const lowercase = filePath.toLowerCase()
  return allowed.some((ext) => lowercase.endsWith(ext))
}

function hasExtensionFilter(command: string): boolean {
  return Boolean(LATEX_FILE_COMMAND_EXTENSIONS[command])
}

function formatCandidatePath(filePath: string, command: string): string {
  return LATEX_FILE_COMMANDS_STRIP_EXTENSIONS.has(command)
    ? stripFileExtension(filePath)
    : filePath
}

function fragmentQuery(fragment: string): string {
  if (fragment.startsWith('./')) {
    return fragment.slice(2)
  }
  if (fragment.startsWith('/')) {
    return fragment.slice(1)
  }
  return fragment
}

function candidateMatchesFragment(candidate: string, fragment: string): boolean {
  const query = fragmentQuery(fragment).toLowerCase()
  if (!query) return true
  return candidate.toLowerCase().includes(query)
}

function matchIndex(candidate: string, fragment: string): number {
  const query = fragmentQuery(fragment).toLowerCase()
  if (!query) return 0
  return candidate.toLowerCase().indexOf(query)
}

function alignCandidateWithFragment(candidate: string, fragment: string): string {
  if (fragment.startsWith('./') && !candidate.startsWith('./') && !candidate.startsWith('../')) {
    return `./${candidate}`
  }
  if (fragment.startsWith('/') && !candidate.startsWith('/')) {
    return `/${candidate}`
  }
  return candidate
}

function collectParentDirectories(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  const directories: string[] = []
  for (let index = 1; index < parts.length; index += 1) {
    directories.push(`${parts.slice(0, index).join('/')}/`)
  }
  return directories
}

function addSuggestion(target: Map<string, PathSuggestionKind>, value: string, kind: PathSuggestionKind): void {
  const existing = target.get(value)
  if (existing === 'file' || (existing === 'directory' && kind === 'directory')) {
    return
  }
  target.set(value, kind)
}

export function suggestLatexFilePaths(
  commandRaw: string,
  partialPath: string,
  activeFilePath: string,
  availableFilePaths: readonly string[],
): PathSuggestion[] {
  const command = commandRaw.toLowerCase()
  const fragment = normalizeFragmentSlashes(partialPath)
  const activeNormalized = normalizeSlashes(activeFilePath)
  const includeDirectories = !hasExtensionFilter(command)
  const entries = new Map<string, PathSuggestionKind>()

  for (const rawPath of availableFilePaths) {
    const normalized = normalizeSlashes(rawPath)
    if (!normalized || normalized === activeNormalized) {
      continue
    }
    if (!hasAllowedExtension(normalized, command)) {
      continue
    }

    const rootPath = formatCandidatePath(normalized, command)
    const relativePath = formatCandidatePath(toRelativePath(activeNormalized, normalized), command)

    for (const candidate of [relativePath, rootPath]) {
      if (!candidate) continue
      addSuggestion(entries, candidate, 'file')
      if (includeDirectories) {
        for (const directory of collectParentDirectories(candidate)) {
          addSuggestion(entries, directory, 'directory')
        }
      }
    }
  }

  const filtered = Array.from(entries.entries())
    .filter(([candidate]) => candidateMatchesFragment(candidate, fragment))
    .map(([candidate, kind]) => ({
      value: alignCandidateWithFragment(candidate, fragment),
      kind,
    }))

  const preferDirectories = fragment.endsWith('/')
  filtered.sort((left, right) => {
    if (left.kind !== right.kind) {
      if (preferDirectories) {
        return left.kind === 'directory' ? -1 : 1
      }
      return left.kind === 'file' ? -1 : 1
    }

    const leftMatchIndex = matchIndex(left.value, fragment)
    const rightMatchIndex = matchIndex(right.value, fragment)
    if (leftMatchIndex !== rightMatchIndex) {
      return leftMatchIndex - rightMatchIndex
    }

    const leftRelative = left.value.startsWith('../') ? 1 : 0
    const rightRelative = right.value.startsWith('../') ? 1 : 0
    if (leftRelative !== rightRelative) {
      return leftRelative - rightRelative
    }

    if (left.value.length !== right.value.length) {
      return left.value.length - right.value.length
    }
    return left.value.localeCompare(right.value)
  })

  const deduped = new Map<string, PathSuggestion>()
  for (const entry of filtered) {
    deduped.set(entry.value, entry)
  }
  return Array.from(deduped.values())
}

function latexFilePathCompletion(context: CompletionContext, paths: PathCompletionContext): CompletionResult | null {
  if (!paths.activeFilePath || paths.availableFilePaths.length === 0) {
    return null
  }

  const match = context.matchBefore(LATEX_FILE_ARGUMENT_MATCH_PATTERN)
  if (!match) {
    return null
  }

  const parsed = LATEX_FILE_ARGUMENT_EXTRACT_PATTERN.exec(match.text)
  if (!parsed) {
    return null
  }

  const command = parsed[1]
  const argumentText = parsed[2] ?? ''
  const lastComma = argumentText.lastIndexOf(',')
  const segmentStart = lastComma >= 0 ? lastComma + 1 : 0
  const segmentWithWhitespace = argumentText.slice(segmentStart)
  const leadingWhitespace = segmentWithWhitespace.length - segmentWithWhitespace.trimStart().length
  const pathFragment = segmentWithWhitespace.slice(leadingWhitespace)
  const from = match.from + match.text.lastIndexOf('{') + 1 + segmentStart + leadingWhitespace

  const suggestions = suggestLatexFilePaths(command, pathFragment, paths.activeFilePath, paths.availableFilePaths)
  if (!suggestions.length) {
    return null
  }

  return {
    from,
    options: suggestions.map((suggestion) => ({
      label: suggestion.value,
      detail: suggestion.kind === 'directory' ? 'directory' : 'file',
      type: suggestion.kind === 'directory' ? 'namespace' : 'variable',
      boost: suggestion.kind === 'directory' ? 90 : 70,
    })),
    validFor: /^[^}\s,]*$/,
  }
}

export function detectEditorLanguage(filename: string): EditorLanguage {
  return detectProjectFormatFromFilename(filename, true) ?? 'markdown'
}

function latexCompletion(context: CompletionContext): CompletionResult | null {
  const envMatch = context.matchBefore(/\\(?:begin|end)\{[A-Za-z*]*$/)
  if (envMatch) {
    const isBeginEnvironment = envMatch.text.startsWith('\\begin{')
    const from = envMatch.from + envMatch.text.lastIndexOf('{') + 1
    return {
      from,
      options: LATEX_ENVIRONMENTS.map((label) => ({
        label,
        type: 'keyword',
        ...(isBeginEnvironment
          ? {
            apply: (view: EditorView, completion: Completion, completionFrom: number, completionTo: number) => {
              applyLatexBeginEnvironmentCompletion(view, completion, completionFrom, completionTo)
            },
          }
          : {}),
      })),
      validFor: /^[A-Za-z*]*$/,
    }
  }

  const commandMatch = context.matchBefore(/\\[A-Za-z]*$/)
  if (commandMatch) {
    return {
      from: commandMatch.from + 1,
      options: LATEX_COMMANDS.map((label) => ({
        label,
        type: 'keyword',
      })),
      validFor: /^[A-Za-z]*$/,
    }
  }

  return null
}

function applyLatexBeginEnvironmentCompletion(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
): void {
  const environmentName = completion.label
  const line = view.state.doc.lineAt(from)
  const linePrefix = view.state.doc.sliceString(line.from, from)
  const beginPrefixMatch = linePrefix.match(/^(\s*)\\begin\{[A-Za-z*]*$/)

  if (!beginPrefixMatch) {
    const replaceTo = to + (view.state.doc.sliceString(to, to + 1) === '}' ? 1 : 0)
    view.dispatch({
      changes: { from, to: replaceTo, insert: environmentName },
      selection: { anchor: from + environmentName.length },
      scrollIntoView: true,
      userEvent: 'input.complete',
    })
    return
  }

  const baseIndent = beginPrefixMatch[1] ?? ''
  const beginFrom = line.from + baseIndent.length
  const replaceTo = to + (view.state.doc.sliceString(to, to + 1) === '}' ? 1 : 0)
  const insert = `\\begin{${environmentName}}\n${baseIndent}\n${baseIndent}\\end{${environmentName}}`
  const cursor = beginFrom + `\\begin{${environmentName}}\n${baseIndent}`.length

  view.dispatch({
    changes: { from: beginFrom, to: replaceTo, insert },
    selection: { anchor: cursor },
    scrollIntoView: true,
    userEvent: 'input.complete',
  })
}

function typstCompletion(context: CompletionContext): CompletionResult | null {
  const directiveMatch = context.matchBefore(/#[A-Za-z-]*$/)
  if (!directiveMatch) {
    return null
  }

  return {
    from: directiveMatch.from + 1,
    options: TYPST_DIRECTIVES.map((label) => ({
      label,
      type: 'keyword',
    })),
    validFor: /^[A-Za-z-]*$/,
  }
}

export async function languageAwareCompletion(
  context: CompletionContext,
  language: EditorLanguage,
  pathContext?: PathCompletionContext,
): Promise<CompletionResult | null> {
  if (language === 'latex' || language === 'typst') {
    const citations = await citationCompletion(context)
    if (citations) {
      return citations
    }
  }

  if (language === 'latex') {
    if (pathContext) {
      const filePaths = latexFilePathCompletion(context, pathContext)
      if (filePaths) {
        return filePaths
      }
    }

    return latexCompletion(context)
  }

  if (language === 'typst') {
    return typstCompletion(context)
  }

  return null
}
