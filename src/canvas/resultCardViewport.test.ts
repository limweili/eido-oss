import { describe, expect, it } from 'vitest'
import {
  cardGrowthMaxHeight,
  resultCardViewportMaxHeight,
  resultCardViewportMaxHeights,
} from './resultCardViewport'

describe('cardGrowthMaxHeight', () => {
  it('stops an auto-sized Note before the nearest card below it', () => {
    const note = {
      id: 'note',
      kind: 'note' as const,
      blocks: [],
      position: { x: 100, y: 100 },
    }
    const blocker = {
      id: 'blocker',
      kind: 'note' as const,
      blocks: [],
      position: { x: 100, y: 360 },
    }

    expect(
      cardGrowthMaxHeight({
        card: note,
        cards: [note, blocker],
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: { width: 1_200, height: 800 },
      }),
    ).toBe(240)
  })

  it('allows only the minimum height when a blocker is already too close', () => {
    const note = {
      id: 'note',
      kind: 'note' as const,
      blocks: [],
      position: { x: 100, y: 100 },
    }
    const blocker = {
      id: 'blocker',
      kind: 'note' as const,
      blocks: [],
      position: { x: 100, y: 200 },
    }

    expect(
      cardGrowthMaxHeight({
        card: note,
        cards: [note, blocker],
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: { width: 1_200, height: 800 },
      }),
    ).toBe(120)
  })

  it('does not treat a Card outside the horizontal growth path as a blocker', () => {
    const note = {
      id: 'note',
      kind: 'note' as const,
      blocks: [],
      position: { x: 100, y: 100 },
    }
    const beside = {
      id: 'beside',
      kind: 'note' as const,
      blocks: [],
      position: { x: 400, y: 200 },
    }

    expect(
      cardGrowthMaxHeight({
        card: note,
        cards: [note, beside],
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: { width: 1_200, height: 800 },
      }),
    ).toBe(670)
  })
})

describe('resultCardViewportMaxHeight', () => {
  it('leaves a generous screen-space buffer beneath an auto-sized Result card', () => {
    expect(
      resultCardViewportMaxHeight({
        card: {
          id: 'result',
          kind: 'result',
          blocks: [],
          position: { x: 100, y: 100 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: { width: 1_200, height: 800 },
      }),
    ).toBe(670)
  })

  it('converts the screen-space allowance back into board units at the current zoom', () => {
    expect(
      resultCardViewportMaxHeight({
        card: {
          id: 'result',
          kind: 'result',
          blocks: [],
          position: { x: 100, y: 100 },
        },
        viewport: { x: 0, y: 0, zoom: 2 },
        viewportSize: { width: 1_200, height: 800 },
      }),
    ).toBe(285)
  })

  it('does not cap a manually resized Result card', () => {
    expect(
      resultCardViewportMaxHeight({
        card: {
          id: 'result',
          kind: 'result',
          blocks: [],
          position: { x: 100, y: 100 },
          size: { width: 260, height: 320 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: { width: 1_200, height: 800 },
      }),
    ).toBeUndefined()
  })

  it('keeps a practical minimum height when a Result begins near the viewport edge', () => {
    expect(
      resultCardViewportMaxHeight({
        card: {
          id: 'result',
          kind: 'result',
          blocks: [],
          position: { x: 100, y: 750 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: { width: 1_200, height: 800 },
      }),
    ).toBe(120)
  })

  it('keeps an established Result cap stable when the viewport pans', () => {
    const result = {
      id: 'result',
      kind: 'result' as const,
      blocks: [],
      position: { x: 100, y: 100 },
    }
    const established = resultCardViewportMaxHeights(
      [result],
      { x: 0, y: 0, zoom: 1 },
      { width: 1_200, height: 800 },
    )

    const afterPan = resultCardViewportMaxHeights(
      [result],
      { x: 0, y: -180, zoom: 1 },
      { width: 1_200, height: 800 },
      established,
    )

    expect(afterPan).toBe(established)
    expect(afterPan.get(result.id)).toBe(670)
  })
})
