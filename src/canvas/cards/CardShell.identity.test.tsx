// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../../graph/store'
import type { Card } from '../../graph/types'
import {
  CARD_IDENTITIES,
  DEFAULT_CARD_IDENTITY,
  resolveCardIdentity,
} from '../../ui/cardIdentity'
import { CardShell } from './CardShell'
import { PlaybackCard } from './PlaybackCard'
import { TitleCard } from './TitleCard'

function card(headerColor: string): Card {
  return {
    id: 'identity-note',
    kind: 'note',
    blocks: [{ id: 'identity-note-block', text: 'Identity' }],
    position: { x: 0, y: 0 },
    size: { width: 260, height: 160 },
    title: 'Identity note',
    headerColor,
    headerFill: 'full',
  }
}

function resetStore(headerColor = '#F1666D') {
  useGraph.setState({
    cards: [card(headerColor)],
    connections: [],
    outputs: [],
    runs: [],
    compactionSummaries: [],
    intentLog: [],
    highlights: [],
    highlightTags: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    activeTool: 'select',
  })
}

function renderLive(selected = false) {
  return render(
    <ReactFlowProvider>
      <CardShell
        id="identity-note"
        kind="note"
        selected={selected}
        data={{ selectedCardCount: selected ? 1 : 0 }}
      >
        <div className="card-body">Identity body</div>
      </CardShell>
    </ReactFlowProvider>,
  )
}

const BODY_FOREGROUND_PROPERTY_BY_ROLE = {
  '--identity-body-ink': 'ink',
  '--identity-body-ink-soft': 'inkSoft',
  '--identity-body-ink-faint': 'inkFaint',
  '--identity-body-go-ink': 'goInk',
  '--identity-body-avoid-ink': 'avoidInk',
  '--identity-body-mod-ink': 'modInk',
  '--identity-body-convo-ink': 'convoInk',
  '--identity-body-attention-ink': 'attentionInk',
} as const

function expectBodyForegroundProperties(
  element: HTMLElement,
  expected: ReturnType<typeof resolveCardIdentity>,
  scope: 'all' | 'neutral' = 'all',
) {
  for (const [property, role] of Object.entries(BODY_FOREGROUND_PROPERTY_BY_ROLE)) {
    const neutral = role === 'ink' || role === 'inkSoft' || role === 'inkFaint'
    expect(element.style.getPropertyValue(property), property).toBe(
      scope === 'all' || neutral ? expected.bodyForegrounds[role] : '',
    )
  }
  expect(element.style.getPropertyValue('--card-body-ink')).toBe('')
}

describe('CardShell identity rendering', () => {
  beforeEach(() => resetStore())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('marks only agent-created Cards that the user has not adopted', () => {
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const user = { kind: 'user', client: 'eido-desktop', sessionId: 'user-session' } as const
    useGraph.setState({
      cards: [{ ...useGraph.getState().cards[0]!, createdBy: agent, lastModifiedBy: agent }],
    })
    const rendered = renderLive()
    const live = rendered.container.querySelector<HTMLElement>('.card')!

    expect(live.classList.contains('agent-unadopted')).toBe(true)

    act(() => useGraph.setState({
      cards: [{ ...useGraph.getState().cards[0]!, lastModifiedBy: user }],
    }))
    expect(live.classList.contains('agent-unadopted')).toBe(false)

    act(() => useGraph.setState({
      cards: [{ ...useGraph.getState().cards[0]!, createdBy: undefined, lastModifiedBy: undefined }],
    }))
    expect(live.classList.contains('agent-unadopted')).toBe(false)
  })

  it('keeps an Agent-created Title accented until the user adopts it', () => {
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    useGraph.setState({
      cards: [{
        ...useGraph.getState().cards[0]!,
        kind: 'title',
        createdBy: agent,
        lastModifiedBy: agent,
      }],
    })
    const rendered = render(
      <ReactFlowProvider>
        <TitleCard {...({ id: 'identity-note', selected: false } as NodeProps)} />
      </ReactFlowProvider>,
    )
    const titleCard = rendered.container.querySelector<HTMLElement>('.title-card')!
    const input = rendered.container.querySelector<HTMLTextAreaElement>('.title-card-input')!

    expect(titleCard.classList.contains('agent-unadopted')).toBe(true)

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Adopted title' } })
    fireEvent.blur(input)

    expect(titleCard.classList.contains('agent-unadopted')).toBe(false)
    expect(useGraph.getState().cards[0]?.createdBy).toEqual(agent)
    expect(useGraph.getState().cards[0]?.lastModifiedBy?.kind).toBe('user')
  })

  it('marks both connector nodes for the shared visual recipe without tooltip copy', () => {
    const { container } = renderLive()
    const connectors = [...container.querySelectorAll<HTMLElement>('.card-connector')]

    expect(connectors).toHaveLength(2)
    expect(connectors.every((connector) => !connector.hasAttribute('data-connector-label'))).toBe(true)
    expect(connectors[0]?.classList.contains('react-flow__handle-left')).toBe(true)
    expect(connectors[1]?.classList.contains('react-flow__handle-right')).toBe(true)
  })

  it('gives live and playback the same assigned inks while retaining raw casing', () => {
    const expected = resolveCardIdentity('#F1666D')
    const liveRender = renderLive()
    const live = liveRender.container.querySelector<HTMLElement>('.card')!
    expect(live.style.getPropertyValue('--card-header-color')).toBe('#F1666D')
    expect(live.style.getPropertyValue('--card-header-ink')).toBe(expected.onSolid)
    expectBodyForegroundProperties(live, expected)
    liveRender.unmount()

    const playbackCard = card('#F1666D')
    const playbackRender = render(
      <ReactFlowProvider>
        <PlaybackCard
          {...({ data: { card: playbackCard, ghost: false } } as unknown as NodeProps)}
        />
      </ReactFlowProvider>,
    )
    const playback = playbackRender.container.querySelector<HTMLElement>('.playback-card')!
    expect(playback.style.getPropertyValue('--card-header-color')).toBe('#F1666D')
    expect(playback.style.getPropertyValue('--card-header-ink')).toBe(expected.onSolid)
    expectBodyForegroundProperties(playback, expected, 'neutral')
  })

  it('assigns design-system typography roles to live and playback title surfaces', () => {
    useGraph.setState({
      cards: [{ ...useGraph.getState().cards[0]!, title: '' }],
    })
    const liveRender = renderLive(true)
    const titleDisplay = liveRender.container.querySelector<HTMLElement>('.card-title-display')!

    expect(titleDisplay.classList.contains('t-title')).toBe(true)

    fireEvent.click(titleDisplay)
    const titleInput = liveRender.container.querySelector<HTMLInputElement>('.card-title-input')!
    expect(titleInput.classList.contains('t-title')).toBe(true)
    liveRender.unmount()

    const playbackRender = render(
      <ReactFlowProvider>
        <PlaybackCard
          {...({ data: { card: card('#F1666D'), ghost: false } } as unknown as NodeProps)}
        />
      </ReactFlowProvider>,
    )
    expect(
      playbackRender.container
        .querySelector<HTMLElement>('.card-title-display')!
        .classList.contains('t-title'),
    ).toBe(true)
  })

  it('renders the final Popover with twelve rainbow-ordered solids in a 6×2 grid', () => {
    const parentPointerDown = vi.fn()
    const parentClick = vi.fn()
    render(
      <div onPointerDown={parentPointerDown} onClick={parentClick}>
        <ReactFlowProvider>
          <CardShell id="identity-note" kind="note" selected={false} data={{ selectedCardCount: 0 }}>
            <div className="card-body">Identity body</div>
          </CardShell>
        </ReactFlowProvider>
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Card colour' }))
    expect(document.querySelector('.e-popover')).not.toBeNull()

    const swatches = [
      ...document.querySelectorAll<HTMLButtonElement>('.e-colour-picker__swatch'),
    ]
    expect(
      swatches.map((swatch) => swatch.style.getPropertyValue('--e-colour-picker-swatch')),
    ).toEqual(
      CARD_IDENTITIES.map((identity) => identity.solid),
    )
    expect(swatches).toHaveLength(12)

    parentPointerDown.mockClear()
    parentClick.mockClear()
    fireEvent.pointerDown(swatches[4]!, { pointerId: 8 })
    fireEvent.click(swatches[4]!)
    expect(parentPointerDown).not.toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
    expect(useGraph.getState().cards[0]!.headerColor).toBe(CARD_IDENTITIES[4].solid)
  })

  it('composes shared tooltips through the Popover trigger without losing click or focus', () => {
    vi.useFakeTimers()
    const parentPointerDown = vi.fn()
    const parentClick = vi.fn()
    render(
      <div onPointerDown={parentPointerDown} onClick={parentClick}>
        <ReactFlowProvider>
          <CardShell id="identity-note" kind="note" selected={false} data={{ selectedCardCount: 0 }}>
            <div className="card-body">Identity body</div>
          </CardShell>
        </ReactFlowProvider>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'Card colour' })

    expect(trigger.hasAttribute('title')).toBe(false)
    fireEvent.pointerEnter(trigger)
    act(() => vi.advanceTimersByTime(599))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip').textContent).toBe('CARD COLOUR')
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
    fireEvent.pointerLeave(trigger)
    const exitingTriggerTip = document.querySelector<HTMLElement>('.e-tooltip[data-state="exiting"]')
    if (exitingTriggerTip) fireEvent.transitionEnd(exitingTriggerTip, { propertyName: 'opacity' })

    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    expect(parentPointerDown).not.toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
    expect(document.querySelector('.card-color-popover')).not.toBeNull()
    expect(document.querySelector('.card-color-popover .e-colour-picker')).not.toBeNull()

    const paletteControls = [
      ...document.querySelectorAll<HTMLElement>('.card-color-popover button'),
    ]
    expect(paletteControls).toHaveLength(16)
    expect([trigger, ...paletteControls].filter((control) => control.hasAttribute('title'))).toEqual(
      [],
    )
    expect(
      document.querySelectorAll('.e-colour-picker__modes > .e-colour-picker__mode'),
    ).toHaveLength(4)
    expect(
      document.querySelectorAll('.e-colour-picker__swatches > .e-colour-picker__swatch'),
    ).toHaveLength(12)

    const tooltipCases = [
      [screen.getByRole('radio', { name: 'Soft fill' }), 'SOFT FILL'],
    ] as const
    for (const [control, content] of tooltipCases) {
      fireEvent.keyDown(control, { key: 'Shift' })
      fireEvent.focus(control)
      act(() => vi.advanceTimersByTime(599))
      expect(screen.queryByRole('tooltip')).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByRole('tooltip').textContent).toBe(content)
      fireEvent.blur(control)
      const exiting = document.querySelector<HTMLElement>('.e-tooltip[data-state="exiting"]')
      if (exiting) fireEvent.transitionEnd(exiting, { propertyName: 'opacity' })
    }

    const charcoal = screen.getByRole('radio', { name: 'Set card colour Charcoal' })
    fireEvent.pointerEnter(charcoal)
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(charcoal)
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(charcoal.hasAttribute('aria-describedby')).toBe(false)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.e-popover')?.getAttribute('aria-hidden')).toBe('true')
  })

  it.each(['#F1666D', '#777777']) (
    'carries the resolved %s identity into the portalled fill specimens',
    (rawColor) => {
      resetStore(rawColor)
      const expected = resolveCardIdentity(rawColor)
      const view = renderLive()

      fireEvent.click(screen.getByRole('button', { name: 'Card colour' }))
      const popover = document.querySelector<HTMLElement>('.card-color-popover')!

      expect(popover.style.getPropertyValue('--card-header-color')).toBe(rawColor)
      expect(popover.style.getPropertyValue('--card-header-soft')).toBe(expected.soft)
      expect(popover.style.getPropertyValue('--card-header-body')).toBe(expected.body)
      expect(popover.style.getPropertyValue('--card-header-ink')).toBe(expected.onSolid)
      expectBodyForegroundProperties(popover, expected)
      expect(popover.style.getPropertyValue('--card-header-pattern-head')).toBe(
        expected.patternHead,
      )
      expect(popover.style.getPropertyValue('--card-header-pattern')).toBe(expected.pattern)

      view.unmount()
    },
  )

  it('previews the default identity without assigning colour until a fill is chosen', () => {
    const uncoloured = card(DEFAULT_CARD_IDENTITY)
    delete uncoloured.headerColor
    delete uncoloured.headerFill
    useGraph.setState({ cards: [uncoloured], undoStack: [], redoStack: [] })
    const beforeOpen = JSON.stringify({
      cards: useGraph.getState().cards,
      undoStack: useGraph.getState().undoStack,
      redoStack: useGraph.getState().redoStack,
    })
    const expected = resolveCardIdentity(DEFAULT_CARD_IDENTITY)
    const view = renderLive()
    const liveCard = view.container.querySelector<HTMLElement>('.card')!

    fireEvent.click(screen.getByRole('button', { name: 'Card colour' }))
    const popover = document.querySelector<HTMLElement>('.card-color-popover')!

    expect(liveCard.style.getPropertyValue('--card-header-color')).toBe('')
    expect(popover.style.getPropertyValue('--card-header-color')).toBe(DEFAULT_CARD_IDENTITY)
    expect(popover.style.getPropertyValue('--card-header-soft')).toBe(expected.soft)
    expect(popover.style.getPropertyValue('--card-header-body')).toBe(expected.body)
    expect(popover.style.getPropertyValue('--card-header-ink')).toBe(expected.onSolid)
    expectBodyForegroundProperties(popover, expected)
    expect(popover.style.getPropertyValue('--card-header-pattern-head')).toBe(
      expected.patternHead,
    )
    expect(popover.style.getPropertyValue('--card-header-pattern')).toBe(expected.pattern)
    expect(screen.queryByLabelText('Custom card colour')).toBeNull()
    expect(screen.getByRole('radio', { name: 'No fill' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    for (const name of ['Soft fill', 'Body fill', 'Pattern fill']) {
      expect(screen.getByRole('radio', { name }).getAttribute('aria-checked')).toBe('false')
    }
    for (const identity of CARD_IDENTITIES) {
      expect(
        screen
          .getByRole('radio', { name: `Set card colour ${identity.name}` })
          .getAttribute('aria-checked'),
      ).toBe('false')
    }
    expect(
      JSON.stringify({
        cards: useGraph.getState().cards,
        undoStack: useGraph.getState().undoStack,
        redoStack: useGraph.getState().redoStack,
      }),
    ).toBe(beforeOpen)

    fireEvent.click(screen.getByRole('radio', { name: 'Soft fill' }))
    expect(useGraph.getState().cards[0]).toMatchObject({
      headerColor: DEFAULT_CARD_IDENTITY,
      headerFill: 'half',
    })
  })
})
