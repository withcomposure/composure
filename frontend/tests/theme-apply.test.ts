import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme } from '../src/themes/apply-theme'

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-appearance')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.removeProperty('--color-cz-accent')
    document.documentElement.style.removeProperty('--color-cz-accent-hover')
    document.documentElement.style.removeProperty('--color-cz-surface')
    document.documentElement.style.removeProperty('--color-cz-bg')

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies and clears inline theme vars as selection changes', () => {
    const root = document.documentElement

    applyTheme('tide', 'dark')
    expect(root.dataset.appearance).toBe('dark')
    expect(root.dataset.theme).toBe('tide')
    expect(root.style.getPropertyValue('--color-cz-accent')).toBe('#2dd4bf')
    expect(root.style.getPropertyValue('--color-cz-bg')).toBe('#080d0e')

    applyTheme('default', 'dark')
    expect(root.dataset.theme).toBe('default')
    expect(root.style.getPropertyValue('--color-cz-accent')).toBe('')
    expect(root.style.getPropertyValue('--color-cz-bg')).toBe('')
  })

  it('uses system appearance when set to system', () => {
    const root = document.documentElement
    applyTheme('phosphor', 'system')
    expect(root.dataset.appearance).toBe('light')
    expect(root.style.getPropertyValue('--color-cz-accent')).toBe('#059669')
  })
})
