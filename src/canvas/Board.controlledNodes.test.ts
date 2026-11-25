// @vitest-environment jsdom

import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { render, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { Card } from '../graph/types'
import { renderLayer, type MountPlan } from './boardScene'
import { allNodeTypes, useControlledBoardNodes } from './Board'

const note = (id: string, x: number): Card =>
  ({
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    position: { x, y: 0 },
  })

const EMPTY_IDS = new Set<string>()

function plan({
  mountedCards,
  proxyCardIds = new Set<string>(),
  liveCardIds = EMPTY_IDS,
}: {
  mountedCards: readonly Card[]
  proxyCardIds?: ReadonlySet<string>
  liveCardIds?: ReadonlySet<string>
}): MountPlan {
  return {
    mountedCards,
    proxyCardIds,
    liveCardIds,
    excludedParticipantIds: EMPTY_IDS,
    paintOccludingCardIds: EMPTY_IDS,
    overviewSuppressedCardIds: EMPTY_IDS,
  }
}

describe('Board controlled nodes', () => {
  it('names mounted Card groups with selection state and keeps gesture proxies outside keyboard and AT traversal', () => {
    const source = note('source thought', 0)
    const target = note('target thought', 320)
    const cardsById = new Map([source, target].map((card) => [card.id, card]))
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 1 },
      measuredCardSizesById: new Map(),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
      selectedNodeIds: new Set([source.id]),
    }
    const { result } = renderHook(() => useControlledBoardNodes({
      ...stable,
      mountPlan: plan({ mountedCards: [source, target], proxyCardIds: new Set([target.id]) }),
    }))

    expect(result.current[0]).toMatchObject({
      id: source.id,
      ariaRole: 'group',
      ariaLabel: 'Note: source thought, Selected',
      focusable: true,
      domAttributes: { 'aria-roledescription': 'Card' },
    })
    expect(result.current[1]).toMatchObject({
      id: target.id,
      ariaRole: undefined,
      ariaLabel: undefined,
      focusable: false,
      domAttributes: { 'aria-hidden': true },
    })
  })

  it('keeps the same rich Card component when live ownership changes', () => {
    const source = note('source', 0)
    const mountedCards = [source]
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      measuredCardSizesById: new Map(),
      readOnly: false,
      cardById: (cardId: string) => cardId === source.id ? source : undefined,
      selectedNodeIds: EMPTY_IDS,
    }
    const { result, rerender } = renderHook(
      ({ mountPlan }) => useControlledBoardNodes({ ...stable, mountPlan }),
      { initialProps: { mountPlan: plan({ mountedCards }) } },
    )
    const residentNodes = result.current

    rerender({ mountPlan: plan({ mountedCards, liveCardIds: new Set([source.id]) }) })

    expect(result.current).toBe(residentNodes)
    expect(result.current.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'source', type: 'note' },
    ])
  })

  it('keeps graph-layer order stable when residency priority reorders mounted Cards', () => {
    const source = { ...note('source', 0), zIndex: 7 }
    const target = { ...note('target', 320), zIndex: 7 }
    const cardsById = new Map([source, target].map((card) => [card.id, card]))
    const cardOrderById = new Map([[source.id, 0], [target.id, 1]])
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      measuredCardSizesById: new Map(),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
      cardOrder: (cardId: string) => cardOrderById.get(cardId),
      selectedNodeIds: EMPTY_IDS,
    }
    const { result, rerender } = renderHook(
      ({ mountedCards }) => useControlledBoardNodes({
        ...stable,
        mountPlan: plan({ mountedCards }),
      }),
      { initialProps: { mountedCards: [source, target] } },
    )
    const graphOrderedNodes = result.current

    rerender({ mountedCards: [target, source] })

    expect(result.current).toBe(graphOrderedNodes)
    expect(result.current.map((node) => node.id)).toEqual([source.id, target.id])
  })

  it('uses graph order when distinct Group layers clamp to the same rendered layer', () => {
    const source: Card = { ...note('source-group', 0), kind: 'group', zIndex: 95 }
    const target: Card = { ...note('target-group', 320), kind: 'group', zIndex: 120 }
    const cardsById = new Map([source, target].map((card) => [card.id, card]))
    const cardOrderById = new Map([[source.id, 0], [target.id, 1]])
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      measuredCardSizesById: new Map(),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
      cardOrder: (cardId: string) => cardOrderById.get(cardId),
      selectedNodeIds: EMPTY_IDS,
    }
    const { result, rerender } = renderHook(
      ({ mountedCards }) => useControlledBoardNodes({
        ...stable,
        mountPlan: plan({ mountedCards }),
      }),
      { initialProps: { mountedCards: [source, target] } },
    )
    const graphOrderedNodes = result.current

    rerender({ mountedCards: [target, source] })

    expect(result.current).toBe(graphOrderedNodes)
    expect(result.current.map((node) => node.id)).toEqual([source.id, target.id])
    expect([renderLayer(source, 0), renderLayer(target, 1)]).toEqual([-10, -10])
  })

  it('marks only the Card whose S/O to Live handoff is still loading', () => {
    const source = note('source', 0)
    const target = note('target', 320)
    const cardsById = new Map([source, target].map((card) => [card.id, card]))
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 1 },
      measuredCardSizesById: new Map(),
      mountPlan: plan({ mountedCards: [source, target] }),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
      selectedNodeIds: new Set([target.id]),
    }
    const { result, rerender } = renderHook(
      ({ liveTransitionCardIds }) => useControlledBoardNodes({
        ...stable,
        liveTransitionCardIds,
      }),
      { initialProps: { liveTransitionCardIds: new Set([target.id]) } },
    )

    expect(result.current.find((node) => node.id === source.id)?.domAttributes)
      .not.toHaveProperty('data-live-transition')
    expect(result.current.find((node) => node.id === target.id)?.domAttributes)
      .toMatchObject({ 'data-live-transition': 'loading' })

    rerender({ liveTransitionCardIds: EMPTY_IDS })
    expect(result.current.find((node) => node.id === target.id)?.domAttributes)
      .not.toHaveProperty('data-live-transition')
  })

  it('publishes visual selection before swapping the outgoing and incoming editor authority', () => {
    const outgoing = note('outgoing', 0)
    const incoming = note('incoming', 320)
    const cardsById = new Map([outgoing, incoming].map((card) => [card.id, card]))
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 1 },
      measuredCardSizesById: new Map(),
      mountPlan: plan({ mountedCards: [outgoing, incoming] }),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
    }
    const { result, rerender } = renderHook(
      ({ selectedNodeIds, interactionSelectedNodeIds }) => useControlledBoardNodes({
        ...stable,
        selectedNodeIds,
        interactionSelectedNodeIds,
      }),
      { initialProps: {
        selectedNodeIds: new Set([outgoing.id]),
        interactionSelectedNodeIds: new Set([outgoing.id]),
      } },
    )
    const before = new Map(result.current.map((node) => [node.id, node]))
    const outgoingData = before.get(outgoing.id)!.data
    const incomingData = before.get(incoming.id)!.data

    // Immediate visual handoff: only the shallow wrapper selection changes.
    rerender({
      selectedNodeIds: new Set([incoming.id]),
      interactionSelectedNodeIds: new Set([outgoing.id]),
    })
    expect(result.current.find((node) => node.id === outgoing.id)).toMatchObject({
      selected: false,
      data: { selectedCardCount: 1, semanticSelected: true },
    })
    expect(result.current.find((node) => node.id === outgoing.id)?.data).toBe(outgoingData)
    expect(result.current.find((node) => node.id === incoming.id)).toMatchObject({
      selected: true,
      data: { selectedCardCount: 0, semanticSelected: false },
    })
    expect(result.current.find((node) => node.id === incoming.id)?.data).toBe(incomingData)

    // After the paint barrier, semantic selection/editor authority swaps.
    rerender({
      selectedNodeIds: new Set([incoming.id]),
      interactionSelectedNodeIds: new Set([incoming.id]),
    })
    expect(result.current.find((node) => node.id === outgoing.id)?.data).not.toBe(outgoingData)
    expect(result.current.find((node) => node.id === incoming.id)?.data).not.toBe(incomingData)
    expect(result.current.find((node) => node.id === incoming.id)?.data).toMatchObject({
      selectedCardCount: 1,
      semanticSelected: true,
    })
  })

  it('owns Reading crossfade opacity on the shallow controlled node', () => {
    const source = note('source', 0)
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      measuredCardSizesById: new Map(),
      mountPlan: plan({ mountedCards: [source] }),
      readOnly: false,
      cardById: (cardId: string) => cardId === source.id ? source : undefined,
      selectedNodeIds: EMPTY_IDS,
    }
    const { result, rerender } = renderHook(
      ({ readingOpacity }) => useControlledBoardNodes({ ...stable, readingOpacity }),
      { initialProps: { readingOpacity: 0.35 } },
    )

    expect(result.current[0]?.style).toMatchObject({ opacity: 0.35 })
    expect(result.current[0]?.style).not.toHaveProperty('--e-reading-card-opacity')

    rerender({ readingOpacity: 0.8 })
    expect(result.current[0]?.style).toMatchObject({ opacity: 0.8 })
  })

  it('reuses every unrelated controlled Node across one immutable Card move', () => {
    const source = note('source', 0)
    const target = note('target', 320)
    const peer = note('peer', 640)
    const cardsById = new Map([source, target, peer].map((card) => [card.id, card]))
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      measuredCardSizesById: new Map(),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
      selectedNodeIds: EMPTY_IDS,
    }
    const { result, rerender } = renderHook(
      ({ mountedCards }) => useControlledBoardNodes({
        ...stable,
        mountPlan: plan({ mountedCards }),
      }),
      { initialProps: { mountedCards: [source, target, peer] } },
    )
    const before = new Map(result.current.map((node) => [node.id, node]))
    const movedTarget = { ...target, position: { x: 430, y: 70 } }
    cardsById.set(target.id, movedTarget)

    rerender({ mountedCards: [source, movedTarget, peer] })

    expect(result.current.find((node) => node.id === source.id)).toBe(before.get(source.id))
    expect(result.current.find((node) => node.id === target.id)).not.toBe(before.get(target.id))
    expect(result.current.find((node) => node.id === peer.id)).toBe(before.get(peer.id))
  })

  it('keeps live node data stable within one Idea and changes it across same-id Idea scope', () => {
    const source = note('same-id', 0)
    let currentCard = source
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      measuredCardSizesById: new Map(),
      readOnly: false,
      cardById: () => currentCard,
      selectedNodeIds: EMPTY_IDS,
    }
    const { result, rerender } = renderHook(
      ({ card, semanticScopeId }) => useControlledBoardNodes({
        ...stable,
        mountPlan: plan({ mountedCards: [card] }),
        semanticScopeId,
      }),
      { initialProps: { card: source, semanticScopeId: 'idea-a' } },
    )
    const ideaANode = result.current[0]!

    currentCard = { ...source, position: { x: 80, y: 40 } }
    rerender({ card: currentCard, semanticScopeId: 'idea-a' })
    expect(result.current[0]).not.toBe(ideaANode)
    expect(result.current[0]!.data).toBe(ideaANode.data)

    const movedIdeaANode = result.current[0]!
    rerender({ card: currentCard, semanticScopeId: 'idea-b' })
    expect(result.current[0]).not.toBe(movedIdeaANode)
    expect(result.current[0]!.data).not.toBe(movedIdeaANode.data)
    expect(result.current[0]!.data).toMatchObject({
      semanticScopeKey: expect.stringContaining('idea-b'),
    })
  })

  it('keeps a million-text Playback body cold for position and stacking replacements', () => {
    const millionText = 'x'.repeat(1_000_000)
    let bodyReads = 0
    const trackedBlock = {
      id: 'stress-block',
      get text() {
        bodyReads += 1
        return millionText
      },
    }
    const source: Card = {
      id: 'playback-stress',
      kind: 'note',
      blocks: [trackedBlock],
      position: { x: 0, y: 0 },
      zIndex: 1,
    }
    const observedNodes: import('@xyflow/react').Node[] = []
    const latestObservedNode = () => observedNodes[observedNodes.length - 1]!
    const Playback = allNodeTypes.playbackCard

    function Harness({ card, semanticScopeId }: { card: Card; semanticScopeId: string }) {
      const nodes = useControlledBoardNodes({
        activeTool: 'select',
        ghostCardIds: EMPTY_IDS,
        liveCardClassName: () => undefined,
        liveNodeData: { selectedCardCount: 0 },
        measuredCardSizesById: new Map(),
        mountPlan: plan({ mountedCards: [card] }),
        readOnly: true,
        semanticScopeId,
        cardById: () => card,
        selectedNodeIds: EMPTY_IDS,
      })
      observedNodes.push(nodes[0]!)
      return createElement(Playback, nodes[0] as unknown as NodeProps)
    }

    const playbackHarness = (card: Card, semanticScopeId: string) => createElement(
      ReactFlowProvider,
      null,
      createElement(Harness, { card, semanticScopeId }),
    )
    const view = render(playbackHarness(source, 'idea-a'))
    expect(view.container.querySelector('.playback-card-text')?.textContent).toHaveLength(1_000_000)
    const initialReads = bodyReads
    const initialNode = latestObservedNode()
    const initialData = initialNode.data

    const moved = { ...source, position: { x: 480, y: 240 } }
    view.rerender(playbackHarness(moved, 'idea-a'))
    const movedNode = latestObservedNode()
    expect(movedNode).not.toBe(initialNode)
    expect(movedNode.data).toBe(initialData)
    expect(bodyReads).toBe(initialReads)

    const restacked = { ...moved, zIndex: 9 }
    view.rerender(playbackHarness(restacked, 'idea-a'))
    const restackedNode = latestObservedNode()
    expect(restackedNode).not.toBe(movedNode)
    expect(restackedNode.data).toBe(initialData)
    expect(bodyReads).toBe(initialReads)

    view.rerender(playbackHarness(restacked, 'idea-b'))
    const ideaBNode = latestObservedNode()
    expect(ideaBNode.data).not.toBe(initialData)
    expect(bodyReads).toBeGreaterThan(initialReads)

    let changedBodyReads = 0
    const changed: Card = {
      ...restacked,
      blocks: [{
        id: 'stress-block',
        get text() {
          changedBodyReads += 1
          return `${millionText}!`
        },
      }],
    }
    const ideaBData = ideaBNode.data
    view.rerender(playbackHarness(changed, 'idea-b'))
    expect(latestObservedNode().data).not.toBe(ideaBData)
    expect(changedBodyReads).toBeGreaterThan(0)
    expect(view.container.querySelector('.playback-card-text')?.textContent).toHaveLength(1_000_001)
  })

  it('replaces only selected controlled Nodes when selection cardinality changes', () => {
    const source = note('source', 0)
    const target = note('target', 320)
    const peer = note('peer', 640)
    const mountedCards = [source, target, peer]
    const cardsById = new Map(mountedCards.map((card) => [card.id, card]))
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      measuredCardSizesById: new Map(),
      mountPlan: plan({ mountedCards }),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
    }
    const { result, rerender } = renderHook(
      ({ selectedNodeIds, selectedCardCount }) => useControlledBoardNodes({
        ...stable,
        liveNodeData: { selectedCardCount },
        selectedNodeIds,
      }),
      {
        initialProps: {
          selectedNodeIds: new Set([source.id]),
          selectedCardCount: 1,
        },
      },
    )
    const before = new Map(result.current.map((node) => [node.id, node]))

    rerender({
      selectedNodeIds: new Set([source.id, target.id]),
      selectedCardCount: 2,
    })

    expect(result.current.find((node) => node.id === source.id)).not.toBe(before.get(source.id))
    expect(result.current.find((node) => node.id === target.id)).not.toBe(before.get(target.id))
    expect(result.current.find((node) => node.id === peer.id)).toBe(before.get(peer.id))
    expect(result.current.find((node) => node.id === peer.id)?.data).toMatchObject({
      selectedCardCount: 0,
    })
  })

  it('shares content-only edits and replaces only projected semantic, style, selection, or Reading changes', () => {
    const source = note('source', 0)
    const target = { ...note('target', 320), title: 'Target title' }
    const proxy = note('proxy', 640)
    const cardsById = new Map([source, target, proxy].map((card) => [card.id, card]))
    const proxyCardIds = new Set([proxy.id])
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      measuredCardSizesById: new Map(),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
    }
    const initialProps = {
      mountedCards: [source, target, proxy],
      selectedNodeIds: EMPTY_IDS,
      readingOpacity: 0.4,
      cardGrowthMaxHeightsById: new Map<string, number>(),
    }
    const { result, rerender } = renderHook(
      ({ mountedCards, selectedNodeIds, readingOpacity, cardGrowthMaxHeightsById }) =>
        useControlledBoardNodes({
          ...stable,
          mountPlan: plan({ mountedCards, proxyCardIds }),
          selectedNodeIds,
          readingOpacity,
          cardGrowthMaxHeightsById,
        }),
      { initialProps },
    )
    const identities = () => new Map(result.current.map((node) => [node.id, node]))

    let before = identities()
    const editedTarget = {
      ...target,
      blocks: [{ id: 'target-block', text: 'Edited body, same node projection' }],
    }
    cardsById.set(target.id, editedTarget)
    rerender({ ...initialProps, mountedCards: [source, editedTarget, proxy] })
    expect(result.current.find((node) => node.id === source.id)).toBe(before.get(source.id))
    expect(result.current.find((node) => node.id === target.id)).toBe(before.get(target.id))
    expect(result.current.find((node) => node.id === proxy.id)).toBe(before.get(proxy.id))

    before = identities()
    const renamedTarget = { ...editedTarget, title: 'Renamed target' }
    cardsById.set(target.id, renamedTarget)
    rerender({ ...initialProps, mountedCards: [source, renamedTarget, proxy] })
    expect(result.current.find((node) => node.id === source.id)).toBe(before.get(source.id))
    expect(result.current.find((node) => node.id === target.id)).not.toBe(before.get(target.id))
    expect(result.current.find((node) => node.id === proxy.id)).toBe(before.get(proxy.id))

    before = identities()
    const growth = new Map([[target.id, 480]])
    rerender({
      ...initialProps,
      mountedCards: [source, renamedTarget, proxy],
      cardGrowthMaxHeightsById: growth,
    })
    expect(result.current.find((node) => node.id === source.id)).toBe(before.get(source.id))
    expect(result.current.find((node) => node.id === target.id)).not.toBe(before.get(target.id))
    expect(result.current.find((node) => node.id === proxy.id)).toBe(before.get(proxy.id))

    before = identities()
    const selectedNodeIds = new Set([target.id])
    rerender({
      ...initialProps,
      mountedCards: [source, renamedTarget, proxy],
      cardGrowthMaxHeightsById: growth,
      selectedNodeIds,
    })
    expect(result.current.find((node) => node.id === source.id)).toBe(before.get(source.id))
    expect(result.current.find((node) => node.id === target.id)).not.toBe(before.get(target.id))
    expect(result.current.find((node) => node.id === proxy.id)).toBe(before.get(proxy.id))

    before = identities()
    rerender({
      ...initialProps,
      mountedCards: [source, renamedTarget, proxy],
      cardGrowthMaxHeightsById: growth,
      selectedNodeIds,
      readingOpacity: 0.8,
    })
    expect(result.current.find((node) => node.id === source.id)).not.toBe(before.get(source.id))
    expect(result.current.find((node) => node.id === target.id)).not.toBe(before.get(target.id))
    expect(result.current.find((node) => node.id === proxy.id)).toBe(before.get(proxy.id))
  })

  it('keys the real controlled-node path only on mounted Cards and normalized proxy membership', () => {
    const source = note('source', 0)
    const target = note('target', 320)
    const sourceOnly = [source]
    const sourceAndTarget = [source, target]
    const cardsById = new Map(sourceAndTarget.map((card) => [card.id, card]))
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      measuredCardSizesById: new Map(),
      readOnly: false,
      cardById: (cardId: string) => cardsById.get(cardId),
      selectedNodeIds: EMPTY_IDS,
    }
    const { result, rerender } = renderHook(
      ({ mountPlan }) => useControlledBoardNodes({ ...stable, mountPlan }),
      { initialProps: { mountPlan: plan({ mountedCards: sourceOnly }) } },
    )
    const initialNodes = result.current
    expect(initialNodes.map(({ id, type }) => ({ id, type }))).toEqual([{ id: 'source', type: 'note' }])

    // Source activation, connect-start/live ownership, and target hover all
    // replace hot plan metadata. None changes either node-driving collection;
    // each also supplies a fresh empty proxy identity to pin normalization.
    rerender({ mountPlan: plan({ mountedCards: sourceOnly, liveCardIds: new Set(['source']) }) })
    expect(result.current).toBe(initialNodes)
    rerender({ mountPlan: plan({ mountedCards: sourceOnly, liveCardIds: new Set(['source']) }) })
    expect(result.current).toBe(initialNodes)
    rerender({ mountPlan: plan({ mountedCards: sourceOnly, liveCardIds: new Set(['source', 'target']) }) })
    expect(result.current).toBe(initialNodes)

    rerender({ mountPlan: plan({ mountedCards: sourceAndTarget }) })
    const mountedTargetNodes = result.current
    expect(mountedTargetNodes).not.toBe(initialNodes)
    expect(mountedTargetNodes.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'source', type: 'note' },
      { id: 'target', type: 'note' },
    ])

    rerender({ mountPlan: plan({ mountedCards: sourceAndTarget, proxyCardIds: new Set(['target']) }) })
    expect(result.current).not.toBe(mountedTargetNodes)
    expect(result.current.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'source', type: 'note' },
      { id: 'target', type: 'gestureProxy' },
    ])
  })

  it('carries the latest measured footprint across controlled Card replacements', () => {
    const source = note('source', 0)
    const sourceOnly = [source]
    const resizedSource = { ...source, size: { width: 320, height: 180 } }
    let liveSource = source
    const initialMeasurements = new Map([
      [source.id, { width: 260, height: 140 }],
    ])
    const stable = {
      activeTool: 'select' as const,
      ghostCardIds: EMPTY_IDS,
      liveCardClassName: () => undefined,
      liveNodeData: { selectedCardCount: 0 },
      readOnly: false,
      cardById: (cardId: string) => cardId === source.id ? liveSource : undefined,
      selectedNodeIds: EMPTY_IDS,
    }
    const { result, rerender } = renderHook(
      ({ mountPlan, measuredCardSizesById }) => useControlledBoardNodes({
        ...stable,
        measuredCardSizesById,
        mountPlan,
      }),
      {
        initialProps: {
          measuredCardSizesById: initialMeasurements,
          mountPlan: plan({ mountedCards: sourceOnly }),
        },
      },
    )

    const initialNodes = result.current
    expect(result.current[0]?.measured).toEqual({ width: 260, height: 140 })

    // ResizeObserver-only updates must not churn the Reading-band node
    // collection. React Flow already owns that live internal measurement.
    const latestMeasurements = new Map([
      [source.id, { width: 270, height: 150 }],
    ])
    rerender({
      measuredCardSizesById: latestMeasurements,
      mountPlan: plan({ mountedCards: sourceOnly }),
    })
    expect(result.current).toBe(initialNodes)

    // The next real controlled-node replacement carries the latest footprint
    // into adoptUserNodes, preserving its handle bounds until RO catches up.
    liveSource = resizedSource
    rerender({
      measuredCardSizesById: latestMeasurements,
      mountPlan: plan({ mountedCards: [resizedSource] }),
    })

    expect(result.current[0]).toMatchObject({
      id: source.id,
      measured: { width: 270, height: 150 },
      style: { width: 320, height: 180 },
    })
  })
})
