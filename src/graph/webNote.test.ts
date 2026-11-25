import { beforeEach, describe, expect, it } from 'vitest'
import { useGraph } from './store'
import { gatherConnectedThought } from '../brain/compiler'
import { validateSavedBoardTransport } from '../persistence/profileLogicalProjection'
import type { Card } from './types'

const page = {
  title: 'What shipped in Electron 40',
  url: 'https://example.test/electron-40',
  markdown: '# Electron 40\n\nThe release notes, as markdown.',
  retrievedAt: '2026-08-16T02:00:00.000Z',
}

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    intentLog: [],
    compactionSummaries: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    hydrated: false,
    currentIdeaId: null,
  })
}

function cardById(id: string): Card {
  const card = useGraph.getState().cards.find((candidate) => candidate.id === id)
  if (!card) throw new Error(`no card ${id}`)
  return card
}

beforeEach(resetStore)

describe('a web page on the Board', () => {
  it('arrives as an ordinary Note that remembers where it came from', () => {
    const id = useGraph.getState().addWebNote(page, { x: 240, y: 120 })
    const card = cardById(id)

    // An ordinary Note: every connection, compaction, search and export path
    // already knows how to handle it. Only the provenance is new.
    expect(card.kind).toBe('note')
    expect(card.title).toBe(page.title)
    expect(card.blocks.map((block) => block.text).join('\n')).toBe(page.markdown)
    expect(card.source).toEqual({
      url: page.url,
      retrievedAt: page.retrievedAt,
      title: page.title,
    })
  })

  it('reads into an Ask AI Card as the page text, like any other Note', () => {
    const noteId = useGraph.getState().addWebNote(page, { x: 0, y: 0 })
    const askId = useGraph.getState().addCard('askAi', { x: 600, y: 0 })
    useGraph.getState().setCardText(askId, 'Summarise the release.')
    expect(useGraph.getState().addConnection(noteId, askId)).toBe(true)

    const compiled = gatherConnectedThought(useGraph.getState().snapshot(), askId)

    expect(compiled.text).toContain('The release notes, as markdown.')
    expect(compiled.usedCardIds).toContain(noteId)
  })

  it('lands as one undoable step, not a card plus a separate edit', () => {
    const id = useGraph.getState().addWebNote(page, { x: 0, y: 0 })
    expect(useGraph.getState().cards).toHaveLength(1)

    useGraph.getState().undo()

    expect(useGraph.getState().cards).toHaveLength(0)
    useGraph.getState().redo()
    expect(cardById(id).source?.url).toBe(page.url)
  })

  it('survives the persistence boundary with its provenance intact', () => {
    useGraph.getState().addWebNote(page, { x: 0, y: 0 })

    const board = JSON.parse(JSON.stringify(useGraph.getState().snapshot())) as unknown
    const restored = validateSavedBoardTransport(board)

    expect(restored.cards.find((card) => card.kind === 'note')?.source?.url).toBe(page.url)
  })
})

describe('a pasted address becoming its page', () => {
  function pasteAddress(): string {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(id, page.url)
    return id
  }

  it('replaces the address with the page and remembers where it came from', () => {
    const id = pasteAddress()

    expect(useGraph.getState().applyWebPage(id, page, page.url)).toBe(true)

    const card = cardById(id)
    expect(card.title).toBe(page.title)
    expect(card.blocks.map((block) => block.text).join('\n')).toBe(page.markdown)
    expect(card.source?.url).toBe(page.url)
  })

  it('leaves alone a Note the user has started typing into', () => {
    // The read can land seconds after the paste. A thought typed in between
    // outranks the page every time.
    const id = pasteAddress()
    useGraph.getState().setCardText(id, 'actually, my own note about this')

    expect(useGraph.getState().applyWebPage(id, page, page.url)).toBe(false)

    expect(cardById(id).blocks[0]!.text).toBe('actually, my own note about this')
    expect(cardById(id).source).toBeUndefined()
  })

  it('leaves alone a Note that is gone by the time the page arrives', () => {
    const id = pasteAddress()
    useGraph.getState().deleteCard(id)

    expect(useGraph.getState().applyWebPage(id, page, page.url)).toBe(false)
    expect(useGraph.getState().cards).toHaveLength(0)
  })

  it('can always be taken back, one press at a time', () => {
    // The page is its own undoable step. Undo hands back the address that was
    // pasted; undo again and the Card is gone. Nothing the user did becomes
    // unreachable because a read landed on top of it.
    const id = pasteAddress()
    useGraph.getState().applyWebPage(id, page, page.url)

    useGraph.getState().undo()
    expect(cardById(id).blocks[0]!.text).toBe(page.url)
    expect(cardById(id).source).toBeUndefined()

    while (useGraph.getState().undoStack.length) useGraph.getState().undo()
    expect(useGraph.getState().cards.some((card) => card.id === id)).toBe(false)
  })
})
