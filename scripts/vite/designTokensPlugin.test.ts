import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DESIGN_TOKENS_VIRTUAL_ID,
  RESOLVED_DESIGN_TOKENS_VIRTUAL_ID,
  designTokensVitePlugin,
} from './designTokensPlugin'

const fonts = [
  {
    file: 'jetbrains-mono-latin-wght-400-700.woff2',
    bytes: 31_340,
    sha256: '2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4',
  },
  {
    file: 'open-sans-latin-variable-normal.woff2',
    bytes: 42_964,
    sha256: '441af0def989ebfdbd6ad85ffaed85e967ab21a05f1dd342f16259464a206dd0',
  },
  {
    file: 'open-sans-latin-variable-italic.woff2',
    bytes: 45_072,
    sha256: '8df90accd45bfd23e80b325300058648f6d4b293d1c8f399dfa4cda318d203e0',
  },
] as const

const readBytes = readFileSync as unknown as (path: string) => Uint8Array

type TestPlugin = {
  name: string
  enforce?: string
  resolveId: (id: string) => unknown
  load: (id: string) => unknown
  generateBundle: (this: { emitFile: (asset: unknown) => string }) => unknown
}

describe('design token Vite artifact', () => {
  it('resolves and loads the named CSS artifact before framework and storage plugins', async () => {
    const plugin = designTokensVitePlugin() as unknown as TestPlugin

    expect(plugin.name).toBe('eido-design-tokens')
    expect(plugin.enforce).toBe('pre')
    expect(await plugin.resolveId(DESIGN_TOKENS_VIRTUAL_ID)).toBe(
      RESOLVED_DESIGN_TOKENS_VIRTUAL_ID,
    )
    expect(await plugin.resolveId('virtual:not-eido')).toBeNull()
    expect(await plugin.load('not-the-resolved-id')).toBeNull()

    const css = await plugin.load(RESOLVED_DESIGN_TOKENS_VIRTUAL_ID)
    expect(typeof css).toBe('string')
    if (typeof css !== 'string') throw new Error('Expected virtual design tokens to load as CSS')
    expect(css).toContain(':root {\n  color-scheme: light;')
    expect(css).toContain(':root[data-theme="dark"] {')
    expect(css).not.toMatch(/local\(|https?:\/\//)
    expect(css.match(/@font-face/g)).toHaveLength(3)
    expect(css.match(/font-display: swap/g)).toHaveLength(3)
    expect(css.match(/unicode-range:/g)).toHaveLength(3)
    expect(css).toContain("font-family: 'JetBrains Mono';")
    expect(css).toContain('font-weight: 400 700;')
    expect(css).toContain("font-family: 'Open Sans';")
    expect(css).toContain('font-style: normal;')
    expect(css).toContain('font-style: italic;')
    expect(css.match(/font-weight: 300 800;/g)).toHaveLength(2)

    const config = readFileSync('vite.config.ts', 'utf8')
    expect(config).toContain(
      "import { designTokensVitePlugin } from './scripts/vite/designTokensPlugin'",
    )
    const tokenPlugin = config.indexOf('designTokensVitePlugin()')
    const reactPlugin = config.indexOf('react()')
    const storagePlugin = config.indexOf('eidoStoragePlugin()')
    expect(tokenPlugin).toBeGreaterThan(-1)
    expect(tokenPlugin).toBeLessThan(reactPlugin)
    expect(tokenPlugin).toBeLessThan(storagePlugin)
  })

  it('imports the virtual artifact immediately before the owned stylesheet cascade', () => {
    const mainImports = readFileSync('src/main.tsx', 'utf8')
      .split(/\r?\n/)
      .filter(line => line.startsWith('import '))

    const tokenImport = mainImports.indexOf("import 'virtual:eido-design-tokens.css'")
    expect(tokenImport).toBeGreaterThan(-1)
    expect(mainImports[tokenImport + 1]).toBe("import './styles.css'")
    expect(readFileSync('src/vite-env.d.ts', 'utf8')).toContain(
      "declare module 'virtual:eido-design-tokens.css'",
    )
  })

  it('pins the exact official font bytes and self-hosted preload contract', () => {
    const html = readFileSync('index.html', 'utf8')

    for (const font of fonts) {
      const contents = readBytes(`src/assets/fonts/${font.file}`)
      expect(String.fromCharCode(...contents.subarray(0, 4))).toBe('wOF2')
      expect(contents).toHaveLength(font.bytes)
      expect(createHash('sha256').update(contents).digest('hex')).toBe(font.sha256)
      expect(html).toContain(
        `<link rel="preload" href="/src/assets/fonts/${font.file}" as="font" type="font/woff2" crossorigin />`,
      )
    }

    expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/)
  })

  it('emits both OFLs and provenance beside the packaged font assets', async () => {
    const plugin = designTokensVitePlugin() as unknown as TestPlugin
    const emitted: Array<{
      type: string
      fileName: string
      source: string | Uint8Array
    }> = []

    await plugin.generateBundle.call({
      emitFile(asset) {
        emitted.push(asset as (typeof emitted)[number])
        return `asset-${emitted.length}`
      },
    })

    expect(emitted.map(asset => asset.fileName)).toEqual([
      'assets/fonts/OFL-JetBrainsMono.txt',
      'assets/fonts/OFL-OpenSans.txt',
      'assets/fonts/SOURCES.md',
    ])
    for (const asset of emitted) {
      expect(asset.type).toBe('asset')
      expect(asset.source).toEqual(
        readFileSync(
          `src/assets/fonts/${asset.fileName.replace('assets/fonts/', '')}`,
          'utf8',
        ),
      )
    }

    expect(String(emitted[0]?.source)).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(String(emitted[1]?.source)).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(String(emitted[2]?.source)).toContain(
      '2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4',
    )
    expect(String(emitted[2]?.source)).toContain(
      'bd7e37632246368c60fdcbd374dbf9bad11969b6',
    )
  })
})
