import type { ReactNode } from 'react'

interface AmbientBackgroundProps {
  children: ReactNode
  className?: string
}

export function AmbientBackground({ children, className = '' }: AmbientBackgroundProps) {
  return (
    <div className={`relative h-dvh overflow-hidden bg-cz-bg text-cz-text ${className}`.trim()}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-cz-accent/20 blur-3xl" />
        <div className="absolute -bottom-24 right-10 h-72 w-72 rounded-full bg-cz-accent/10 blur-3xl" />
      </div>
      <div className="relative h-full overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full box-border items-center justify-center px-4 py-8">
          {children}
        </div>
      </div>
    </div>
  )
}
