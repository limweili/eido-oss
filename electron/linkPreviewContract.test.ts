import { describe, expect, it, vi } from 'vitest'
import {
  assertLinkPreviewRequest,
  assertLinkPreviewResponse,
  createInstalledLinkPreviewBridge,
  LINK_PREVIEW_BRIDGE_CHANNEL,
  type LinkPreviewRequest,
} from './linkPreviewContract'
import { LINK_PREVIEW_LIMITS } from '../src/shared/linkPreview'

describe('link preview bridge contract', () => {
  it('accepts only one bounded web URL operation', () => {
    expect(assertLinkPreviewRequest({
      version: 1,
      operation: 'load',
      payload: { url: 'https://drybread.studio/' },
    })).toEqual({
      version: 1,
      operation: 'load',
      payload: { url: 'https://drybread.studio/' },
    })
    expect(() => assertLinkPreviewRequest({
      version: 1,
      operation: 'load',
      payload: { url: 'file:///etc/passwd' },
    })).toThrow(/denied/)
    expect(() => assertLinkPreviewRequest({
      version: 1,
      operation: 'load',
      payload: { url: 'https://drybread.studio/', path: '/tmp/profile' },
    })).toThrow(/denied/)
    expect(() => assertLinkPreviewRequest({
      version: 1,
      operation: 'load',
      payload: { url: `https://example.com/${'a'.repeat(LINK_PREVIEW_LIMITS.url)}` },
    })).toThrow(/denied/)
  })

  it('accepts only host-shaped recognition text at the trusted boundary', () => {
    expect(assertLinkPreviewRequest({
      version: 1,
      operation: 'recognize',
      payload: { text: 'www.example.co/path' },
    })).toEqual({
      version: 1,
      operation: 'recognize',
      payload: { text: 'www.example.co/path' },
    })
    for (const text of ['hello@example.com', 'v1.2.3', '192.168.1.1', 'README.md']) {
      expect(() => assertLinkPreviewRequest({
        version: 1,
        operation: 'recognize',
        payload: { text },
      })).toThrow(/denied/)
    }
    expect(() => assertLinkPreviewRequest({
      version: 1,
      operation: 'recognize',
      payload: { text: `${' '.repeat(LINK_PREVIEW_LIMITS.url)}example.com` },
    })).toThrow(/denied/)
  })

  it('admits local HTML operations without ever returning a filesystem path', async () => {
    const invoke = vi.fn(async (_channel: string, request: LinkPreviewRequest) => {
      if (request.operation === 'recognize-local') {
        return { ok: true, source: { id: 'local-source-1', name: 'review.html' } }
      }
      if (request.operation === 'load-local') {
        return {
          ok: true,
          capture: {
            sourceId: request.payload.sourceId,
            title: 'Review',
            imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
            mimeType: 'image/jpeg',
            size: 4,
            width: 1200,
            height: 675,
            capturedAt: '2026-08-14T10:00:00.000Z',
          },
        }
      }
      if (request.operation === 'open-local') return { ok: true, opened: true }
      throw new Error('unexpected operation')
    })
    const bridge = createInstalledLinkPreviewBridge(invoke)

    await expect(bridge.recognizeLocal('/Users/example/review.html')).resolves.toEqual({
      id: 'local-source-1',
      name: 'review.html',
    })
    await expect(bridge.loadLocal('local-source-1', true)).resolves.toMatchObject({
      sourceId: 'local-source-1',
      mimeType: 'image/jpeg',
      width: 1200,
      height: 675,
    })
    await expect(bridge.openLocal('local-source-1')).resolves.toBe(true)
    expect(JSON.stringify(await bridge.recognizeLocal('/Users/example/review.html'))).not.toContain(
      '/Users/example',
    )
  })

  it('rejects local operations with non-HTML shapes, path-shaped ids, or media overflow', () => {
    expect(() => assertLinkPreviewRequest({
      version: 1,
      operation: 'recognize-local',
      payload: { text: '/Users/example/review.pdf' },
    })).toThrow(/denied/)
    expect(() => assertLinkPreviewRequest({
      version: 1,
      operation: 'load-local',
      payload: { sourceId: '/Users/example/review.html', refresh: false },
    })).toThrow(/denied/)
    expect(() => assertLinkPreviewRequest({
      version: 1,
      operation: 'open-local',
      payload: { sourceId: '/Users/example/review.html' },
    })).toThrow(/denied/)
    expect(() => assertLinkPreviewResponse({
      ok: true,
      source: { id: 'source-1', name: 'review.html', path: '/Users/example/review.html' },
    })).toThrow(/denied/)
    expect(() => assertLinkPreviewResponse({
      ok: true,
      capture: {
        sourceId: 'source-1',
        imageDataUrl: 'data:image/jpeg;base64,YQ==',
        mimeType: 'image/jpeg',
        size: 1,
        width: 1200,
        height: 675,
        capturedAt: '2026-08-14T10:00:00.000Z',
      },
    })).toThrow(/denied/)
  })

  it('rejects response shapes belonging to the other bridge operation', () => {
    expect(() => assertLinkPreviewResponse({
      ok: true,
      preview: { url: 'https://example.com/', status: 'fallback' },
      url: 'https://example.com/',
    })).toThrow(/denied/)
    expect(() => assertLinkPreviewResponse({ ok: true, preview: null })).toThrow(/denied/)
    expect(() => assertLinkPreviewResponse({ ok: true, url: 'file:///etc/passwd' })).toThrow(
      /denied/,
    )
  })

  it('exposes a frozen renderer bridge and validates the returned preview', async () => {
    const invoke = vi.fn(async (_channel: string, request: LinkPreviewRequest) => (
      request.operation === 'load'
        ? {
            ok: true,
            preview: {
              url: request.payload.url,
              status: 'ready',
              title: 'Drybread Studios',
            },
          }
        : { ok: true, url: 'https://drybread.studio' }
    ))
    const bridge = createInstalledLinkPreviewBridge(invoke)

    await expect(bridge.load('https://drybread.studio/')).resolves.toEqual({
      url: 'https://drybread.studio/',
      status: 'ready',
      title: 'Drybread Studios',
    })
    await expect(bridge.recognize('drybread.studio')).resolves.toBe('https://drybread.studio')
    expect(Object.isFrozen(bridge)).toBe(true)
    expect(invoke).toHaveBeenCalledWith(LINK_PREVIEW_BRIDGE_CHANNEL, {
      version: 1,
      operation: 'load',
      payload: { url: 'https://drybread.studio/' },
    })
  })
})
