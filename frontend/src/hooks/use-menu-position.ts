import { useLayoutEffect, useState, type RefObject } from 'react'

export interface MenuPosition {
  top: number
  left: number
  minWidth?: number
}

interface UseMenuPositionOptions {
  enabled?: boolean
  fallbackWidth?: number
  viewportPadding?: number
  offsetY?: number
  trackMinWidth?: boolean
}

export function useMenuPosition(
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  {
    enabled = true,
    fallbackWidth = 176,
    viewportPadding = 8,
    offsetY = 4,
    trackMinWidth = false,
  }: UseMenuPositionOptions = {},
): MenuPosition {
  const [position, setPosition] = useState<MenuPosition>({
    top: 0,
    left: 0,
    minWidth: trackMinWidth ? fallbackWidth : undefined,
  })

  useLayoutEffect(() => {
    if (!enabled) return

    const updatePosition = () => {
      if (!triggerRef.current) return

      const rect = triggerRef.current.getBoundingClientRect()
      const menuWidth = menuRef.current?.offsetWidth ?? fallbackWidth
      let left = rect.right - menuWidth
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - menuWidth - viewportPadding))

      let top = rect.bottom + offsetY
      const maxTop = window.innerHeight - viewportPadding
      if (top > maxTop) {
        top = maxTop
      }

      const next: MenuPosition = {
        top,
        left,
        minWidth: trackMinWidth ? Math.max(rect.width, fallbackWidth) : undefined,
      }

      setPosition((prev) => {
        if (prev.top === next.top && prev.left === next.left && prev.minWidth === next.minWidth) {
          return prev
        }
        return next
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [enabled, fallbackWidth, menuRef, offsetY, trackMinWidth, triggerRef, viewportPadding])

  return position
}
