// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../../graph/store'
import type { Card } from '../../graph/types'
import { CardShell } from './CardShell'

const INITIAL_CARD: Card = {
  id: 'resize-note',
  kind: 'note',
  blocks: [{ id: 'resize-note-block', text: 'Resize me' }],
  position: { x: 100, y: 80 },
  size: { width: 260, height: 160 },
}

const NATURAL_CARD: Card = {
  ...INITIAL_CARD,
  id: 'natural-resize-note',
  size: undefined,
}

const GROUP_CARD: Card = {
  id: 'resize-group',
  kind: 'group',
  blocks: [{ id: 'resize-group-block', text: '' }],
  position: { x: 100, y: 80 },
  size: { width: 320, height: 220 },
}

const GROUP_MEMBER: Card = {
  id: 'resize-group-member',
  kind: 'note',
  blocks: [{ id: 'resize-group-member-block', text: 'Stay put' }],
  position: { x: 160, y: 140 },
  size: { width: 200, height: 120 },
  groupId: GROUP_CARD.id,
}

function resetStore(cards: Card[] = [INITIAL_CARD], selectedCardIds = [cards[0]!.id]) {
  useGraph.setState({
    cards,
    connections: [],
    outputs: [],
    runs: [],
    compactionSummaries: [],
    intentLog: [],
    highlights: [],
    highlightTags: [],
    selection: null,
    selectedCardIds,
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    activeTool: 'select',
    lastBoardChange: null,
    boardChangeSeq: 0,
  })
}

function renderedCard(id = INITIAL_CARD.id) {
  return useGraph.getState().cards.find((card) => card.id === id)!
}

function ViewportZoom({ zoom }: { zoom: number }) {
  const store = useStoreApi()
  useLayoutEffect(() => {
    store.setState({ transform: [0, 0, zoom] })
  }, [store, zoom])
  return null
}

type ShellFixtureProps = {
  zoom?: number
  card?: Card
  data?: Record<string, unknown>
  selected?: boolean
}

function ShellFixture({
  zoom = 1,
  card = INITIAL_CARD,
  data = { selectedCardCount: 1 },
  selected = true,
}: ShellFixtureProps) {
  return (
    <ReactFlowProvider>
      <ViewportZoom zoom={zoom} />
      <CardShell
        id={card.id}
        kind={card.kind}
        selected={selected}
        data={data}
      >
        <div className="card-body">Resize body</div>
      </CardShell>
    </ReactFlowProvider>
  )
}

function renderShell(options: ShellFixtureProps = {}) {
  return render(<ShellFixture {...options} />)
}

function installFrameClock() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId
    nextId += 1
    callbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id)
  })
  return {
    flush() {
      const frame = [...callbacks.values()]
      callbacks.clear()
      act(() => frame.forEach((callback) => callback(performance.now())))
    },
  }
}

function handleFor(container: HTMLElement, selector: string) {
  const handle = container.querySelector<HTMLElement>(selector)
  expect(handle).not.toBeNull()
  let captured = false
  const setPointerCapture = vi.fn(() => {
    captured = true
  })
  const releasePointerCapture = vi.fn(() => {
    captured = false
  })
  Object.defineProperty(handle!, 'setPointerCapture', { configurable: true, value: setPointerCapture })
  Object.defineProperty(handle!, 'hasPointerCapture', { configurable: true, value: () => captured })
  Object.defineProperty(handle!, 'releasePointerCapture', {
    configurable: true,
    value: releasePointerCapture,
  })
  return { handle: handle!, setPointerCapture, releasePointerCapture }
}

describe('CardShell resize gesture ownership', () => {
  beforeEach(() => resetStore())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('leaves a natural-size card and its structural summaries untouched after a stationary press', () => {
    resetStore([NATURAL_CARD], [NATURAL_CARD.id])
    const reportCardResize = vi.fn()
    const reportCardResizePreview = vi.fn()
    const { container } = renderShell({
      card: NATURAL_CARD,
      data: {
        selectedCardCount: 1,
        onCardResize: reportCardResize,
        onCardResizePreview: reportCardResizePreview,
      },
    })
    const { handle } = handleFor(container, '.react-flow__resize-control.bottom.right')

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 11 })
    fireEvent.pointerUp(handle, { clientX: 200, clientY: 160, pointerId: 11 })

    expect(renderedCard(NATURAL_CARD.id).size).toBeUndefined()
    expect(reportCardResize).not.toHaveBeenCalled()
    expect(reportCardResizePreview.mock.calls.map((call) => call[1]?.type)).toEqual([
      'begin',
      'abort',
    ])
    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().intentLog).toHaveLength(0)
    expect(useGraph.getState().saveState).toBe('saved')
  })

  it('uses fixed-height shell geometry only while previewing a natural-size card', () => {
    const frame = installFrameClock()
    const reportCardResize = vi.fn()
    const reportCardResizePreview = vi.fn()
    resetStore([NATURAL_CARD], [NATURAL_CARD.id])
    const { container } = renderShell({
      card: NATURAL_CARD,
      data: {
        selectedCardCount: 1,
        onCardResize: reportCardResize,
        onCardResizePreview: reportCardResizePreview,
      },
    })
    const shell = container.querySelector<HTMLElement>('.card')!
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 260,
      bottom: 160,
      left: 0,
      width: 260,
      height: 160,
      toJSON: () => ({}),
    })
    const { handle } = handleFor(container, '.react-flow__resize-control.bottom.right')

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 12 })
    fireEvent.pointerMove(handle, { clientX: 240, clientY: 200, pointerId: 12 })
    frame.flush()

    expect(renderedCard(NATURAL_CARD.id).size).toBeUndefined()
    expect(shell.classList.contains('fixed-h')).toBe(true)
    expect(shell.style.width).toBe('300px')
    expect(shell.style.height).toBe('200px')
    expect(reportCardResize).not.toHaveBeenCalled()
    expect(
      reportCardResizePreview.mock.calls[
        reportCardResizePreview.mock.calls.length - 1
      ]?.slice(0, 2),
    ).toEqual([
      NATURAL_CARD.id,
      expect.objectContaining({
        type: 'preview',
        geometry: {
          position: NATURAL_CARD.position,
          size: { width: 300, height: 200 },
        },
      }),
    ])

    fireEvent.pointerUp(handle, { clientX: 240, clientY: 200, pointerId: 12 })
    expect(renderedCard(NATURAL_CARD.id).size).toEqual({ width: 300, height: 200 })
    expect(shell.classList.contains('fixed-h')).toBe(true)
    expect(shell.style.width).toBe('')
    expect(shell.style.height).toBe('100%')
    expect(shell.style.transform).toBe('')
    expect(reportCardResize).toHaveBeenCalledTimes(1)
    expect(
      reportCardResizePreview.mock.calls[
        reportCardResizePreview.mock.calls.length - 1
      ]?.slice(0, 2),
    ).toEqual([
      NATURAL_CARD.id,
      expect.objectContaining({
        type: 'commit',
        geometry: {
          position: NATURAL_CARD.position,
          size: { width: 300, height: 200 },
        },
      }),
    ])
    const lifecycle = reportCardResizePreview.mock.calls.map((call) => call[1])
    expect(lifecycle.map((event) => event.type)).toEqual(['begin', 'preview', 'commit'])
    expect(lifecycle[0]).toMatchObject({
      type: 'begin',
      geometry: { position: NATURAL_CARD.position, size: { width: 260, height: 160 } },
    })
    expect(typeof lifecycle[0].sessionId).toBe('number')
    expect(new Set(lifecycle.map((event) => event.sessionId))).toEqual(
      new Set([lifecycle[0].sessionId]),
    )
  })

  it('clears a local preview when selection loss unmounts only the resize handles', () => {
    const frame = installFrameClock()
    const reportCardResizePreview = vi.fn()
    const rendered = renderShell({
      data: { selectedCardCount: 1, onCardResizePreview: reportCardResizePreview },
    })
    const { handle, releasePointerCapture } = handleFor(
      rendered.container,
      '.react-flow__resize-control.bottom.right',
    )
    const shell = rendered.container.querySelector<HTMLElement>('.card')!

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 13 })
    fireEvent.pointerMove(handle, { clientX: 230, clientY: 200, pointerId: 13 })
    frame.flush()
    expect(shell.style.width).toBe('290px')
    expect(shell.style.height).toBe('200px')

    rendered.rerender(<ShellFixture selected={false} />)

    expect(renderedCard().size).toEqual({ width: 290, height: 200 })
    expect(rendered.container.querySelector('.card-resize-handle')).toBeNull()
    expect(shell.style.width).toBe('')
    expect(shell.style.height).toBe('100%')
    expect(shell.style.transform).toBe('')
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(reportCardResizePreview.mock.calls.map((call) => call[1]?.type)).toEqual([
      'begin',
      'preview',
      'commit',
    ])
  })

  it('allocates a distinct resize session token for a second gesture', () => {
    const frame = installFrameClock()
    const reportCardResizePreview = vi.fn()
    const { container } = renderShell({
      data: { selectedCardCount: 1, onCardResizePreview: reportCardResizePreview },
    })
    const { handle } = handleFor(container, '.react-flow__resize-control.bottom.right')

    fireEvent.pointerDown(handle, { button: 0, clientX: 260, clientY: 160, pointerId: 70 })
    fireEvent.pointerMove(handle, { clientX: 280, clientY: 180, pointerId: 70 })
    frame.flush()
    fireEvent.pointerUp(handle, { clientX: 280, clientY: 180, pointerId: 70 })

    fireEvent.pointerDown(handle, { button: 0, clientX: 280, clientY: 180, pointerId: 71 })
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 200, pointerId: 71 })
    frame.flush()
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 200, pointerId: 71 })

    const events = reportCardResizePreview.mock.calls.map((call) => call[1])
    expect(events.map((event) => event.type)).toEqual([
      'begin',
      'preview',
      'commit',
      'begin',
      'preview',
      'commit',
    ])
    const firstToken = events[0].sessionId
    const secondToken = events[3].sessionId
    expect(typeof firstToken).toBe('number')
    expect(typeof secondToken).toBe('number')
    expect(secondToken).not.toBe(firstToken)
    expect(new Set(events.slice(0, 3).map((event) => event.sessionId))).toEqual(
      new Set([firstToken]),
    )
    expect(new Set(events.slice(3).map((event) => event.sessionId))).toEqual(
      new Set([secondToken]),
    )
  })

  it('drops the preview without history or reporting when the live card disappears', () => {
    const frame = installFrameClock()
    const reportCardResize = vi.fn()
    const reportCardResizePreview = vi.fn()
    const { container } = renderShell({
      data: {
        selectedCardCount: 1,
        onCardResize: reportCardResize,
        onCardResizePreview: reportCardResizePreview,
      },
    })
    const { handle, releasePointerCapture } = handleFor(
      container,
      '.react-flow__resize-control.bottom.right',
    )
    const shell = container.querySelector<HTMLElement>('.card')!

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 14 })
    fireEvent.pointerMove(handle, { clientX: 230, clientY: 200, pointerId: 14 })
    frame.flush()
    act(() => useGraph.setState({ cards: [] }))
    fireEvent.pointerUp(handle, { clientX: 230, clientY: 200, pointerId: 14 })

    expect(useGraph.getState().cards).toEqual([])
    expect(shell.style.width).toBe('')
    expect(shell.style.transform).toBe('')
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(reportCardResize).not.toHaveBeenCalled()
    expect(reportCardResizePreview.mock.calls.map((call) => call[1]?.type)).toEqual([
      'begin',
      'preview',
      'abort',
    ])
    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().intentLog).toHaveLength(0)
  })

  it('keeps a travelled gesture history-free when it returns to its start geometry', () => {
    const frame = installFrameClock()
    const reportCardResize = vi.fn()
    const reportCardResizePreview = vi.fn()
    const { container } = renderShell({
      data: {
        selectedCardCount: 1,
        onCardResize: reportCardResize,
        onCardResizePreview: reportCardResizePreview,
      },
    })
    const { handle } = handleFor(container, '.react-flow__resize-control.bottom.right')

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 15 })
    fireEvent.pointerMove(handle, { clientX: 240, clientY: 200, pointerId: 15 })
    frame.flush()
    fireEvent.pointerMove(handle, { clientX: 200, clientY: 160, pointerId: 15 })
    fireEvent.pointerUp(handle, { clientX: 200, clientY: 160, pointerId: 15 })

    expect(renderedCard()).toMatchObject(INITIAL_CARD)
    expect(reportCardResize).not.toHaveBeenCalled()
    expect(reportCardResizePreview.mock.calls.map((call) => call[1]?.type)).toEqual([
      'begin',
      'preview',
      'abort',
    ])
    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().intentLog).toHaveLength(0)
  })

  it('keeps a top-left resize in one history entry and restores position plus size with one undo', () => {
    const frame = installFrameClock()
    const { container } = renderShell()
    const { handle, setPointerCapture } = handleFor(container, '.react-flow__resize-control.top.left')
    const shell = container.querySelector<HTMLElement>('.card')!

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 17 })
    fireEvent.pointerMove(handle, { clientX: 160, clientY: 130, pointerId: 17 })
    frame.flush()

    expect(setPointerCapture).toHaveBeenCalledWith(17)
    expect(renderedCard()).toMatchObject(INITIAL_CARD)
    expect(shell.style.width).toBe('300px')
    expect(shell.style.height).toBe('190px')
    expect(shell.style.transform).toBe('translate(-40px, -30px)')
    const resizeReadout = screen.getByRole('status')
    expect(resizeReadout.textContent).toBe('300 × 190')
    expect(resizeReadout.classList.contains('t-value')).toBe(true)

    fireEvent.pointerUp(handle, { clientX: 160, clientY: 130, pointerId: 17 })

    expect(screen.queryByRole('status')).toBeNull()
    expect(renderedCard()).toMatchObject({
      position: { x: 60, y: 50 },
      size: { width: 300, height: 190 },
    })
    expect(useGraph.getState().undoStack).toHaveLength(1)
    useGraph.getState().undo()
    expect(renderedCard()).toMatchObject({
      position: INITIAL_CARD.position,
      size: INITIAL_CARD.size,
    })
  })

  it.each([
    ['top left', '.top.left', { x: -40, y: -40 }, { x: 80, y: 60 }],
    ['top right', '.top.right', { x: 40, y: -40 }, { x: 100, y: 60 }],
    ['bottom left', '.bottom.left', { x: -40, y: 40 }, { x: 80, y: 80 }],
    ['bottom right', '.bottom.right', { x: 40, y: 40 }, { x: 100, y: 80 }],
  ] as const)(
    'tracks the %s corner through pointer capture at 2× zoom',
    (_label, selector, screenDelta, expectedPosition) => {
      const frame = installFrameClock()
      const { container } = renderShell({ zoom: 2 })
      const { handle, setPointerCapture } = handleFor(container, `.react-flow__resize-control${selector}`)
      const shell = container.querySelector<HTMLElement>('.card')!

      fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 23 })
      fireEvent.pointerMove(handle, {
        clientX: 200 + screenDelta.x,
        clientY: 160 + screenDelta.y,
        pointerId: 23,
      })
      frame.flush()

      expect(setPointerCapture).toHaveBeenCalledWith(23)
      expect(renderedCard()).toMatchObject(INITIAL_CARD)
      expect(shell.style.width).toBe('280px')
      expect(shell.style.height).toBe('180px')
      expect(shell.style.transform).toBe(
        `translate(${expectedPosition.x - INITIAL_CARD.position.x}px, ${
          expectedPosition.y - INITIAL_CARD.position.y
        }px)`,
      )
      expect(screen.getByRole('status').textContent).toBe('280 × 180')

      fireEvent.pointerUp(handle, {
        clientX: 200 + screenDelta.x,
        clientY: 160 + screenDelta.y,
        pointerId: 23,
      })
      expect(renderedCard()).toMatchObject({
        position: expectedPosition,
        size: { width: 280, height: 180 },
      })
      expect(useGraph.getState().undoStack).toHaveLength(1)
    },
  )

  it('clamps a shrinking corner to the 200×120 card minimum', () => {
    const frame = installFrameClock()
    const { container } = renderShell({ zoom: 2 })
    const { handle } = handleFor(container, '.react-flow__resize-control.bottom.right')
    const shell = container.querySelector<HTMLElement>('.card')!

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 31 })
    fireEvent.pointerMove(handle, { clientX: -400, clientY: -400, pointerId: 31 })
    frame.flush()

    expect(renderedCard().size).toEqual(INITIAL_CARD.size)
    expect(shell.style.width).toBe('200px')
    expect(shell.style.height).toBe('120px')
    expect(screen.getByRole('status').textContent).toBe('200 × 120')
    fireEvent.pointerUp(handle, { clientX: -400, clientY: -400, pointerId: 31 })
    expect(renderedCard().size).toEqual({ width: 200, height: 120 })
  })

  it('resizes only the Group frame from the top-left without translating its members', () => {
    const frame = installFrameClock()
    resetStore([GROUP_CARD, GROUP_MEMBER], [GROUP_CARD.id])
    const { container } = renderShell({ card: GROUP_CARD })
    const { handle } = handleFor(container, '.react-flow__resize-control.top.left')
    const shell = container.querySelector<HTMLElement>('.card')!

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 41 })
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 120, pointerId: 41 })
    frame.flush()

    expect(renderedCard(GROUP_CARD.id)).toMatchObject(GROUP_CARD)
    expect(shell.style.width).toBe('370px')
    expect(shell.style.height).toBe('260px')
    expect(shell.style.transform).toBe('translate(-50px, -40px)')
    expect(renderedCard(GROUP_MEMBER.id).position).toEqual(GROUP_MEMBER.position)
    expect(renderedCard(GROUP_MEMBER.id).groupId).toBe(GROUP_CARD.id)

    fireEvent.pointerUp(handle, { clientX: 150, clientY: 120, pointerId: 41 })
    expect(renderedCard(GROUP_CARD.id)).toMatchObject({
      position: { x: 50, y: 40 },
      size: { width: 370, height: 260 },
    })
    expect(renderedCard(GROUP_MEMBER.id).position).toEqual(GROUP_MEMBER.position)
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(useGraph.getState().intentLog.filter((event) => event.type === 'card.resized')).toHaveLength(1)
  })

  it('previews a dense Group resize without graph-store work between rendered frames', () => {
    const frame = installFrameClock()
    let observeHotPath = false
    let unrelatedCardReads = 0
    const unrelatedCards = Array.from({ length: 512 }, (_, index): Card => {
      const card: Card = {
        id: `dense-resize-note-${index}`,
        kind: 'note',
        blocks: [{ id: `dense-resize-note-${index}-block`, text: 'Unrelated' }],
        position: { x: 600 + index * 8, y: 400 + index * 4 },
        size: { width: 200, height: 120 },
      }
      return new Proxy(card, {
        get(target, property, receiver) {
          if (
            observeHotPath &&
            typeof property === 'string' &&
            ['id', 'kind', 'position', 'size', 'groupId'].includes(property)
          ) {
            unrelatedCardReads += 1
          }
          return Reflect.get(target, property, receiver)
        },
      })
    })
    resetStore([GROUP_CARD, GROUP_MEMBER, ...unrelatedCards], [GROUP_CARD.id])
    const reportCardResize = vi.fn()
    const reportCardResizePreview = vi.fn()
    const { container } = renderShell({
      card: GROUP_CARD,
      data: {
        selectedCardCount: 1,
        onCardResize: reportCardResize,
        onCardResizePreview: reportCardResizePreview,
      },
    })
    const { handle } = handleFor(container, '.react-flow__resize-control.top.left')
    const shell = container.querySelector<HTMLElement>('.card')!

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 46 })

    const state = useGraph.getState()
    const heldCards = state.cards
    const heldUndoStack = state.undoStack
    const heldIntentLog = state.intentLog
    const heldSaveState = state.saveState
    const heldBoardChangeSeq = state.boardChangeSeq
    const heldLastBoardChange = state.lastBoardChange
    const moveCards = vi.spyOn(state, 'moveCards')
    const moveCard = vi.spyOn(state, 'moveCard')
    const setCardSize = vi.spyOn(state, 'setCardSize')
    const recordCardStructuralChange = vi.spyOn(state, 'recordCardStructuralChange')
    const graphWrites = vi.fn()
    const unsubscribe = useGraph.subscribe(graphWrites)
    observeHotPath = true

    for (let renderedFrame = 1; renderedFrame <= 10; renderedFrame += 1) {
      for (let sample = 1; sample <= 32; sample += 1) {
        const offset = (renderedFrame - 1) * 8 + Math.ceil(sample / 4)
        fireEvent.pointerMove(handle, {
          clientX: 200 - offset,
          clientY: 160 - offset,
          pointerId: 46,
        })
      }
      frame.flush()
    }

    observeHotPath = false
    unsubscribe()

    expect({
      graphActionCalls:
        moveCards.mock.calls.length +
        moveCard.mock.calls.length +
        setCardSize.mock.calls.length +
        recordCardStructuralChange.mock.calls.length,
      graphWrites: graphWrites.mock.calls.length,
      unrelatedCardReads,
    }).toEqual({
      graphActionCalls: 0,
      graphWrites: 0,
      unrelatedCardReads: 0,
    })
    const heldState = useGraph.getState()
    expect({
      cardsIdentityHeld: heldState.cards === heldCards,
      undoIdentityHeld: heldState.undoStack === heldUndoStack,
      intentIdentityHeld: heldState.intentLog === heldIntentLog,
      saveState: heldState.saveState,
      boardChangeSeq: heldState.boardChangeSeq,
      lastBoardChange: heldState.lastBoardChange,
      reportCalls: reportCardResize.mock.calls.length,
      previewCalls: reportCardResizePreview.mock.calls.length,
    }).toEqual({
      cardsIdentityHeld: true,
      undoIdentityHeld: true,
      intentIdentityHeld: true,
      saveState: heldSaveState,
      boardChangeSeq: heldBoardChangeSeq,
      lastBoardChange: heldLastBoardChange,
      reportCalls: 0,
      previewCalls: 11,
    })
    expect(renderedCard(GROUP_CARD.id)).toMatchObject(GROUP_CARD)
    expect(renderedCard(GROUP_MEMBER.id).position).toEqual(GROUP_MEMBER.position)
    expect(renderedCard(GROUP_MEMBER.id).groupId).toBe(GROUP_CARD.id)
    expect(renderedCard(unrelatedCards[128]!.id).position).toEqual(unrelatedCards[128]!.position)
    expect(shell.style.width).toBe('400px')
    expect(shell.style.height).toBe('300px')
    expect(shell.style.transform).toBe('translate(-80px, -80px)')
    expect(screen.getByRole('status').textContent).toBe('400 × 300')

    fireEvent.pointerUp(handle, { clientX: 120, clientY: 80, pointerId: 46 })
    expect(renderedCard(GROUP_CARD.id)).toMatchObject({
      position: { x: 20, y: 0 },
      size: { width: 400, height: 300 },
    })
    expect(reportCardResize).toHaveBeenCalledTimes(1)
    expect(reportCardResizePreview.mock.calls.map((call) => call[1]?.type)).toEqual([
      'begin',
      ...Array.from({ length: 10 }, () => 'preview'),
      'commit',
    ])
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(useGraph.getState().intentLog.filter((event) => event.type === 'card.resized')).toHaveLength(1)
  })

  it('coalesces dense pointer samples to one rendered-frame update and flushes the exact release sample', () => {
    const frame = installFrameClock()
    const reportCardResize = vi.fn()
    const { container } = renderShell({
      data: { selectedCardCount: 1, onCardResize: reportCardResize },
    })
    const { handle } = handleFor(container, '.react-flow__resize-control.bottom.right')

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 42 })
    for (let offset = 1; offset <= 24; offset += 1) {
      fireEvent.pointerMove(handle, {
        clientX: 200 + offset,
        clientY: 160 + offset * 2,
        pointerId: 42,
      })
    }

    expect(renderedCard().size).toEqual(INITIAL_CARD.size)
    expect(reportCardResize).not.toHaveBeenCalled()
    frame.flush()
    const shell = container.querySelector<HTMLElement>('.card')!
    expect(renderedCard().size).toEqual(INITIAL_CARD.size)
    expect(shell.style.width).toBe('284px')
    expect(shell.style.height).toBe('208px')
    expect(reportCardResize).not.toHaveBeenCalled()

    fireEvent.pointerMove(handle, { clientX: 230, clientY: 222, pointerId: 42 })
    fireEvent.pointerUp(handle, { clientX: 237, clientY: 231, pointerId: 42 })
    expect(renderedCard().size).toEqual({ width: 297, height: 231 })
    expect(reportCardResize).toHaveBeenCalledTimes(1)
    expect(useGraph.getState().undoStack).toHaveLength(1)
  })

  it('flushes the last valid pointer sample on cancel instead of using cancellation coordinates', () => {
    installFrameClock()
    const reportCardResizePreview = vi.fn()
    const { container } = renderShell({
      data: { selectedCardCount: 1, onCardResizePreview: reportCardResizePreview },
    })
    const { handle, releasePointerCapture } = handleFor(
      container,
      '.react-flow__resize-control.bottom.right',
    )

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 43 })
    fireEvent.pointerMove(handle, { clientX: 240, clientY: 200, pointerId: 43 })
    fireEvent.pointerCancel(handle, { clientX: -500, clientY: -500, pointerId: 43 })

    expect(renderedCard().size).toEqual({ width: 300, height: 200 })
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(useGraph.getState().intentLog.filter((event) => event.type === 'card.resized')).toHaveLength(1)
    expect(reportCardResizePreview.mock.calls.map((call) => call[1]?.type)).toEqual([
      'begin',
      'commit',
    ])
  })

  it.each([
    ['lost pointer capture', (handle: HTMLElement, pointerId: number) => {
      fireEvent.lostPointerCapture(handle, { pointerId })
    }],
    ['window blur', () => {
      fireEvent(window, new Event('blur'))
    }],
    ['document visibility loss', () => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      fireEvent(document, new Event('visibilitychange'))
    }],
  ] as const)('finalizes pending geometry once on %s', (_label, finalize) => {
    installFrameClock()
    const reportCardResizePreview = vi.fn()
    const { container } = renderShell({
      data: { selectedCardCount: 1, onCardResizePreview: reportCardResizePreview },
    })
    const { handle, releasePointerCapture } = handleFor(
      container,
      '.react-flow__resize-control.bottom.right',
    )

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 44 })
    fireEvent.pointerMove(handle, { clientX: 232, clientY: 204, pointerId: 44 })
    finalize(handle, 44)

    expect(renderedCard().size).toEqual({ width: 292, height: 204 })
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(useGraph.getState().intentLog.filter((event) => event.type === 'card.resized')).toHaveLength(1)
    expect(reportCardResizePreview.mock.calls.map((call) => call[1]?.type)).toEqual([
      'begin',
      'commit',
    ])
  })

  it('flushes and summarizes pending geometry when the selected shell unmounts', () => {
    installFrameClock()
    const reportCardResizePreview = vi.fn()
    const rendered = renderShell({
      data: { selectedCardCount: 1, onCardResizePreview: reportCardResizePreview },
    })
    const { handle, releasePointerCapture } = handleFor(
      rendered.container,
      '.react-flow__resize-control.bottom.right',
    )

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 160, pointerId: 45 })
    fireEvent.pointerMove(handle, { clientX: 226, clientY: 198, pointerId: 45 })
    rendered.unmount()

    expect(renderedCard().size).toEqual({ width: 286, height: 198 })
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(useGraph.getState().intentLog.filter((event) => event.type === 'card.resized')).toHaveLength(1)
    expect(reportCardResizePreview.mock.calls.map((call) => call[1]?.type)).toEqual([
      'begin',
      'commit',
    ])
  })

  it('exposes named focusable handles with current size and supports arrow-key resizing', () => {
    const { container } = renderShell()
    const handle = screen.getByRole('button', { name: 'Resize card from bottom right' })

    expect(container.querySelectorAll('.card-resize-handle')).toHaveLength(4)
    expect(handle.getAttribute('type')).toBe('button')
    expect(handle.getAttribute('aria-description')).toBe(
      'Current size 260 by 160 pixels. Use arrow keys to resize.',
    )
    handle.focus()
    expect(document.activeElement).toBe(handle)

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(renderedCard().size).toEqual({ width: 270, height: 160 })
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(handle.getAttribute('aria-description')).toBe(
      'Current size 270 by 160 pixels. Use arrow keys to resize.',
    )
  })
})
