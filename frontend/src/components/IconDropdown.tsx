import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useEscapeKey } from '@/hooks/use-escape-key'
import { useMenuPosition } from '@/hooks/use-menu-position'
import { ToggleSwitch } from '@/components/ToggleSwitch'

interface DropdownOptionBase {
  id?: string
  label: string
  icon: LucideIcon
  iconColor?: string
  description?: string
  disabled?: boolean
  title?: string
  ariaLabel?: string
  trailing?: ReactNode
  className?: string
  closeOnSelect?: boolean
}

export interface DropdownSelectOption<T extends string> extends DropdownOptionBase {
  type?: 'select'
  value: T
}

export interface DropdownActionOption extends DropdownOptionBase {
  type: 'action'
  onSelect: () => void
}

export interface DropdownToggleOption extends DropdownOptionBase {
  type: 'toggle'
  checked: boolean
  onToggle: (nextChecked: boolean) => void
  switchAriaLabel?: string
  closeOnToggle?: boolean
}

export type DropdownOption<T extends string> =
  | DropdownSelectOption<T>
  | DropdownActionOption
  | DropdownToggleOption

export interface IconDropdownTrigger {
  icon: LucideIcon
  label?: string
  iconColor?: string
  iconOnly?: boolean
  showChevron?: boolean
  title?: string
  ariaLabel?: string
  className?: string
  loading?: boolean
}

interface IconDropdownProps<T extends string> {
  value?: T
  options: Array<DropdownOption<T>>
  onChange?: (value: T) => void
  disabled?: boolean
  iconOnly?: boolean
  /** Trigger height: 'md' (32px, standard control height) or 'sm' (28px, dense toolbars). */
  size?: 'sm' | 'md'
  className?: string
  menuClassName?: string
  buttonClassName?: string
  unstyledButton?: boolean
  trigger?: IconDropdownTrigger
  fallbackWidth?: number
  menuRole?: 'listbox' | 'menu'
  trackMinWidth?: boolean
  stopPropagation?: boolean
}

function isSelectOption<T extends string>(option: DropdownOption<T>): option is DropdownSelectOption<T> {
  return option.type === undefined || option.type === 'select'
}

function isActionOption<T extends string>(option: DropdownOption<T>): option is DropdownActionOption {
  return option.type === 'action'
}

function isToggleOption<T extends string>(option: DropdownOption<T>): option is DropdownToggleOption {
  return option.type === 'toggle'
}

function getOptionKey<T extends string>(option: DropdownOption<T>, index: number): string {
  if (option.id) {
    return option.id
  }
  if (isSelectOption(option)) {
    return `select:${option.value}`
  }
  if (isActionOption(option)) {
    return `action:${option.label}:${index}`
  }
  return `toggle:${option.label}:${index}`
}

export function IconDropdown<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  iconOnly = false,
  size = 'md',
  className = '',
  menuClassName = '',
  buttonClassName = '',
  unstyledButton = false,
  trigger,
  fallbackWidth = 176,
  menuRole,
  trackMinWidth = false,
  stopPropagation = false,
}: IconDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const closeMenu = useCallback(() => setOpen(false), [])

  const selected = useMemo(() => {
    const matching = options.find((option): option is DropdownSelectOption<T> =>
      isSelectOption(option) && option.value === value,
    )
    if (matching) {
      return matching
    }
    return options.find((option): option is DropdownSelectOption<T> => isSelectOption(option))
  }, [options, value])

  const hasNonSelectOption = options.some((option) => !isSelectOption(option))
  const resolvedMenuRole = menuRole ?? (hasNonSelectOption ? 'menu' : 'listbox')

  const triggerConfig = trigger ??
    (selected
      ? {
          icon: selected.icon,
          label: selected.label,
          iconColor: selected.iconColor,
          title: selected.label,
          ariaLabel: selected.label,
        }
      : null)

  if (!triggerConfig) return null

  const TriggerIcon = triggerConfig.icon
  const buttonTitle = triggerConfig.title ?? selected?.label ?? triggerConfig.label ?? 'Options'
  const buttonAriaLabel = triggerConfig.ariaLabel ?? buttonTitle
  const showButtonLabel = !(triggerConfig.iconOnly ?? iconOnly)
  const showChevron = triggerConfig.showChevron ?? true

  const menuPosition = useMenuPosition(buttonRef, menuRef, {
    enabled: open,
    fallbackWidth,
    trackMinWidth,
  })

  useClickOutside([rootRef, menuRef], closeMenu, open)
  useEscapeKey(closeMenu, open)

  const buttonBaseClass = `flex ${size === 'sm' ? 'h-7' : 'h-8'} items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50`
  const buttonSkinClass = unstyledButton
    ? ''
    : 'border border-cz-border bg-cz-surface text-cz-text hover:bg-cz-surface-hover'

  return (
    <div ref={rootRef} className={`relative ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={(event) => {
          if (stopPropagation) {
            event.stopPropagation()
          }
          setOpen((prev) => !prev)
        }}
        className={`${buttonBaseClass} ${buttonSkinClass} ${buttonClassName} ${triggerConfig.className ?? ''}`.trim()}
        aria-haspopup={resolvedMenuRole}
        aria-expanded={open}
        aria-label={buttonAriaLabel}
        title={buttonTitle}
      >
        {triggerConfig.loading ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <TriggerIcon
            size={12}
            className="shrink-0"
            style={triggerConfig.iconColor ? { color: triggerConfig.iconColor } : undefined}
          />
        )}
        {showButtonLabel && <span>{triggerConfig.label ?? selected?.label}</span>}
        {showChevron && !triggerConfig.loading && <ChevronDown size={12} className="shrink-0" />}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role={resolvedMenuRole}
            className={`fixed z-[100] min-w-44 overflow-hidden rounded-lg border border-cz-border bg-cz-surface p-1 shadow-xl ${menuClassName}`.trim()}
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              minWidth: menuPosition.minWidth ? `${menuPosition.minWidth}px` : undefined,
            }}
          >
            {options.map((option, index) => {
              const OptionIcon = option.icon

              if (isToggleOption(option)) {
                return (
                  <div
                    key={getOptionKey(option, index)}
                    role={resolvedMenuRole === 'menu' ? 'menuitemcheckbox' : undefined}
                    aria-checked={resolvedMenuRole === 'menu' ? option.checked : undefined}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${option.disabled ? 'opacity-40' : 'text-cz-text hover:bg-cz-surface-hover'} ${option.className ?? ''}`.trim()}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <OptionIcon
                        size={14}
                        className="shrink-0"
                        style={option.iconColor ? { color: option.iconColor } : undefined}
                      />
                      <span className="flex-1 min-w-0">
                        {option.label}
                        {option.description && (
                          <span className="block text-[10px] text-cz-text-muted">{option.description}</span>
                        )}
                      </span>
                    </span>
                    <ToggleSwitch
                      checked={option.checked}
                      disabled={option.disabled}
                      onChange={(nextChecked) => {
                        option.onToggle(nextChecked)
                        if (option.closeOnToggle) {
                          closeMenu()
                        }
                      }}
                      ariaLabel={option.switchAriaLabel ?? option.ariaLabel ?? option.label}
                    />
                  </div>
                )
              }

              const active = isSelectOption(option) && option.value === value
              const sharedClass = active
                ? 'bg-cz-accent-muted text-cz-text'
                : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'

              return (
                <button
                  key={getOptionKey(option, index)}
                  type="button"
                  role={resolvedMenuRole === 'listbox' ? 'option' : 'menuitem'}
                  aria-selected={resolvedMenuRole === 'listbox' ? active : undefined}
                  disabled={option.disabled}
                  onClick={(event) => {
                    if (stopPropagation) {
                      event.stopPropagation()
                    }
                    if (option.disabled) {
                      return
                    }

                    if (isSelectOption(option)) {
                      onChange?.(option.value)
                      if (option.closeOnSelect !== false) {
                        closeMenu()
                      }
                      return
                    }

                    option.onSelect()
                    if (option.closeOnSelect !== false) {
                      closeMenu()
                    }
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${sharedClass} ${option.className ?? ''}`.trim()}
                  title={option.title}
                  aria-label={option.ariaLabel ?? option.label}
                >
                  <OptionIcon
                    size={14}
                    className="shrink-0"
                    style={option.iconColor ? { color: option.iconColor } : undefined}
                  />
                  <span className="flex-1 min-w-0">
                    {option.label}
                    {option.description && (
                      <span className="block text-[10px] text-cz-text-muted">{option.description}</span>
                    )}
                  </span>
                  {option.trailing ?? (active ? <Check size={13} className="shrink-0 text-cz-accent" /> : null)}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
