import { describe, expect, it } from 'vitest'
import { displayHost, normalizeWebUrl } from './webUrl'

describe('web URL helpers', () => {
  it('assumes https for a bare host and rejects unsupported URLs', () => {
    expect(normalizeWebUrl('example.com/a')).toBe('https://example.com/a')
    expect(normalizeWebUrl('  https://example.com  ')).toBe('https://example.com/')
    expect(normalizeWebUrl('localhost')).toBeNull()
    expect(normalizeWebUrl('ftp://example.com')).toBeNull()
  })

  it('shows a host without its www prefix and falls back to the original label', () => {
    expect(displayHost('https://www.example.com/deep/path?q=1')).toBe('example.com')
    expect(displayHost('nonsense')).toBe('nonsense')
  })
})
