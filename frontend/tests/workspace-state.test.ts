import { describe, expect, it } from 'vitest'
import {
  ROOT_PANE_ID,
  buildPersistedWorkspaceState,
  defaultPersistedWorkspaceState,
  getNextPaneIdCounter,
  getNextSplitIdCounter,
  parsePersistedWorkspaceState,
  type PersistedWorkspaceState,
} from '../src/editor/workspace-state'

describe('workspace-state parsing', () => {
  it('normalizes widths, tabs, and active pane references', () => {
    const parsed = parsePersistedWorkspaceState({
      sidebarOpen: false,
      sidebarTab: 'history',
      sidebarWidth: 9999,
      previewOpen: false,
      previewWidth: 10,
      activePaneId: 'pane-9',
      activeFile: 'docs/main.tex',
      paneStateById: {
        'pane-2': {
          tabs: [
            { path: 'docs/main.tex', isEphemeral: false },
            { path: 'docs/main.tex', isEphemeral: true },
            { path: '   ', isEphemeral: false },
          ],
          activePath: 'does-not-exist.tex',
        },
      },
      editorLayout: {
        kind: 'pane',
        paneId: 'pane-2',
      },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.sidebarOpen).toBe(false)
    expect(parsed?.sidebarTab).toBe('history')
    expect(parsed?.sidebarWidth).toBe(420)
    expect(parsed?.previewOpen).toBe(false)
    expect(parsed?.previewWidth).toBe(300)
    expect(parsed?.activePaneId).toBe('pane-2')
    expect(parsed?.paneStateById['pane-2']?.tabs).toEqual([
      { kind: 'file', path: 'docs/main.tex', isEphemeral: false },
    ])
    expect(parsed?.paneStateById['pane-2']?.activePath).toBe('docs/main.tex')
    expect(parsed?.paneStateById['pane-2']?.showSnippetToolbar).toBe(true)
  })

  it('falls back to default root pane when layout is malformed', () => {
    const parsed = parsePersistedWorkspaceState({
      sidebarOpen: true,
      paneStateById: {},
      editorLayout: {
        kind: 'split',
        splitId: 'split-1',
        orientation: 'horizontal',
        ratio: 0.5,
        first: { kind: 'pane', paneId: 'pane-1' },
        second: { kind: 'pane', paneId: 'pane-1' },
      },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.editorLayout).toEqual({ kind: 'pane', paneId: ROOT_PANE_ID })
    expect(parsed?.paneStateById[ROOT_PANE_ID]).toEqual({ tabs: [], activePath: '', showSnippetToolbar: true })
  })

  it('preserves diff tabs and their settings when parsing', () => {
    const diffTabPath = 'diff:deadbeef:docs/main.tex'
    const parsed = parsePersistedWorkspaceState({
      activePaneId: 'pane-1',
      activeFile: diffTabPath,
      paneStateById: {
        'pane-1': {
          tabs: [
            {
              kind: 'diff',
              path: diffTabPath,
              filePath: 'docs/main.tex',
              commitSha: 'deadbeef',
              diffMode: 'inline',
              diffBase: 'current',
            },
          ],
          activePath: diffTabPath,
        },
      },
      editorLayout: { kind: 'pane', paneId: 'pane-1' },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.activeFile).toBe(diffTabPath)
    expect(parsed?.paneStateById['pane-1']?.tabs).toEqual([
      {
        kind: 'diff',
        path: diffTabPath,
        filePath: 'docs/main.tex',
        commitSha: 'deadbeef',
        diffMode: 'inline',
        diffBase: 'current',
      },
    ])
  })

  it('builds a canonical state payload', () => {
    const built = buildPersistedWorkspaceState({
      sidebarOpen: true,
      sidebarTab: 'review',
      sidebarWidth: 260,
      previewOpen: true,
      previewWidth: 520,
      activePaneId: 'pane-3',
      activeFile: 'src/chapter.tex',
      paneStateById: {
        'pane-3': {
          tabs: [{ kind: 'file', path: 'src/chapter.tex', isEphemeral: true }],
          activePath: 'src/chapter.tex',
          showSnippetToolbar: false,
        },
      },
      editorLayout: {
        kind: 'pane',
        paneId: 'pane-3',
      },
    })

    expect(built.version).toBe(1)
    expect(built.sidebarTab).toBe('review')
    expect(built.activePaneId).toBe('pane-3')
  })
})

describe('workspace-state counters', () => {
  it('computes next pane and split counters from existing IDs', () => {
    const state: PersistedWorkspaceState = {
      ...defaultPersistedWorkspaceState(),
      paneStateById: {
        'pane-2': { tabs: [], activePath: '', showSnippetToolbar: true },
        'pane-10': { tabs: [], activePath: '', showSnippetToolbar: true },
      },
      editorLayout: {
        kind: 'split',
        splitId: 'split-8',
        orientation: 'horizontal',
        ratio: 0.5,
        first: { kind: 'pane', paneId: 'pane-2' },
        second: {
          kind: 'split',
          splitId: 'split-11',
          orientation: 'vertical',
          ratio: 0.5,
          first: { kind: 'pane', paneId: 'pane-10' },
          second: { kind: 'pane', paneId: 'pane-4' },
        },
      },
    }

    expect(getNextPaneIdCounter(state.editorLayout, state.paneStateById)).toBe(11)
    expect(getNextSplitIdCounter(state.editorLayout)).toBe(12)
  })
})
