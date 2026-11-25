import { describe, expect, it } from 'vitest'
import { planPassiveCardResidency } from './cardResidency'

describe('planPassiveCardResidency', () => {
  it('admits only exact-visible Cards above 100,000 text-weight units to the oversize pool', () => {
    const plan = planPassiveCardResidency({
      visibleCardIds: ['ordinary-boundary', 'oversize-boundary'],
      preloadCardIds: [],
      cardWeightById: new Map([
        ['ordinary-boundary', 100_000],
        ['oversize-boundary', 100_001],
      ]),
    })

    expect({
      passiveIds: [...plan.passiveCardIds],
      ordinaryWeight: plan.admittedTextWeight,
      oversizeIds: [...plan.oversizePassiveCardIds],
      oversizeWeight: plan.oversizePassiveTextWeight,
    }).toEqual({
      passiveIds: ['ordinary-boundary', 'oversize-boundary'],
      ordinaryWeight: 100_000,
      oversizeIds: ['oversize-boundary'],
      oversizeWeight: 100_001,
    })
  })

  it('admits deterministic, hysteretic tiers within both text-weight and Card ceilings', () => {
    const weightedInput = {
      visibleCardIds: ['new-visible', 'kept-visible', 'boundary-visible', 'overflow-visible'],
      preloadCardIds: ['preload'],
      lookAheadCardIds: ['ahead'],
      cardWeightById: new Map([
        ['new-visible', 100_000],
        ['kept-visible', 100_000],
        ['boundary-visible', 100_000],
        ['overflow-visible', 1],
        ['ahead', 1],
        ['preload', 1],
      ]),
      previousPassiveCardIds: new Set(['kept-visible']),
      viewport: { x: -400, y: 0, zoom: 1 },
      previousViewport: { x: 0, y: 0, zoom: 1 },
      passiveCardTextWeightLimit: 300_000,
    }
    const first = planPassiveCardResidency(weightedInput)
    const replay = planPassiveCardResidency(weightedInput)

    expect({
      ids: [...first.passiveCardIds],
      weight: first.admittedTextWeight,
      oversizeIds: [...first.oversizePassiveCardIds],
      oversizeWeight: first.oversizePassiveTextWeight,
    }).toEqual({
      ids: ['kept-visible', 'new-visible', 'boundary-visible'],
      weight: 300_000,
      oversizeIds: [],
      oversizeWeight: 0,
    })
    expect([...replay.passiveCardIds]).toEqual([...first.passiveCardIds])

    const tinyCardIds = Array.from({ length: 13 }, (_, index) => `tiny-${index}`)
    const starvationInput = {
      visibleCardIds: ['resident-a', 'resident-b', 'oversize', ...tinyCardIds],
      preloadCardIds: [],
      cardWeightById: new Map([
        ['resident-a', 60_000],
        ['resident-b', 60_000],
        ['oversize', 4_800_000],
        ...tinyCardIds.map((cardId, index) => [cardId, index + 1] as const),
      ]),
      previousPassiveCardIds: new Set(['resident-a', 'resident-b']),
    }
    const starvationPlan = planPassiveCardResidency(starvationInput)
    const starvationReplay = planPassiveCardResidency({
      ...starvationInput,
      previousPassiveCardIds: starvationPlan.passiveCardIds,
    })

    expect({
      ids: [...starvationPlan.passiveCardIds],
      weight: starvationPlan.admittedTextWeight,
      oversizeIds: [...starvationPlan.oversizePassiveCardIds],
      oversizeWeight: starvationPlan.oversizePassiveTextWeight,
    }).toEqual({
      ids: ['resident-a', 'resident-b', 'oversize', ...tinyCardIds],
      weight: 120_091,
      oversizeIds: ['oversize'],
      oversizeWeight: 4_800_000,
    })
    expect([...starvationReplay.passiveCardIds]).toEqual([...starvationPlan.passiveCardIds])

    const giantCardIds = Array.from({ length: 31 }, (_, index) => `giant-${index}`)
    const oversizedViewport = {
      visibleCardIds: [...giantCardIds, 'small'],
      preloadCardIds: [],
      cardWeightById: new Map<string, number>([
        ...giantCardIds.map((cardId, index) => [cardId, 700_000 + index] as const),
        ['small', 10],
      ]),
    }
    const oversizedFirst = planPassiveCardResidency(oversizedViewport)
    const oversizedReplay = planPassiveCardResidency({
      ...oversizedViewport,
      previousPassiveCardIds: oversizedFirst.passiveCardIds,
    })
    expect({
      ids: [...oversizedFirst.passiveCardIds],
      weight: oversizedFirst.admittedTextWeight,
      oversizeIds: [...oversizedFirst.oversizePassiveCardIds],
      oversizeWeight: oversizedFirst.oversizePassiveTextWeight,
      replayIds: [...oversizedReplay.passiveCardIds],
    }).toEqual({
      ids: [...giantCardIds.slice(0, 10), 'small'],
      weight: 10,
      oversizeIds: giantCardIds.slice(0, 10),
      oversizeWeight: giantCardIds.slice(0, 10).reduce((sum, _cardId, index) => sum + 700_000 + index, 0),
      replayIds: [...giantCardIds.slice(0, 10), 'small'],
    })

    const noOversizePreload = planPassiveCardResidency({
      visibleCardIds: ['visible-small'],
      preloadCardIds: ['preload-oversize', 'preload-small'],
      lookAheadCardIds: ['ahead-oversize'],
      cardWeightById: new Map([
        ['visible-small', 10],
        ['preload-oversize', 700_000],
        ['preload-small', 20],
        ['ahead-oversize', 800_000],
      ]),
      previousPassiveCardIds: new Set(['preload-oversize']),
      retentionCardIds: ['preload-oversize'],
      viewport: { x: 1, y: 0, zoom: 1 },
      previousViewport: { x: 0, y: 0, zoom: 1 },
    })
    expect({
      ids: [...noOversizePreload.passiveCardIds],
      weight: noOversizePreload.admittedTextWeight,
      oversizeIds: [...noOversizePreload.oversizePassiveCardIds],
    }).toEqual({
      ids: ['visible-small', 'preload-small'],
      weight: 30,
      oversizeIds: [],
    })

    const movementInput = {
      visibleCardIds: ['visible'],
      preloadCardIds: ['preload'],
      lookAheadCardIds: ['ahead'],
      cardWeightById: new Map([
        ['visible', 1],
        ['ahead', 1],
        ['preload', 1],
        ['linger', 1],
      ]),
      previousPassiveCardIds: new Set(['linger']),
      retentionCardIds: ['visible', 'linger'],
      passiveCardLimit: 3,
      viewport: { x: -400, y: 0, zoom: 1 },
    }
    const moving = planPassiveCardResidency({
      ...movementInput,
      previousViewport: { x: 0, y: 0, zoom: 1 },
    })
    const stationary = planPassiveCardResidency({
      ...movementInput,
      previousViewport: movementInput.viewport,
    })

    expect({ moving: [...moving.passiveCardIds], stationary: [...stationary.passiveCardIds] }).toEqual({
      moving: ['visible', 'ahead', 'preload'],
      stationary: ['visible', 'preload', 'linger'],
    })
  })
})
