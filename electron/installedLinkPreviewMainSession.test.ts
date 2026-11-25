import { describe, expect, it, vi } from 'vitest'
import { createInstalledLinkPreviewMainSession } from './installedLinkPreviewMainSession'

describe('installed link preview main session', () => {
  it('serves only the exact trusted app frame and contains service failures', async () => {
    const frame = { url: 'eido://app/' }
    const target = { mainFrame: frame }
    const service = {
      load: vi.fn(async (url: string) => ({
        url,
        status: 'ready' as const,
        title: 'Drybread Studios',
      })),
    }
    const localService = {
      recognize: vi.fn(async () => ({ id: 'source-1', name: 'review.html' })),
      load: vi.fn(async (sourceId: string) => ({
        sourceId,
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        mimeType: 'image/jpeg' as const,
        size: 4,
        width: 1200,
        height: 675,
        capturedAt: '2026-08-14T10:00:00.000Z',
      })),
      open: vi.fn(async () => true),
      close: vi.fn(),
    }
    const session = createInstalledLinkPreviewMainSession({ service, localService, target })
    const request = {
      version: 1 as const,
      operation: 'load' as const,
      payload: { url: 'https://drybread.studio/' },
    }

    await expect(session.route({ sender: target, senderFrame: frame }, [request])).resolves.toEqual({
      ok: true,
      preview: {
        url: 'https://drybread.studio/',
        status: 'ready',
        title: 'Drybread Studios',
      },
    })
    await expect(session.route({ sender: target, senderFrame: frame }, [{
      version: 1,
      operation: 'recognize',
      payload: { text: 'drybread.studio' },
    }])).resolves.toEqual({ ok: true, url: 'https://drybread.studio' })
    await expect(session.route({ sender: target, senderFrame: frame }, [{
      version: 1,
      operation: 'recognize-local',
      payload: { text: '/Users/example/review.html' },
    }])).resolves.toEqual({ ok: true, source: { id: 'source-1', name: 'review.html' } })
    await expect(session.route({ sender: target, senderFrame: frame }, [{
      version: 1,
      operation: 'load-local',
      payload: { sourceId: 'source-1', refresh: true },
    }])).resolves.toMatchObject({ ok: true, capture: { sourceId: 'source-1' } })
    expect(localService.load).toHaveBeenCalledWith('source-1', true)
    await expect(session.route({ sender: target, senderFrame: frame }, [{
      version: 1,
      operation: 'open-local',
      payload: { sourceId: 'source-1' },
    }])).resolves.toEqual({ ok: true, opened: true })
    await expect(session.route({
      sender: target,
      senderFrame: { url: 'https://attacker.example/' },
    }, [request])).rejects.toThrow(/denied/)

    service.load.mockRejectedValueOnce(new Error('offline'))
    await expect(session.route({ sender: target, senderFrame: frame }, [request])).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    })
  })
})
