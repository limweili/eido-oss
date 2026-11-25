import { describe, expect, it, vi } from 'vitest'
import {
  createLinkPreviewService,
  isAllowedLinkPreviewPort,
  isBoundedStaticImage,
  isPublicAddress,
  parseLinkPreviewDocument,
  type LinkPreviewResourceReader,
} from './linkPreviewService'

describe('link preview metadata service', () => {
  it('extracts ordered Open Graph metadata, decodes text, and resolves media URLs', () => {
    expect(parseLinkPreviewDocument(`
      <html><head>
        <title>Fallback title</title>
        <meta name="description" content="Fallback description">
        <meta property="og:title" content="Drybread &amp; Friends">
        <meta property="og:description" content="Products, tools &amp; games">
        <meta property="og:site_name" content="Drybread Studios">
        <meta property="og:image" content="/social-card.png">
        <link href="/favicon.png" rel="shortcut icon">
      </head></html>
    `, 'https://drybread.studio/work')).toEqual({
      title: 'Drybread & Friends',
      description: 'Products, tools & games',
      siteName: 'Drybread Studios',
      imageUrl: 'https://drybread.studio/social-card.png',
      faviconCandidates: ['https://drybread.studio/favicon.png'],
    })
  })

  it('orders favicon candidates by declared size, smallest first, undeclared last', () => {
    expect(parseLinkPreviewDocument(`
      <html><head>
        <link rel="icon" href="/logo-huge.png">
        <link rel="icon" sizes="180x180" href="/touch-icon.png">
        <link rel="apple-touch-icon" sizes="120x120" href="/apple-icon.png">
        <link rel="icon" sizes="32x32" href="/favicon-32.png">
        <link rel="icon" sizes="16x16" href="/favicon-16.png">
      </head></html>
    `, 'https://drybread.studio/')).toMatchObject({
      faviconCandidates: [
        'https://drybread.studio/favicon-16.png',
        'https://drybread.studio/favicon-32.png',
        'https://drybread.studio/apple-icon.png',
        'https://drybread.studio/touch-icon.png',
        'https://drybread.studio/logo-huge.png',
      ],
    })
  })

  it('returns no favicon candidates when the page declares none', () => {
    expect(parseLinkPreviewDocument('<html><head></head></html>', 'https://drybread.studio/'))
      .toMatchObject({ faviconCandidates: [] })
  })

  it('returns a durable rich preview while containing optional media failures', async () => {
    const readResource = vi.fn<LinkPreviewResourceReader>(async (request) => {
      if (request.url === 'https://drybread.studio/') {
        return {
          finalUrl: request.url,
          mimeType: 'text/html',
          bytes: new TextEncoder().encode(`
            <meta property="og:title" content="Drybread Studios">
            <meta property="og:image" content="/preview.png">
            <link rel="icon" href="/favicon.ico">
          `),
        }
      }
      if (request.url.endsWith('/preview.png')) {
        return {
          finalUrl: request.url,
          mimeType: 'image/png',
          bytes: Uint8Array.from(Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          )),
        }
      }
      throw new Error('favicon unavailable')
    })
    const service = createLinkPreviewService({ readResource })

    await expect(service.load('https://drybread.studio/')).resolves.toEqual({
      url: 'https://drybread.studio/',
      status: 'ready',
      title: 'Drybread Studios',
      siteName: 'drybread.studio',
      imageDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    })
  })

  it('falls through to the well-known favicon path when the only declared icon is unusable', async () => {
    const smallPng = Uint8Array.from(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    // A logo reused as `rel="icon"` with no small size declared, and no
    // sizes attribute at all -- the exact drybread.studio shape a live
    // pull of the site turned up: one oversized icon and nothing else.
    const oversizedLogoPng = Uint8Array.from(smallPng)
    new DataView(oversizedLogoPng.buffer).setUint32(16, 4_000)

    const readResource = vi.fn<LinkPreviewResourceReader>(async (request) => {
      if (request.url === 'https://oversized-icon.example/') {
        return {
          finalUrl: request.url,
          mimeType: 'text/html',
          bytes: new TextEncoder().encode('<link rel="icon" href="/logo.png">'),
        }
      }
      if (request.url.endsWith('/logo.png')) {
        return { finalUrl: request.url, mimeType: 'image/png', bytes: oversizedLogoPng }
      }
      if (request.url.endsWith('/favicon.ico')) {
        return { finalUrl: request.url, mimeType: 'image/png', bytes: smallPng }
      }
      throw new Error('unexpected request')
    })
    const service = createLinkPreviewService({ readResource })

    await expect(service.load('https://oversized-icon.example/')).resolves.toEqual({
      url: 'https://oversized-icon.example/',
      status: 'ready',
      siteName: 'oversized-icon.example',
      faviconDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    })
  })

  it('accepts a well-formed .ico as a favicon under its own canonical mime type', async () => {
    const ico = Uint8Array.from([
      0, 0, 1, 0, 1, 0, // ICONDIR: reserved, type=1, one image
      32, 32, 0, 0, 1, 0, 32, 0, 4, 0, 0, 0, 22, 0, 0, 0, // one 32x32 entry
      1, 2, 3, 4, // placeholder pixel payload, never decoded
    ])
    const readResource = vi.fn<LinkPreviewResourceReader>(async (request) => {
      if (request.url === 'https://icon-only.example/') {
        return {
          finalUrl: request.url,
          mimeType: 'text/html',
          bytes: new TextEncoder().encode('<title>Icon Only</title>'),
        }
      }
      if (request.url.endsWith('/favicon.ico')) {
        return { finalUrl: request.url, mimeType: 'image/x-icon', bytes: ico }
      }
      throw new Error('unexpected request')
    })
    const service = createLinkPreviewService({ readResource })

    await expect(service.load('https://icon-only.example/')).resolves.toEqual({
      url: 'https://icon-only.example/',
      status: 'ready',
      title: 'Icon Only',
      siteName: 'icon-only.example',
      faviconDataUrl: expect.stringMatching(/^data:image\/x-icon;base64,/),
    })
  })

  it('falls back to the URL when the page is blocked or unavailable', async () => {
    const service = createLinkPreviewService({
      readResource: async () => { throw new Error('blocked') },
    })

    await expect(service.load('https://drybread.studio/')).resolves.toEqual({
      url: 'https://drybread.studio/',
      status: 'fallback',
    })
  })

  it('uses the website fallback when HTML exposes no usable preview metadata', async () => {
    const service = createLinkPreviewService({
      readResource: async (request) => ({
        finalUrl: request.url,
        mimeType: 'text/html',
        bytes: new TextEncoder().encode('<html><head></head><body></body></html>'),
      }),
    })

    await expect(service.load('https://drybread.studio/')).resolves.toEqual({
      url: 'https://drybread.studio/',
      status: 'fallback',
    })
  })

  it('rejects local, private, documentation, and mapped addresses before fetching', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('10.0.0.2')).toBe(false)
    expect(isPublicAddress('169.254.169.254')).toBe(false)
    expect(isPublicAddress('192.0.2.1')).toBe(false)
    expect(isPublicAddress('198.51.100.1')).toBe(false)
    expect(isPublicAddress('198.51.101.1')).toBe(true)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false)
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false)
    expect(isPublicAddress('fc00::1')).toBe(false)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    expect(isPublicAddress('1.1.1.1')).toBe(true)
  })

  it('limits preview traffic to standard HTTP and HTTPS ports', () => {
    expect(isAllowedLinkPreviewPort(new URL('http://example.com/'))).toBe(true)
    expect(isAllowedLinkPreviewPort(new URL('http://example.com:80/'))).toBe(true)
    expect(isAllowedLinkPreviewPort(new URL('https://example.com/'))).toBe(true)
    expect(isAllowedLinkPreviewPort(new URL('https://example.com:443/'))).toBe(true)
    expect(isAllowedLinkPreviewPort(new URL('https://example.com:22/'))).toBe(false)
    expect(isAllowedLinkPreviewPort(new URL('http://example.com:8080/'))).toBe(false)
  })

  it('caps concurrent website resolutions', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const service = createLinkPreviewService({
      // The gate this test pins is the per-site concurrency cap, not the
      // favicon fallback's extra round trip -- an unmatched favicon request
      // fails immediately here so each site still costs the single
      // observable request the counting below assumes.
      readResource: async (request) => {
        if (request.accept === 'image') throw new Error('favicon unavailable')
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => releases.push(resolve))
        active -= 1
        return {
          finalUrl: request.url,
          mimeType: 'text/html',
          bytes: new TextEncoder().encode('<title>Preview</title>'),
        }
      },
    })

    const loads = Array.from({ length: 12 }, (_, index) => (
      service.load(`https://site-${index}.example/`)
    ))
    await vi.waitFor(() => expect(releases).toHaveLength(8))
    expect(peak).toBe(8)
    while (releases.length) releases.shift()?.()
    await vi.waitFor(() => expect(releases).toHaveLength(4))
    while (releases.length) releases.shift()?.()
    await Promise.all(loads)
    expect(peak).toBe(8)
  })

  it('fails fast beyond the bounded website queue', async () => {
    const releases: Array<() => void> = []
    const service = createLinkPreviewService({
      // Same isolation as the concurrency-cap test above: only the html
      // fetch blocks, so the queue depth this test counts stays the number
      // of sites in flight, not sites times their favicon fallback attempt.
      readResource: async (request) => {
        if (request.accept === 'image') throw new Error('favicon unavailable')
        await new Promise<void>((resolve) => releases.push(resolve))
        return {
          finalUrl: request.url,
          mimeType: 'text/html',
          bytes: new TextEncoder().encode('<title>Preview</title>'),
        }
      },
    })

    const admitted = Array.from({ length: 24 }, (_, index) => (
      service.load(`https://queued-${index}.example/`)
    ))
    await vi.waitFor(() => expect(releases).toHaveLength(8))
    await expect(service.load('https://overflow.example/')).resolves.toEqual({
      url: 'https://overflow.example/',
      status: 'fallback',
    })
    while (releases.length) releases.shift()?.()
    await vi.waitFor(() => expect(releases).toHaveLength(8))
    while (releases.length) releases.shift()?.()
    await vi.waitFor(() => expect(releases).toHaveLength(8))
    while (releases.length) releases.shift()?.()
    await Promise.all(admitted)
  })

  it('admits only bounded non-animated PNG or JPEG media', () => {
    const png = Uint8Array.from(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    expect(isBoundedStaticImage('image/png', png)).toBe(true)

    const iendTypeOffset = Buffer.from(png).indexOf('IEND')
    const animationChunk = Buffer.alloc(20)
    animationChunk.writeUInt32BE(8, 0)
    animationChunk.write('acTL', 4, 'ascii')
    animationChunk.writeUInt32BE(1, 8)
    const animated = Uint8Array.from(Buffer.concat([
      Buffer.from(png).subarray(0, iendTypeOffset - 4),
      animationChunk,
      Buffer.from(png).subarray(iendTypeOffset - 4),
    ]))
    expect(isBoundedStaticImage('image/png', animated)).toBe(false)

    const oversized = Uint8Array.from(png)
    new DataView(oversized.buffer).setUint32(16, 4_000)
    expect(isBoundedStaticImage('image/png', oversized)).toBe(false)
    expect(isBoundedStaticImage('image/gif', Uint8Array.from([1, 2, 3]))).toBe(false)
  })

  it('falls back after one wall-clock deadline even when a reader never settles', async () => {
    const service = createLinkPreviewService({
      requestDeadlineMs: 20,
      readResource: async () => new Promise(() => {}),
    })

    await expect(service.load('https://slow.example/')).resolves.toEqual({
      url: 'https://slow.example/',
      status: 'fallback',
    })
  })
})
