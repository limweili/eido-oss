import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('bottom dock design-system stylesheet', () => {
  it('uses machined semantic surfaces for the stationary dock and attached tray', () => {
    const css = readFileSync('src/styles/090-dock.css', 'utf8')

    expect(css).toMatch(
      /\.canvas-toolbox\s*\{[^}]*background:\s*var\(--e-surface-panel\);[^}]*border:\s*1px solid var\(--e-line-strong\);[^}]*border-radius:\s*var\(--e-r-well\);[^}]*box-shadow:\s*none;/s,
    )
    expect(css).toMatch(
      /\.dock-context-tray\s*\{[^}]*background:\s*var\(--e-surface-panel\);[^}]*border:\s*1px solid var\(--e-line-strong\);[^}]*border-bottom:\s*0;[^}]*transition:\s*transform var\(--e-t-move\) var\(--e-ease-settle\);/s,
    )
    // The Mod menu wears the toolbox skin so the dock reads as one instrument.
    expect(css).toMatch(
      /\.mod-library-menu\s*\{[^}]*border-radius:\s*var\(--e-r-well\);[^}]*background:\s*var\(--e-surface-panel\);[^}]*box-shadow:\s*none;/s,
    )
    expect(css).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*?\.canvas-toolbox\s*\{[^}]*overflow-x:\s*auto;/,
    )
    expect(css).not.toMatch(/var\(--(?:paper|ink|ink-soft|ink-faint|line|line-strong|accent|accent-soft|warn|warn-soft|mod|mod-soft|shadow|radius)\)/)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|backdrop-filter/i)
  })
})
