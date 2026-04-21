export interface ComposureTheme {
  id: string
  label: string
  swatch: string
  vars: {
    light: Record<string, string>
    dark: Record<string, string>
  }
}

export const THEMES: ComposureTheme[] = [
  {
    id: 'default',
    label: 'Night Shift',
    swatch: '#6366f1',
    vars: { light: {}, dark: {} },
  },

  {
    id: 'tide',
    label: 'Tide',
    swatch: '#2dd4bf',
    vars: {
      light: {
        '--color-cz-accent': '#0d9488',
        '--color-cz-accent-hover': '#0f766e',
        '--color-cz-accent-muted': 'rgba(13, 148, 136, 0.1)',
      },
      dark: {
        '--color-cz-bg': '#080d0e',
        '--color-cz-surface': '#0e1a1c',
        '--color-cz-surface-hover': '#141f22',
        '--color-cz-border': '#1c2e32',
        '--color-cz-border-subtle': '#131e21',
        '--color-cz-accent': '#2dd4bf',
        '--color-cz-accent-hover': '#5eead4',
        '--color-cz-accent-muted': 'rgba(45, 212, 191, 0.12)',
      },
    },
  },

  {
    id: 'sunset',
    label: 'Sunset',
    swatch: '#f59e0b',
    vars: {
      light: {
        '--color-cz-accent': '#d97706',
        '--color-cz-accent-hover': '#b45309',
        '--color-cz-accent-muted': 'rgba(217, 119, 6, 0.1)',
      },
      dark: {
        '--color-cz-bg': '#0d0b08',
        '--color-cz-surface': '#171410',
        '--color-cz-surface-hover': '#1d1a14',
        '--color-cz-border': '#2a2418',
        '--color-cz-border-subtle': '#1d1a12',
        '--color-cz-accent': '#f59e0b',
        '--color-cz-accent-hover': '#fbbf24',
        '--color-cz-accent-muted': 'rgba(245, 158, 11, 0.12)',
      },
    },
  },

  {
    id: 'sakura',
    label: 'Sakura',
    swatch: '#f472b6',
    vars: {
      light: {
        '--color-cz-accent': '#db2777',
        '--color-cz-accent-hover': '#be185d',
        '--color-cz-accent-muted': 'rgba(219, 39, 119, 0.1)',
      },
      dark: {
        '--color-cz-bg': '#0e0a0c',
        '--color-cz-surface': '#1a1217',
        '--color-cz-surface-hover': '#20161c',
        '--color-cz-border': '#2e1e28',
        '--color-cz-border-subtle': '#201318',
        '--color-cz-accent': '#f472b6',
        '--color-cz-accent-hover': '#f9a8d4',
        '--color-cz-accent-muted': 'rgba(244, 114, 182, 0.12)',
      },
    },
  },

  {
    id: 'phosphor',
    label: 'Phosphor',
    swatch: '#34d399',
    vars: {
      light: {
        '--color-cz-accent': '#059669',
        '--color-cz-accent-hover': '#047857',
        '--color-cz-accent-muted': 'rgba(5, 150, 105, 0.1)',
      },
      dark: {
        '--color-cz-bg': '#09090a',
        '--color-cz-surface': '#111411',
        '--color-cz-surface-hover': '#161a16',
        '--color-cz-border': '#1e2a1e',
        '--color-cz-border-subtle': '#131a13',
        '--color-cz-accent': '#34d399',
        '--color-cz-accent-hover': '#6ee7b7',
        '--color-cz-accent-muted': 'rgba(52, 211, 153, 0.12)',
      },
    },
  },
]

export const DEFAULT_THEME_ID = 'default'

export function findTheme(id: string): ComposureTheme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}
