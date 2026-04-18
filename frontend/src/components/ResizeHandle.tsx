import { useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react'

interface ResizeHandleProps {
  orientation: 'vertical' | 'horizontal'
  ariaLabel: string
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => void
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
    window.addEventListener('touchend', stopDragging)
    window.addEventListener('touchcancel', stopDragging)
    window.addEventListener('blur', stopDragging)
    return () => {
      window.removeEventListener('mouseup', stopDragging)
      window.removeEventListener('touchend', stopDragging)
      window.removeEventListener('touchcancel', stopDragging)
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
      className={`relative shrink-0 bg-transparent before:absolute before:content-[''] ${
        isVertical
          ? 'h-full w-px before:-left-[5px] before:-right-[5px] before:inset-y-0'
          : 'h-px w-full before:inset-x-0 before:-top-[5px] before:-bottom-[5px]'
      } ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={(event) => {
        onMouseDown(event)
        setIsDragging(true)
      }}
      onTouchStart={(event) => {
        onMouseDown(event)
        setIsDragging(true)
      }}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-10 transition-colors duration-100 ${
          isActive ? 'bg-cz-accent' : 'bg-cz-border'
        }`}
      />
      {/* Pill touch/click target */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors duration-100 ${
          isVertical ? 'h-8 w-[6px]' : 'h-[6px] w-8'
        } ${isActive ? 'border-cz-accent bg-cz-accent' : 'border-cz-border bg-cz-bg'}`}
      />
    </div>
  )
}
