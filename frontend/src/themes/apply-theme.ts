import { DEFAULT_THEME_ID, findTheme } from './themes'

type AppearancePreference = 'light' | 'dark' | 'system'
type EffectiveAppearance = 'light' | 'dark'

const appliedThemeVarNames = new Set<string>()

function resolveAppearance(appearance: AppearancePreference): EffectiveAppearance {
  if (appearance === 'light' || appearance === 'dark') {
    return appearance
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeVars(root: HTMLElement, vars: Record<string, string>): void {
  for (const varName of appliedThemeVarNames) {
    root.style.removeProperty(varName)
  }
  appliedThemeVarNames.clear()

  for (const [varName, value] of Object.entries(vars)) {
    root.style.setProperty(varName, value)
    appliedThemeVarNames.add(varName)
  }
}

export function applyTheme(themeId: string | undefined, appearance: AppearancePreference): void {
  const root = document.documentElement
  const effectiveAppearance = resolveAppearance(appearance)
  const nextThemeId = String(themeId ?? DEFAULT_THEME_ID).trim() || DEFAULT_THEME_ID

  root.dataset.appearance = effectiveAppearance
  root.dataset.theme = nextThemeId

  const theme = findTheme(nextThemeId)
  const vars = effectiveAppearance === 'dark' ? theme.vars.dark : theme.vars.light
  applyThemeVars(root, vars)
}
