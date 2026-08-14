import { Download, FileText, FileType, Globe, LetterText } from 'lucide-react'
import { IconDropdown, type DropdownOption } from '@/components/IconDropdown'

type ProjectFormat = 'latex' | 'typst' | 'markdown' | 'asciidoc'

interface ExportMenuProps {
  projectFormat: ProjectFormat
  onExport: (format: string) => void
  exporting: boolean
}

interface ExportOption {
  format: ExportFormat
  label: string
  icon: typeof FileText
}

type ExportFormat = 'pdf' | 'docx' | 'html' | 'latex'

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
  const exportOptions: Array<DropdownOption<ExportFormat>> = getExportOptions(projectFormat).map((option) => ({
    type: 'action',
    id: `export-${option.format}`,
    icon: option.icon,
    label: option.label,
    disabled: exporting,
    onSelect: () => onExport(option.format),
  }))

  return (
    <IconDropdown<ExportFormat>
      size="sm"
      disabled={exporting}
      options={exportOptions}
      fallbackWidth={192}
      menuRole="menu"
      menuClassName="w-48 p-1.5"
      trigger={{
        icon: Download,
        iconOnly: true,
        loading: exporting,
        title: exporting ? 'Exporting...' : 'Export',
        ariaLabel: exporting ? 'Exporting...' : 'Export',
        className: exporting
          ? 'bg-cz-surface-hover text-cz-text-muted cursor-wait'
          : 'border border-cz-border text-cz-text hover:bg-cz-surface-hover',
      }}
      className="inline-flex"
    />
  )
}
