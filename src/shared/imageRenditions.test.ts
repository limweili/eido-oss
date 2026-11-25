import { describe, expect, it, vi } from 'vitest'
import type { CardAsset } from '../graph/types'
import {
  createImageRenditionResolver,
  imageRenditionKey,
  type ImageRenditionRender,
  type ImageRenditionVisual,
} from './imageRenditions'

function asset(id: string, dataUrl = `data:image/jpeg;base64,${id}`): CardAsset {
  return {
    id,
    kind: 'image',
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    dataUrl,
    size: dataUrl.length,
    createdAt: '2026-07-14T00:00:00.000Z',
    width: 1280,
    height: 960,
  }
}

function demand(
  purpose: 'card-thumbnail' | 'passive-card' | 'active-card' | 'gallery-thumbnail' | 'gallery',
  width: number,
  height: number,
  overrides: Partial<{ visibility: 'visible' | 'preload' | 'offscreen'; settled: boolean }> = {},
) {
  return {
    purpose,
    width,
    height,
    visibility: overrides.visibility ?? 'visible',
    settled: overrides.settled ?? true,
  } as const
}

function renderer() {
  const revoked: string[] = []
  const render = vi.fn<ImageRenditionRender>(async ({ key, width, height }) => ({
    src: `blob:${key}`,
    width,
    height,
    byteSize: Math.max(1, Math.round((width * height) / 4)),
    revoke: () => revoked.push(`blob:${key}`),
  }))
  return { render, revoked }
}

describe('image rendition resolver', () => {
  it('keys and deduplicates work by authoritative reference identity plus purpose and size', async () => {
    const { render } = renderer()
    const resolver = createImageRenditionResolver({
      render,
      maxDecodedBytes: 10_000_000,
      maxRenditionBytes: 10_000_000,
      maxPreloadEntries: 3,
    })
    const reference = asset('same-reference')

    const first = resolver.request(reference, demand('card-thumbnail', 120, 80))
    const duplicate = resolver.request(reference, demand('card-thumbnail', 120, 80))
    const otherPurpose = resolver.request(reference, demand('gallery-thumbnail', 120, 80))
    const otherSize = resolver.request(reference, demand('card-thumbnail', 240, 160))

    await Promise.all([first.ready, duplicate.ready, otherPurpose.ready, otherSize.ready])

    expect(first.key).toBe(duplicate.key)
    expect(render).toHaveBeenCalledTimes(3)
    expect(new Set(render.mock.calls.map(([request]) => request.key)).size).toBe(3)
    expect(imageRenditionKey(reference, demand('card-thumbnail', 120, 80))).not.toBe(
      imageRenditionKey(asset(reference.id, `${reference.dataUrl}-changed`), demand('card-thumbnail', 120, 80)),
    )

    first.release()
    duplicate.release()
    otherPurpose.release()
    otherSize.release()
    resolver.dispose()
  })

  it('keeps the last valid visual while sharper work is pending, deferred, or fails', async () => {
    let resolveRender!: (visual: Awaited<ReturnType<ImageRenditionRender>>) => void
    const render = vi.fn<ImageRenditionRender>(
      () => new Promise((resolve) => { resolveRender = resolve }),
    )
    const resolver = createImageRenditionResolver({
      render,
      maxDecodedBytes: 10_000_000,
      maxRenditionBytes: 10_000_000,
      maxPreloadEntries: 2,
    })
    const reference = asset('visual')
    const previous: ImageRenditionVisual = {
      src: 'blob:last-valid',
      key: 'last-valid',
      width: 160,
      height: 120,
      decodedBytes: 76_800,
      renditionBytes: 4_000,
      derived: true,
    }

    const pending = resolver.request(reference, demand('gallery', 900, 700), previous)
    expect(pending.status).toBe('pending')
    expect(pending.visual.src).toBe('blob:last-valid')

    await Promise.resolve()
    resolveRender({ src: 'blob:sharp', width: 900, height: 700, byteSize: 30_000, revoke: vi.fn() })
    await expect(pending.ready).resolves.toMatchObject({ src: 'blob:sharp', derived: true })
    pending.release()

    const moving = resolver.request(reference, demand('gallery', 1200, 900, { settled: false }), previous)
    expect(moving.status).toBe('deferred')
    await expect(moving.ready).resolves.toBe(previous)
    expect(render).toHaveBeenCalledTimes(1)
    moving.release()

    const failingResolver = createImageRenditionResolver({
      render: async () => { throw new Error('resize-failed') },
      maxDecodedBytes: 10_000_000,
      maxRenditionBytes: 10_000_000,
      maxPreloadEntries: 1,
    })
    const failing = failingResolver.request(reference, demand('active-card', 500, 400), previous)
    expect(failing.visual.src).toBe('blob:last-valid')
    await expect(failing.ready).resolves.toBe(previous)
    expect(failing.visual.src).not.toBe('')
    failing.release()
    failingResolver.dispose()
    resolver.dispose()
  })

  it('does not start sharper offscreen work and bounds preload fan-out', async () => {
    const { render } = renderer()
    const resolver = createImageRenditionResolver({
      render,
      maxDecodedBytes: 10_000_000,
      maxRenditionBytes: 10_000_000,
      maxPreloadEntries: 2,
    })
    const offscreen = resolver.request(asset('offscreen'), demand('active-card', 640, 480, { visibility: 'offscreen' }))

    expect(offscreen.status).toBe('deferred')
    await offscreen.ready
    expect(render).not.toHaveBeenCalled()

    const results = await resolver.preload([
      { asset: asset('one'), demand: demand('passive-card', 200, 150, { visibility: 'preload' }) },
      { asset: asset('two'), demand: demand('passive-card', 200, 150, { visibility: 'preload' }) },
      { asset: asset('three'), demand: demand('passive-card', 200, 150, { visibility: 'preload' }) },
      { asset: asset('hidden'), demand: demand('active-card', 800, 600, { visibility: 'offscreen' }) },
    ])

    expect(results).toHaveLength(2)
    expect(render).toHaveBeenCalledTimes(2)
    expect(resolver.snapshot().preloadRejected).toBe(2)
    offscreen.release()
    resolver.dispose()
  })

  it('evicts and revokes reference-aware LRU entries under both byte budgets with bounded repeated traversal', async () => {
    const { render, revoked } = renderer()
    const resolver = createImageRenditionResolver({
      render,
      maxDecodedBytes: 800,
      maxRenditionBytes: 60,
      maxPreloadEntries: 1,
    })

    for (let index = 0; index < 20; index += 1) {
      const handle = resolver.request(asset(`ref-${index % 4}`), demand('card-thumbnail', 10, 10))
      await handle.ready
      handle.release()
      const snapshot = resolver.snapshot()
      expect(snapshot.decodedBytes).toBeLessThanOrEqual(800)
      expect(snapshot.renditionBytes).toBeLessThanOrEqual(60)
      expect(snapshot.entries).toBeLessThanOrEqual(2)
    }

    const snapshot = resolver.snapshot()
    expect(snapshot.evictions).toBeGreaterThan(0)
    expect(snapshot.revocations).toBe(snapshot.evictions)
    expect(revoked).toHaveLength(snapshot.revocations)
    expect(new Set(snapshot.references).size).toBe(snapshot.references.length)
    resolver.dispose()
  })

  it('keeps a shared rendition alive until its last pending or adopted reference releases', async () => {
    let resolveShared!: (visual: Awaited<ReturnType<ImageRenditionRender>>) => void
    const revoked: string[] = []
    const render = vi.fn<ImageRenditionRender>(async ({ key, width, height, asset: reference }) => {
      if (reference.id === 'anchor') {
        return {
          src: `blob:${key}`,
          width,
          height,
          byteSize: 25,
          revoke: () => revoked.push(`blob:${key}`),
        }
      }
      return new Promise((resolve) => { resolveShared = resolve })
    })
    const resolver = createImageRenditionResolver({
      render,
      maxDecodedBytes: 400,
      maxRenditionBytes: 25,
      maxPreloadEntries: 1,
    })
    const anchor = resolver.request(asset('anchor'), demand('card-thumbnail', 10, 10))
    await anchor.ready

    const sharedReference = asset('shared')
    const abandoned = resolver.request(sharedReference, demand('card-thumbnail', 10, 10))
    const adopted = resolver.request(sharedReference, demand('card-thumbnail', 10, 10))
    abandoned.release()
    await Promise.resolve()
    resolveShared({
      src: `blob:${adopted.key}`,
      width: 10,
      height: 10,
      byteSize: 25,
      revoke: () => revoked.push(`blob:${adopted.key}`),
    })

    const visual = await adopted.ready
    expect(visual.src).toBe(`blob:${adopted.key}`)
    expect(revoked).not.toContain(visual.src)
    expect(resolver.snapshot()).toMatchObject({
      activePins: 2,
      pendingPins: 0,
      pinnedEntries: 2,
      budgetBlocked: 1,
    })

    resolver.invalidateReference(sharedReference)
    expect(resolver.snapshot().invalidatedEntries).toBe(1)
    expect(revoked).not.toContain(visual.src)
    const invalidatedRetry = resolver.request(
      sharedReference,
      demand('card-thumbnail', 10, 10),
      visual,
    )
    expect(invalidatedRetry.status).toBe('deferred')
    await expect(invalidatedRetry.ready).resolves.toMatchObject({
      src: sharedReference.dataUrl,
      derived: false,
    })
    expect(resolver.snapshot().invalidationDeferred).toBe(1)
    invalidatedRetry.release()

    adopted.release()
    expect(revoked.filter((src) => src === visual.src)).toHaveLength(1)
    expect(resolver.snapshot()).toMatchObject({
      activePins: 1,
      invalidatedEntries: 0,
      decodedBytes: 400,
      renditionBytes: 25,
    })

    anchor.release()
    resolver.dispose()
  })

  it('supports legacy assets without compression dimensions and never mutates Board truth', async () => {
    const { render } = renderer()
    const resolver = createImageRenditionResolver({
      render,
      maxDecodedBytes: 10_000,
      maxRenditionBytes: 10_000,
      maxPreloadEntries: 1,
    })
    const legacy = asset('legacy')
    delete legacy.width
    delete legacy.height
    const before = structuredClone(legacy)

    const handle = resolver.request(legacy, demand('card-thumbnail', 80, 60))
    await expect(handle.ready).resolves.toMatchObject({ width: 80, height: 60, derived: true })
    expect(legacy).toEqual(before)
    expect(render.mock.calls[0]?.[0].asset.dataUrl).toBe(before.dataUrl)

    handle.release()
    resolver.dispose()
  })
})
