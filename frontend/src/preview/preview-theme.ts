export function getPreviewDarkModeDefault(): boolean {
  if (typeof document !== 'undefined') {
    const appearance = document.documentElement.dataset.appearance
    if (appearance === 'dark') {
      return true
    }
    if (appearance === 'light') {
      return false
    }
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  return true
}