import { useEffect, type RefObject } from 'react'

type OutsideClickRef = RefObject<HTMLElement | null>

export function useClickOutside(
  refs: readonly OutsideClickRef[],
  onClose: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const clickedInside = refs.some((ref) => ref.current?.contains(target))
      if (!clickedInside) {
        onClose()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [enabled, onClose, refs])
}
