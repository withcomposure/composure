import { describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileTabs } from '../src/editor/FileTabs'
import {
  TAB_SINGLE_PATH_MIME,
  TAB_SOURCE_PANE_MIME,
  writeComposureDragPayload,
} from '../src/utils/drag-data'

function fileTab(path: string, isEphemeral: boolean) {
  return { kind: 'file' as const, path, isEphemeral }
}

describe('FileTabs', () => {
  it('renders and handles snippet toolbar toggle button', async () => {
    const user = userEvent.setup()
    const onToggleSnippetToolbar = vi.fn<() => void>()

    render(
      <FileTabs
        paneId="pane-1"
        tabs={[]}
        activeFile=""
        onActivate={() => undefined}
        onClose={() => undefined}
        onPromote={() => undefined}
        onMove={() => undefined}
        snippetToolbarVisible={false}
        onToggleSnippetToolbar={onToggleSnippetToolbar}
      />,
    )

    await user.hover(screen.getByTestId('file-tabs-bar'))
    const toggle = screen.getByTestId('file-tabs-toolbar-toggle-pane-1')
    expect(toggle).toHaveAttribute('aria-label', 'Show snippet toolbar')
    await user.click(toggle)
    expect(onToggleSnippetToolbar).toHaveBeenCalledTimes(1)
  })

  it('activates a tab when clicked', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn<(path: string) => void>()

    render(
      <FileTabs
        paneId="pane-1"
        tabs={[
          fileTab('main.tex', true),
          fileTab('chapters/intro.tex', false),
        ]}
        activeFile="main.tex"
        onActivate={onActivate}
        onClose={() => undefined}
        onPromote={() => undefined}
        onMove={() => undefined}
      />,
    )

    await user.click(screen.getByTestId('file-tab-chapters/intro.tex'))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith('chapters/intro.tex')
  })

  it('renders diff tabs as "filename @ short-hash"', () => {
    render(
      <FileTabs
        paneId="pane-1"
        tabs={[
          {
            kind: 'diff',
            path: 'diff:deadbeef:chapters/intro.tex',
            filePath: 'chapters/intro.tex',
            commitSha: 'deadbeef',
            diffMode: 'side-by-side',
            diffBase: 'parent',
          },
        ]}
        activeFile="diff:deadbeef:chapters/intro.tex"
        onActivate={() => undefined}
        onClose={() => undefined}
        onPromote={() => undefined}
        onMove={() => undefined}
      />,
    )

    expect(screen.getByText('intro.tex @ deadbee')).toBeInTheDocument()
    expect(screen.getByTestId('file-tab-diff:deadbeef:chapters/intro.tex')).toHaveAttribute(
      'title',
      'chapters/intro.tex @ deadbee',
    )
  })

  it('promotes a preview tab on double-click', async () => {
    const user = userEvent.setup()
    const onPromote = vi.fn<(path: string) => void>()

    render(
      <FileTabs
        paneId="pane-1"
        tabs={[fileTab('main.tex', true)]}
        activeFile="main.tex"
        onActivate={() => undefined}
        onClose={() => undefined}
        onPromote={onPromote}
        onMove={() => undefined}
      />,
    )

    await user.dblClick(screen.getByTestId('file-tab-main.tex'))
    expect(onPromote).toHaveBeenCalledTimes(1)
    expect(onPromote).toHaveBeenCalledWith('main.tex')
  })

  it('closes a tab with the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn<(path: string) => void>()

    render(
      <FileTabs
        paneId="pane-1"
        tabs={[fileTab('main.tex', true)]}
        activeFile="main.tex"
        onActivate={() => undefined}
        onClose={onClose}
        onPromote={() => undefined}
        onMove={() => undefined}
      />,
    )

    await user.hover(screen.getByTestId('file-tab-main.tex'))
    await user.click(screen.getByRole('button', { name: 'Close main.tex' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('main.tex')
  })

  it('closes a tab on middle click', () => {
    const onClose = vi.fn<(path: string) => void>()
    const onActivate = vi.fn<(path: string) => void>()

    render(
      <FileTabs
        paneId="pane-1"
        tabs={[fileTab('main.tex', true)]}
        activeFile="main.tex"
        onActivate={onActivate}
        onClose={onClose}
        onPromote={() => undefined}
        onMove={() => undefined}
      />,
    )

    const tab = screen.getByTestId('file-tab-main.tex')
    fireEvent.mouseDown(tab, { button: 1 })
    fireEvent(tab, new MouseEvent('auxclick', { button: 1, bubbles: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('main.tex')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('requests tab move on drop anywhere in tab bar', () => {
    const onMove = vi.fn<(path: string, targetIndex: number) => void>()

    render(
      <FileTabs
        paneId="pane-1"
        tabs={[
          fileTab('main.tex', true),
          fileTab('chapters/intro.tex', false),
        ]}
        activeFile="main.tex"
        onActivate={() => undefined}
        onClose={() => undefined}
        onPromote={() => undefined}
        onMove={onMove}
      />,
    )

    const tabBar = screen.getByTestId('file-tabs-bar')
    const firstTab = screen.getByTestId('file-tab-main.tex')
    const secondTab = screen.getByTestId('file-tab-chapters/intro.tex')

    vi.spyOn(tabBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: 28,
      top: 0,
      right: 300,
      bottom: 28,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    vi.spyOn(firstTab, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 80,
      height: 28,
      top: 0,
      right: 80,
      bottom: 28,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    vi.spyOn(secondTab, 'getBoundingClientRect').mockReturnValue({
      x: 90,
      y: 0,
      width: 110,
      height: 28,
      top: 0,
      right: 200,
      bottom: 28,
      left: 90,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.dragStart(screen.getByTestId('file-tab-main.tex'))
    const dragOverEvent = createEvent.dragOver(tabBar)
    Object.defineProperty(dragOverEvent, 'clientX', { value: 110 })
    fireEvent(tabBar, dragOverEvent)

    expect(screen.getByTestId('file-tabs-drop-indicator')).toBeInTheDocument()

    const dropEvent = createEvent.drop(tabBar)
    Object.defineProperty(dropEvent, 'clientX', { value: 110 })
    fireEvent(tabBar, dropEvent)

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledWith('main.tex', 1)
  })

  it('maps vertical wheel movement to horizontal scrolling when overflowed', () => {
    render(
      <FileTabs
        paneId="pane-1"
        tabs={[
          fileTab('main.tex', true),
          fileTab('chapters/intro.tex', false),
          fileTab('chapters/methods.tex', false),
        ]}
        activeFile="main.tex"
        onActivate={() => undefined}
        onClose={() => undefined}
        onPromote={() => undefined}
        onMove={() => undefined}
      />,
    )

    const tabBar = screen.getByTestId('file-tabs-bar')

    Object.defineProperty(tabBar, 'clientWidth', {
      value: 200,
      configurable: true,
    })
    Object.defineProperty(tabBar, 'scrollWidth', {
      value: 600,
      configurable: true,
    })

    tabBar.scrollLeft = 10
    fireEvent.wheel(tabBar, { deltaY: 48, deltaX: 0 })

    expect(tabBar.scrollLeft).toBe(58)
  })

  it('uses non-selectable intrinsic-width tabs', () => {
    render(
      <FileTabs
        paneId="pane-1"
        tabs={[
          fileTab('a.tex', true),
          fileTab('chapters/intro.tex', false),
        ]}
        activeFile="a.tex"
        onActivate={() => undefined}
        onClose={() => undefined}
        onPromote={() => undefined}
        onMove={() => undefined}
      />,
    )

    const tabBar = screen.getByTestId('file-tabs-bar')
    const shortTab = screen.getByTestId('file-tab-a.tex')

    expect(tabBar.className).toContain('select-none')
    expect(shortTab.className).toContain('select-none')
    expect(shortTab.className).toContain('w-fit')
    expect(shortTab.className).toContain('grow-0')
    expect(shortTab.className).toContain('shrink-0')
    expect(shortTab.className).not.toContain('flex-1')
  })

  it('accepts external file-tree multi-drop payloads', () => {
    const onDropPaths = vi.fn()

    render(
      <FileTabs
        paneId="pane-2"
        tabs={[fileTab('main.tex', true)]}
        activeFile="main.tex"
        onActivate={() => undefined}
        onClose={() => undefined}
        onPromote={() => undefined}
        onMove={() => undefined}
        onDropPaths={onDropPaths}
      />,
    )

    const tabBar = screen.getByTestId('file-tabs-bar')
    const tab = screen.getByTestId('file-tab-main.tex')

    vi.spyOn(tabBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 28,
      top: 0,
      right: 240,
      bottom: 28,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 90,
      height: 28,
      top: 0,
      right: 90,
      bottom: 28,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const dragOverEvent = createEvent.dragOver(tabBar)
    Object.defineProperty(dragOverEvent, 'clientX', { value: 120 })
    Object.defineProperty(dragOverEvent, 'dataTransfer', {
      value: {
        getData: (type: string) => {
          if (type === 'text/x-composure-paths') {
            return JSON.stringify(['main.tex', 'chapters/intro.tex'])
          }
          return ''
        },
        dropEffect: 'copy',
      },
    })
    fireEvent(tabBar, dragOverEvent)

    const dropEvent = createEvent.drop(tabBar)
    Object.defineProperty(dropEvent, 'clientX', { value: 120 })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        getData: (type: string) => {
          if (type === 'text/x-composure-paths') {
            return JSON.stringify(['main.tex', 'chapters/intro.tex'])
          }
          return ''
        },
      },
    })
    fireEvent(tabBar, dropEvent)

    expect(onDropPaths).toHaveBeenCalledTimes(1)
    expect(onDropPaths).toHaveBeenCalledWith({
      paths: ['main.tex', 'chapters/intro.tex'],
      targetIndex: 1,
      fromTabBar: false,
      sourcePaneId: null,
    })
  })

  it('accepts cross-tab-bar drops from text/plain fallback payload data', () => {
    const onDropPaths = vi.fn()

    render(
      <FileTabs
        paneId="pane-2"
        tabs={[fileTab('main.tex', true)]}
        activeFile="main.tex"
        onActivate={() => undefined}
        onClose={() => undefined}
        onPromote={() => undefined}
        onMove={() => undefined}
        onDropPaths={onDropPaths}
      />,
    )

    const tabBar = screen.getByTestId('file-tabs-bar')
    const tab = screen.getByTestId('file-tab-main.tex')

    vi.spyOn(tabBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 28,
      top: 0,
      right: 240,
      bottom: 28,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 90,
      height: 28,
      top: 0,
      right: 90,
      bottom: 28,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const fallbackCarrier = {
      payloadByType: new Map<string, string>(),
      getData(type: string) {
        return type === 'text/plain' || type === 'text' ? this.payloadByType.get(type) ?? '' : ''
      },
      setData(type: string, value: string) {
        this.payloadByType.set(type, value)
      },
    }

    writeComposureDragPayload(fallbackCarrier as unknown as DataTransfer, {
      [TAB_SINGLE_PATH_MIME]: 'chapters/intro.tex',
      [TAB_SOURCE_PANE_MIME]: 'pane-1',
    })

    const dragOverEvent = createEvent.dragOver(tabBar)
    Object.defineProperty(dragOverEvent, 'clientX', { value: 120 })
    Object.defineProperty(dragOverEvent, 'dataTransfer', {
      value: {
        getData: (type: string) => {
          if (type === 'text/plain' || type === 'text') {
            return fallbackCarrier.payloadByType.get(type) ?? ''
          }
          return ''
        },
        dropEffect: 'copy',
      },
    })
    fireEvent(tabBar, dragOverEvent)

    const dropEvent = createEvent.drop(tabBar)
    Object.defineProperty(dropEvent, 'clientX', { value: 120 })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        getData: (type: string) => {
          if (type === 'text/plain' || type === 'text') {
            return fallbackCarrier.payloadByType.get(type) ?? ''
          }
          return ''
        },
      },
    })
    fireEvent(tabBar, dropEvent)

    expect(onDropPaths).toHaveBeenCalledTimes(1)
    expect(onDropPaths).toHaveBeenCalledWith({
      paths: ['chapters/intro.tex'],
      targetIndex: 1,
      fromTabBar: true,
      sourcePaneId: 'pane-1',
    })
  })

  it('prefers external payload over stale local drag state from another tab bar', () => {
    const onTargetMove = vi.fn<(path: string, targetIndex: number) => void>()
    const onTargetDropPaths = vi.fn()

    render(
      <>
        <FileTabs
          paneId="pane-1"
          tabs={[fileTab('a.tex', false)]}
          activeFile="a.tex"
          onActivate={() => undefined}
          onClose={() => undefined}
          onPromote={() => undefined}
          onMove={() => undefined}
        />
        <FileTabs
          paneId="pane-2"
          tabs={[fileTab('b.tex', false)]}
          activeFile="b.tex"
          onActivate={() => undefined}
          onClose={() => undefined}
          onPromote={() => undefined}
          onMove={onTargetMove}
          onDropPaths={onTargetDropPaths}
        />
      </>,
    )

    const tabBars = screen.getAllByTestId('file-tabs-bar')
    const targetBar = tabBars[1]
    const targetTab = screen.getByTestId('file-tab-b.tex')

    vi.spyOn(targetBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 28,
      top: 0,
      right: 240,
      bottom: 28,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    vi.spyOn(targetTab, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 28,
      top: 0,
      right: 100,
      bottom: 28,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    // Simulate stale local drag state in target bar from an earlier drag.
    fireEvent.dragStart(targetTab)

    const dragOverEvent = createEvent.dragOver(targetBar)
    Object.defineProperty(dragOverEvent, 'clientX', { value: 120 })
    Object.defineProperty(dragOverEvent, 'dataTransfer', {
      value: {
        getData: (type: string) => {
          if (type === 'text/x-composure-tab-path') {
            return 'a.tex'
          }
          if (type === 'text/x-composure-tab-source-bar') {
            return 'different-bar'
          }
          return ''
        },
        dropEffect: 'copy',
      },
    })
    fireEvent(targetBar, dragOverEvent)

    const dropEvent = createEvent.drop(targetBar)
    Object.defineProperty(dropEvent, 'clientX', { value: 120 })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        getData: (type: string) => {
          if (type === 'text/x-composure-tab-path') {
            return 'a.tex'
          }
          if (type === 'text/x-composure-tab-source-bar') {
            return 'different-bar'
          }
          return ''
        },
      },
    })
    fireEvent(targetBar, dropEvent)

    expect(onTargetMove).not.toHaveBeenCalled()
    expect(onTargetDropPaths).toHaveBeenCalledTimes(1)
    expect(onTargetDropPaths).toHaveBeenCalledWith({
      paths: ['a.tex'],
      targetIndex: 1,
      fromTabBar: true,
      sourcePaneId: null,
    })
  })
})
