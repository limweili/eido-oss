// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gatherConnectedThoughtWithCachedSummaries } from '../brain/contextCompaction'
import { budgetFor } from '../brain/modelWindows'
import { runChain, type CompletionStream } from '../brain/runEngine'
import { useGraph } from '../graph/store'
import { DEFAULT_COMPACTION_MODE, type Card, type Connection } from '../graph/types'
import { createSeedMod } from '../mods/seeds'
import { words } from '../shared/words'
import { Chip, ContextRow } from '../ui/primitives'
import { OverlayProvider } from '../ui/overlays'
import { ChainPreview } from './ChainPreview'
import { ContextPeek } from './ContextPeek'

const originalReorderContextItems = useGraph.getState().reorderContextItems

function card(id: string, kind: Card['kind'], text: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 0, y: 0 },
    ...extra,
  }
}

function feed(
  id: string,
  from: string,
  to: string,
  extra: Partial<Connection> = {},
): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...extra,
  }
}

function renderInApp(children: ReactNode) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  return render(<OverlayProvider>{children}</OverlayProvider>, { container: appRoot })
}

function contextPeekFor(askAiCardId: string, onClose: () => void) {
  const state = useGraph.getState()
  const board = state.snapshot()
  const card = board.cards.find((candidate) => candidate.id === askAiCardId)
  const model = card?.model || state.settings.model
  const compiled = gatherConnectedThoughtWithCachedSummaries(board, askAiCardId, {
    budgetTokens: budgetFor(model),
    mode: state.settings.compactionMode ?? DEFAULT_COMPACTION_MODE,
  })
  return (
    <ContextPeek
      compiled={compiled}
      onReorder={state.reorderContextItems}
      onClose={onClose}
    />
  )
}

function resetStore() {
  useGraph.setState((state) => ({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    settings: {
      ...state.settings,
      apiKey: 'test-key',
      model: 'default/model',
      models: ['default/model'],
      reasoningEffort: 'medium',
      compactionMode: 'eager',
    },
    reorderContextItems: originalReorderContextItems,
  }))
}

beforeEach(resetStore)

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  document.body.replaceChildren()
})

describe('shared context row grammar', () => {
  it('keeps full rows silent, marks exceptions, draws Light solid, and removes rank and grip from Avoid', () => {
    render(
      <>
        <ContextRow
          rank={1}
          reorderable
          relation="direct"
          title="Morning commuters"
          meta="DIRECT · HOP 1"
          snippet="Open before the station crowd arrives."
        />
        <ContextRow
          rank={2}
          reorderable
          relation="light"
          title="Pricing instinct"
          status={<Chip tone="attention">SHORTENED</Chip>}
        />
        <ContextRow relation="avoid" title="Mall kiosk" snippet="Reason this path died: tried already" />
      </>,
    )

    const full = screen.getByText('Morning commuters').closest<HTMLElement>('.e-context-row')!
    const light = screen.getByText('Pricing instinct').closest<HTMLElement>('.e-context-row')!
    const avoid = screen.getByText('Mall kiosk').closest<HTMLElement>('.e-context-row')!

    expect(within(full).queryByText(/FULL/i)).not.toBeInTheDocument()
    expect(within(light).getByText('SHORTENED')).toBeInTheDocument()
    expect(light.querySelector('.e-context-row__glyph[data-relation="light"] path'))
      .not.toHaveAttribute('stroke-dasharray')
    expect(within(avoid).queryByText(/^\d+$/)).not.toBeInTheDocument()
    expect(within(avoid).queryByRole('button', { name: 'Drag to rearrange' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Morning commuters').closest('summary')!)
    expect(screen.getByText('DIRECT · HOP 1')).toBeVisible()
    expect(screen.getByText('Open before the station crowd arrives.')).toBeVisible()
  })
})

describe('owned context surfaces', () => {
  it('keeps one trims-first boundary and the complete positive playlist', async () => {
    const reorderContextItems = vi.fn()
    useGraph.setState((state) => ({
      cards: [
        card('direct-one', 'note', 'Primary fact.', { title: 'Primary note' }),
        card('direct-two', 'note', 'Secondary fact.', { title: 'Secondary note' }),
        card('light-note', 'note', 'Ambient fact.', { title: 'Ambient note' }),
        card('avoid-note', 'note', 'Rejected direction.', { title: 'Rejected path' }),
        card('tone-mod', 'mod', '', {
          title: 'Tone',
          modV2: createSeedMod('switch'),
        }),
        card('ask', 'askAi', 'Find the launch angle.'),
      ],
      connections: [
        feed('direct-one-connection', 'direct-one', 'ask', { meta: { contextOrder: 0 } }),
        feed('direct-two-connection', 'direct-two', 'ask', { meta: { contextOrder: 1 } }),
        feed('light-connection', 'light-note', 'ask', {
          strength: 'weak',
          meta: { contextOrder: 2 },
        }),
        feed('avoid-connection', 'avoid-note', 'ask', {
          polarity: 'pushesAgainst',
          reason: 'tried already',
          meta: { contextOrder: 3 },
        }),
        feed('tone-connection', 'tone-mod', 'ask', {
          role: 'modifies',
          meta: { contextOrder: 4 },
        }),
      ],
      settings: { ...state.settings, compactionMode: 'when-needed' },
      reorderContextItems,
    }))

    const view = renderInApp(contextPeekFor('ask', vi.fn()))

    const dialog = await screen.findByRole('dialog', { name: words.peekTitle })
    expect(within(dialog).getAllByRole('separator', { name: /trims first/i })).toHaveLength(1)
    const endFold = within(dialog).getByRole('separator', { name: /trims first/i })
    const light = dialog.querySelector<HTMLElement>('[data-card-id="light-note"]')!
    const avoid = dialog.querySelector<HTMLElement>('[data-card-id="avoid-note"]')!
    expect(light.compareDocumentPosition(endFold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(endFold.compareDocumentPosition(avoid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(within(dialog).queryByText('Cite sources for every claim.')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /SWITCHES/ }))
    const modProjection = dialog.querySelector<HTMLElement>('.context-surface__mod-projection')!
    expect(within(modProjection).getByRole('heading', { level: 3 })).toHaveTextContent('SWITCHES')
    expect(within(modProjection).getAllByRole('listitem')).toHaveLength(3)
    expect(within(modProjection).getByText('Cite sources for every claim.')).toBeVisible()

    act(() => {
      useGraph.setState((state) => ({
        settings: { ...state.settings, compactionMode: 'eager' },
      }))
    })
    view.rerender(<OverlayProvider>{contextPeekFor('ask', vi.fn())}</OverlayProvider>)
    const fold = within(dialog).getByRole('separator', { name: /trims first/i })
    expect(fold.compareDocumentPosition(light) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const first = dialog.querySelector<HTMLElement>('[data-card-id="direct-one"]')!
    fireEvent.click(first.querySelector('summary')!)
    expect(within(first).getByText('DIRECT · HOP 1')).toBeVisible()
    const showText = within(dialog).getByRole('button', { name: words.seeExactText })
    expect(showText).toHaveClass('e-button--quiet')
    fireEvent.click(showText)
    expect(within(dialog).getByText(/## TASK/)).toBeVisible()
    const dataTransfer = { effectAllowed: '', setData: vi.fn() }
    fireEvent.dragStart(within(light).getByRole('button', { name: 'Drag to rearrange' }), {
      dataTransfer,
    })
    fireEvent.dragOver(first)
    fireEvent.drop(first)

    expect(reorderContextItems).toHaveBeenCalledWith([
      'light-connection',
      'direct-one-connection',
      'direct-two-connection',
    ])
  })

  it('renders fresh chain steps as dimmed REUSED rows without explanatory prose', async () => {
    const okStream: CompletionStream = async (_instruction, options) => {
      options.onChunk('answer')
      return 'answer'
    }
    useGraph.setState({
      cards: [
        card('note-a', 'note', 'Fact for A.'),
        card('ask-a', 'askAi', 'Summarise A.'),
        card('result-a', 'result', ''),
        card('note-b', 'note', 'Fact for B.'),
        card('ask-b', 'askAi', 'Expand the summary.'),
      ],
      connections: [
        feed('c0', 'note-a', 'ask-a'),
        feed('c1', 'ask-a', 'result-a'),
        feed('c2', 'result-a', 'ask-b'),
        feed('c3', 'note-b', 'ask-b'),
      ],
    })
    await runChain('ask-b', { stream: okStream })
    useGraph.setState((state) => ({
      cards: state.cards.map((item) =>
        item.id === 'note-b'
          ? { ...item, blocks: [{ ...item.blocks[0]!, text: 'Fact for B, revised.' }] }
          : item,
      ),
    }))

    renderInApp(
      <ChainPreview
        targetAskAiCardId="ask-b"
        mode="peek"
        onRun={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: words.whatWillRun })
    const reused = within(dialog).getByText(/reused/i).closest<HTMLElement>('.e-context-row')!
    expect(reused).toHaveClass('e-context-row--dimmed')
    expect(reused.querySelector('.e-context-row__chevron')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText(words.chainTagSourceChanged)).toHaveTextContent('!')
  })

  it('hands Escape and logical exit to ModalShell before notifying the Context Peek owner', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    useGraph.setState({
      cards: [card('ask', 'askAi', 'Ask something.')],
      connections: [],
    })

    renderInApp(contextPeekFor('ask', onClose))
    screen.getByRole('dialog', { name: words.peekTitle })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.querySelector('.e-overlay-backdrop')).toHaveAttribute('data-state', 'exiting')
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(500))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
