import { useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'

interface ResizeHandleProps {
  orientation: 'vertical' | 'horizontal'
  ariaLabel: string
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  className?: string
  forceActive?: boolean
  cursor?: CSSProperties['cursor']
}

export function ResizeHandle({
  orientation,
  ariaLabel,
  onMouseDown,
  className = '',
  forceActive = false,
  cursor,
}: ResizeHandleProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const isVertical = orientation === 'vertical'
  const isActive = forceActive || isHovered || isDragging

  useEffect(() => {
    if (!isDragging) {
      return
    }

    const stopDragging = () => {
      setIsDragging(false)
    }

    window.addEventListener('mouseup', stopDragging)
    window.addEventListener('blur', stopDragging)
    return () => {
      window.removeEventListener('mouseup', stopDragging)
      window.removeEventListener('blur', stopDragging)
    }
  }, [isDragging])

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      style={{
        touchAction: 'none',
        cursor: cursor ?? (isVertical ? 'col-resize' : 'row-resize'),
      }}
      className={`relative shrink-0 bg-transparent ${isVertical ? 'h-full w-1' : 'h-1 w-full'} ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={(event) => {
        onMouseDown(event)
        setIsDragging(true)
      }}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-sm transition-all duration-100 ${
          isVertical
            ? `inset-y-0 left-1/2 -translate-x-1/2 ${isActive ? 'w-[2px] bg-cz-accent/70' : 'w-px bg-cz-border'}`
            : `inset-x-0 top-1/2 -translate-y-1/2 ${isActive ? 'h-[2px] bg-cz-accent/70' : 'h-px bg-cz-border'}`
        }`}
      />
    </div>
  )
}
