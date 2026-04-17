import { useCallback, type MouseEvent as ReactMouseEvent } from 'react'

export interface ResizeDragSessionOptions {
  cursor: string
  onMove: (event: MouseEvent) => void
  onStart?: () => void
  onEnd?: () => void
}

export type StartResizeDrag = (
  event: ReactMouseEvent<HTMLElement>,
  options: ResizeDragSessionOptions,
) => void

export function useResizeDrag(): StartResizeDrag {
  return useCallback((event: ReactMouseEvent<HTMLElement>, options: ResizeDragSessionOptions) => {
    event.preventDefault()

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    options.onStart?.()
    document.body.style.cursor = options.cursor
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: MouseEvent) => {
      options.onMove(moveEvent)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      options.onEnd?.()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }, [])
}
