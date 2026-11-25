import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { routeLinkPreviewRequest } from './linkPreviewPlugin'

describe('Vite link preview route', () => {
  it('is installed before the catch-all development storage API', () => {
    const config = readFileSync('vite.config.ts', 'utf8')
    const previewPosition = config.indexOf('eidoLinkPreviewPlugin()')
    const storagePosition = config.indexOf('eidoStoragePlugin()')

    expect(previewPosition).toBeGreaterThanOrEqual(0)
    expect(storagePosition).toBeGreaterThan(previewPosition)
  })

  it('loads one encoded URL through the shared preview service', async () => {
    const service = {
      load: vi.fn(async (url: string) => ({ url, status: 'fallback' as const })),
    }

    await expect(routeLinkPreviewRequest(
      'GET',
      new URL('/api/eido/link-preview?url=https%3A%2F%2Fdrybread.studio%2F', 'http://eido.local'),
      service,
    )).resolves.toEqual({
      status: 200,
      body: { preview: { url: 'https://drybread.studio/', status: 'fallback' } },
    })
    expect(service.load).toHaveBeenCalledWith('https://drybread.studio/')
  })

  it('recognizes a scheme-less website through the local classifier route', async () => {
    const service = { load: vi.fn() }
    await expect(routeLinkPreviewRequest(
      'GET',
      new URL('/api/eido/link-preview-url?text=example.co.uk%2Fpath', 'http://eido.local'),
      service,
    )).resolves.toEqual({
      status: 200,
      body: { url: 'https://example.co.uk/path' },
    })
    expect(service.load).not.toHaveBeenCalled()
  })

  it('rejects malformed requests and leaves unrelated routes alone', async () => {
    const service = { load: vi.fn() }
    await expect(routeLinkPreviewRequest(
      'POST',
      new URL('/api/eido/link-preview?url=https%3A%2F%2Fdrybread.studio%2F', 'http://eido.local'),
      service,
    )).resolves.toEqual({ status: 405, body: { error: 'Method not allowed' } })
    await expect(routeLinkPreviewRequest(
      'GET',
      new URL('/api/eido/link-preview', 'http://eido.local'),
      service,
    )).resolves.toEqual({ status: 400, body: { error: 'URL is required' } })
    await expect(routeLinkPreviewRequest(
      'GET',
      new URL('/api/eido/link-preview-url?text=hello%40example.com', 'http://eido.local'),
      service,
    )).resolves.toEqual({ status: 400, body: { error: 'Text is required' } })
    await expect(routeLinkPreviewRequest(
      'GET',
      new URL('/api/eido/status', 'http://eido.local'),
      service,
    )).resolves.toBeNull()
  })
})
