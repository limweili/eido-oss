// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const html = readFileSync('index.html', 'utf8')

function bootstrapSource(): string {
  const match = html.match(/<script data-eido-theme-bootstrap>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('Missing inline theme bootstrap')
  return match[1]
}

function runBootstrap(saved: unknown, systemDark = false) {
  delete document.documentElement.dataset.theme
  const getItem = vi.fn(() => saved === undefined ? null : JSON.stringify(saved))
  const matchMedia = vi.fn(() => ({ matches: systemDark }))
  Function('document', 'localStorage', 'matchMedia', bootstrapSource())(
    document,
    { getItem },
    matchMedia,
  )
  return { getItem, matchMedia, theme: document.documentElement.dataset.theme }
}

describe('startup theme bootstrap', () => {
  it('runs before the React module and reads only device settings', () => {
    const bootstrapAt = html.indexOf('data-eido-theme-bootstrap')
    const reactAt = html.indexOf('<script type="module" src="/src/main.tsx"></script>')
    expect(bootstrapAt).toBeGreaterThan(-1)
    expect(bootstrapAt).toBeLessThan(reactAt)

    const result = runBootstrap({ theme: 'dark', board: { theme: 'light' } })
    expect(result.theme).toBe('dark')
    expect(result.getItem).toHaveBeenCalledOnce()
    expect(result.getItem).toHaveBeenCalledWith('eido-v3-settings')
    expect(result.matchMedia).not.toHaveBeenCalled()
  })

  it('sets Light for missing or invalid data before React starts', () => {
    expect(runBootstrap(undefined).theme).toBe('light')
    expect(runBootstrap({ theme: 'sepia' }).theme).toBe('light')
  })

  it('resolves Match system synchronously', () => {
    expect(runBootstrap({ theme: 'system' }, false).theme).toBe('light')
    expect(runBootstrap({ theme: 'system' }, true).theme).toBe('dark')
  })
})
