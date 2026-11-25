import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(`src/styles/${name}`, 'utf8')

describe('v2 Mod face stylesheet ownership', () => {
  it('predeclares one ordered sheet per parallel face family', () => {
    const entry = readFileSync('src/styles.css', 'utf8')
    for (const name of [
      '051-mod-face-foundation.css',
      '052-mod-face-rows.css',
      '053-mod-face-options.css',
      '054-mod-face-wells.css',
      '055-mod-face-complex.css',
      '056-mod-face-chrome.css',
    ]) {
      expect(entry).toContain(`@import './styles/${name}';`)
      expect(read(name)).toBeTruthy()
    }
  })

  it('keeps inline editing and removal in the shared foundation recipe', () => {
    // In-face growth is retired: mods grow from the card head's + key.
    const styles = read('051-mod-face-foundation.css')
    expect(styles).toMatch(/\.e-edit\s*\{[^}]*border-bottom:\s*1px solid transparent/s)
    expect(styles).toMatch(/\.e-edit:focus\s*\{[^}]*border-bottom-color:\s*var\(--e-go\)/s)
    expect(styles).toMatch(/\.row-x\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px/s)
    expect(styles).not.toContain('.mod-add')
  })

  it('keeps slider drag paint clip-only and makes the fixed inner rail the geometry seam', () => {
    const styles = read('052-mod-face-rows.css')
    expect(styles).toMatch(/\.mod-face--slider \.i-track\s*\{[^}]*touch-action:\s*none/s)
    expect(styles).toMatch(/\.mod-face--slider \.i-rail\s*\{[^}]*position:\s*absolute/s)
    // The reference recipe: the fill is revealed by a clip, never re-laid-out.
    expect(styles).toMatch(/\.mod-face--slider \.i-fill\s*\{[^}]*clip-path:\s*inset\(/s)
    expect(styles).toMatch(/\.mod-face--slider \.i-travel\s*\{[^}]*transform:\s*translateX\(calc\(var\(--e-mod-face-ratio\) \* 100%\)\)/s)
    expect(styles).not.toMatch(/\.i-(?:fill|travel)\s*\{[^}]*(?:width|left):\s*calc\([^}]var\(--e-mod-face-ratio\)/s)
  })

  it('keeps option-family pointer geometry open and order previews transform-only', () => {
    const styles = read('053-mod-face-options.css')
    expect(styles).toMatch(/\.mod-face--select \.i-seg\s*\{[^}]*touch-action:\s*none/s)
    expect(styles).toMatch(/\.mod-face--select \.i-seg\s*\{[^}]*height:\s*32px/s)
    expect(styles).not.toMatch(/\.mod-face--select \.i-seg\s*\{[^}]*overflow:\s*hidden/s)
    // Flat cells with 1px seams; only the control's ends wear the pill radius.
    expect(styles).toMatch(/\.mod-face--select \.i-seg-slot:first-child \.i-seg-cell\s*\{[^}]*border-radius:\s*999px 0 0 999px/s)
    expect(styles).toMatch(/\.i-seg-slot \+ \.i-seg-slot \.i-seg-cell\s*\{[^}]*border-left:\s*1px solid var\(--e-line\)/s)
    expect(styles).toMatch(/\.mod-face--select \.i-stack\s*\{[^}]*touch-action:\s*none/s)
    // The picked option wears the Mod's accent, like the reference.
    expect(styles).toMatch(/\.mod-face--select :is\(\.i-seg-cell, \.i-stack-row\)\.is-picked\s*\{[^}]*background:\s*var\(--e-mod-face-accent/s)
    expect(styles).toMatch(/\.mod-face--order \.i-order-list\s*\{[^}]*touch-action:\s*none/s)
    expect(styles).toMatch(/\.mod-face--order \.i-order-token\s*\{[^}]*transform:\s*translateY\(calc\(var\(--e-mod-face-order-shift, 0\) \* 100%\)\)/s)
    expect(styles).not.toMatch(/\.mod-face--order \.i-order-token\s*\{[^}]*(?:top|left):\s*var\(--e-mod-face-order-shift/s)
    expect(styles).not.toContain('.mod-add-select-option')
    expect(styles).not.toContain('.mod-add-order-token')
    expect(styles).not.toMatch(/:is\(\.i-seg-cell, \.i-stack-row\)\s*\{[^}]*(?:font-size|font-weight|letter-spacing):/s)
    expect(styles).not.toMatch(/\.i-order-token\s*\{[^}]*(?:font-size|font-weight|letter-spacing):/s)
  })

  it('uses semantic roles rather than raw or legacy colour aliases', () => {
    const styles = [
      read('051-mod-face-foundation.css'),
      read('052-mod-face-rows.css'),
      read('053-mod-face-options.css'),
      read('054-mod-face-wells.css'),
      read('055-mod-face-complex.css'),
      read('056-mod-face-chrome.css'),
    ].join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(styles).not.toMatch(/var\(--(?:paper|ink|line|accent|shadow|radius|font)\)/)
  })
})
