import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the complex Mod face stylesheet', () => {
  it('keeps gesture geometry scoped and continuous paint on the intended seams', () => {
    const styles = readFileSync('src/styles/055-mod-face-complex.css', 'utf8')
    expect(styles).toMatch(/\.mod-face--mixer \.bd-grip\s*\{[^}]*touch-action:\s*none/s)
    expect(styles).toMatch(/\.mod-face--mixer \.bd-band\s*\{[^}]*block-size:\s*calc\(var\(--e-mod-mixer-share\) \* 1%\)/s)
    expect(styles).toMatch(/\.mod-face--filter \.i-filter\s*\{[^}]*touch-action:\s*none/s)
    expect(styles).toMatch(/\.mod-face--filter \.i-filter-geometry\s*\{[^}]*position:\s*absolute/s)
    expect(styles).toMatch(/\.mod-face--matrix \.mx-dot\s*\{[^}]*transform:\s*translate\(-50%, -50%\) scale\(var\(--e-mod-matrix-scale\)\)/s)
  })
})
