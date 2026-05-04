import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Y from 'yjs'
import { FileTree } from '../src/sidebar/FileTree'

const realXMLHttpRequest = globalThis.XMLHttpRequest

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = []

  onload: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => unknown) | null = null
  onerror: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => unknown) | null = null
  onabort: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => unknown) | null = null
  upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null }
  status = 0
  responseText = ''
  withCredentials = false
  private body: FormData | null = null

  static reset() {
    MockXMLHttpRequest.instances = []
  }

  open(method: string, url: string): void {
    void method
    void url
  }

  setRequestHeader(name: string, value: string): void {
    void name
    void value
  }

  send(body: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body instanceof FormData ? body : null
    MockXMLHttpRequest.instances.push(this)
  }

  uploadedFileName(): string | null {
    const file = this.body?.get('file')
    return file instanceof File ? file.name : null
  }

  emitProgress(percent: number): void {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: percent,
      total: 100,
    } as ProgressEvent<EventTarget>)
  }

  respond(status: number, body: unknown): void {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.call(this as unknown as XMLHttpRequest, {} as ProgressEvent<EventTarget>)
  }
}

function toFileList(files: File[]): FileList {
  const list: Partial<FileList> = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  }
  for (const [index, file] of files.entries()) {
    ;(list as Record<number, File>)[index] = file
  }
  return list as FileList
}

function createDropDataTransfer(files: File[]): DataTransfer {
  return {
    files: toFileList(files),
    types: ['Files'],
    getData: () => '',
    setData: () => undefined,
  } as unknown as DataTransfer
}

function createFileTreeHarness() {
  const ydoc = new Y.Doc()
  const fileMap = ydoc.getMap<string>('files')

  fileMap.set('notes', JSON.stringify({ type: 'folder' }))
  fileMap.set('main.tex', JSON.stringify({ type: 'text' }))
  fileMap.set('diagram.png', JSON.stringify({ type: 'asset', storageKey: 'a'.repeat(32) + '.png' }))

  const onSelect = vi.fn<(path: string) => void>()
  const onSelectPersistent = vi.fn<(path: string) => void>()
  const onSetEntrypoint = vi.fn<(path: string | null) => Promise<void>>().mockResolvedValue(undefined)
  const onSetDefaultBibliography = vi.fn<(path: string | null) => Promise<void>>().mockResolvedValue(undefined)

  const view = render(
    <FileTree
      fileMap={fileMap}
      ydoc={ydoc}
      projectId={'p'.repeat(32)}
      shareHeaders={{}}
      activeFile=""
      isDocumentLoading={false}
      entrypointPath={null}
      defaultBibliographyPath={null}
      onSetEntrypoint={onSetEntrypoint}
      onSetDefaultBibliography={onSetDefaultBibliography}
      onSelect={onSelect}
      onSelectPersistent={onSelectPersistent}
      onRename={() => true}
      onDelete={() => true}
    />,
  )

  return { ...view, onSelect, onSelectPersistent, ydoc }
}

beforeEach(() => {
  MockXMLHttpRequest.reset()
  globalThis.XMLHttpRequest = MockXMLHttpRequest as unknown as typeof XMLHttpRequest
})

afterEach(() => {
  globalThis.XMLHttpRequest = realXMLHttpRequest
})

describe('FileTree selection', () => {
  it('selects a text file when clicked', async () => {
    const user = userEvent.setup()
    const { onSelect, onSelectPersistent, ydoc } = createFileTreeHarness()

    try {
      await user.click(screen.getByText('main.tex'))
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith('main.tex')
      expect(onSelectPersistent).not.toHaveBeenCalled()
    } finally {
      ydoc.destroy()
    }
  })

  it('selects persistently when double-clicked', async () => {
    const user = userEvent.setup()
    const { onSelect, onSelectPersistent, ydoc } = createFileTreeHarness()

    try {
      await user.dblClick(screen.getByText('main.tex'))
      expect(onSelectPersistent).toHaveBeenCalledTimes(1)
      expect(onSelectPersistent).toHaveBeenCalledWith('main.tex')
      expect(onSelect).toHaveBeenCalled()
    } finally {
      ydoc.destroy()
    }
  })

  it('shows an in-progress upload row that is disabled until upload completes', async () => {
    const user = userEvent.setup()
    const { container, onSelect, ydoc } = createFileTreeHarness()

    try {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
      expect(input).not.toBeNull()
      if (!input) {
        return
      }

      const uploadingFile = new File(['hello world'], 'upload.tex', { type: 'text/plain' })
      fireEvent.change(input, {
        target: {
          files: toFileList([uploadingFile]),
        },
      })

      await waitFor(() => {
        expect(MockXMLHttpRequest.instances).toHaveLength(1)
      })

      const req = MockXMLHttpRequest.instances[0]
      act(() => {
        req.emitProgress(35)
      })

      const progress = await screen.findByRole('progressbar', { name: 'Uploading upload.tex' })
      await waitFor(() => {
        expect(progress).toHaveAttribute('aria-valuenow', '35')
      })

      await user.click(screen.getByText('upload.tex'))
      expect(onSelect).not.toHaveBeenCalledWith('upload.tex')

      act(() => {
        req.respond(200, {
          uploaded: [
            {
              kind: 'text',
              originalName: 'upload.tex',
              content: 'hello world',
              size: 11,
            },
          ],
        })
      })

      await waitFor(() => {
        expect(screen.queryByRole('progressbar', { name: 'Uploading upload.tex' })).not.toBeInTheDocument()
      })

      await user.click(screen.getByText('upload.tex'))
      expect(onSelect).toHaveBeenCalledWith('upload.tex')
    } finally {
      ydoc.destroy()
    }
  })

  it('uploads all dragged files individually so one oversized file does not block others', async () => {
    const { container, ydoc } = createFileTreeHarness()

    try {
      const dropTarget = container.firstElementChild as HTMLElement | null
      expect(dropTarget).not.toBeNull()
      if (!dropTarget) {
        return
      }

      const validFile = new File(['ok'], 'ok.tex', { type: 'text/plain' })
      const oversizedFile = new File(['big'], 'too-big.bin', { type: 'application/octet-stream' })
      fireEvent.drop(dropTarget, {
        dataTransfer: createDropDataTransfer([validFile, oversizedFile]),
      })

      await waitFor(() => {
        expect(MockXMLHttpRequest.instances).toHaveLength(2)
      })

      expect(MockXMLHttpRequest.instances.map((req) => req.uploadedFileName())).toEqual(['ok.tex', 'too-big.bin'])

      act(() => {
        MockXMLHttpRequest.instances[0].respond(200, {
          uploaded: [
            {
              kind: 'text',
              originalName: 'ok.tex',
              content: 'ok',
              size: 2,
            },
          ],
        })
      })

      act(() => {
        MockXMLHttpRequest.instances[1].respond(400, {
          error: 'File too large: too-big.bin exceeds the 50 MB upload limit',
        })
      })

      await waitFor(() => {
        expect(screen.getByText('ok.tex')).toBeInTheDocument()
      })
      expect(screen.getByText('File too large: too-big.bin exceeds the 50 MB upload limit')).toBeInTheDocument()
    } finally {
      ydoc.destroy()
    }
  })
})
