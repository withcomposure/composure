import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export function useDebouncedNumber(value: number, delayMs: number) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delayMs])

  return debounced
}

export function useElementContentWidth(ref: React.RefObject<HTMLElement | null>) {
  const [contentWidth, setContentWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const updateWidth = () => {
      const styles = getComputedStyle(el)
      const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
      const paddingRight = Number.parseFloat(styles.paddingRight) || 0
      setContentWidth(Math.max(0, el.clientWidth - paddingLeft - paddingRight))
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return contentWidth
}

export function useDragToPan(scrollRef: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (event.button !== 0) return

    const target = event.target as Element | null
    const isTextGlyph = target instanceof HTMLElement
      && target.closest('.cz-pdf-text-layer') != null
      && (target.tagName === 'SPAN' || target.tagName === 'BR')
    if (isTextGlyph) {
      // Preserve native text selection in the PDF text layer.
      return
    }

    const el = scrollRef.current
    if (!el) return

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: el.scrollLeft,
      startScrollTop: el.scrollTop,
    }
    setIsDragging(true)
    el.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    const drag = dragRef.current
    const el = scrollRef.current
    if (!drag || !el || drag.pointerId !== event.pointerId) return

    el.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX)
    el.scrollTop = drag.startScrollTop - (event.clientY - drag.startY)
  }

  const clearDrag = () => {
    dragRef.current = null
    setIsDragging(false)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (el?.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId)
    }
    clearDrag()
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (el?.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId)
    }
    clearDrag()
  }

  const handleLostPointerCapture = () => {
    clearDrag()
  }

  return {
    isDragging: enabled && isDragging,
    dragHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onLostPointerCapture: handleLostPointerCapture,
    },
  }
}
