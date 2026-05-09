import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { FileText } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import {
  PreviewDarkModeToggle,
  PreviewEmptyState,
  PreviewPinToggle,
  PreviewToolbar,
} from './PreviewToolbar'
import { getPreviewDarkModeDefault } from './preview-theme'
import { usePreviewZoom } from './preview-zoom'
import {
  useDebouncedNumber,
  useDragToPan,
  useElementContentWidth,
} from './preview-interactions'
import { PreviewPane, PreviewViewport } from './PreviewPane'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface PdfTextLayerLike {
  render: () => Promise<void>
  cancel: () => void
}

interface PdfTextLayerConstructor {
  new (args: {
    textContentSource: unknown
    container: HTMLDivElement
    viewport: unknown
  }): PdfTextLayerLike
}

const PdfTextLayer = (pdfjsLib as unknown as { TextLayer?: PdfTextLayerConstructor }).TextLayer

function usePdfRenderer(
  url: string | null,
  renderScale: number,
  displayScale: number,
  onIntrinsicWidth?: (width: number | null) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdfState, setPdfState] = useState<{
    url: string | null
    pageCount: number
    renderError: string | null
  }>({
    url: null,
    pageCount: 0,
    renderError: null,
  })
  const displayScaleRef = useRef(displayScale)
  const pageCount = pdfState.url === url ? pdfState.pageCount : 0
  const renderError = pdfState.url === url ? pdfState.renderError : null

  useEffect(() => {
    displayScaleRef.current = displayScale
  }, [displayScale])

  useEffect(() => {
    if (!containerRef.current) return

    if (!url) {
      containerRef.current.innerHTML = ''
      onIntrinsicWidth?.(null)
      return
    }

    let cancelled = false
    const container = containerRef.current
    const renderTasks: Array<{ cancel: () => void; promise: Promise<void> }> = []
    const textLayerTasks: PdfTextLayerLike[] = []
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null
    let loadedPdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']> | null = null
    const currentUrl = url

    async function render() {
      // Keep page count while re-rendering to avoid page-indicator flicker.
      loadingTask = pdfjsLib.getDocument({
        url: url!,
        withCredentials: true,
      })
      const pdf = await loadingTask.promise
      loadedPdf = pdf
      if (cancelled) return

      setPdfState({
        url: currentUrl,
        pageCount: pdf.numPages,
        renderError: null,
      })

      const firstPage = pdf.numPages > 0 ? await pdf.getPage(1) : null
      const intrinsicWidth = firstPage?.getViewport({ scale: 1 }).width ?? null
      onIntrinsicWidth?.(intrinsicWidth)
      const renderedPages: HTMLDivElement[] = []

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = i === 1 && firstPage ? firstPage : await pdf.getPage(i)
        if (cancelled) return

        const viewport = page.getViewport({ scale: renderScale })
        const baseWidth = viewport.width / renderScale
        const baseHeight = viewport.height / renderScale
        const pageLayer = document.createElement('div')
        pageLayer.className = 'cz-pdf-page'
        pageLayer.dataset.baseWidth = String(baseWidth)
        pageLayer.dataset.baseHeight = String(baseHeight)
        pageLayer.style.width = `${baseWidth * displayScaleRef.current}px`
        pageLayer.style.height = `${baseHeight * displayScaleRef.current}px`

        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.display = 'block'

        const textLayerContainer = document.createElement('div')
        textLayerContainer.className = 'cz-pdf-text-layer'
        textLayerContainer.style.setProperty('--scale-factor', String(displayScaleRef.current))

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error('Failed to create PDF render context')
        }
        const task = page.render({ canvasContext: ctx, viewport })
        renderTasks.push(task)
        await task.promise
        if (cancelled) return

        if (PdfTextLayer) {
          try {
            const textContent = await page.getTextContent()
            if (cancelled) return

            const textLayer = new PdfTextLayer({
              textContentSource: textContent,
              container: textLayerContainer,
              viewport,
            })
            textLayerTasks.push(textLayer)
            await textLayer.render()
            if (cancelled) return
          } catch (textLayerErr) {
            console.warn('[pdf] text-layer-unavailable', textLayerErr)
          }
        }

        page.cleanup()
        pageLayer.append(canvas, textLayerContainer)
        renderedPages.push(pageLayer)
      }

      if (cancelled) return
      container.replaceChildren(...renderedPages)
    }

    render().catch((err) => {
      if (cancelled) return
      console.error(err)
      container.innerHTML = ''
      onIntrinsicWidth?.(null)
      setPdfState({
        url: currentUrl,
        pageCount: 0,
        renderError: 'Failed to render PDF preview.',
      })
    })

    return () => {
      cancelled = true
      for (const task of renderTasks) {
        task.cancel()
      }
      for (const textLayerTask of textLayerTasks) {
        textLayerTask.cancel()
      }
      loadingTask?.destroy()
      loadedPdf?.cleanup()
      loadedPdf?.destroy()
    }
  }, [url, renderScale, onIntrinsicWidth])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const pages = container.querySelectorAll<HTMLDivElement>('.cz-pdf-page')
    pages.forEach((page) => {
      const baseWidth = Number.parseFloat(page.dataset.baseWidth ?? '')
      const baseHeight = Number.parseFloat(page.dataset.baseHeight ?? '')
      if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight)) return
      page.style.width = `${baseWidth * displayScale}px`
      page.style.height = `${baseHeight * displayScale}px`
    })

    const textLayers = container.querySelectorAll<HTMLDivElement>('.cz-pdf-text-layer')
    textLayers.forEach((textLayer) => {
      textLayer.style.setProperty('--scale-factor', String(displayScale))
    })
  }, [displayScale])

  return { containerRef, pageCount, renderError }
}

function clampPageNumber(page: number, totalPages: number): number {
  if (totalPages <= 0) {
    return 1
  }
  return Math.min(totalPages, Math.max(1, page))
}

function getPdfPages(scrollElement: HTMLDivElement): HTMLDivElement[] {
  return Array.from(scrollElement.querySelectorAll<HTMLDivElement>('.cz-pdf-page'))
}

function resolveVisiblePdfPage(scrollElement: HTMLDivElement, totalPages: number): number {
  const pages = getPdfPages(scrollElement)
  if (pages.length === 0) {
    return 1
  }

  const viewportTop = scrollElement.getBoundingClientRect().top
  const anchorY = viewportTop + Math.max(12, scrollElement.clientHeight * 0.2)
  for (let index = 0; index < pages.length; index += 1) {
    const rect = pages[index].getBoundingClientRect()
    if (rect.bottom >= anchorY) {
      return clampPageNumber(index + 1, totalPages)
    }
  }

  return clampPageNumber(pages.length, totalPages)
}

function scrollPdfPageIntoView(
  scrollElement: HTMLDivElement,
  requestedPage: number,
  totalPages: number,
): number {
  const pages = getPdfPages(scrollElement)
  if (pages.length === 0) {
    return 1
  }

  const maxPage = Math.min(totalPages, pages.length)
  const page = clampPageNumber(requestedPage, maxPage)
  const targetPage = pages[page - 1]
  const containerRect = scrollElement.getBoundingClientRect()
  const targetRect = targetPage.getBoundingClientRect()
  const nextTop = scrollElement.scrollTop + (targetRect.top - containerRect.top) - 12
  scrollElement.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' })
  return page
}

export interface PdfViewerPlaceholder {
  icon?: ReactNode
  content: ReactNode
}

interface PdfViewerProps {
  url: string | null
  error: string | null
  documentName?: string
  errorLabel?: string
  placeholder?: PdfViewerPlaceholder | null
  hideToolbarWhenPlaceholder?: boolean
  pinControl?: {
    pinned: boolean
    onToggle: () => void
  } | null
}

export function PdfViewer({
  url,
  error,
  documentName = 'Preview',
  errorLabel = 'Error',
  placeholder = null,
  hideToolbarWhenPlaceholder = true,
  pinControl = null,
}: PdfViewerProps) {
  const [darkMode, setDarkMode] = useState(getPreviewDarkModeDefault)
  const [intrinsicWidth, setIntrinsicWidth] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentWidth = useElementContentWidth(scrollRef)
  const fitScale = intrinsicWidth && contentWidth > 0 ? contentWidth / intrinsicWidth : null
  const { scale, isFit, zoomIn, zoomOut, fitToWidth, setScale } = usePreviewZoom(fitScale, url)
  const renderScale = useDebouncedNumber(scale, 120)
  const dragEnabled = scale > 1
  const { isDragging, dragHandlers } = useDragToPan(scrollRef, dragEnabled)
  const previousScaleRef = useRef(scale)

  const { containerRef, pageCount, renderError } = usePdfRenderer(
    url,
    renderScale,
    scale,
    setIntrinsicWidth,
  )

  const displayError = error ?? renderError
  const showPlaceholder = !url && !displayError

  const defaultPlaceholder: PdfViewerPlaceholder = {
    icon: <FileText size={40} aria-hidden="true" />,
    content: <p className="text-sm text-cz-text-muted">No PDF to display</p>,
  }
  const resolvedPlaceholder = placeholder ?? defaultPlaceholder

  useEffect(() => {
    previousScaleRef.current = scale
  }, [url, scale])

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement || showPlaceholder) {
      previousScaleRef.current = scale
      return
    }

    const previousScale = previousScaleRef.current
    if (previousScale <= 0 || previousScale === scale) {
      previousScaleRef.current = scale
      return
    }

    const zoomRatio = scale / previousScale
    const centerX = scrollElement.scrollLeft + (scrollElement.clientWidth / 2)
    const topY = scrollElement.scrollTop
    scrollElement.scrollLeft = Math.max(0, centerX * zoomRatio - (scrollElement.clientWidth / 2))
    scrollElement.scrollTop = Math.max(0, topY * zoomRatio)
    previousScaleRef.current = scale
  }, [scale, showPlaceholder])

  const syncCurrentPage = useCallback(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement || pageCount <= 0) {
      setCurrentPage(1)
      return
    }
    setCurrentPage(resolveVisiblePdfPage(scrollElement, pageCount))
  }, [pageCount])

  useEffect(() => {
    setCurrentPage(1)
  }, [url])

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement || showPlaceholder || pageCount <= 0) {
      return
    }

    let frameId: number | null = null
    const scheduleSync = () => {
      if (frameId !== null) {
        return
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        syncCurrentPage()
      })
    }

    scrollElement.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)
    scheduleSync()

    return () => {
      scrollElement.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [pageCount, renderScale, scale, showPlaceholder, syncCurrentPage, url])

  const goToPage = useCallback((nextPage: number) => {
    const scrollElement = scrollRef.current
    if (!scrollElement || pageCount <= 0) {
      return
    }

    const resolvedPage = scrollPdfPageIntoView(scrollElement, nextPage, pageCount)
    setCurrentPage(resolvedPage)
  }, [pageCount])

  if (showPlaceholder && hideToolbarWhenPlaceholder) {
    return (
      <PreviewEmptyState icon={resolvedPlaceholder.icon}>
        {resolvedPlaceholder.content}
      </PreviewEmptyState>
    )
  }

  return (
    <PreviewPane
      toolbar={(
        <PreviewToolbar
          statusLabel={documentName}
          scale={scale}
          isFit={isFit}
          onFit={fitToWidth}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onSetScale={setScale}
          pageIndicator={pageCount > 1 ? {
            currentPage,
            totalPages: pageCount,
            onGoToPage: goToPage,
          } : null}
          url={url}
          extra={(
            <div className="flex items-center gap-0.5">
              {pinControl && (
                <PreviewPinToggle pinned={pinControl.pinned} onToggle={pinControl.onToggle} />
              )}
              <PreviewDarkModeToggle enabled={darkMode} onToggle={() => setDarkMode((d) => !d)} />
            </div>
          )}
        />
      )}
      error={displayError ? { label: errorLabel, message: displayError } : null}
    >
      <PreviewViewport
        ref={scrollRef}
        inset={!showPlaceholder}
        className={`${dragEnabled ? 'touch-none' : ''} ${dragEnabled ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''} ${darkMode && !showPlaceholder ? 'pdf-dark' : ''}`}
        {...(showPlaceholder ? {} : dragHandlers)}
      >
        {showPlaceholder ? (
          <PreviewEmptyState icon={resolvedPlaceholder.icon}>
            {resolvedPlaceholder.content}
          </PreviewEmptyState>
        ) : (
          <div className="min-h-full min-w-full">
            <div ref={containerRef} className="flex w-max min-w-full flex-col items-center" />
          </div>
        )}
      </PreviewViewport>
    </PreviewPane>
  )
}
