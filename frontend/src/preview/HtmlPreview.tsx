import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import {
  PreviewDarkModeToggle,
  PreviewEmptyState,
  PreviewErrorBanner,
  PreviewToolbar,
} from './PreviewToolbar'
import { usePreviewZoom } from './preview-zoom'

interface HtmlPreviewProps {
  html: string
  error: string | null
}

export function HtmlPreview({ html, error }: HtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [darkMode, setDarkMode] = useState(true)
  const scrollTopRef = useRef(0)
  const scrollLeftRef = useRef(0)
  const { scale, isFit, zoomIn, zoomOut, fitToWidth } = usePreviewZoom(1, null, {
    initial: 1,
    min: 0.5,
    max: 3,
    step: 0.1,
  })

  const srcdoc = useMemo(() => {
    const bgColor = darkMode ? '#1e1e2e' : '#ffffff'
    const textColor = darkMode ? '#cdd6f4' : '#1f2328'
    const borderColor = darkMode ? '#313244' : '#d0d7de'
    const codeBg = darkMode ? '#181825' : '#f6f8fa'
    const linkColor = darkMode ? '#89b4fa' : '#0969da'
    const blockquoteBorder = darkMode ? '#45475a' : '#d0d7de'

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: ${bgColor};
    color: ${textColor};
  }
  #cz-preview-root {
    width: 100%;
    max-width: 100%;
    margin: 0 auto;
    padding: 24px 32px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.7;
    word-wrap: break-word;
    zoom: ${scale};
  }
  h1, h2, h3, h4, h5, h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }
  h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid ${borderColor}; }
  h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid ${borderColor}; }
  h3 { font-size: 1.25em; }
  p { margin-top: 0; margin-bottom: 16px; }
  a { color: ${linkColor}; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    background: ${codeBg};
    padding: 0.2em 0.4em;
    border-radius: 6px;
    font-size: 85%;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  pre {
    background: ${codeBg};
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
    line-height: 1.45;
  }
  pre code { background: none; padding: 0; border-radius: 0; font-size: 85%; }
  blockquote {
    margin: 0 0 16px;
    padding: 0 16px;
    border-left: 4px solid ${blockquoteBorder};
    color: ${darkMode ? '#a6adc8' : '#656d76'};
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 16px;
  }
  th, td {
    padding: 6px 13px;
    border: 1px solid ${borderColor};
  }
  th { font-weight: 600; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid ${borderColor}; margin: 24px 0; }
  ul, ol { padding-left: 2em; margin-bottom: 16px; }
  li + li { margin-top: 4px; }
  .task-list-item { list-style: none; margin-left: -1.5em; }
  .task-list-item input { margin-right: 0.5em; }
</style>
</head>
<body><div id="cz-preview-root">${html}</div></body>
</html>`
  }, [darkMode, html, scale])

  const openUrl = useMemo(
    () => URL.createObjectURL(new Blob([srcdoc], { type: 'text/html;charset=utf-8' })),
    [srcdoc],
  )

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(openUrl)
    }
  }, [openUrl])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    // Save scroll position before update
    try {
      const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document
      if (iframeDoc?.scrollingElement) {
        scrollTopRef.current = iframeDoc.scrollingElement.scrollTop
        scrollLeftRef.current = iframeDoc.scrollingElement.scrollLeft
      }
    } catch { /* cross-origin or not ready */ }

    iframe.src = openUrl

    // Restore scroll position after content loads
    const restoreScroll = () => {
      try {
        const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document
        if (iframeDoc?.scrollingElement) {
          iframeDoc.scrollingElement.scrollLeft = scrollLeftRef.current
          iframeDoc.scrollingElement.scrollTop = scrollTopRef.current
        }
      } catch { /* cross-origin or not ready */ }
    }
    iframe.addEventListener('load', restoreScroll, { once: true })

    return () => {
      iframe.removeEventListener('load', restoreScroll)
    }
  }, [openUrl])

  // Empty state
  if (!html && !error) {
    return (
      <PreviewEmptyState icon={<FileText size={40} aria-hidden="true" />}>
        <p className="text-sm text-cz-text-muted">Start typing to see a live preview</p>
      </PreviewEmptyState>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PreviewToolbar
        statusLabel="Preview"
        scale={scale}
        isFit={isFit}
        onFit={fitToWidth}
        showFitButton={false}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        url={openUrl}
        extra={<PreviewDarkModeToggle enabled={darkMode} onToggle={() => setDarkMode((d) => !d)} />}
      />

      {error && <PreviewErrorBanner label="Render Error" message={error} />}

      <div className="min-h-0 flex-1">
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          title="Document preview"
          className="h-full w-full border-0"
        />
      </div>
    </div>
  )
}
