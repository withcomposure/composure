import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { FileImage, FileText } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import {
  PreviewDarkModeToggle,
  PreviewEmptyState,
  PreviewErrorBanner,
  PreviewToolbar,
} from './PreviewToolbar'
import { usePreviewZoom } from './preview-zoom'

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

// ---------------------------------------------------------------------------
// Shared hooks
// ---------------------------------------------------------------------------

function useDebouncedNumber(value: number, delayMs: number) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delayMs])

  return debounced
}

function usePdfRenderer(
  url: string | null,
  renderScale: number,
  displayScale: number,
  onRendered?: () => void,
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
      // NOTE: pageCount is intentionally NOT reset here.
      // Resetting it would flash "Preview" in the toolbar on every zoom change.
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
      container.innerHTML = ''

      const firstPage = pdf.numPages > 0 ? await pdf.getPage(1) : null
      const intrinsicWidth = firstPage?.getViewport({ scale: 1 }).width ?? null
      onIntrinsicWidth?.(intrinsicWidth)

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
        container.appendChild(pageLayer)
      }

      onRendered?.()
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
  }, [url, renderScale, onRendered, onIntrinsicWidth])

  useEffect(() => {
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

function useElementContentWidth(ref: React.RefObject<HTMLElement | null>) {
  const [contentWidth, setContentWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const updateWidth = () => {
      const styles = getComputedStyle(el)
      const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
      const paddingRight = Number.parseFloat(styles.paddingRight) || 0
      setContentWidth(Math.max(0, el.clientWidth - paddingLeft - paddingRight))
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return contentWidth
}

function useDragToPan(scrollRef: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (event.button !== 0) return

    const target = event.target as Element | null
    const isTextGlyph = target instanceof HTMLElement
      && target.closest('.cz-pdf-text-layer') != null
      && (target.tagName === 'SPAN' || target.tagName === 'BR')
    if (isTextGlyph) {
      // Preserve native text selection in the PDF text layer.
      return
    }

    const el = scrollRef.current
    if (!el) return

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: el.scrollLeft,
      startScrollTop: el.scrollTop,
    }
    setIsDragging(true)
    el.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    const drag = dragRef.current
    const el = scrollRef.current
    if (!drag || !el || drag.pointerId !== event.pointerId) return

    el.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX)
    el.scrollTop = drag.startScrollTop - (event.clientY - drag.startY)
  }

  const clearDrag = () => {
    dragRef.current = null
    setIsDragging(false)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (el?.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId)
    }
    clearDrag()
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (el?.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId)
    }
    clearDrag()
  }

  const handleLostPointerCapture = () => {
    clearDrag()
  }

  return {
    isDragging: enabled && isDragging,
    dragHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onLostPointerCapture: handleLostPointerCapture,
    },
  }
}

// ---------------------------------------------------------------------------
// Internal UI pieces
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PDF page-count label helper
// ---------------------------------------------------------------------------

function pdfStatusLabel(documentName: string, pageCount: number): string {
  if (pageCount <= 0) return `${documentName} (Preview)`
  return `${documentName} (${pageCount} page${pageCount > 1 ? 's' : ''})`
}

// ---------------------------------------------------------------------------
// CompilePreview — PDF viewer for compile output
// ---------------------------------------------------------------------------

interface CompilePreviewProps {
  pdfUrl: string | null
  error: string | null
  documentName?: string
  compiling?: boolean
}

function CompilingPlaceholderContent() {
  const [showSlowCompileHint, setShowSlowCompileHint] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowSlowCompileHint(true)
    }, 5000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <>
      <span
        aria-hidden="true"
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-cz-text-muted/40 border-t-cz-text-muted"
      />
      <p className="text-sm text-cz-text-muted">Compiling...</p>
      {showSlowCompileHint && (
        <p className="text-xs text-cz-text-muted italic mt-2">
          This is taking longer than usual.
        </p>
      )}
    </>
  )
}

export function CompilePreview({ pdfUrl, error, documentName = 'Compile', compiling = false }: CompilePreviewProps) {
  const [darkMode, setDarkMode] = useState(true)
  const [intrinsicWidth, setIntrinsicWidth] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentWidth = useElementContentWidth(scrollRef)
  const fitScale = intrinsicWidth && contentWidth > 0 ? contentWidth / intrinsicWidth : null
  const { scale, isFit, zoomIn, zoomOut, fitToWidth } = usePreviewZoom(fitScale, pdfUrl)
  const renderScale = useDebouncedNumber(scale, 120)
  const dragEnabled = scale > 1
  const { isDragging, dragHandlers } = useDragToPan(scrollRef, dragEnabled)

  const centerHorizontally = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
  }, [scrollRef])
  const { containerRef, pageCount, renderError } = usePdfRenderer(
    pdfUrl,
    renderScale,
    scale,
    centerHorizontally,
    setIntrinsicWidth,
  )

  const displayError = error ?? renderError
  const showPlaceholder = !pdfUrl && !displayError
  const showCompilingState = showPlaceholder && compiling

  return (
    <div className="flex h-full flex-col">
      {!showPlaceholder && (
        <PreviewToolbar
          statusLabel={pdfStatusLabel(documentName, pageCount)}
          scale={scale}
          isFit={isFit}
          onFit={fitToWidth}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          url={pdfUrl}
          extra={<PreviewDarkModeToggle enabled={darkMode} onToggle={() => setDarkMode((d) => !d)} />}
        />
      )}
      {displayError && <PreviewErrorBanner label="Compilation Error" message={displayError} />}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-auto ${showPlaceholder ? '' : 'p-4'} ${dragEnabled ? 'touch-none' : ''} ${dragEnabled ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''} ${darkMode && !showPlaceholder ? 'pdf-dark' : ''}`}
        {...(showPlaceholder ? {} : dragHandlers)}
      >
        {showPlaceholder ? (
          <PreviewEmptyState icon={!showCompilingState ? <FileText size={40} aria-hidden="true" /> : undefined}>
            {showCompilingState ? (
              <CompilingPlaceholderContent />
            ) : (
              <p className="text-sm text-cz-text-muted">
                Press{' '}
                <kbd className="px-1.5 py-0.5 rounded bg-cz-surface border border-cz-border text-[11px] font-mono">
                  Ctrl+Enter
                </kbd>{' '}
                to compile
              </p>
            )}
          </PreviewEmptyState>
        ) : (
          <div className="min-w-full min-h-full">
            <div ref={containerRef} className="w-max min-w-full flex flex-col items-center" />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PdfViewer — PDF viewer for asset files
// ---------------------------------------------------------------------------

interface PdfViewerProps {
  url: string | null
  error: string | null
  documentName?: string
}

export function PdfViewer({ url, error, documentName = 'Preview' }: PdfViewerProps) {
  const [darkMode, setDarkMode] = useState(true)
  const [intrinsicWidth, setIntrinsicWidth] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentWidth = useElementContentWidth(scrollRef)
  const fitScale = intrinsicWidth && contentWidth > 0 ? contentWidth / intrinsicWidth : null
  const { scale, isFit, zoomIn, zoomOut, fitToWidth } = usePreviewZoom(fitScale, url)
  const renderScale = useDebouncedNumber(scale, 120)
  const dragEnabled = scale > 1
  const { isDragging, dragHandlers } = useDragToPan(scrollRef, dragEnabled)
  const centerHorizontally = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
  }, [scrollRef])
  const { containerRef, pageCount, renderError } = usePdfRenderer(
    url,
    renderScale,
    scale,
    centerHorizontally,
    setIntrinsicWidth,
  )

  const displayError = error ?? renderError

  if (!url && !displayError) {
    return (
      <PreviewEmptyState icon={<FileText size={40} aria-hidden="true" />}>
        <p className="text-sm text-cz-text-muted">No PDF to display</p>
      </PreviewEmptyState>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PreviewToolbar
        statusLabel={pdfStatusLabel(documentName, pageCount)}
        scale={scale}
        isFit={isFit}
        onFit={fitToWidth}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        url={url}
        extra={<PreviewDarkModeToggle enabled={darkMode} onToggle={() => setDarkMode((d) => !d)} />}
      />
      {displayError && <PreviewErrorBanner label="Error" message={displayError} />}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-auto p-4 ${dragEnabled ? 'touch-none' : ''} ${dragEnabled ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''} ${darkMode ? 'pdf-dark' : ''}`}
        {...dragHandlers}
      >
        <div className="min-w-full min-h-full">
          <div ref={containerRef} className="w-max min-w-full flex flex-col items-center" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ImageViewer — image viewer for asset files
// ---------------------------------------------------------------------------

interface ImageViewerProps {
  url: string | null
  error: string | null
  documentName?: string
}

export function ImageViewer({ url, error, documentName = 'Preview' }: ImageViewerProps) {
  const [imageMetrics, setImageMetrics] = useState<{
    url: string | null
    intrinsicWidth: number | null
  }>({
    url: null,
    intrinsicWidth: null,
  })
  const intrinsicWidth = imageMetrics.url === url ? imageMetrics.intrinsicWidth : null
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentWidth = useElementContentWidth(scrollRef)
  const fitScale = intrinsicWidth && contentWidth > 0 ? contentWidth / intrinsicWidth : null
  const { scale, isFit, zoomIn, zoomOut, fitToWidth } = usePreviewZoom(fitScale, url)
  const relativeScale = fitScale && fitScale > 0 ? scale / fitScale : scale
  const displayWidth = intrinsicWidth != null ? intrinsicWidth * scale : null
  const dragEnabled = !isFit && relativeScale > 1
  const { isDragging, dragHandlers } = useDragToPan(scrollRef, dragEnabled)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const frame = requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [scale, url, scrollRef])

  if (!url && !error) {
    return (
      <PreviewEmptyState icon={<FileImage size={40} aria-hidden="true" />}>
        <p className="text-sm text-cz-text-muted">No image to display</p>
      </PreviewEmptyState>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PreviewToolbar
        statusLabel={documentName}
        scale={scale}
        isFit={isFit}
        onFit={fitToWidth}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        url={url}
      />
      {error && <PreviewErrorBanner label="Error" message={error} />}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-auto p-4 ${dragEnabled ? 'touch-none' : ''} ${dragEnabled ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
        {...dragHandlers}
      >
        <div className="min-w-full min-h-full">
          <div className="w-max min-w-full min-h-full flex justify-center">
            <img
              src={url!}
              alt=""
              draggable={false}
              onLoad={(event) => {
                setImageMetrics({
                  url,
                  intrinsicWidth: event.currentTarget.naturalWidth || null,
                })
              }}
              style={displayWidth != null
                ? { width: `${displayWidth}px`, maxWidth: 'none' }
                : { maxWidth: '100%' }
              }
              className="rounded shadow-sm shrink-0"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
