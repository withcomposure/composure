import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { PreviewErrorBanner } from './PreviewToolbar'

interface PreviewPaneProps {
  toolbar?: ReactNode
  error?: {
    label: string
    message: string
  } | null
  children: ReactNode
}

export function PreviewPane({ toolbar, error, children }: PreviewPaneProps) {
  return (
    <div className="flex h-full flex-col">
      {toolbar}
      {error && <PreviewErrorBanner label={error.label} message={error.message} />}
      {children}
    </div>
  )
}

interface PreviewViewportProps extends ComponentPropsWithoutRef<'div'> {
  inset?: boolean
}

export const PreviewViewport = forwardRef<HTMLDivElement, PreviewViewportProps>(
  function PreviewViewport({ className, inset = true, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={`flex-1 overflow-auto ${inset ? 'p-2' : ''}${className ? ` ${className}` : ''}`}
        {...props}
      />
    )
  },
)
