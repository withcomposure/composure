import { useEffect, type RefObject } from 'react'

const DEFAULT_SECTION_THRESHOLD: number[] = [0.2, 0.6]

interface UseSectionObserverOptions<T extends string> {
  enabled?: boolean
  root?: Element | null
  rootId?: string
  rootMargin?: string
  threshold?: number | number[]
  getSectionId?: (entry: IntersectionObserverEntry) => T | null
}

export function useSectionObserver<T extends string>(
  sectionRefs: RefObject<Record<T, HTMLElement | null>>,
  onSectionChange: (sectionId: T) => void,
  {
    enabled = true,
    root = null,
    rootId,
    rootMargin = '-20% 0px -60% 0px',
    threshold = DEFAULT_SECTION_THRESHOLD,
    getSectionId,
  }: UseSectionObserverOptions<T> = {},
): void {
  useEffect(() => {
    if (!enabled) return

    const resolvedRoot = rootId ? document.getElementById(rootId) : root
    if (rootId && !resolvedRoot) {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)

      const topEntry = visible[0]
      if (!topEntry) return

      const resolvedId = getSectionId
        ? getSectionId(topEntry)
        : (topEntry.target.id as T)

      if (resolvedId) {
        onSectionChange(resolvedId)
      }
    }, {
      root: resolvedRoot,
      rootMargin,
      threshold,
    })

    const sectionNodes = Object.values(sectionRefs.current) as Array<HTMLElement | null>
    sectionNodes.forEach((node) => {
      if (node) {
        observer.observe(node)
      }
    })

    return () => {
      observer.disconnect()
    }
  }, [enabled, getSectionId, onSectionChange, root, rootId, rootMargin, sectionRefs, threshold])
}
