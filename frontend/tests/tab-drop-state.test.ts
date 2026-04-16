import { describe, expect, it } from 'vitest'
import {
  applyDroppedPathsToPaneState,
} from '../src/editor/tab-drop-state'
import type { EditorPaneState } from '../src/editor/workspace-state'

function pane(tabs: string[], activePath?: string): EditorPaneState {
  return {
    tabs: tabs.map((path) => ({ path, isEphemeral: false })),
    activePath: activePath ?? tabs[0] ?? '',
    showSnippetToolbar: true,
  }
}

describe('tab-drop-state multi-pane regression', () => {
  it('removes moved tab from source pane only', () => {
    const prev = {
      'pane-x': pane(['a.tex', 'x.tex'], 'a.tex'),
      'pane-y': pane(['b.tex'], 'b.tex'),
      'pane-z': pane(['a.tex', 'z.tex'], 'a.tex'),
    }

    const next = applyDroppedPathsToPaneState(prev, 'pane-y', ['a.tex'], {
      fromTabBar: true,
      sourcePaneId: 'pane-x',
    })

    expect(next['pane-x']?.tabs.map((tab) => tab.path)).toEqual(['x.tex'])
    expect(next['pane-y']?.tabs.map((tab) => tab.path)).toEqual(['b.tex', 'a.tex'])
    expect(next['pane-z']?.tabs.map((tab) => tab.path)).toEqual(['a.tex', 'z.tex'])
  })

  it('appends to end when target already has the file', () => {
    const prev = {
      'pane-x': pane(['a.tex'], 'a.tex'),
      'pane-y': pane(['a.tex', 'chapter.tex'], 'chapter.tex'),
    }

    const next = applyDroppedPathsToPaneState(prev, 'pane-y', ['a.tex'], {
      fromTabBar: true,
      sourcePaneId: 'pane-x',
      targetIndex: 0,
    })

    expect(next['pane-y']?.tabs.map((tab) => tab.path)).toEqual(['chapter.tex', 'a.tex'])
    expect(next['pane-y']?.activePath).toBe('a.tex')
  })

  it('uses non-destructive fallback when source pane is missing', () => {
    const prev = {
      'pane-x': pane(['a.tex'], 'a.tex'),
      'pane-y': pane(['b.tex'], 'b.tex'),
    }

    const next = applyDroppedPathsToPaneState(prev, 'pane-y', ['a.tex'], {
      fromTabBar: true,
      sourcePaneId: null,
    })

    expect(next['pane-x']?.tabs.map((tab) => tab.path)).toEqual(['a.tex'])
    expect(next['pane-y']?.tabs.map((tab) => tab.path)).toEqual(['b.tex', 'a.tex'])
  })
})
