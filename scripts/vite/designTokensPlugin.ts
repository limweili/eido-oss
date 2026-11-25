import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { renderDesignTokenCss } from '../../src/ui/tokens'

export const DESIGN_TOKENS_VIRTUAL_ID = 'virtual:eido-design-tokens.css'
export const RESOLVED_DESIGN_TOKENS_VIRTUAL_ID = `\0${DESIGN_TOKENS_VIRTUAL_ID}`

const LATIN_UNICODE_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

const FONT_ASSET_ROOT = '/src/assets/fonts'
const LICENSE_FILES = ['OFL-JetBrainsMono.txt', 'OFL-OpenSans.txt', 'SOURCES.md'] as const

function renderFontFaces(): string {
  return `@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('${FONT_ASSET_ROOT}/jetbrains-mono-latin-wght-400-700.woff2') format('woff2');
  unicode-range: ${LATIN_UNICODE_RANGE};
}

@font-face {
  font-family: 'Open Sans';
  font-style: normal;
  font-weight: 300 800;
  font-stretch: 100%;
  font-display: swap;
  src: url('${FONT_ASSET_ROOT}/open-sans-latin-variable-normal.woff2') format('woff2');
  unicode-range: ${LATIN_UNICODE_RANGE};
}

@font-face {
  font-family: 'Open Sans';
  font-style: italic;
  font-weight: 300 800;
  font-stretch: 100%;
  font-display: swap;
  src: url('${FONT_ASSET_ROOT}/open-sans-latin-variable-italic.woff2') format('woff2');
  unicode-range: ${LATIN_UNICODE_RANGE};
}
`
}

export function designTokensVitePlugin(): Plugin {
  return {
    name: 'eido-design-tokens',
    enforce: 'pre',
    resolveId(id) {
      return id === DESIGN_TOKENS_VIRTUAL_ID ? RESOLVED_DESIGN_TOKENS_VIRTUAL_ID : null
    },
    load(id) {
      return id === RESOLVED_DESIGN_TOKENS_VIRTUAL_ID
        ? `${renderFontFaces()}\n${renderDesignTokenCss()}`
        : null
    },
    generateBundle() {
      for (const fileName of LICENSE_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/fonts/${fileName}`,
          source: readFileSync(
            fileURLToPath(new URL(`../../src/assets/fonts/${fileName}`, import.meta.url)),
            'utf8',
          ),
        })
      }
    },
  }
}
