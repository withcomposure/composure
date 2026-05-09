import { Ellipsis, type LucideIcon } from 'lucide-react'
import { IconDropdown, type DropdownOption } from '@/components/IconDropdown'

interface ActionMenuItem {
  id: string
  label: string
  icon: LucideIcon
  danger?: boolean
  onSelect: () => void
}

interface ActionMenuProps {
  items: ActionMenuItem[]
  ariaLabel: string
}

export function ActionMenu({ items, ariaLabel }: ActionMenuProps) {
  const options: Array<DropdownOption<'action'>> = items.map((item) => ({
    type: 'action',
    id: item.id,
    icon: item.icon,
    label: item.label,
    onSelect: item.onSelect,
    className: item.danger
      ? 'text-red-300 hover:bg-red-500/15 hover:text-red-200'
      : undefined,
  }))

  return (
    <IconDropdown<'action'>
      options={options}
      menuRole="menu"
      fallbackWidth={192}
      trackMinWidth
      stopPropagation
      className="inline-flex"
      trigger={{
        icon: Ellipsis,
        iconOnly: true,
        showChevron: false,
        title: ariaLabel,
        ariaLabel,
        className: 'h-auto rounded-md border border-transparent bg-transparent p-1.5 text-cz-text-muted hover:border-cz-border hover:bg-cz-surface-hover hover:text-cz-text',
      }}
      menuClassName="p-1"
    />
  )
}
