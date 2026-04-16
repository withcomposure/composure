import { useCallback, useRef, useState } from 'react'
import { ChevronDown, Download, FileText, FileType, Globe, LetterText } from 'lucide-react'
import { useClickOutside } from '../hooks/useClickOutside'
import { useEscapeKey } from '../hooks/useEscapeKey'

type ProjectFormat = 'latex' | 'typst' | 'markdown' | 'asciidoc'

interface ExportMenuProps {
  projectFormat: ProjectFormat
  onExport: (format: string) => void
  exporting: boolean
}

interface ExportOption {
  format: string
  label: string
  icon: typeof FileText
}

function getExportOptions(projectFormat: ProjectFormat): ExportOption[] {
  const options: ExportOption[] = [
    { format: 'pdf', label: 'PDF', icon: FileText },
    { format: 'docx', label: 'Microsoft Word', icon: FileType },
    { format: 'html', label: 'HTML', icon: Globe },
  ]
  if (projectFormat !== 'latex') {
    options.push({ format: 'latex', label: 'LaTeX', icon: LetterText })
  }
  return options
}

export function ExportMenu({ projectFormat, onExport, exporting }: ExportMenuProps) {
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => {
    setShowMenu(false)
  }, [])

  useClickOutside([menuRef], closeMenu, showMenu)
  useEscapeKey(closeMenu, showMenu)

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu((prev) => !prev)}
        disabled={exporting}
        title={exporting ? 'Exporting...' : 'Export'}
        aria-label={exporting ? 'Exporting...' : 'Export'}
        className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
          exporting
            ? 'bg-cz-surface-hover text-cz-text-muted cursor-wait'
            : 'border border-cz-border text-cz-text hover:bg-cz-surface-hover'
        }`}
      >
        {exporting ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <>
            <Download size={12} />
            <ChevronDown size={10} />
          </>
        )}
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg border border-cz-border bg-cz-surface p-1.5 shadow-xl">
          {getExportOptions(projectFormat).map((opt) => (
            <button
              key={opt.format}
              type="button"
              onClick={() => {
                closeMenu()
                onExport(opt.format)
              }}
              disabled={exporting}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-cz-text hover:bg-cz-surface-hover disabled:opacity-50"
            >
              <opt.icon size={14} className="text-cz-text-muted" />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
