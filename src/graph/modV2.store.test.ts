import { beforeEach, describe, expect, it } from 'vitest'
import { commitV2Mod } from '../mods/commit'
import { listModPartIdentities } from '../mods/identity'
import { createSeedMod } from '../mods/seeds'
import { isPatchUndoEntry } from './commitFunnel'
import { useGraph } from './store'
import type { Card } from './types'

function sliderCard(): Card {
  return {
    id: 'mod-slider',
    kind: 'mod',
    title: 'Slider',
    blocks: [],
    modV2: createSeedMod('slider', { createId: (_, ordinal) => `slider-part-${ordinal}` }),
    position: { x: 0, y: 0 },
  }
}

function resetStore() {
  useGraph.setState({
    cards: [sliderCard()],
    connections: [],
    outputs: [],
    runs: [],
    intentLog: [],
    lastBoardChange: null,
    boardChangeSeq: 0,
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    ideaManagerOpen: false,
  })
}

function committedSliderValue(): number {
  const mod = useGraph.getState().cards[0]?.modV2
  if (mod?.kind !== 'slider') throw new Error('Expected a committed slider')
  return mod.state.items[0]?.v ?? -1
}

describe('v2 Mod commits', () => {
  beforeEach(resetStore)

  it('replaces one detached Mod through one undoable commit', () => {
    const current = useGraph.getState().cards[0].modV2!
    const next = structuredClone(current)
    if (next.kind !== 'slider') throw new Error('Expected a slider fixture')
    next.state.items[0].v = 87

    expect(commitV2Mod(useGraph.getState(), 'mod-slider', next, 'Adjust slider')).toBe(true)

    const committed = useGraph.getState().cards[0].modV2!
    expect(committed).not.toBe(next)
    expect(committed.state).not.toBe(next.state)
    expect(committed.kind === 'slider' && committed.state.items[0].v).toBe(87)
    expect(useGraph.getState().undoStack).toHaveLength(1)
    const entry = useGraph.getState().undoStack[0]
    expect(isPatchUndoEntry(entry) && entry.label).toBe('Adjust slider')

    if (next.kind !== 'slider') throw new Error('Expected a slider fixture')
    next.state.items[0].v = 12
    expect(committedSliderValue()).toBe(87)

    useGraph.getState().undo()
    expect(committedSliderValue()).toBe(62)
    useGraph.getState().redo()
    expect(committedSliderValue()).toBe(87)
  })

  it('does not mint history for no-ops, wrong kinds, or non-v2 cards', () => {
    const current = useGraph.getState().cards[0].modV2!
    expect(commitV2Mod(useGraph.getState(), 'mod-slider', structuredClone(current), 'No change')).toBe(false)

    const dial = createSeedMod('dial', { createId: (_, ordinal) => `dial-part-${ordinal}` })
    expect(commitV2Mod(useGraph.getState(), 'mod-slider', dial, 'Wrong face')).toBe(false)

    expect(commitV2Mod(useGraph.getState(), 'missing', current, 'Missing card')).toBe(false)
    expect(useGraph.getState().undoStack).toHaveLength(0)
  })

  it('creates a directly-added Mod as a v2 slider seed', () => {
    useGraph.setState({ cards: [], undoStack: [], redoStack: [] })

    const id = useGraph.getState().addCard('mod', { x: 24, y: 48 })
    const created = useGraph.getState().graph().cardById(id)

    expect(created?.kind).toBe('mod')
    expect(created?.modV2?.kind).toBe('slider')
    expect(created).not.toHaveProperty('mod')
  })

  it('duplicates a v2 Mod with detached state and fresh nested identities', () => {
    const source = useGraph.getState().cards[0]
    const [duplicateId] = useGraph.getState().duplicateCard(source.id)
    const duplicate = useGraph.getState().graph().cardById(duplicateId)

    expect(duplicate?.modV2).toBeDefined()
    expect(duplicate?.modV2).not.toBe(source.modV2)
    expect(duplicate?.modV2?.state).not.toBe(source.modV2?.state)

    const sourcePartIds = new Set(listModPartIdentities(source.modV2!).map((part) => part.sourceId))
    const duplicatePartIds = listModPartIdentities(duplicate!.modV2!).map((part) => part.sourceId)
    expect(duplicatePartIds).not.toHaveLength(0)
    expect(duplicatePartIds.every((id) => !sourcePartIds.has(id))).toBe(true)
  })
})
