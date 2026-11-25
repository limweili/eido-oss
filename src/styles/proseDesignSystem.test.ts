import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TITLE_CARD_TYPE_METRICS } from '../canvas/cards/titleCardFontFit'

const prosePath = 'src/styles/041-prose.css'

describe('shared paper and editor stylesheet', () => {
  it('reserves the task checkbox marker instead of painting a list dash over it', () => {
    const prose = readFileSync(prosePath, 'utf8')

    expect(prose).toContain(".e-prose ul > li:not(.task):not([role='checkbox'])")
    expect(prose).not.toContain(".e-prose ul > li:not(.task)::before")
    expect(prose).toMatch(/\.markdown-card-editor-content li\[role='checkbox'\]::before\s*\{[^}]*content:\s*''/s)
  })

  it('gives the live empty editor the same prose role and quiet voice as passive paper', () => {
    const prose = readFileSync(prosePath, 'utf8')
    const richEditor = readFileSync('src/canvas/cards/RichMarkdownEditor.tsx', 'utf8')

    expect(richEditor).toMatch(
      /placeholder=\{\s*<span className=\{`markdown-card-editor-empty result-empty e-prose \$\{proseClass\}`\}>/s,
    )
    expect(prose).toMatch(
      /\.e-prose > \.result-empty,[^}]*\.markdown-card-editor-empty\s*\{[^}]*color:\s*var\(--e-ink-soft\)[^}]*font-style:\s*italic/s,
    )
    expect(prose).toMatch(
      /\.markdown-card-editor :has\(> \.markdown-card-editor-empty\)\s*\{[^}]*padding:\s*0[^}]*white-space:\s*normal/s,
    )
  })

  it('owns every prose role in one ordered sheet', () => {
    expect(existsSync(prosePath)).toBe(true)

    const entry = readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n')
    const prose = readFileSync(prosePath, 'utf8')
    const cards = readFileSync('src/styles/040-cards-prose.css', 'utf8')

    expect(entry).toContain(
      "@import './styles/040-cards-prose.css';\n@import './styles/041-prose.css';",
    )
    expect(prose).toMatch(/\.e-prose\s*\{[^}]*font-family:\s*var\(--e-sans\)/s)
    expect(prose).toMatch(/\.markdown-card-editor \.markdown-card-editor-content\s*\{[^}]*color:\s*var\(--e-ink\)/s)
    // One rule preserves the writer's runs of spaces on both surfaces. It is
    // shared rather than applied to the editor alone, because a space that
    // collapses when a Card is read and not when it is written moves every
    // glyph after it.
    expect(prose).toMatch(
      /\.note-render\[contenteditable='true'\],\s*\n\.note-render :where\(p, h1, h2, h3, h4, h5, h6, blockquote, td, th\),\s*\n\.note-render li:not\(:has\(ul, ol\)\)\s*\{[^}]*white-space:\s*break-spaces/s,
    )
    expect(prose).not.toMatch(
      /\.markdown-card-editor \.markdown-card-editor-content\s*\{[^}]*white-space:/s,
    )
    expect(prose).toMatch(/\.e-prose h1\s*\{[^}]*font-size:\s*1\.3em/s)
    expect(prose).toMatch(/\.e-prose h2\s*\{[^}]*font-size:\s*1\.15em/s)
    expect(prose).toMatch(/\.e-prose h3\s*\{[^}]*font-size:\s*1em/s)
    expect(prose).toMatch(/\.e-prose blockquote\s*\{[^}]*border-left:\s*2px solid var\(--e-line-strong\)/s)
    expect(prose).toMatch(/\.e-prose code\s*\{[^}]*font-family:\s*var\(--e-mono\)/s)
    expect(prose).toMatch(/\.e-prose del\s*\{[^}]*color:\s*var\(--e-ink-faint\)/s)
    expect(prose).toContain(".markdown-card-editor-content li[role='checkbox']")
    expect(prose).toMatch(/\.e-prose mark:not\(\.painted-highlight\)\s*\{[^}]*padding:\s*0;/s)
    expect(prose).not.toMatch(/\.markdown-card-editor \.markdown-card-editor-content\s*\{[^}]*(?:font-size|line-height):\s*inherit/s)
    expect(prose).toMatch(/\.markdown-card-editor-content li\s*\{[^}]*margin-block:\s*0/s)
    expect(prose).not.toMatch(/\.e-prose table\s*\{[^}]*font-size:/s)
    expect(prose).toMatch(/\.markdown-card-editor-content > div:has\(> table\)\s*\{[^}]*margin-top:\s*0\.6em/s)
    expect(prose).toMatch(/table > tbody \[data-tool-cell='true'\]\s*\{[^}]*width:\s*0[^}]*visibility:\s*hidden/s)
    expect(prose).toMatch(/table > tbody > tr > :nth-child\(2\):not\(\[data-tool-cell='true'\]\)\s*\{[^}]*padding-left:\s*calc\(0\.6em \+ 0\.5px\)/s)

    expect(cards).not.toContain('/* Rendered markdown inside notes, result cards, and conversation transcripts. */')
    expect(cards).not.toMatch(/\.note-font-\d+ \.note-render/)
    expect(prose).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('keeps S/O to Live activation feedback on the identity dot and reduced-motion safe', () => {
    const cards = readFileSync('src/styles/040-cards-prose.css', 'utf8')

    expect(cards).toMatch(
      /\.react-flow__node\[data-live-transition='loading'\] \.card-head \.kind-dot\s*\{[^}]*animation:\s*pulse var\(--e-t-stream\) ease-in-out infinite;/s,
    )
    expect(cards).toMatch(
      /:root\[data-reduced-motion="true"\] \.react-flow__node\[data-live-transition='loading'\] \.card-head \.kind-dot\s*\{[^}]*animation:\s*none !important;[^}]*opacity:\s*1;/s,
    )
    expect(cards).not.toMatch(/data-live-transition='loading'[^}]*\b(?:width|height|top|left|margin)\s*:/s)
  })

  it('keeps TitleCard a canvas label while sharing semantic typography and resize roles', () => {
    const prose = readFileSync(prosePath, 'utf8')
    const titleCard = readFileSync('src/canvas/cards/TitleCard.tsx', 'utf8')

    expect(titleCard).toContain('lineClassName="title-card-resize-line"')
    expect(titleCard).toContain('handleClassName="title-card-resize-handle"')
    expect(titleCard).toContain('title-card-input t-title-canvas')
    expect(titleCard).not.toContain('lineStyle=')
    expect(titleCard).not.toContain('handleStyle=')

    expect(prose).toMatch(
      /\.title-card\.agent-unadopted:not\(\.selected\)\s*\{[^}]*border-color:\s*var\(--e-agent-unadopted-accent\)[^}]*border-style:\s*dashed/s,
    )
    expect(prose).toMatch(/\.title-card\.selected\s*\{[^}]*border-color:\s*var\(--e-go\)[^}]*box-shadow:\s*none/s)
    expect(prose).toMatch(/\.title-card-resize-handle\s*\{[^}]*width:\s*9px[^}]*height:\s*9px[^}]*border-radius:\s*50%/s)
    expect(prose).toMatch(/\.title-card-resize-line\s*\{[^}]*display:\s*none/s)
  })

  it('fits Title card type to its drawn box through one leading authority', () => {
    const prose = readFileSync(prosePath, 'utf8')
    const foundation = readFileSync('src/styles/000-foundation.css', 'utf8')

    // The measured twin must wear the editor's classes, so the fit cannot
    // drift from what the visible editor renders.
    expect(prose).toMatch(/\.title-card-measure\s*\{[^}]*visibility:\s*hidden[^}]*white-space:\s*pre-wrap/s)
    expect(prose).toMatch(/\.title-card-input\s*\{[^}]*overflow-wrap:\s*break-word/s)
    expect(prose).toMatch(/\.title-card-measure\s*\{[^}]*overflow-wrap:\s*normal[^}]*white-space:\s*pre-wrap/s)

    // The resting step stays token-owned, and the fitted range scales its own
    // leading only while the CSS ratio equals the metric the search assumes.
    const canvasRole = [...foundation.matchAll(/^\.t-title-canvas\s*\{([^}]*)\}/gm)]
      .map(match => match[1])
      .find(block => block.includes('font-size:')) ?? ''
    expect(canvasRole).toContain('font-size: var(--e-fs-title-canvas);')
    expect(canvasRole).toContain(`line-height: ${TITLE_CARD_TYPE_METRICS.lineHeight};`)
  })
})
