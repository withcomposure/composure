import { useCallback, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react'

export interface ResizeDragSessionOptions {
  cursor: string
  onMove: (event: MouseEvent | TouchEvent) => void
  onStart?: () => void
  onEnd?: () => void
}

export type StartResizeDrag = (
  event: ReactMouseEvent<HTMLElement> | ReactTouchEvent<HTMLElement>,
  options: ResizeDragSessionOptions,
) => void

export function useResizeDrag(): StartResizeDrag {
  return useCallback((event: ReactMouseEvent<HTMLElement> | ReactTouchEvent<HTMLElement>, options: ResizeDragSessionOptions) => {
    event.preventDefault()

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    options.onStart?.()
    document.body.style.cursor = options.cursor
    document.body.style.userSelect = 'none'

    const isTouch = 'touches' in event.nativeEvent

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      options.onMove(moveEvent)
    }

    const onUp = () => {
      if (isTouch) {
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onUp)
        window.removeEventListener('touchcancel', onUp)
      } else {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.removeEventListener('blur', onUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      options.onEnd?.()
    }

    if (isTouch) {
      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onUp)
      window.addEventListener('touchcancel', onUp)
    } else {
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    window.addEventListener('blur', onUp)
  }, [])
}
