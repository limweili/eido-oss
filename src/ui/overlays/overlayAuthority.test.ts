import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('overlay foundation authorities', () => {
  it('installs one provider at bootstrap and gives its portal a dedicated cascade owner', () => {
    const main = readFileSync('src/main.tsx', 'utf8')
    const styles = readFileSync('src/styles.css', 'utf8')

    expect(main).toContain("from './ui/overlays'")
    expect(main).toMatch(/<OverlayProvider>\s*<App\s*\/>\s*<\/OverlayProvider>/)
    expect(styles).toContain("@import './styles/006-overlays.css';")
  })

  it('keeps the new overlay recipe on semantic design-system meanings', () => {
    const css = readFileSync('src/styles/006-overlays.css', 'utf8')

    expect(css).toContain('.e-modal-shell')
    expect(css).toContain('var(--e-veil)')
    expect(css).toContain('var(--e-surface-panel)')
    expect(css).toContain('var(--e-r-modal)')
    expect(css).toContain('var(--e-shadow-lift)')
    expect(css).not.toMatch(/var\(--(?:paper|ink|line|shadow|radius)\)/)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })

  it('owns deep veils and the shared 720px modal sheet geometry', () => {
    const modalShell = readFileSync('src/ui/overlays/ModalShell.tsx', 'utf8')
    const css = readFileSync('src/styles/006-overlays.css', 'utf8')

    expect(modalShell).toContain("backdropTone = 'standard'")
    expect(modalShell).toContain('data-backdrop-tone={backdropTone}')
    expect(modalShell).toContain('titleMeta?: ReactNode')
    expect(modalShell).toContain('className="e-modal-shell__title-line"')
    expect(css).toContain('.e-overlay-backdrop[data-backdrop-tone="deep"]')
    expect(css).toContain('background: var(--e-veil-deep);')
    expect(css).toMatch(/@media \(max-width: 720px\)/)
    expect(css).toContain('place-items: end stretch;')
    expect(css).toContain('padding: var(--e-sp-3) 0 0;')
    expect(css).toContain('max-height: calc(100dvh - var(--e-sp-3));')
    expect(css).toContain('border-radius: var(--e-r-modal) var(--e-r-modal) 0 0;')
    expect(css).toContain('.e-modal-shell__title-line')
    expect(css).toContain('.e-modal-shell__title-meta')
  })
})
