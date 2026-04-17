import type { ReactNode } from 'react'

export type PopupActionVariant = 'primary' | 'secondary' | 'danger'

export interface PopupAction {
  label: string
  onClick: () => void
  variant?: PopupActionVariant
  disabled?: boolean
  autoFocus?: boolean
}

export interface PopupDismiss {
  label: string
  onClick: () => void
  disabled?: boolean
}

export type PopupPanelWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl'

interface PopupDialogProps {
  open: boolean
  title: string
  message?: string
  actions: PopupAction[]
  dismiss?: PopupDismiss
  children?: ReactNode
  panelWidth?: PopupPanelWidth
  panelClassName?: string
}

const panelWidthClass: Record<PopupPanelWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
}

function actionClass(variant: PopupActionVariant): string {
  if (variant === 'danger') {
    return 'bg-cz-danger text-white hover:brightness-110'
  }

  if (variant === 'secondary') {
    return 'border border-cz-border bg-cz-surface text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'
  }

  return 'bg-cz-accent text-white hover:bg-cz-accent-hover'
}

export function PopupDialog({
  open,
  title,
  message,
  actions,
  dismiss,
  children,
  panelWidth = 'md',
  panelClassName,
}: PopupDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={() => {
        if (dismiss && !dismiss.disabled) {
          dismiss.onClick()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        className={`w-full ${panelWidthClass[panelWidth]} rounded-xl border border-cz-border bg-cz-surface shadow-2xl ${panelClassName ?? ''}`.trim()}
      >
        <div className="border-b border-cz-border px-5 py-4">
          <h2 className="text-base font-semibold text-cz-text">{title}</h2>
          {message && <p className="mt-1 text-sm text-cz-text-muted">{message}</p>}
        </div>

        {children && <div className="px-5 py-4">{children}</div>}

        <div className="flex items-center justify-end gap-2 border-t border-cz-border px-5 py-4">
          {dismiss && (
            <button
              onClick={dismiss.onClick}
              disabled={dismiss.disabled}
              className="rounded-md border border-cz-border bg-cz-surface px-3 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-60"
            >
              {dismiss.label}
            </button>
          )}

          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              autoFocus={action.autoFocus}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${actionClass(action.variant ?? 'primary')}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
