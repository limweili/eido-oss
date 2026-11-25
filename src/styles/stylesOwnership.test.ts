import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styleModules = [
  '000-foundation.css',
  '005-primitives.css',
  '006-overlays.css',
  '010-app-chrome.css',
  '020-board.css',
  '030-empty-state.css',
  '040-cards-prose.css',
  '041-prose.css',
  '051-mod-face-foundation.css',
  '052-mod-face-rows.css',
  '053-mod-face-options.css',
  '054-mod-face-wells.css',
  '055-mod-face-complex.css',
  '056-mod-face-chrome.css',
  '057-mod-cross-kind-chrome.css',
  '060-groups.css',
  '070-board-interactions.css',
  '080-playback.css',
  '090-dock.css',
  '100-overlays.css',
  '110-conversation-cards.css',
  '120-highlights.css',
  '125-board-search.css',
  '126-reach.css',
] as const

describe('stylesheet ownership entry point', () => {
  it('assigns the cascade to the ordered foundation and surface modules', () => {
    const entry = readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n')
    const expectedEntry = `${styleModules
      .map(module => `@import './styles/${module}';`)
      .join('\n')}\n`

    expect(entry).toBe(expectedEntry)
  })

  it('retires both #496-only freezes before token values change', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>
    }
    const smokeCommand = packageJson.scripts?.['test:browser:smoke'] ?? ''

    expect(existsSync('src/styles/legacyCascadeFreeze.test.ts')).toBe(false)
    expect(existsSync('src/canvas/legacyStylesOwnership.browser.test.ts')).toBe(false)
    expect(smokeCommand).not.toContain('legacyStylesOwnership.browser.test.ts')
  })

  it('ships semantic foundation roles without the retired compatibility bridge', () => {
    const foundation = readFileSync('src/styles/000-foundation.css', 'utf8')
    expect(foundation).toMatch(
      /body\s*\{[^}]*font-family:\s*var\(--e-sans\);[^}]*color:\s*var\(--e-ink\);[^}]*background:\s*var\(--e-surface-panel\);/s,
    )
    expect(foundation).not.toMatch(/--(?:bg|board-bg|paper|ink|accent|warn|mod|convo|shadow|radius|font)\s*:/)

    for (const role of [
      't-micro',
      't-label',
      't-ui',
      't-value',
      't-title',
      't-display',
      't-title-canvas',
      't-prose-s',
      't-prose-m',
      't-prose-l',
      't-prose-xl',
      't-prose-2xl',
      't-prose-3xl',
      't-hint',
    ]) {
      expect(foundation).toContain(`.${role}`)
    }
  })

  it('disables mono ligatures through both shaping controls on every mono role', () => {
    const foundation = readFileSync('src/styles/000-foundation.css', 'utf8')
    expect(foundation).toMatch(
      /\.mono,[\s\S]*?\.t-title-canvas\s*\{[^}]*font-feature-settings:\s*"calt" 0;[^}]*font-variant-ligatures:\s*none;/,
    )
  })

  it('gives the board semantic ground without duplicating generated token declarations', () => {
    const board = readFileSync('src/styles/020-board.css', 'utf8')
    expect(board).toMatch(/\.board-wrap\s*\{[^}]*background:\s*var\(--e-surface-ground\);/s)

    const authoredCascade = styleModules
      .map(module => readFileSync(`src/styles/${module}`, 'utf8'))
      .join('\n')
    expect(authoredCascade).not.toMatch(/^\s*--e-[\w-]+\s*:/m)
  })

  it('themes React Flow ground, marquee, and controls through semantic hooks', () => {
    const board = readFileSync('src/styles/020-board.css', 'utf8')
    const boardComponent = readFileSync('src/canvas/Board.tsx', 'utf8')

    expect(board).toContain('--xy-background-color: var(--e-surface-ground);')
    expect(board).toContain('--xy-selection-border: 1.5px dashed var(--e-go);')
    expect(board).toContain('--xy-controls-button-background-color: var(--e-surface-panel);')
    expect(board).toContain('--xy-controls-button-color: var(--e-ink);')
    expect(board).toContain('--xy-controls-box-shadow: none;')
    expect(boardComponent).not.toContain('colorMode=')
    expect(boardComponent).not.toContain('theme={DEFAULT_THEME}')
  })

  it('gives React Flow controls the complete semantic state grammar', () => {
    const board = readFileSync('src/styles/020-board.css', 'utf8')

    expect(board).toMatch(
      /\.board-flow \.react-flow__controls\s*\{[^}]*border:\s*0;/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls-button\s*\{[^}]*border:\s*1px solid var\(--e-line-strong\);[^}]*background-color var\(--e-t-fast\) var\(--e-ease-out\),[^}]*border-color var\(--e-t-fast\) var\(--e-ease-out\),[^}]*color var\(--e-t-fast\) var\(--e-ease-out\),[^}]*transform var\(--e-t-fast\) var\(--e-ease-out\);/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls-button:active:not\(:disabled\)\s*\{[^}]*transform:\s*scale\(var\(--e-scale-press\)\);/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls-button:focus-visible\s*\{[^}]*border:\s*1px solid var\(--e-go\);[^}]*outline:\s*none;/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls-button:has\(\+ \.react-flow__controls-button:focus-visible\)\s*\{[^}]*border-bottom-color:\s*transparent;/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls-button:disabled\s*\{[^}]*border:\s*1px solid var\(--e-line\);[^}]*background:\s*var\(--e-surface-panel\);[^}]*color:\s*var\(--e-ink-faint\);[^}]*cursor:\s*default;[^}]*opacity:\s*1;/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls-button:disabled svg\s*\{[^}]*fill-opacity:\s*1;[^}]*opacity:\s*1;/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls\.horizontal[\s\S]*?\.react-flow__controls-button:has\(\+ \.react-flow__controls-button:focus-visible\),[\s\S]*?\.react-flow__controls-button:has\(\+ \.react-flow__controls-button:disabled\)\s*\{[^}]*border-right-color:\s*transparent;[^}]*border-bottom-color:\s*var\(--e-line-strong\);/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls\.horizontal \.react-flow__controls-button:focus-visible\s*\{[^}]*border:\s*1px solid var\(--e-go\);/s,
    )
    expect(board).toMatch(
      /\.board-flow \.react-flow__controls\.horizontal \.react-flow__controls-button:disabled\s*\{[^}]*border:\s*1px solid var\(--e-line\);/s,
    )
  })
})
