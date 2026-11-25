import { beforeEach, describe, expect, it } from 'vitest'
import type { Card } from './types'
import {
  ATTACHMENT_PANEL_HEIGHT_MIN,
  ATTACHMENT_PANELS_GROWN_SETTING,
  attachmentPanelGrowth,
} from './attachmentPanelGrowth'
import { useGraph } from './store'

function note(overrides: Partial<Card> = {}): Card {
  return {
    id: 'note-1',
    kind: 'note',
    blocks: [{ id: 'note-1-block', text: 'A note with a link in it.' }],
    position: { x: 0, y: 0 },
    ...overrides,
  } as Card
}

function noteInStore(overrides: Partial<Card> = {}) {
  useGraph.setState({ cards: [note(overrides)] })
  return () => useGraph.getState().cards[0]
}

describe('attachment panel growth', () => {
  it('grows a fixed-height Card by one panel floor, once per panel and never per tile', () => {
    const start = { width: 320, height: 400 }
    const first = attachmentPanelGrowth(note({ size: start }), ['previews'])
    expect(first?.size).toEqual({ width: 320, height: 400 + ATTACHMENT_PANEL_HEIGHT_MIN })

    // The same Card, now carrying the marker the first growth wrote and a
    // second link preview in the same track. A second tile is not a second
    // panel, so it buys no height.
    const grown = note({ size: first!.size, meta: first!.meta })
    expect(attachmentPanelGrowth(grown, ['previews'])).toBeNull()

    // A first image is a second PANEL, so it does earn its own floor.
    const withImages = attachmentPanelGrowth(grown, ['images', 'previews'])
    expect(withImages?.size).toEqual({
      width: 320,
      height: 400 + 2 * ATTACHMENT_PANEL_HEIGHT_MIN,
    })
    expect(attachmentPanelGrowth(
      note({ size: withImages!.size, meta: withImages!.meta }),
      ['images', 'previews'],
    )).toBeNull()
  })

  it('marks an auto-height Card without giving it a height it never had', () => {
    // An auto-height Card measures itself from its content and already grows by
    // the panel it appended. Writing a height here would freeze it.
    const growth = attachmentPanelGrowth(note(), ['previews'])
    expect(growth?.size).toBeUndefined()
    expect(growth?.meta).toMatchObject({ [ATTACHMENT_PANELS_GROWN_SETTING.key]: ['previews'] })
    // The marker still counts, so the height adopted from that rendered Card
    // later is not grown a second time for the same panel.
    expect(attachmentPanelGrowth(note({ meta: growth!.meta, size: { width: 320, height: 520 } }), ['previews']))
      .toBeNull()
  })

  it('records a panel the Note mounted with, and does not resize a Card the founder already lived with', () => {
    const start = { width: 320, height: 400 }
    const mounted = attachmentPanelGrowth(note({ size: start }), ['previews'], 'already-there')
    expect(mounted?.size).toBeUndefined()
    expect(mounted?.meta).toMatchObject({ [ATTACHMENT_PANELS_GROWN_SETTING.key]: ['previews'] })

    // Recorded means paid: the same panel never earns height later either.
    expect(attachmentPanelGrowth(note({ size: start, meta: mounted!.meta }), ['previews']))
      .toBeNull()
  })

  it('pays only for panels the Card is actually showing', () => {
    const growth = attachmentPanelGrowth(note({ size: { width: 320, height: 400 } }), ['images'])
    expect(growth?.meta).toMatchObject({ [ATTACHMENT_PANELS_GROWN_SETTING.key]: ['images'] })
    // Previews were never present, so nothing about them was marked and the
    // first preview to arrive still earns its own growth.
    const next = attachmentPanelGrowth(
      note({ size: growth!.size, meta: growth!.meta }),
      ['images', 'previews'],
    )
    expect(next?.size?.height).toBe(400 + 2 * ATTACHMENT_PANEL_HEIGHT_MIN)
  })
})

describe('growCardForAttachmentPanels', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      undoStack: [],
      redoStack: [],
    })
  })

  it('grows the Card once and never again, however many times the Note re-renders', () => {
    const current = noteInStore({ size: { width: 320, height: 400 } })

    useGraph.getState().growCardForAttachmentPanels('note-1', ['previews'])
    expect(current().size?.height).toBe(400 + ATTACHMENT_PANEL_HEIGHT_MIN)

    // Every re-render of the Note asks again. This is the whole defect risk:
    // ask ten more times and the Card must not move a pixel.
    for (let ask = 0; ask < 10; ask += 1) {
      useGraph.getState().growCardForAttachmentPanels('note-1', ['previews'])
    }
    expect(current().size?.height).toBe(400 + ATTACHMENT_PANEL_HEIGHT_MIN)
  })

  it('does not grow again when the same Note comes back from a save file', () => {
    const current = noteInStore({ size: { width: 320, height: 400 } })
    useGraph.getState().growCardForAttachmentPanels('note-1', ['previews'], 'arrived')
    const saved = current()
    expect(saved.size?.height).toBe(400 + ATTACHMENT_PANEL_HEIGHT_MIN)

    // A reload: the Card comes back exactly as it went to disk, through a JSON
    // round trip so nothing survives in memory that a real save would not have
    // carried, and the Note mounts and asks for its growth again.
    useGraph.setState({ cards: [JSON.parse(JSON.stringify(saved)) as Card] })
    // The remounted Note reports its panels as already there, and then asks
    // again on every later render as an arrival. Neither moves it.
    useGraph.getState().growCardForAttachmentPanels('note-1', ['previews'], 'already-there')
    useGraph.getState().growCardForAttachmentPanels('note-1', ['previews'], 'arrived')

    expect(useGraph.getState().cards[0].size?.height).toBe(400 + ATTACHMENT_PANEL_HEIGHT_MIN)
  })

  it('leaves no undo entry and claims no authorship, because it is neither an edit nor a resize', () => {
    // Growth answers what the Card is showing. It is not something the founder
    // did, so undoing the paste that brought the link must undo the paste; and
    // it is not authorship, so an Agent-created Card is not restamped as
    // user-modified for a height nobody chose.
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const current = noteInStore({
      size: { width: 320, height: 400 },
      createdBy: agent,
      lastModifiedBy: agent,
    })
    const undoDepth = useGraph.getState().undoStack.length

    useGraph.getState().growCardForAttachmentPanels('note-1', ['previews'])

    expect(current().size?.height).toBe(400 + ATTACHMENT_PANEL_HEIGHT_MIN)
    expect(useGraph.getState().undoStack.length).toBe(undoDepth)
    expect(current().lastModifiedBy).toMatchObject({ kind: 'agent' })
  })
})
