// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkPreviewUrlFromClipboardText, loadLinkPreview } from './loadLinkPreview'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'eidoDesktop')
  Reflect.deleteProperty(window, 'eidoLinkPreviews')
})

describe('renderer link preview loader', () => {
  it('uses the local desktop bridge only for plausible scheme-less websites', async () => {
    const recognize = vi.fn(async () => 'https://www.example.co')
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load: vi.fn(), recognize },
    })

    await expect(linkPreviewUrlFromClipboardText('www.example.co')).resolves.toBe(
      'https://www.example.co',
    )
    await expect(linkPreviewUrlFromClipboardText('ordinary note text')).resolves.toBeNull()
    expect(recognize).toHaveBeenCalledTimes(1)
  })

  it('keeps emails, token-shaped strings, versions, and IPs inside the renderer', async () => {
    const recognize = vi.fn()
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load: vi.fn(), recognize },
    })

    for (const value of [
      'hello@example.com',
      `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(80)}.signature`,
      'v1.2.3',
      '192.168.1.1',
      'Fig.4',
    ]) {
      await expect(linkPreviewUrlFromClipboardText(value)).resolves.toBeNull()
    }
    expect(recognize).not.toHaveBeenCalled()
  })

  it('falls back to a Note when installed recognition misses its deadline', async () => {
    vi.useFakeTimers()
    const recognize = vi.fn(() => new Promise<string | null>(() => undefined))
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load: vi.fn(), recognize },
    })

    const result = linkPreviewUrlFromClipboardText('www.example.co')
    await vi.advanceTimersByTimeAsync(750)
    await expect(result).resolves.toBeNull()
  })

  it('uses the local web endpoint and rejects invalid or unsuccessful responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://www.example.co' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'file:///etc/passwd' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(linkPreviewUrlFromClipboardText('www.example.co')).resolves.toBe(
      'https://www.example.co',
    )
    await expect(linkPreviewUrlFromClipboardText('www.example.co')).resolves.toBeNull()
    await expect(linkPreviewUrlFromClipboardText('www.example.co')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      signal: expect.any(AbortSignal),
    })
  })

  it('uses the installed bridge in desktop mode', async () => {
    const load = vi.fn(async (url: string) => ({
      url,
      status: 'ready' as const,
      title: 'Drybread Studios',
    }))
    Object.defineProperty(window, 'eidoDesktop', { configurable: true, value: true })
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load },
    })

    await expect(loadLinkPreview('https://drybread.studio/')).resolves.toMatchObject({
      status: 'ready',
      title: 'Drybread Studios',
    })
    expect(load).toHaveBeenCalledWith('https://drybread.studio/')
  })

  it('uses the browser-development endpoint and coalesces matching in-flight URLs', async () => {
    let release!: () => void
    const fetchMock = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return new Response(JSON.stringify({
        preview: { url: 'https://drybread.studio/', status: 'fallback' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = loadLinkPreview('https://drybread.studio/')
    const second = loadLinkPreview('https://drybread.studio/')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([
      { url: 'https://drybread.studio/', status: 'fallback' },
      { url: 'https://drybread.studio/', status: 'fallback' },
    ])
  })

  it('returns the website fallback when the trusted boundary is missing or malformed', async () => {
    Object.defineProperty(window, 'eidoDesktop', { configurable: true, value: true })
    vi.stubGlobal('fetch', vi.fn())

    await expect(loadLinkPreview('https://drybread.studio/')).resolves.toEqual({
      url: 'https://drybread.studio/',
      status: 'fallback',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('evicts old transient media by byte budget instead of retaining an entry-count maximum', async () => {
    const load = vi.fn(async (url: string) => ({
      url,
      status: 'ready' as const,
      title: url,
      imageDataUrl: `data:image/png;base64,${'A'.repeat(699_000)}`,
    }))
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load },
    })
    const { cachedLinkPreview } = await import('./loadLinkPreview')
    const urls = Array.from({ length: 24 }, (_, index) => `https://cache-${index}.example/`)

    for (const url of urls) await loadLinkPreview(url)

    expect(cachedLinkPreview(urls[0]!)).toBeUndefined()
    expect(cachedLinkPreview(urls[urls.length - 1]!)).toMatchObject({ status: 'ready' })
  })
})
