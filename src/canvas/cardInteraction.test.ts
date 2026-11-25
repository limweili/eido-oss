// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  assertCardActivationOwnerSnapshot,
  boardReleaseSurface,
  cardActivationOwnerSnapshot,
  cardActivationDecision,
  canEditSelectedCard,
  createCardSelectionPaintBarrier,
  dragBlockingClass,
  focusedMarkdownEditorForDifferentDragCapablePress,
  highlightableTextDragBlockingClass,
  liveCardNodeClassName,
  liveCardNodeData,
  clientPointHitsPaintedHandle,
  modFaceGestureLiveOwnerIds,
  selectedCardCountFromNodeData,
  shouldCaptureWheel,
  shouldPanOnScroll,
  useCardActivationOwnership,
  useRelativeScrollPosition,
  useRetainedCardScrollPosition,
  wheelGate,
} from './cardInteraction'

describe('card interaction policy', () => {
  it('resolves only the first painted owner for connector releases', () => {
    const board = document.createElement('div')
    board.innerHTML = `
      <div class="react-flow"><div class="react-flow__pane">
        <div class="react-flow__node" data-id="target"><div class="card"></div></div>
      </div></div>
    `
    const blocker = document.createElement('button')
    document.body.append(board, blocker)
    const card = board.querySelector<HTMLElement>('[data-id="target"]')!
    const pane = board.querySelector<HTMLElement>('.react-flow__pane')!

    expect(boardReleaseSurface([card, pane], board)).toEqual({ kind: 'card', cardId: 'target' })
    expect(boardReleaseSurface([pane, card], board)).toEqual({ kind: 'canvas' })
    expect(boardReleaseSurface([blocker, card, pane], board)).toEqual({ kind: 'blocked' })

    blocker.remove()
    board.remove()
  })

  it('classifies only the painted Handle disc, excluding its pointer halo', () => {
    const handle = document.createElement('div')
    handle.getBoundingClientRect = () => ({
      x: 100, y: 100, left: 100, top: 100, right: 113, bottom: 113,
      width: 13, height: 13, toJSON: () => ({}),
    })
    expect(clientPointHitsPaintedHandle(handle, 106.5, 106.5)).toBe(true)
    expect(clientPointHitsPaintedHandle(handle, 96.5, 106.5)).toBe(false)
  })

  it('starts accepted S/O Live work only after the selected outline had a paint opportunity', () => {
    const frames: FrameRequestCallback[] = []
    const cancelled = new Set<number>()
    const barrier = createCardSelectionPaintBarrier({
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: (frame) => cancelled.add(frame),
    })
    const events = ['selection-committed']

    barrier.afterPaint('oversize', () => events.push('live-started'))
    expect(barrier.pendingCardId()).toBe('oversize')
    expect(events).toEqual(['selection-committed'])

    frames.shift()!(0)
    events.push('outline-painted')
    expect(events).toEqual(['selection-committed', 'outline-painted'])

    frames.shift()!(16)
    expect(events).toEqual(['selection-committed', 'outline-painted', 'live-started'])
    expect(barrier.pendingCardId()).toBeNull()
    expect(cancelled).toEqual(new Set())
  })

  it('supersedes stale S/O Live work when the user selects another Card before paint', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    const barrier = createCardSelectionPaintBarrier({
      requestFrame: (callback) => {
        const frame = ++nextFrame
        frames.set(frame, callback)
        return frame
      },
      cancelFrame: (frame) => frames.delete(frame),
    })
    const activated: string[] = []

    barrier.afterPaint('first', () => activated.push('first'))
    barrier.afterPaint('second', () => activated.push('second'))
    expect(barrier.pendingCardId()).toBe('second')

    frames.get(2)!(0)
    frames.delete(2)
    frames.get(3)!(16)
    expect(activated).toEqual(['second'])
  })

  it('preserves a different Markdown editor only for a primary press on a drag-capable Card surface', () => {
    const board = document.createElement('div')
    board.innerHTML = `
      <div class="react-flow__node draggable nopan" data-id="card-a">
        <div class="card">
          <div class="card-head"><span class="same-card-drag-surface">Same Card</span></div>
          <div class="markdown-card-editor-content" contenteditable="true"></div>
        </div>
      </div>
      <div class="react-flow__node draggable nopan" data-id="card-b"><div class="card">
        <div class="card-resize-layer"><button class="react-flow__resize-control nodrag"></button></div>
        <div class="card-connector react-flow__handle"></div>
        <div class="card-head">
          <button class="kind-dot"></button>
          <button class="card-title-display"><span>Other title</span></button>
          <button class="card-action nodrag">Action</button>
        </div>
        <div class="card-body">
          <div class="note-render" role="textbox"><span>Passive body</span><a href="https://example.com">Link</a></div>
          <input />
          <video></video>
        </div>
      </div></div>
    `
    document.body.append(board)
    const editor = board.querySelector<HTMLElement>('.markdown-card-editor-content')!
    const pressedCard = board.querySelector<HTMLElement>('[data-id="card-b"]')!
    const head = pressedCard.querySelector<HTMLElement>('.card-head')!
    const title = pressedCard.querySelector<HTMLElement>('.card-title-display')!
    const titleText = title.querySelector('span')!
    const passiveText = board.querySelector<HTMLElement>('.note-render span')!
    const sameCardSurface = board.querySelector<HTMLElement>('.same-card-drag-surface')!
    const eligible = {
      target: head,
      activeElement: editor,
      boardRoot: board,
      button: 0,
      modified: false,
    }
    expect(focusedMarkdownEditorForDifferentDragCapablePress(eligible)).toBe(editor)
    expect(focusedMarkdownEditorForDifferentDragCapablePress({ ...eligible, target: titleText })).toBe(editor)
    expect(focusedMarkdownEditorForDifferentDragCapablePress({ ...eligible, target: passiveText })).toBe(editor)
    expect(focusedMarkdownEditorForDifferentDragCapablePress({ ...eligible, button: 1 })).toBeNull()
    expect(focusedMarkdownEditorForDifferentDragCapablePress({ ...eligible, modified: true })).toBeNull()
    for (const target of board.querySelectorAll<HTMLElement>(
      '.kind-dot, .card-action, a, input, video, .react-flow__resize-control, .card-connector',
    )) {
      expect(focusedMarkdownEditorForDifferentDragCapablePress({ ...eligible, target })).toBeNull()
    }
    title.classList.add('nodrag')
    expect(focusedMarkdownEditorForDifferentDragCapablePress({ ...eligible, target: titleText })).toBeNull()
    title.classList.remove('nodrag')
    title.classList.add('nopan')
    expect(focusedMarkdownEditorForDifferentDragCapablePress({ ...eligible, target: titleText })).toBeNull()
    title.classList.remove('nopan')
    title.closest('.react-flow__node')?.classList.remove('draggable')
    expect(focusedMarkdownEditorForDifferentDragCapablePress({ ...eligible, target: passiveText })).toBeNull()
    title.closest('.react-flow__node')?.classList.add('draggable')
    expect(focusedMarkdownEditorForDifferentDragCapablePress({
      ...eligible,
      target: sameCardSurface,
    })).toBeNull()
    board.remove()
  })

  it('reports every effective live-owner reason through the closed diagnostic seam', () => {
    const none = new Set<string>()
    const base = {
      enabled: true,
      focusedCardId: null,
      selectedCardIds: none,
      editingCardIds: none,
      scrollingCardId: null,
      gestureParticipantIds: none,
      activeMediaCardIds: none,
      activationCardId: null,
    }
    const cases = [
      ['selected', { selectedCardIds: new Set(['target']) }],
      ['editing', { editingCardIds: new Set(['target']) }],
      ['activation', { activationCardId: 'target' }],
      ['focused', { focusedCardId: 'target' }],
      ['scrolling', { scrollingCardId: 'target' }],
      ['gesture', { gestureParticipantIds: new Set(['target']) }],
      ['media', { activeMediaCardIds: new Set(['target']) }],
    ] as const

    for (const [reason, over] of cases) {
      const snapshot = cardActivationOwnerSnapshot('target', { ...base, ...over })
      expect(snapshot.mode).toBe('live')
      expect(snapshot.ownerTokens).toEqual([reason])
      expect(snapshot.owners).toEqual({
        selected: reason === 'selected',
        editing: reason === 'editing',
        activation: reason === 'activation',
        focused: reason === 'focused',
        scrolling: reason === 'scrolling',
        gesture: reason === 'gesture',
        media: reason === 'media',
      })
      expect(JSON.stringify(snapshot)).not.toContain('target')
    }

    expect(cardActivationOwnerSnapshot('target', { ...base, enabled: false })).toEqual({
      mode: 'passive',
      ownerTokens: [],
      owners: {
        selected: false,
        editing: false,
        activation: false,
        focused: false,
        scrolling: false,
        gesture: false,
        media: false,
      },
    })
  })

  it('rejects every non-canonical or privacy-bearing owner snapshot payload', () => {
    const valid = {
      mode: 'live',
      ownerTokens: ['activation', 'focused'],
      owners: {
        selected: false,
        editing: false,
        activation: true,
        focused: true,
        scrolling: false,
        gesture: false,
        media: false,
      },
    }
    expect(() => assertCardActivationOwnerSnapshot(valid)).not.toThrow()

    const inherited = Object.assign(Object.create({ content: 'private' }), valid)
    const inheritedOwners = {
      ...valid,
      owners: Object.assign(Object.create({ cardId: 'other-card' }), valid.owners),
    }
    const sparseTokens = new Array(2)
    sparseTokens[1] = 'focused'
    const malformed: Array<[string, unknown]> = [
      ['content', { ...valid, content: 'private' }],
      ['card id', { ...valid, cardId: 'other-card' }],
      ['target', { ...valid, target: 'note' }],
      ['stage', { ...valid, stage: 'after-release' }],
      ['prototype', inherited],
      ['owners prototype', inheritedOwners],
      ['sparse tokens', { ...valid, ownerTokens: sparseTokens }],
      ['duplicate tokens', { ...valid, ownerTokens: ['activation', 'activation'] }],
      ['reordered tokens', { ...valid, ownerTokens: ['focused', 'activation'] }],
      ['false owner token', { ...valid, ownerTokens: ['activation', 'media'] }],
      ['owners mismatch', {
        ...valid,
        owners: { ...valid.owners, activation: false },
      }],
      ['extra owner', {
        ...valid,
        owners: { ...valid.owners, content: true },
      }],
    ]

    for (const [label, value] of malformed) {
      expect(() => assertCardActivationOwnerSnapshot(value), label).toThrow()
    }
  })

  it('prepares focus and leaves each native click on its original target exactly once', () => {
    expect(cardActivationDecision({ trigger: 'focus', live: false })).toEqual({
      beginActivation: true,
      intentDelivery: 'none',
      pin: true,
      showLoading: false,
    })
    expect(cardActivationDecision({ trigger: 'click', live: false })).toEqual({
      beginActivation: true,
      intentDelivery: 'continue',
      pin: true,
      showLoading: false,
    })
    expect(cardActivationDecision({ trigger: 'press', live: false })).toEqual({
      beginActivation: true,
      intentDelivery: 'continue',
      pin: true,
      showLoading: false,
    })
    expect(cardActivationDecision({ trigger: 'click', live: true })).toEqual({
      beginActivation: false,
      intentDelivery: 'continue',
      pin: true,
      showLoading: false,
    })
  })

  it('defers safety and oversize pointer activation until React Flow resolves a stationary click', () => {
    expect(cardActivationDecision({
      trigger: 'press',
      live: false,
      deferUntilClick: true,
    })).toEqual({
      beginActivation: false,
      intentDelivery: 'continue',
      pin: false,
      showLoading: false,
    })
    expect(cardActivationDecision({
      trigger: 'click',
      live: false,
      deferUntilClick: true,
    })).toEqual({
      beginActivation: true,
      intentDelivery: 'continue',
      pin: true,
      showLoading: true,
    })
    expect(cardActivationDecision({
      trigger: 'click',
      live: true,
      deferUntilClick: true,
    })).toEqual({
      beginActivation: false,
      intentDelivery: 'continue',
      pin: true,
      showLoading: false,
    })
  })

  it('keeps visual hover outside Live ownership while independent Card owners survive pointer leave', () => {
    const none = new Set<string>()
    const owners = (over: Partial<Parameters<typeof useCardActivationOwnership>[0]> = {}) => ({
      enabled: true,
      focusedCardId: null,
      selectedCardIds: none,
      editingCardIds: none,
      scrollingCardId: null,
      gestureParticipantIds: none,
      activeMediaCardIds: none,
      ...over,
    })
    const { result, rerender } = renderHook(
      (props) => useCardActivationOwnership(props),
      { initialProps: owners() },
    )
    act(() => result.current.setHoveredCardId('card-a'))
    expect([...result.current.liveOwnerIds]).toEqual([])
    expect(result.current.hoveredCardId).toBe('card-a')
    act(() => result.current.leaveCard('card-a'))
    expect([...result.current.liveOwnerIds]).toEqual([])
    const firstClick = cardActivationDecision({ trigger: 'click', live: false })
    expect(firstClick.intentDelivery).toBe('continue')
    act(() => result.current.beginActivation('card-a', firstClick, 'click'))
    expect([...result.current.liveOwnerIds]).toEqual(['card-a'])
    act(() => result.current.leaveCard('card-a'))
    expect([...result.current.liveOwnerIds]).toEqual([])

    const independentOwners: Array<Partial<Parameters<typeof useCardActivationOwnership>[0]>> = [
      { focusedCardId: 'card-a' },
      { selectedCardIds: new Set(['card-a']) },
      { editingCardIds: new Set(['card-a']) },
      { scrollingCardId: 'card-a' },
      { gestureParticipantIds: new Set(['card-a']) },
      { activeMediaCardIds: new Set(['card-a']) },
    ]
    for (const owner of independentOwners) {
      rerender(owners(owner))
      act(() => result.current.beginActivation('card-a', firstClick, 'click'))
      act(() => result.current.leaveCard('card-a'))
      expect(result.current.liveOwnerIds.has('card-a')).toBe(true)
      rerender(owners())
      expect(result.current.liveOwnerIds.has('card-a')).toBe(false)
    }

    // Below Reading the same hot G/selection signals remain available to
    // their own renderer, but cannot create rich-DOM Live ownership.
    rerender(owners({
      enabled: false,
      selectedCardIds: new Set(['card-a']),
      gestureParticipantIds: new Set(['card-a']),
    }))
    expect(result.current.liveOwnerIds.has('card-a')).toBe(false)
  })

  it('keeps deferred S/O visual hover and generic gesture participation geometry-only', () => {
    const none = new Set<string>()
    const { result } = renderHook(() => useCardActivationOwnership({
      enabled: true,
      focusedCardId: null,
      selectedCardIds: none,
      editingCardIds: none,
      scrollingCardId: null,
      gestureParticipantIds: new Set(['oversize']),
      activeMediaCardIds: none,
      deferredActivationCardIds: new Set(['oversize']),
    }))

    act(() => result.current.setHoveredCardId('oversize'))

    expect(result.current.hoveredCardId).toBe('oversize')
    expect(result.current.liveOwnerIds.has('oversize')).toBe(false)
    expect(result.current.ownerSnapshot('oversize').owners.gesture).toBe(false)
  })

  it('gates deferred S/O Mod-face pointer ownership until a stationary click is accepted', () => {
    const pointerGestureIds = new Set(['ordinary', 'oversize'])
    const deferredActivationCardIds = new Set(['oversize'])

    expect([...modFaceGestureLiveOwnerIds({
      pointerGestureIds,
      deferredActivationCardIds,
      existingLiveOwnerIds: new Set(),
      preserveCapturedContinuation: false,
    })]).toEqual(['ordinary'])

    expect([...modFaceGestureLiveOwnerIds({
      pointerGestureIds,
      deferredActivationCardIds,
      existingLiveOwnerIds: new Set(['oversize']),
      preserveCapturedContinuation: false,
    })]).toEqual(['ordinary', 'oversize'])

    // Below Reading no new Mod-face gesture can begin because no face exists;
    // an already captured pointer remains Live until its own release.
    expect([...modFaceGestureLiveOwnerIds({
      pointerGestureIds,
      deferredActivationCardIds,
      existingLiveOwnerIds: new Set(),
      preserveCapturedContinuation: true,
    })]).toEqual(['ordinary', 'oversize'])
  })

  it('keeps a visually selected S/O Card passive until its accepted click activation begins', () => {
    const none = new Set<string>()
    const selected = new Set(['oversize'])
    const { result } = renderHook(() => useCardActivationOwnership({
      enabled: true,
      focusedCardId: null,
      selectedCardIds: selected,
      editingCardIds: selected,
      scrollingCardId: null,
      gestureParticipantIds: none,
      activeMediaCardIds: none,
      deferredActivationCardIds: selected,
    }))

    // Selection is already available to the wrapper/painter, but must not
    // make the expensive Live/editor surface part of that same commit.
    expect(result.current.liveOwnerIds.has('oversize')).toBe(false)
    expect(result.current.ownerSnapshot('oversize').owners.selected).toBe(false)
    expect(result.current.ownerSnapshot('oversize').owners.editing).toBe(false)

    act(() => result.current.beginActivation(
      'oversize',
      cardActivationDecision({ trigger: 'click', live: false, deferUntilClick: true }),
      'click',
    ))

    expect(result.current.liveOwnerIds.has('oversize')).toBe(true)
    expect(result.current.ownerSnapshot('oversize').owners.activation).toBe(true)
  })

  it('preserves ordinary resident pointer-down activation before click resolution', () => {
    const none = new Set<string>()
    const { result } = renderHook(() => useCardActivationOwnership({
      enabled: true,
      focusedCardId: null,
      selectedCardIds: none,
      editingCardIds: none,
      scrollingCardId: null,
      gestureParticipantIds: none,
      activeMediaCardIds: none,
    }))

    act(() => result.current.beginActivation(
      'ordinary',
      cardActivationDecision({ trigger: 'press', live: false }),
      'press',
    ))

    expect(result.current.liveOwnerIds.has('ordinary')).toBe(true)
  })

  it('releases only the focus activation claim when click independently pins the same Card', () => {
    const none = new Set<string>()
    const { result } = renderHook(() => useCardActivationOwnership({
      enabled: true,
      focusedCardId: null,
      selectedCardIds: none,
      editingCardIds: none,
      scrollingCardId: null,
      gestureParticipantIds: none,
      activeMediaCardIds: none,
    }))

    act(() => result.current.beginActivation(
      'card-a',
      cardActivationDecision({ trigger: 'click', live: false }),
      'click',
    ))
    act(() => result.current.beginActivation(
      'card-a',
      cardActivationDecision({ trigger: 'focus', live: true }),
      'focus',
    ))
    act(() => result.current.releaseActivation('card-a', 'focus'))

    expect(result.current.liveOwnerIds.has('card-a')).toBe(true)
    expect(result.current.ownerSnapshot('card-a').owners.activation).toBe(true)

    act(() => result.current.leaveCard('card-a'))
    expect(result.current.liveOwnerIds.has('card-a')).toBe(false)
  })

  it('clears a pure focus activation when focus is released', () => {
    const none = new Set<string>()
    const { result } = renderHook(() => useCardActivationOwnership({
      enabled: true,
      focusedCardId: null,
      selectedCardIds: none,
      editingCardIds: none,
      scrollingCardId: null,
      gestureParticipantIds: none,
      activeMediaCardIds: none,
    }))

    act(() => result.current.beginActivation(
      'card-a',
      cardActivationDecision({ trigger: 'focus', live: false }),
      'focus',
    ))
    expect(result.current.liveOwnerIds.has('card-a')).toBe(true)
    act(() => result.current.releaseActivation('card-a', 'focus'))
    expect(result.current.liveOwnerIds.has('card-a')).toBe(false)
  })

  it('uses the React Flow selection snapshot as live card node data', () => {
    expect(liveCardNodeData(new Set(['a']))).toEqual({ selectedCardCount: 1 })
    expect(liveCardNodeData(new Set(['a', 'b']))).toEqual({ selectedCardCount: 2 })
  })

  it('only allows single selected cards to enter edit mode in Select tool', () => {
    expect(canEditSelectedCard({ activeTool: 'select', data: { selectedCardCount: 1 }, selected: true })).toBe(true)
    expect(canEditSelectedCard({ activeTool: 'select', data: { selectedCardCount: 2 }, selected: true })).toBe(false)
    expect(canEditSelectedCard({ activeTool: 'select', data: { selectedCardCount: 1 }, selected: false })).toBe(false)
    expect(canEditSelectedCard({ activeTool: 'pan', data: { selectedCardCount: 1 }, selected: true })).toBe(false)
    expect(canEditSelectedCard({ activeTool: 'highlight', data: { selectedCardCount: 1 }, selected: true })).toBe(false)
  })

  it('treats missing or malformed node data as not editable', () => {
    expect(selectedCardCountFromNodeData(undefined)).toBe(0)
    expect(selectedCardCountFromNodeData({ selectedCardCount: '1' })).toBe(0)
    expect(canEditSelectedCard({ activeTool: 'select', data: undefined, selected: true })).toBe(false)
  })

  it('keeps canvas scroll pan available in every tool', () => {
    expect(shouldPanOnScroll({ activeTool: 'select', readOnly: false, selectedCardCount: 0 })).toBe(true)
    expect(shouldPanOnScroll({ activeTool: 'select', readOnly: false, selectedCardCount: 1 })).toBe(true)
    expect(shouldPanOnScroll({ activeTool: 'highlight', readOnly: false, selectedCardCount: 1 })).toBe(true)
    expect(shouldPanOnScroll({ activeTool: 'pan', readOnly: false, selectedCardCount: 1 })).toBe(true)
    expect(shouldPanOnScroll({ activeTool: 'select', readOnly: true, selectedCardCount: 1 })).toBe(true)
  })

  it('blocks dragging from interactive regions only while the card is selected', () => {
    // Unselected: no nodrag anywhere, so press-and-move on any surface drags the card.
    expect(dragBlockingClass(false)).toBe('')
    // Selected: interactive regions keep today's behavior (buttons, text selection).
    expect(dragBlockingClass(true)).toBe('nodrag')
  })

  it('gives highlightable text exclusive ownership of pointer drags in Highlight mode', () => {
    expect(highlightableTextDragBlockingClass('highlight', false)).toBe('nodrag nopan')
    expect(highlightableTextDragBlockingClass('highlight', true)).toBe('nodrag nopan')
    expect(highlightableTextDragBlockingClass('select', false)).toBe('')
    expect(highlightableTextDragBlockingClass('select', true)).toBe('nodrag')
  })

  it('keeps selected live node wrappers available for canvas pan while preserving highlights', () => {
    expect(liveCardNodeClassName(false, false)).toBeUndefined()
    expect(liveCardNodeClassName(true, false)).toBeUndefined()
    expect(liveCardNodeClassName(false, true)).toBe('card-link-target')
    expect(liveCardNodeClassName(true, true)).toBe('card-link-target')
  })

})

describe('wheel capture gate', () => {
  const wheel = (over: Partial<Parameters<typeof shouldCaptureWheel>[0]> = {}) => ({
    deltaX: 0,
    deltaY: 0,
    ctrlKey: false,
    metaKey: false,
    ...over,
  })
  // Defaults model a container mid-scroll with room in every direction.
  const scroller = (over: Partial<Parameters<typeof shouldCaptureWheel>[1]> = {}) => ({
    scrollTop: 50,
    scrollHeight: 300,
    clientHeight: 100,
    scrollLeft: 50,
    scrollWidth: 300,
    clientWidth: 100,
    ...over,
  })

  it('releases to the canvas when the content does not overflow', () => {
    const flat = scroller({
      scrollTop: 0,
      scrollHeight: 100,
      scrollLeft: 0,
      scrollWidth: 100,
    })
    expect(shouldCaptureWheel(wheel({ deltaY: 40 }), flat)).toBe(false)
    expect(shouldCaptureWheel(wheel({ deltaY: -40 }), flat)).toBe(false)
    expect(shouldCaptureWheel(wheel({ deltaX: 40 }), flat)).toBe(false)
    expect(shouldCaptureWheel(wheel({ deltaX: -40 }), flat)).toBe(false)
  })

  it('captures the wheel while overflowing content can move both ways', () => {
    expect(shouldCaptureWheel(wheel({ deltaY: 40 }), scroller())).toBe(true)
    expect(shouldCaptureWheel(wheel({ deltaY: -40 }), scroller())).toBe(true)
    expect(shouldCaptureWheel(wheel({ deltaX: 40 }), scroller())).toBe(true)
    expect(shouldCaptureWheel(wheel({ deltaX: -40 }), scroller())).toBe(true)
  })

  it('releases scroll-up at the top but keeps scroll-down', () => {
    const atTop = scroller({ scrollTop: 0 })
    expect(shouldCaptureWheel(wheel({ deltaY: -40 }), atTop)).toBe(false)
    expect(shouldCaptureWheel(wheel({ deltaY: 40 }), atTop)).toBe(true)
  })

  it('releases scroll-down at the bottom but keeps scroll-up', () => {
    const atBottom = scroller({ scrollTop: 200 })
    expect(shouldCaptureWheel(wheel({ deltaY: 40 }), atBottom)).toBe(false)
    expect(shouldCaptureWheel(wheel({ deltaY: -40 }), atBottom)).toBe(true)
  })

  it('gates the horizontal axis by direction at its edges', () => {
    expect(shouldCaptureWheel(wheel({ deltaX: -40 }), scroller({ scrollLeft: 0 }))).toBe(false)
    expect(shouldCaptureWheel(wheel({ deltaX: 40 }), scroller({ scrollLeft: 0 }))).toBe(true)
    expect(shouldCaptureWheel(wheel({ deltaX: 40 }), scroller({ scrollLeft: 200 }))).toBe(false)
    expect(shouldCaptureWheel(wheel({ deltaX: -40 }), scroller({ scrollLeft: 200 }))).toBe(true)
  })

  it('always releases ctrl/meta wheel so pinch-zoom reaches the canvas', () => {
    expect(shouldCaptureWheel(wheel({ deltaY: 40, ctrlKey: true }), scroller())).toBe(false)
    expect(shouldCaptureWheel(wheel({ deltaY: 40, metaKey: true }), scroller())).toBe(false)
  })

  it('toggles the nowheel class per wheel event through the gate ref', () => {
    const classes = new Set<string>()
    const listeners = new Map<string, (event: unknown) => void>()
    const el = {
      scrollTop: 50,
      scrollHeight: 300,
      clientHeight: 100,
      scrollLeft: 0,
      scrollWidth: 100,
      clientWidth: 100,
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    }

    const gate = wheelGate<HTMLElement>(() => true)
    gate(el as unknown as HTMLElement)

    listeners.get('wheel')?.({ deltaX: 0, deltaY: 40, ctrlKey: false, metaKey: false })
    expect(classes.has('nowheel')).toBe(true)
    listeners.get('wheel')?.({ deltaX: 0, deltaY: 40, ctrlKey: true, metaKey: false })
    expect(classes.has('nowheel')).toBe(false)

    gate(null)
    expect(listeners.size).toBe(0)
  })

  it('keeps a fast wheel gesture inside the card after it reaches an edge', () => {
    const classes = new Set<string>()
    const listeners = new Map<string, (event: unknown) => void>()
    const el = {
      scrollTop: 12,
      scrollHeight: 300,
      clientHeight: 100,
      scrollLeft: 0,
      scrollWidth: 100,
      clientWidth: 100,
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    }

    const gate = wheelGate<HTMLElement>(() => true)
    gate(el as unknown as HTMLElement)

    listeners.get('wheel')?.({ deltaX: 0, deltaY: -120, ctrlKey: false, metaKey: false, timeStamp: 100 })
    expect(classes.has('nowheel')).toBe(true)

    el.scrollTop = 0
    listeners.get('wheel')?.({ deltaX: 0, deltaY: -120, ctrlKey: false, metaKey: false, timeStamp: 116 })
    expect(classes.has('nowheel')).toBe(true)
  })

  it('keeps a jittery horizontal flick inside the track after it reaches the end', () => {
    // The real trackpad shape, and the reason the horizontal end of an
    // attachment carousel used to hand the board a pan while the vertical end
    // of a Note body settled: a sideways flick carries a little vertical jitter
    // that comes and goes event by event, so a gesture classified by "did
    // deltaY move at all" changes label mid-flick and stops looking like the
    // gesture that captured. Only the dominant axis is stable enough to keep
    // the momentum tail inside the Card.
    const classes = new Set<string>()
    const listeners = new Map<string, (event: unknown) => void>()
    const el = {
      scrollTop: 0,
      scrollHeight: 100,
      clientHeight: 100,
      scrollLeft: 40,
      scrollWidth: 300,
      clientWidth: 100,
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    }

    const gate = wheelGate<HTMLElement>(() => true)
    gate(el as unknown as HTMLElement)

    // Mid-track, and the flick is not perfectly horizontal.
    listeners.get('wheel')?.({ deltaX: 90, deltaY: 3, ctrlKey: false, metaKey: false, timeStamp: 100 })
    expect(classes.has('nowheel')).toBe(true)

    // The track is now pinned at its right end, and the momentum tail of the
    // same flick keeps arriving. It belongs to the Card, not to the board.
    el.scrollLeft = 200
    listeners.get('wheel')?.({ deltaX: 60, deltaY: 0, ctrlKey: false, metaKey: false, timeStamp: 116 })
    expect(classes.has('nowheel')).toBe(true)
    listeners.get('wheel')?.({ deltaX: 30, deltaY: 2, ctrlKey: false, metaKey: false, timeStamp: 132 })
    expect(classes.has('nowheel')).toBe(true)

    // A gesture that STARTS while already pinned is free to pan the board.
    listeners.get('wheel')?.({ deltaX: 30, deltaY: 1, ctrlKey: false, metaKey: false, timeStamp: 900 })
    expect(classes.has('nowheel')).toBe(false)
  })
})

describe('Card scroll retention scope', () => {
  it('restores exact Result-style offsets and the remembered pinned-to-end state', () => {
    const makeElement = () => {
      const element = document.createElement('div')
      Object.defineProperties(element, {
        clientHeight: { configurable: true, value: 100 },
        clientWidth: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: 1_000 },
        scrollWidth: { configurable: true, value: 300 },
      })
      return element
    }

    const firstElement = makeElement()
    const first = renderHook(() => useRetainedCardScrollPosition(
      'exact-result-idea',
      'exact-result-card',
      { current: firstElement },
    ))
    expect(first.result.current.pinnedToEndRef.current).toBe(true)
    firstElement.scrollTop = 500
    firstElement.scrollLeft = 60
    act(() => first.result.current.rememberScrollPosition())
    first.unmount()

    const remountedElement = makeElement()
    const remounted = renderHook(() => useRetainedCardScrollPosition(
      'exact-result-idea',
      'exact-result-card',
      { current: remountedElement },
    ))
    expect(remountedElement.scrollTop).toBe(500)
    expect(remountedElement.scrollLeft).toBe(60)
    expect(remounted.result.current.pinnedToEndRef.current).toBe(false)

    remountedElement.scrollTop = 880
    act(() => remounted.result.current.rememberScrollPosition())
    remounted.unmount()

    const pinnedElement = makeElement()
    const pinned = renderHook(() => useRetainedCardScrollPosition(
      'exact-result-idea',
      'exact-result-card',
      { current: pinnedElement },
    ))
    expect(pinnedElement.scrollTop).toBe(880)
    expect(pinned.result.current.pinnedToEndRef.current).toBe(true)
    pinned.unmount()
  })

  it.each([
    ['Result', 'shrinking-result', 100, 0],
    ['Conversation Result', 'shrinking-conversation-result', 350, 250],
  ])('does not resurrect a stale %s offset after shrink, remount, growth, and remount', (
    _label,
    cardId,
    shrunkScrollHeight,
    expectedShrunkTop,
  ) => {
    const makeElement = (scrollHeight: number, scrollWidth: number) => {
      const element = document.createElement('div')
      Object.defineProperties(element, {
        clientHeight: { configurable: true, value: 100 },
        clientWidth: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: scrollHeight },
        scrollWidth: { configurable: true, value: scrollWidth },
      })
      return element
    }
    const mount = (element: HTMLElement) => renderHook(() => useRetainedCardScrollPosition(
      'shrink-grow-idea',
      cardId,
      { current: element },
    ))

    const originalElement = makeElement(1_000, 300)
    const original = mount(originalElement)
    originalElement.scrollTop = 700
    originalElement.scrollLeft = 150
    act(() => original.result.current.rememberScrollPosition())
    original.unmount()

    // Result covers the no-overflow vertical clamp; Conversation Result covers
    // a positive vertical clamp. Both cover a no-overflow horizontal clamp.
    const shrunkElement = makeElement(shrunkScrollHeight, 100)
    const shrunk = mount(shrunkElement)
    expect(shrunkElement.scrollTop).toBe(expectedShrunkTop)
    expect(shrunkElement.scrollLeft).toBe(0)
    expect(shrunk.result.current.pinnedToEndRef.current).toBe(true)
    shrunk.unmount()

    const grownElement = makeElement(1_500, 500)
    const grown = mount(grownElement)
    expect(grownElement.scrollTop).toBe(expectedShrunkTop)
    expect(grownElement.scrollLeft).toBe(0)
    expect(grown.result.current.pinnedToEndRef.current).toBe(true)
    grown.unmount()
  })

  it('keeps an actively updated Card ahead of stale scroll records at the cache limit', () => {
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 100 },
      clientWidth: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollWidth: { configurable: true, value: 300 },
    })
    const ref = { current: element }
    const view = renderHook(
      ({ cardId }) => useRetainedCardScrollPosition('lru-idea', cardId, ref),
      { initialProps: { cardId: 'active-card' } },
    )
    element.scrollTop = 120
    act(() => view.result.current.rememberScrollPosition())

    // Fill the bounded 1,024-entry cache exactly, then update the oldest entry.
    for (let index = 0; index < 1_023; index += 1) {
      view.rerender({ cardId: `stale-card-${index}` })
      element.scrollTop = index % 900
      act(() => view.result.current.rememberScrollPosition())
    }
    view.rerender({ cardId: 'active-card' })
    expect(element.scrollTop).toBe(120)
    element.scrollTop = 700
    act(() => view.result.current.rememberScrollPosition())

    view.rerender({ cardId: 'overflow-card' })
    element.scrollTop = 35
    act(() => view.result.current.rememberScrollPosition())
    view.rerender({ cardId: 'active-card' })
    expect(element.scrollTop).toBe(700)
    view.unmount()
  })

  it('keeps identical Card ids isolated between ideas', () => {
    const scroller = () => {
      const element = document.createElement('div')
      Object.defineProperties(element, {
        clientHeight: { configurable: true, value: 100 },
        clientWidth: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: 1_000 },
        scrollWidth: { configurable: true, value: 300 },
      })
      return element
    }

    // React Flow can reuse one mounted node when two ideas legitimately share
    // an imported Card id. Exercise that stricter boundary instead of relying
    // on a new DOM element to reset browser scroll state for us.
    const element = scroller()
    const ref = { current: element }
    const view = renderHook(
      ({ ideaId }) => useRetainedCardScrollPosition(ideaId, 'shared-card', ref),
      { initialProps: { ideaId: 'idea-a' } },
    )
    element.scrollTop = 640
    element.scrollLeft = 80
    act(() => view.result.current.rememberScrollPosition())

    view.rerender({ ideaId: 'idea-b' })
    expect(element.scrollTop).toBe(0)
    expect(element.scrollLeft).toBe(0)
    element.scrollTop = 125
    element.scrollLeft = 20
    act(() => view.result.current.rememberScrollPosition())

    view.rerender({ ideaId: 'idea-a' })
    expect(element.scrollTop).toBe(640)
    expect(element.scrollLeft).toBe(80)
    view.unmount()
  })

  it('resets relative Note-style scroll when a mounted Card id is reused by another idea', () => {
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 100 },
      clientWidth: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollWidth: { configurable: true, value: 300 },
    })
    const ref = { current: element }
    const view = renderHook(
      ({ ideaId }) => useRelativeScrollPosition(ideaId, 'shared-relative-card', ref),
      { initialProps: { ideaId: 'idea-a' } },
    )

    element.scrollTop = 540
    element.scrollLeft = 60
    act(() => view.result.current.rememberScrollPosition())

    view.rerender({ ideaId: 'idea-b' })
    expect(element.scrollTop).toBe(0)
    expect(element.scrollLeft).toBe(0)
    element.scrollTop = 180
    act(() => view.result.current.rememberScrollPosition())

    view.rerender({ ideaId: 'idea-a' })
    expect(element.scrollTop).toBe(540)
    expect(element.scrollLeft).toBe(60)
    view.unmount()
  })

  it('restores both axes by relative progress when passive and editor geometry differ', () => {
    let scrollHeight = 1_000
    let scrollWidth = 500
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 100 },
      clientWidth: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollWidth: { configurable: true, get: () => scrollWidth },
    })
    const ref = { current: element }
    const view = renderHook(() => useRelativeScrollPosition(
      'relative-axes-idea',
      'relative-axes-card',
      ref,
    ))

    element.scrollTop = 675
    element.scrollLeft = 300
    act(() => view.result.current.rememberScrollPosition())

    scrollHeight = 1_900
    scrollWidth = 900
    element.scrollTop = 0
    element.scrollLeft = 0
    act(() => view.result.current.restoreScrollPosition())

    expect(element.scrollTop).toBe(1_350)
    expect(element.scrollLeft).toBe(600)
    view.unmount()
  })

  it('forgets a stale relative ratio when content no longer overflows', () => {
    let scrollHeight = 1_000
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 100 },
      clientWidth: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollWidth: { configurable: true, value: 100 },
    })
    const ref = { current: element }
    const view = renderHook(
      ({ ideaId }) => useRelativeScrollPosition(ideaId, 'ratio-reset-card', ref),
      { initialProps: { ideaId: 'ratio-reset-idea' } },
    )

    element.scrollTop = 450
    act(() => view.result.current.rememberScrollPosition())
    scrollHeight = 100
    // jsdom does not clamp this the way a browser does, which lets the test
    // prove restoration itself treats no-overflow as authoritative.
    act(() => view.result.current.restoreScrollPosition())
    expect(element.scrollTop).toBe(0)

    // React Flow may reuse the same mounted node across Ideas. The no-overflow
    // authority must already be recorded before the old-key cleanup is skipped.
    view.rerender({ ideaId: 'another-ratio-reset-idea' })
    scrollHeight = 1_000
    view.rerender({ ideaId: 'ratio-reset-idea' })
    expect(element.scrollTop).toBe(0)
    view.unmount()
  })
})
