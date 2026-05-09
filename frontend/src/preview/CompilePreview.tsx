import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { PdfViewer, type PdfViewerPlaceholder } from './PdfViewer'

interface CompilePreviewProps {
  pdfUrl: string | null
  error: string | null
  documentName?: string
  compiling?: boolean
  pinControl?: {
    pinned: boolean
    onToggle: () => void
  } | null
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
        <p className="mt-2 text-xs italic text-cz-text-muted">
          This is taking longer than usual.
        </p>
      )}
    </>
  )
}

export function CompilePreview({
  pdfUrl,
  error,
  documentName = 'Compile',
  compiling = false,
  pinControl = null,
}: CompilePreviewProps) {
  const placeholder: PdfViewerPlaceholder = compiling
    ? {
      icon: undefined,
      content: <CompilingPlaceholderContent />,
    }
    : {
      icon: <FileText size={40} aria-hidden="true" />,
      content: (
        <p className="text-sm text-cz-text-muted">
          Press{' '}
          <kbd className="rounded border border-cz-border bg-cz-surface px-1.5 py-0.5 font-mono text-[11px]">
            Ctrl+Enter
          </kbd>{' '}
          to compile
        </p>
      ),
    }

  return (
    <PdfViewer
      url={pdfUrl}
      error={error}
      documentName={documentName}
      errorLabel="Compilation Error"
      placeholder={placeholder}
      hideToolbarWhenPlaceholder={pinControl == null}
      pinControl={pinControl}
    />
  )
}

export { PdfViewer } from './PdfViewer'
export { ImageViewer } from './ImageViewer'
