import type { ReactNode } from 'react'

interface AmbientBackgroundProps {
  children: ReactNode
  className?: string
}

export function AmbientBackground({ children, className = '' }: AmbientBackgroundProps) {
  return (
    <div className={`relative h-dvh overflow-hidden bg-cz-bg text-cz-text ${className}`.trim()}>
      <div className="relative h-full overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full box-border items-center justify-center px-4 py-8">
          {children}
        </div>
      </div>
    </div>
  )
}
