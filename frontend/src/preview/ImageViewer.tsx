import { useEffect, useRef, useState } from 'react'
import { FileImage } from 'lucide-react'
import { PreviewEmptyState, PreviewToolbar } from './PreviewToolbar'
import { usePreviewZoom } from './preview-zoom'
import { useDragToPan, useElementContentWidth } from './preview-interactions'
import { PreviewPane, PreviewViewport } from './PreviewPane'

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
  }, [scale, url])

  if (!url && !error) {
    return (
      <PreviewEmptyState icon={<FileImage size={40} aria-hidden="true" />}>
        <p className="text-sm text-cz-text-muted">No image to display</p>
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
          url={url}
        />
      )}
      error={error ? { label: 'Error', message: error } : null}
    >
      <PreviewViewport
        ref={scrollRef}
        className={`${dragEnabled ? 'touch-none' : ''} ${dragEnabled ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
        {...dragHandlers}
      >
        <div className="min-h-full min-w-full">
          <div className="flex min-h-full w-max min-w-full justify-center">
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
              className="shrink-0 rounded shadow-sm"
            />
          </div>
        </div>
      </PreviewViewport>
    </PreviewPane>
  )
}
