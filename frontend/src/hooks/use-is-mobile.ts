import { useEffect, useState } from 'react'

const mobileBreakpointPx = 1024

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return window.innerWidth < mobileBreakpointPx
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const onResize = () => {
      setIsMobile(window.innerWidth < mobileBreakpointPx)
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return isMobile
}
