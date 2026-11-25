import { describe, expect, it, vi } from 'vitest'
import type { Card, CardAsset } from '../graph/types'
import type { ImageRenditionResolver } from '../shared/imageRenditions'
import {
  createLookAheadImageRenditionPrewarmCoordinator,
  type ImageRenditionIdleScheduler,
  type LookAheadImageRenditionPrewarmWindow,
} from './imageRenditionPrewarm'

function image(id: string): CardAsset {
  return {
    id,
    kind: 'image',
    name: `${id}.png`,
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${id}`,
    size: id.length,
    createdAt: '2026-07-23T00:00:00.000Z',
    width: 1280,
    height: 960,
  }
}

function note(id: string, imageCount: number): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    assets: Array.from({ length: imageCount }, (_, index) => image(`${id}-${index + 1}`)),
    position: { x: 0, y: 0 },
  }
}

describe('look-ahead image rendition prewarm', () => {
  it('scopes exact Card keys and serialises them only after viewport, rendition, and idle settle', async () => {
    const visible = note('visible', 1)
    const passive = note('passive', 2)
    const compact = note('compact', 5)
    const latest = note('latest', 1)
    const sharedA = { ...note('shared', 1), assets: [image('a-shared')] }
    const sharedB = { ...note('shared', 1), assets: [image('b-shared')] }
    const cardsA = new Map([visible, passive, compact, latest, sharedA].map((card) => [card.id, card]))
    const cardsB = new Map([[sharedB.id, sharedB]])
    const windowState = (
      scopeId: string,
      cardIds?: string[],
      settled = true,
      cardById: (cardId: string) => Card | undefined = (cardId) => cardsA.get(cardId),
    ): LookAheadImageRenditionPrewarmWindow => ({
      scopeId,
      lookAheadCardIds: cardIds ? new Set(cardIds) : undefined,
      visibleCardIds: new Set(['visible']),
      cardById,
      settled,
    })

    const idleWork: Array<() => void> = []
    let idleCancellations = 0
    const scheduleIdle = vi.fn<ImageRenditionIdleScheduler>((work) => {
      let active = true
      idleWork.push(() => {
        if (active) work()
      })
      return () => {
        if (!active) return
        active = false
        idleCancellations += 1
      }
    })
    const runIdle = () => idleWork.shift()?.()

    let finishFirstBatch: (() => void) | undefined
    const firstBatch = new Promise<[]>(resolve => {
      finishFirstBatch = () => resolve([])
    })
    const preload = vi.fn<ImageRenditionResolver['preload']>()
      .mockImplementationOnce(() => firstBatch)
      .mockResolvedValue([])
    const resolver = { preload } as Pick<ImageRenditionResolver, 'preload'> as ImageRenditionResolver
    let globalMotionSettled = false
    const coordinator = createLookAheadImageRenditionPrewarmCoordinator(
      scheduleIdle,
      () => resolver,
      () => globalMotionSettled,
    )

    // Programmatic camera motion has no input-navigation flag: the scene's
    // actual viewport motion captures the window and blocks its dispatch.
    coordinator.update(windowState('idea-a', ['passive'], false))
    coordinator.update(windowState('idea-a', undefined, false))
    expect(scheduleIdle).not.toHaveBeenCalled()

    coordinator.update(windowState('idea-a'))
    coordinator.update(windowState('idea-a'))
    runIdle()
    runIdle()
    expect(preload).not.toHaveBeenCalled()

    globalMotionSettled = true
    coordinator.update(windowState('idea-a', ['visible', 'passive', 'compact'], false))
    coordinator.update(windowState('idea-a'))
    runIdle()
    expect(preload.mock.calls[0]?.[0].map(({ asset, demand }) => [
      asset.id,
      demand.purpose,
      demand.width,
      demand.height,
    ])).toEqual([
      ['passive-1', 'passive-card', 240, 180],
      ['passive-2', 'passive-card', 240, 180],
      ['compact-1', 'card-thumbnail', 144, 108],
      ['compact-2', 'card-thumbnail', 144, 108],
      ['compact-3', 'card-thumbnail', 144, 108],
      ['compact-4', 'card-thumbnail', 144, 108],
    ])

    coordinator.update(windowState('idea-a', ['passive'], false))
    coordinator.update(windowState('idea-a', ['latest'], false))
    coordinator.update(windowState('idea-a'))
    expect(preload).toHaveBeenCalledOnce()

    finishFirstBatch?.()
    await firstBatch
    await Promise.resolve()
    runIdle()
    expect(preload.mock.calls[1]?.[0].map(({ asset }) => asset.id)).toEqual(['latest-1'])

    // A stationary Idea switch cancels A's pending retained window even when
    // B contains the same Card id; only B's own later query may resolve it.
    await Promise.resolve()
    await Promise.resolve()
    coordinator.update(windowState('idea-a', ['shared'], false))
    coordinator.update(windowState('idea-a'))
    coordinator.update(windowState('idea-b', undefined, true, (cardId) => cardsB.get(cardId)))
    runIdle()
    expect(preload).toHaveBeenCalledTimes(2)

    coordinator.update(windowState('idea-b', ['shared'], false, (cardId) => cardsB.get(cardId)))
    coordinator.update(windowState('idea-b', undefined, true, (cardId) => cardsB.get(cardId)))
    runIdle()
    expect(preload.mock.calls[2]?.[0].map(({ asset }) => asset.id)).toEqual(['b-shared'])
    expect(idleCancellations).toBe(2)
    coordinator.dispose()
  })
})
