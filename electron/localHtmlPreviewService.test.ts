import { describe, expect, it, vi } from 'vitest'
import { createLocalHtmlPreviewService } from './localHtmlPreviewService'

describe('local HTML preview service', () => {
  it('deduplicates an unchanged source into one bounded static JPEG capture', async () => {
    const source = {
      source: { id: 'source-1', name: 'review.html' },
      path: '/synthetic/review.html',
      size: 42,
      modifiedAtMs: 100,
    }
    const sources = {
      recognize: vi.fn(async () => source.source),
      resolve: vi.fn(async () => source),
      close: vi.fn(),
    }
    const capture = vi.fn(async () => ({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      title: 'Visual Review',
      width: 1200,
      height: 675,
    }))
    const service = createLocalHtmlPreviewService({
      sources,
      capture,
      openPath: vi.fn(async () => ''),
      now: () => '2026-08-14T10:00:00.000Z',
    })

    await expect(Promise.all([service.load('source-1'), service.load('source-1')])).resolves.toEqual([
      expect.objectContaining({
        sourceId: 'source-1',
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        mimeType: 'image/jpeg',
        size: 4,
        width: 1200,
        height: 675,
      }),
      expect.objectContaining({ sourceId: 'source-1' }),
    ])
    await service.load('source-1')
    expect(capture).toHaveBeenCalledTimes(1)
    await service.load('source-1', true)
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('fails closed for missing sources and delegates opening only by opaque id', async () => {
    const openPath = vi.fn(async () => '')
    const sources = {
      recognize: vi.fn(async () => null),
      resolve: vi.fn(async () => null),
      close: vi.fn(),
    }
    const service = createLocalHtmlPreviewService({
      sources,
      capture: vi.fn(),
      openPath,
    })

    await expect(service.load('source-missing')).rejects.toThrow(/unavailable/)
    await expect(service.open('source-missing')).resolves.toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('rejects an older capture after a newer source fingerprint starts', async () => {
    let revision = 0
    const olderCapture = deferredCapture()
    const newerCapture = deferredCapture()
    const captures = [olderCapture, newerCapture]
    const service = createLocalHtmlPreviewService({
      sources: {
        recognize: vi.fn(async () => null),
        resolve: vi.fn(async () => ({
          source: { id: 'source-1', name: 'review.html' },
          path: '/synthetic/review.html',
          size: 42 + revision,
          modifiedAtMs: 100 + revision++,
        })),
        close: vi.fn(),
      },
      capture: vi.fn(() => captures.shift()!.promise),
      openPath: vi.fn(async () => ''),
    })

    const older = service.load('source-1')
    await vi.waitFor(() => expect(captures).toHaveLength(1))
    const newer = service.load('source-1')
    await vi.waitFor(() => expect(captures).toHaveLength(0))
    newerCapture.resolve(validCapture(5))
    await expect(newer).resolves.toMatchObject({ size: 5 })
    olderCapture.resolve(validCapture(4))
    await expect(older).rejects.toThrow(/superseded/)
  })

  it('supersedes an active capture as soon as a newer fingerprint enters the queue', async () => {
    let sourceRevision = 0
    const first = deferredCapture()
    const blocker = deferredCapture()
    const replacement = deferredCapture()
    const captures = [first, blocker, replacement]
    const service = createLocalHtmlPreviewService({
      sources: {
        recognize: vi.fn(async () => null),
        resolve: vi.fn(async (sourceId: string) => ({
          source: { id: sourceId, name: 'review.html' },
          path: `/synthetic/${sourceId}.html`,
          size: 42 + (sourceId === 'source-1' ? sourceRevision : 0),
          modifiedAtMs: 100 + (sourceId === 'source-1' ? sourceRevision++ : 0),
        })),
        close: vi.fn(),
      },
      capture: vi.fn(() => captures.shift()!.promise),
      openPath: vi.fn(async () => ''),
    })

    const older = service.load('source-1')
    const activeBlocker = service.load('source-2')
    await vi.waitFor(() => expect(captures).toHaveLength(1))
    const newer = service.load('source-1')

    first.resolve(validCapture(4))
    await expect(older).rejects.toThrow(/superseded/)
    replacement.resolve(validCapture(5))
    await expect(newer).resolves.toMatchObject({ size: 5 })
    blocker.resolve(validCapture(4))
    await expect(activeBlocker).resolves.toMatchObject({ size: 4 })
  })

  it('invalidates stale pixels during refresh without leaking cache accounting', async () => {
    const refreshCapture = deferredCapture()
    let captureCount = 0
    const service = createLocalHtmlPreviewService({
      sources: {
        recognize: vi.fn(async () => null),
        resolve: vi.fn(async () => ({
          source: { id: 'source-1', name: 'review.html' },
          path: '/synthetic/review.html',
          size: 42,
          modifiedAtMs: 100,
        })),
        close: vi.fn(),
      },
      capture: vi.fn(async () => {
        captureCount += 1
        if (captureCount === 2) return refreshCapture.promise
        return validCapture(600_000)
      }),
      openPath: vi.fn(async () => ''),
    })

    await service.load('source-1')
    const refreshing = service.load('source-1', true)
    const concurrent = service.load('source-1')
    refreshCapture.resolve(validCapture(5))
    await expect(Promise.all([refreshing, concurrent])).resolves.toEqual([
      expect.objectContaining({ size: 5 }),
      expect.objectContaining({ size: 5 }),
    ])

    for (let index = 0; index < 24; index += 1) await service.load('source-1', true)
    await service.load('source-1')
    expect(captureCount).toBe(26)
  }, 15_000)

  it('bounds waiting captures and rejects them when the service closes', async () => {
    const active = deferredCapture()
    const sources = {
      recognize: vi.fn(async () => null),
      resolve: vi.fn(async (sourceId: string) => ({
        source: { id: sourceId, name: 'review.html' },
        path: `/synthetic/${sourceId}.html`,
        size: 42,
        modifiedAtMs: 100,
      })),
      close: vi.fn(),
    }
    const service = createLocalHtmlPreviewService({
      sources,
      capture: vi.fn(() => active.promise),
      openPath: vi.fn(async () => ''),
    })
    const admitted = Array.from({ length: 18 }, (_, index) => service.load(`source-${index}`))

    await expect(service.load('source-overflow')).rejects.toThrow(/queue is full/)
    service.close()
    active.resolve(validCapture(4))
    const outcomes = await Promise.allSettled(admitted)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(18)
    expect(sources.close).toHaveBeenCalledOnce()
  })
})

function deferredCapture() {
  let resolve!: (value: ReturnType<typeof validCapture>) => void
  const promise = new Promise<ReturnType<typeof validCapture>>((settle) => { resolve = settle })
  return { promise, resolve }
}

function validCapture(size: number) {
  const bytes = Uint8Array.from({ length: size }, () => 97)
  bytes.set([0xff, 0xd8], 0)
  bytes.set([0xff, 0xd9], size - 2)
  return {
    bytes,
    width: 1200,
    height: 675,
  }
}
