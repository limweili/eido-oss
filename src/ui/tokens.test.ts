import { describe, expect, it } from 'vitest'
import {
  BOARD_SEARCH_PANEL_METRICS,
  CONNECTION_ARROW_METRICS,
  CONNECTOR_NODE_METRICS,
  DEFAULT_THEME,
  DESIGN_TOKEN_NAMES,
  DESIGN_TOKENS,
  GROUP_CARD_SURFACE_OPACITY,
  REDUCED_MOTION_TOKEN_OVERRIDES,
  designTokensForTheme,
  painterPaletteForTheme,
  renderDesignTokenCss,
  type ThemeId,
} from './tokens'

const expectedLight = {
  '--e-surface-recessed': '#dcd7cc',
  '--e-surface-ground': '#e8e4dc',
  '--e-surface-panel': '#f1eee8',
  '--e-surface-card': '#f8f6f1',
  '--e-surface-floating': '#fcfaf6',
  '--e-surface-field': '#e9e5dd',
  '--e-field-bg': '#fcfaf6',
  '--e-field-hover': '#e9e5dd',
  '--e-veil': 'rgba(35,32,25,.32)',
  '--e-veil-deep': 'rgba(35,32,25,.78)',
  '--e-ink': '#232019',
  '--e-ink-soft': '#5f594c',
  '--e-ink-faint': '#847d70',
  '--e-line': 'rgba(35,32,25,.16)',
  '--e-line-strong': 'rgba(35,32,25,.52)',
  '--e-dot': 'rgba(35,32,25,.26)',
  '--e-wash': 'rgba(35,32,25,.07)',
  '--e-grid-dot': 'rgba(35,32,25,.11)',
  '--e-pad-dot': 'rgba(35,32,25,.14)',
  '--e-ink-on-bright': '#232019',
  '--e-go': '#2f6f5e',
  '--e-go-ink': '#2b6656',
  '--e-avoid': '#bb4326',
  '--e-avoid-ink': '#9f3b21',
  '--e-mod': '#6a4fb0',
  '--e-mod-ink': '#664ca9',
  '--e-convo': '#3466c2',
  '--e-convo-ink': '#2f5cb0',
  '--e-attention': '#e9a820',
  '--e-attention-ink': '#805b06',
  '--e-agent-unadopted-accent': '#805b06',
  '--e-on-solid': '#f8f6f1',
  '--e-wash-base': '#f8f6f1',
  '--e-brand-green': '#2f6f5e',
  '--e-brand-blue': '#3568c6',
  '--e-brand-amber': '#eca23b',
  '--e-hl-yellow': '#f9eaa6',
  '--e-hl-yellow-dot': '#dfb93a',
  '--e-hl-green': '#d8efc4',
  '--e-hl-green-dot': '#74b74a',
  '--e-hl-blue': '#cfe6fb',
  '--e-hl-blue-dot': '#5a9bdd',
  '--e-hl-pink': '#fbd9ea',
  '--e-hl-pink-dot': '#e178b0',
  '--e-hl-orange': '#fcdfbd',
  '--e-hl-orange-dot': '#e99a45',
  '--e-hl-purple': '#e4dcf9',
  '--e-hl-purple-dot': '#9a7edb',
  '--e-hl-teal': '#c8eee6',
  '--e-hl-teal-dot': '#41ac99',
  '--e-hl-red': '#fbd6cf',
  '--e-hl-red-dot': '#dd6d5c',
  '--e-hl-brown': '#e9dccd',
  '--e-hl-brown-dot': '#a3805e',
  '--e-hl-gray': '#e4e1d8',
  '--e-hl-gray-dot': '#8d897c',
  '--e-mono': '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  '--e-sans': '"Open Sans", system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
  '--e-fs-micro': '11px',
  '--e-fs-label': '12px',
  '--e-fs-ui': '13px',
  '--e-fs-title': '14px',
  '--e-fs-display': '16px',
  '--e-fs-title-canvas': '24px',
  '--e-tracking-caps-s': '.08em',
  '--e-tracking-caps': '.06em',
  '--e-tracking-mono': '.04em',
  '--e-tracking-display': '.02em',
  '--e-fs-prose-s': '14px',
  '--e-fs-prose-m': '15px',
  '--e-fs-prose-l': '18px',
  '--e-fs-prose-xl': '22px',
  '--e-fs-prose-2xl': '28px',
  '--e-fs-prose-3xl': '34px',
  '--e-fs-editorial-h3': '16px',
  '--e-fs-editorial-h2': '20px',
  '--e-fs-editorial-h1': '26px',
  '--e-fs-editorial-title': '34px',
  '--e-lh-editorial-h3': '1.35',
  '--e-lh-editorial-h2': '1.28',
  '--e-lh-editorial-h1': '1.2',
  '--e-lh-editorial-title': '1.1',
  '--e-fs-editorial-lede': '18px',
  '--e-sp-1': '4px',
  '--e-sp-2': '8px',
  '--e-sp-3': '12px',
  '--e-sp-4': '16px',
  '--e-sp-5': '24px',
  '--e-sp-6': '32px',
  '--e-sp-7': '48px',
  '--e-r-inner': '4px',
  '--e-r-chip': '6px',
  '--e-r-card': '8px',
  '--e-r-well': '10px',
  '--e-r-modal': '12px',
  '--e-card-border-width': '1px',
  '--e-attachment-panel-height-min': '120px',
  '--e-attachment-panel-height-max': '240px',
  '--e-attachment-panel-height-share': '28%',
  '--e-attachment-preview-width': '240px',
  '--e-attachment-image-width-max': '320px',
  '--e-attachment-preview-width-max': '480px',
  '--e-link-preview-split-inline': '360px',
  '--e-link-preview-stack-image-block': '144px',
  '--e-link-preview-description-block': '96px',
  '--e-link-preview-chip-block': '72px',
  '--e-link-preview-stack-image-ratio': '16 / 9',
  '--e-link-preview-stack-image-block-max': '50%',
  '--e-link-preview-row-image-ratio': '4 / 3',
  '--e-link-preview-row-image-inline-max': '40%',
  '--e-attachment-panel-reserved-chrome': '62px',
  '--e-group-surface-opacity': '45%',
  '--e-group-selected-surface-opacity': '55%',
  '--e-connector-size': '13px',
  '--e-connector-hit-size': '24px',
  '--e-connector-stroke': '1.5px',
  '--e-connector-focus-ring': '1px',
  '--e-topbar-height': '44px',
  '--e-shadow-lift': '0 2px 4px rgba(35,32,25,.08), 0 12px 30px rgba(35,32,25,.16)',
  '--e-z-canvas-chrome': '6',
  '--e-z-canvas-floating': '9001',
  '--e-z-lifted': '30',
  '--e-z-dock': '40',
  '--e-z-panel': '45',
  '--e-z-popover': '60',
  '--e-z-chrome-barrier': '70',
  '--e-z-modal': '80',
  '--e-z-toast': '90',
  '--e-t-fast': '120ms',
  '--e-t-exit': '140ms',
  '--e-t-move': '220ms',
  '--e-t-move-far': '320ms',
  '--e-t-camera': '360ms',
  '--e-t-intent': '600ms',
  '--e-t-stream': '1s',
  '--e-t-fade': '120ms',
  '--e-t-reduced-fade': '80ms',
  '--e-scale-press': '.97',
  '--e-scale-lift': '1.02',
  '--e-scale-grow': '1.35',
  '--e-ease-out': 'cubic-bezier(.25,.6,.25,1)',
  '--e-ease-in': 'cubic-bezier(.5,0,.75,.4)',
  '--e-ease-settle': 'cubic-bezier(.2,.75,.25,1.08)',
} as const

const expectedDark = {
  ...expectedLight,
  '--e-surface-recessed': '#181512',
  '--e-surface-ground': '#1e1b19',
  '--e-surface-panel': '#25221f',
  '--e-surface-card': '#2b2725',
  '--e-surface-floating': '#383432',
  '--e-surface-field': '#211e1c',
  '--e-field-bg': '#211e1c',
  '--e-field-hover': '#262321',
  '--e-veil': 'rgba(20,17,12,.55)',
  '--e-veil-deep': 'rgba(20,17,12,.85)',
  '--e-ink': '#ece7db',
  '--e-ink-soft': '#b8b0a0',
  '--e-ink-faint': '#8b8375',
  '--e-line': 'rgba(236,231,219,.15)',
  '--e-line-strong': 'rgba(236,231,219,.44)',
  '--e-dot': 'rgba(236,231,219,.25)',
  '--e-wash': 'rgba(236,231,219,.08)',
  '--e-grid-dot': 'rgba(236,231,219,.10)',
  '--e-pad-dot': 'rgba(236,231,219,.13)',
  '--e-go': '#4d9d84',
  '--e-go-ink': '#7fc4ab',
  '--e-avoid': '#d77355',
  '--e-avoid-ink': '#ec9f85',
  '--e-mod': '#a68ae0',
  '--e-mod-ink': '#bfa8ee',
  '--e-convo': '#6d97e8',
  '--e-convo-ink': '#93b4f0',
  '--e-attention': '#e9a820',
  '--e-attention-ink': '#e3b458',
  '--e-agent-unadopted-accent': '#e3b458',
  '--e-on-solid': '#1d1a18',
  '--e-wash-base': '#2b2725',
  '--e-brand-green': '#4d9d84',
  '--e-brand-blue': '#6f9ce8',
  '--e-brand-amber': '#eca23b',
  '--e-hl-yellow': '#584518',
  '--e-hl-yellow-dot': '#e0c34e',
  '--e-hl-green': '#37522b',
  '--e-hl-green-dot': '#8bbf68',
  '--e-hl-blue': '#2b4562',
  '--e-hl-blue-dot': '#74a8e0',
  '--e-hl-pink': '#5c3049',
  '--e-hl-pink-dot': '#d585b4',
  '--e-hl-orange': '#5f3d1d',
  '--e-hl-orange-dot': '#dd9a50',
  '--e-hl-purple': '#443463',
  '--e-hl-purple-dot': '#a68ae0',
  '--e-hl-teal': '#1f4f47',
  '--e-hl-teal-dot': '#58b5a2',
  '--e-hl-red': '#5d2a25',
  '--e-hl-red-dot': '#d97a68',
  '--e-hl-brown': '#4a3a2b',
  '--e-hl-brown-dot': '#b08a62',
  '--e-hl-gray': '#3d3a33',
  '--e-hl-gray-dot': '#97907f',
  '--e-shadow-lift': '0 2px 4px rgba(10,8,6,.44), 0 12px 30px rgba(10,8,6,.58)',
} as const

const expectedByTheme = { light: expectedLight, dark: expectedDark } as const

const HIGHLIGHT_NAMES = [
  'yellow',
  'green',
  'blue',
  'pink',
  'orange',
  'purple',
  'teal',
  'red',
  'brown',
  'gray',
] as const

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('design token authority', () => {
  it('pins the prototype connector geometry as screen-space chrome', () => {
    expect(CONNECTOR_NODE_METRICS).toEqual({
      diameter: 13,
      maxDiameter: 24,
      hitDiameter: 24,
      stroke: 1.5,
      focusRing: 1,
    })
    expect(CONNECTION_ARROW_METRICS).toEqual({
      tipExtension: 3,
      heightRatio: 0.72,
    })
  })

  it('pins the Board Search panel geometry recipe', () => {
    expect(BOARD_SEARCH_PANEL_METRICS).toEqual({
      defaultWidth: 360,
      minWidth: 280,
      maxWidth: 720,
      keyboardStep: 16,
      viewportInset: 64,
    })
  })

  it('pins the translucent Group surface recipe shared by DOM and painter', () => {
    expect(GROUP_CARD_SURFACE_OPACITY).toEqual({
      resting: 0.45,
      selected: 0.55,
    })
  })

  it('pins the complete ordered schema and concrete values in both themes', () => {
    expect(DEFAULT_THEME satisfies ThemeId).toBe('light')
    expect(DESIGN_TOKEN_NAMES).toEqual(Object.keys(expectedLight))
    expect(DESIGN_TOKENS).toEqual(expectedByTheme)
    expect(Object.keys(DESIGN_TOKENS.light)).toEqual(Object.keys(DESIGN_TOKENS.dark))

    for (const theme of ['light', 'dark'] as const) {
      expect(designTokensForTheme(theme)).toBe(DESIGN_TOKENS[theme])
      expect(DESIGN_TOKENS[theme]['--e-agent-unadopted-accent']).toBe(
        DESIGN_TOKENS[theme]['--e-attention-ink'],
      )
      for (const value of Object.values(DESIGN_TOKENS[theme])) {
        expect(value).not.toMatch(/\b(?:var|color-mix)\(/)
      }
    }
  })

  it('renders one deterministic root and dark block without duplicate declarations', () => {
    const first = renderDesignTokenCss()
    const second = renderDesignTokenCss()

    expect(second).toBe(first)
    expect(first).toMatch(/^:root \{\n  color-scheme: light;/)
    expect(first).toContain('\n:root[data-theme="dark"] {\n  color-scheme: dark;')
    expect(first.endsWith('\n')).toBe(true)
    expect(first.match(/:root \{/g)).toHaveLength(1)
    expect(first.match(/:root\[data-theme="dark"\] \{/g)).toHaveLength(1)
    expect(first.match(/:root\[data-reduced-motion="true"\] \{/g)).toHaveLength(1)

    for (const name of DESIGN_TOKEN_NAMES) {
      const expectedDeclarations = name in REDUCED_MOTION_TOKEN_OVERRIDES ? 3 : 2
      expect(first.match(new RegExp(`${name.replace(/-/g, '\\-')}:`, 'g'))).toHaveLength(
        expectedDeclarations,
      )
    }
  })

  it('keeps every highlight wash contrast-safe and makes dark dots brighter than their washes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const tokens = designTokensForTheme(theme)
      const ink = tokens['--e-ink']
      for (const name of HIGHLIGHT_NAMES) {
        const wash = tokens[`--e-hl-${name}`]
        const dot = tokens[`--e-hl-${name}-dot`]

        expect(contrastRatio(ink, wash), `${theme} ${name} wash`).toBeGreaterThanOrEqual(
          theme === 'dark' ? 7 : 4.5,
        )
        if (theme === 'dark') {
          expect(relativeLuminance(dot), `${theme} ${name} dot`).toBeGreaterThan(
            relativeLuminance(wash),
          )
        }
      }
    }
  })

  it('derives painter meanings, including the named Agent accent, from the same token maps', () => {
    expect(painterPaletteForTheme('light')).toEqual({
      cacheKey:
        'eido-design-tokens:v1:light:#e8e4dc|rgba(35,32,25,.11)|#f8f6f1|rgba(35,32,25,.52)|#6a4fb0|#3466c2|#2f6f5e|#bb4326|#232019|#5f594c|#805b06',
      theme: 'light',
      board: { fill: '#e8e4dc', gridDot: 'rgba(35,32,25,.11)' },
      cards: {
        note: { fill: '#f8f6f1', stroke: 'rgba(35,32,25,.52)' },
        ask: { fill: '#f8f6f1', stroke: 'rgba(35,32,25,.52)' },
        result: { fill: '#f8f6f1', stroke: 'rgba(35,32,25,.52)' },
        title: { fill: '#f8f6f1', stroke: 'rgba(35,32,25,.52)' },
        group: { fill: '#f8f6f1', stroke: 'rgba(35,32,25,.52)' },
        mod: { fill: '#e7e2e9', stroke: '#6a4fb0' },
        conversation: { fill: '#e0e5eb', stroke: '#3466c2' },
      },
      connections: { helps: '#2f6f5e', avoid: '#bb4326', modifies: '#6a4fb0' },
      selection: '#2f6f5e',
      hover: '#2f6f5e',
      agentUnadoptedAccent: '#805b06',
      port: { fill: '#e8e4dc', stroke: '#232019' },
      badge: { fill: '#f8f6f1', stroke: 'rgba(35,32,25,.52)' },
      label: { ink: '#232019', softInk: '#5f594c', halo: '#e8e4dc' },
    })

    expect(painterPaletteForTheme('dark')).toEqual({
      cacheKey:
        'eido-design-tokens:v1:dark:#1e1b19|rgba(236,231,219,.10)|#2b2725|rgba(236,231,219,.44)|#a68ae0|#6d97e8|#4d9d84|#d77355|#ece7db|#b8b0a0|#e3b458',
      theme: 'dark',
      board: { fill: '#1e1b19', gridDot: 'rgba(236,231,219,.10)' },
      cards: {
        note: { fill: '#2b2725', stroke: 'rgba(236,231,219,.44)' },
        ask: { fill: '#2b2725', stroke: 'rgba(236,231,219,.44)' },
        result: { fill: '#2b2725', stroke: 'rgba(236,231,219,.44)' },
        title: { fill: '#2b2725', stroke: 'rgba(236,231,219,.44)' },
        group: { fill: '#2b2725', stroke: 'rgba(236,231,219,.44)' },
        mod: { fill: '#3a333b', stroke: '#a68ae0' },
        conversation: { fill: '#33343c', stroke: '#6d97e8' },
      },
      connections: { helps: '#4d9d84', avoid: '#d77355', modifies: '#a68ae0' },
      selection: '#4d9d84',
      hover: '#4d9d84',
      agentUnadoptedAccent: '#e3b458',
      port: { fill: '#1e1b19', stroke: '#ece7db' },
      badge: { fill: '#2b2725', stroke: 'rgba(236,231,219,.44)' },
      label: { ink: '#ece7db', softInk: '#b8b0a0', halo: '#1e1b19' },
    })
  })
})
