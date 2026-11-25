// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { ReactFlowProvider, type NodeProps, useStoreApi } from '@xyflow/react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../../graph/store'
import type { Card, Output } from '../../graph/types'
import {
  cardTextProjectionBuildCountForTests,
  resetCardTextProjectionBuildCountForTests,
  resetTextHasContentScanCountForTests,
  textHasContentScanCountForTests,
} from '../../graph/graphHelpers'
import { createSeedMod } from '../../mods'
import { words } from '../../shared/words'
import { OverlayProvider } from '../../ui/overlays'
import { AskAiCard } from './AskAiCard'
import {
  CardShell,
  cardShellTitleProjectionCountForTests,
  resetCardShellTitleProjectionCountForTests,
} from './CardShell'
import { ConversationCard } from './ConversationCard'
import {
  GroupCard,
  groupMemberDetailsProjectionCountForTests,
  groupMemberSemanticProjectionVisitCountForTests,
  resetGroupMemberDetailsProjectionCountForTests,
  resetGroupMemberSemanticProjectionVisitCountForTests,
} from './GroupCard'
import { ModCard } from './ModCard'
import { NoteCard } from './NoteCard'
import { TitleCard } from './TitleCard'
import { CONNECTOR_NODE_METRICS } from '../../ui/tokens'
import { connectorHitScaleForZoom, handleScaleForZoom } from '../zoomChrome'

const cards: Card[] = [
  {
    id: 'shell',
    kind: 'note',
    blocks: [{ id: 'shell-block', text: 'Shell body' }],
    position: { x: 0, y: 0 },
    title: 'Shell title',
  },
  {
    id: 'note',
    kind: 'note',
    blocks: [{ id: 'note-block', text: 'Note body' }],
    position: { x: 40, y: 0 },
  },
  {
    id: 'ask',
    kind: 'askAi',
    blocks: [{ id: 'ask-block', text: 'Ask body' }],
    position: { x: 80, y: 0 },
    model: 'card/model',
  },
  {
    id: 'conversation',
    kind: 'conversation',
    blocks: [{ id: 'conversation-block', text: 'Conversation body' }],
    position: { x: 120, y: 0 },
    conversationStyle: 'critique',
    conversationTurns: 3,
  },
  {
    id: 'group',
    kind: 'group',
    blocks: [{ id: 'group-block', text: '' }],
    position: { x: 160, y: 0 },
    title: 'Group title',
  },
  {
    id: 'group-member',
    kind: 'note',
    blocks: [{ id: 'member-block', text: 'Member body' }],
    position: { x: 200, y: 0 },
    groupId: 'group',
  },
  {
    id: 'mod',
    kind: 'mod',
    blocks: [{ id: 'mod-block', text: '' }],
    position: { x: 240, y: 0 },
    modV2: createSeedMod('slider', {
      title: 'Intensity',
      createId: (_, ordinal) => `mod-part-${ordinal}`,
    }),
  },
  {
    id: 'title',
    kind: 'title',
    blocks: [{ id: 'title-block', text: 'Title body' }],
    position: { x: 280, y: 0 },
  },
]

function nodeProps(id: string, selected = false): NodeProps {
  return {
    id,
    selected,
    data: { selectedCardCount: selected ? 1 : 0 },
  } as unknown as NodeProps
}

function patchCard(id: string, patch: Partial<Card>) {
  useGraph.setState((state) => ({
    cards: state.cards.map((card) => card.id === id ? { ...card, ...patch } : card),
  }))
}

function Track({ id, onRender, children }: {
  id: string
  onRender: ProfilerOnRenderCallback
  children: ReactNode
}) {
  return <Profiler id={id} onRender={onRender}>{children}</Profiler>
}

function cardsElement(onRender: ProfilerOnRenderCallback, selected = false) {
  return (
    <OverlayProvider>
      <ReactFlowProvider>
        <Track id="shell" onRender={onRender}>
          <CardShell id="shell" kind="note" selected={selected} data={{ selectedCardCount: selected ? 1 : 0 }}>
            <div>Shell body</div>
          </CardShell>
        </Track>
        <Track id="note" onRender={onRender}>
          <NoteCard {...nodeProps('note', selected)} />
        </Track>
        <Track id="ask" onRender={onRender}>
          <AskAiCard {...nodeProps('ask', selected)} />
        </Track>
        <Track id="conversation" onRender={onRender}>
          <ConversationCard {...nodeProps('conversation', selected)} />
        </Track>
        <Track id="group" onRender={onRender}>
          <GroupCard {...nodeProps('group', selected)} />
        </Track>
        <Track id="mod" onRender={onRender}>
          <ModCard {...nodeProps('mod', selected)} />
        </Track>
        <Track id="title" onRender={onRender}>
          <TitleCard {...nodeProps('title', selected)} />
        </Track>
      </ReactFlowProvider>
    </OverlayProvider>
  )
}

function renderCards(onRender: ProfilerOnRenderCallback) {
  return render(cardsElement(onRender))
}

describe('Card geometry subscription isolation', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn()
    useGraph.setState({
      cards: structuredClone(cards),
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
      lastBoardChange: null,
      boardChangeSeq: 0,
      saveState: 'saved',
      hydrated: false,
      currentIdeaId: null,
      keyPromptOpen: false,
      linkupKeyPresent: false,
      activeTool: 'select',
      settings: {
        ...useGraph.getState().settings,
        apiKey: 'test-key',
        provider: 'openrouter',
        model: 'default/model',
        models: ['default/model', 'card/model'],
      },
    })
  })

  afterEach(() => {
    cleanup()
    document.body.replaceChildren()
  })

  it('does not commit semantic Cards or the common shell for position-only replacements', () => {
    const commits = new Map<string, number>()
    renderCards((id, phase) => {
      if (phase === 'update') commits.set(id, (commits.get(id) ?? 0) + 1)
    })

    for (const id of ['shell', 'note', 'ask', 'conversation', 'group', 'mod', 'title']) {
      commits.clear()
      const card = useGraph.getState().graph().cardById(id)!
      act(() => patchCard(id, { position: { x: card.position.x + 11, y: card.position.y + 7 } }))
      expect(commits.get(id) ?? 0, id).toBe(0)
    }

    commits.clear()
    const member = useGraph.getState().graph().cardById('group-member')!
    act(() => patchCard('group-member', {
      position: { x: member.position.x + 11, y: member.position.y + 7 },
    }))
    expect(commits.get('group') ?? 0, 'moving a Group member').toBe(0)
  })

  it('does not rebuild complete editable Card text when selection starts a drag', () => {
    const onRender = vi.fn<ProfilerOnRenderCallback>()
    const view = renderCards(onRender)
    resetCardTextProjectionBuildCountForTests()
    resetTextHasContentScanCountForTests()

    view.rerender(cardsElement(onRender, true))

    expect(cardTextProjectionBuildCountForTests()).toBe(0)
    expect(textHasContentScanCountForTests()).toBe(0)

    act(() => patchCard('note', {
      blocks: [{ id: 'note-block', text: 'Semantically replaced note body' }],
    }))
    expect(cardTextProjectionBuildCountForTests()).toBe(1)
    expect(textHasContentScanCountForTests()).toBe(1)
    expect(screen.getByText('Semantically replaced note body')).toBeInTheDocument()

    resetTextHasContentScanCountForTests()
    act(() => patchCard('note', {
      blocks: [{ id: 'note-block', text: ' \n ' }],
    }))
    expect(textHasContentScanCountForTests()).toBe(1)
    expect(screen.getByText(words.notePlaceholder)).toBeInTheDocument()
  })

  it('does not retrim a large unchanged Card title during selection or drag start', () => {
    const largeTitle = `${' '.repeat(500_000)}Large shell title${' '.repeat(500_000)}`
    useGraph.setState((state) => ({
      cards: state.cards.map((card) => card.id === 'shell' ? { ...card, title: largeTitle } : card),
    }))
    const onRender = vi.fn<ProfilerOnRenderCallback>()
    const view = renderCards(onRender)
    expect(screen.getByText('Large shell title')).toBeInTheDocument()
    resetCardShellTitleProjectionCountForTests()

    view.rerender(cardsElement(onRender, true))

    expect(cardShellTitleProjectionCountForTests()).toBe(0)
    act(() => useGraph.getState().setCardTitle(
      'shell',
      `${' '.repeat(500_000)}Changed shell title${' '.repeat(500_000)}`,
    ))
    expect(cardShellTitleProjectionCountForTests()).toBe(1)
    expect(screen.getByText('Changed shell title')).toBeInTheDocument()
  })

  it('does not revisit Group member semantics on repeated real geometry commits', () => {
    const extraMembers: Card[] = Array.from({ length: 255 }, (_, index) => ({
      id: `group-member-extra-${index}`,
      kind: 'note',
      blocks: [{ id: `group-member-extra-block-${index}`, text: `Member ${index}` }],
      position: { x: 220 + (index % 10), y: 20 + (index % 20) },
      groupId: 'group',
    }))
    useGraph.setState((state) => ({
      cards: [
        ...state.cards.map((card, index) => (
          card.id === 'group' || card.id === 'group-member'
            ? card
            : { ...card, position: { x: -2_000 - index * 100, y: -2_000 } }
        )),
        ...extraMembers,
      ],
    }))
    renderCards(vi.fn<ProfilerOnRenderCallback>())
    resetGroupMemberSemanticProjectionVisitCountForTests()

    act(() => {
      for (let step = 1; step <= 30; step += 1) {
        useGraph.getState().moveCard(
          'group',
          { x: 160 + step, y: step },
          { recordHistory: false },
        )
      }
    })

    expect(groupMemberSemanticProjectionVisitCountForTests()).toBe(0)

    act(() => useGraph.getState().setCardText('group-member', 'Changed member semantics'))
    expect(groupMemberSemanticProjectionVisitCountForTests()).toBe(256)
  })

  it('does not construct closed Group details during selection or drag start', async () => {
    const largeMembers: Card[] = Array.from({ length: 128 }, (_, index) => ({
      id: `large-group-member-${index}`,
      kind: 'note',
      blocks: [{
        id: `large-group-member-block-${index}`,
        text: index === 127 ? `Last member sentinel ${'z'.repeat(8_000)}` : 'x'.repeat(8_192),
      }],
      position: { x: 220 + (index % 10), y: 20 + (index % 20) },
      groupId: 'group',
    }))
    useGraph.setState((state) => ({ cards: [...state.cards, ...largeMembers] }))
    const onRender = vi.fn<ProfilerOnRenderCallback>()
    const view = renderCards(onRender)
    resetGroupMemberDetailsProjectionCountForTests()

    view.rerender(cardsElement(onRender, true))

    expect(groupMemberDetailsProjectionCountForTests()).toBe(0)
    const details = within(view.container).getByRole('button', { name: words.groupDetails })
    details.focus()
    fireEvent.click(details)
    expect(groupMemberDetailsProjectionCountForTests()).toBe(129)
    const dialog = screen.getByRole('dialog', { name: words.groupDetailsTitle })
    expect([...dialog.querySelectorAll('.group-member-body pre')].some(
      (element) => element.textContent?.includes('Last member sentinel'),
    )).toBe(true)

    resetGroupMemberDetailsProjectionCountForTests()
    const closeButtons = within(dialog).getAllByRole('button', { name: words.close })
    fireEvent.click(closeButtons[closeButtons.length - 1]!)
    expect(groupMemberDetailsProjectionCountForTests()).toBe(0)
    fireEvent.transitionEnd(dialog.parentElement!, { propertyName: 'opacity' })
    await vi.waitFor(() => expect(details).toHaveFocus())

    view.rerender(cardsElement(onRender, false))
    view.rerender(cardsElement(onRender, true))
    expect(groupMemberDetailsProjectionCountForTests()).toBe(0)
  })

  it('invalidates Group member projection when a Result member chooses another output version', () => {
    const resultMember: Card = {
      id: 'group-result-member',
      kind: 'result',
      blocks: [{ id: 'group-result-member-block', text: '' }],
      position: { x: 240, y: 60 },
      groupId: 'group',
    }
    const resultOutput: Output = {
      id: 'group-result-output',
      resultCardId: resultMember.id,
      chosenVersionId: 'group-result-v1',
      versions: [
        {
          id: 'group-result-v1', number: 1, text: 'First result text',
          createdAt: '2026-08-21T00:00:00.000Z', fromRunId: 'group-result-run-1',
        },
        {
          id: 'group-result-v2', number: 2, text: 'Second result text',
          createdAt: '2026-08-21T00:00:01.000Z', fromRunId: 'group-result-run-2',
        },
      ],
    }
    useGraph.setState((state) => ({
      cards: [...state.cards, resultMember],
      outputs: [resultOutput],
    }))
    const view = renderCards(vi.fn<ProfilerOnRenderCallback>())
    fireEvent.click(within(view.container).getByRole('button', { name: words.groupDetails }))
    const dialog = screen.getByRole('dialog', { name: words.groupDetailsTitle })
    const resultBody = [...dialog.querySelectorAll<HTMLElement>('.group-member-body pre')]
      .find((element) => element.textContent?.includes('First result text'))
    expect(resultBody).toHaveTextContent('v1 (chosen):')
    resetGroupMemberSemanticProjectionVisitCountForTests()

    act(() => useGraph.getState().chooseVersion(resultOutput.id, 'group-result-v2'))

    expect(groupMemberSemanticProjectionVisitCountForTests()).toBe(2)
    expect(resultBody).toHaveTextContent('v2 (chosen):')
  })

  it('invalidates Group member projection for authored membership and order', () => {
    useGraph.setState((state) => ({
      cards: state.cards.map((card) => (
        card.id === 'note' || card.id === 'ask' ? { ...card, groupId: 'group' } : card
      )),
    }))
    const view = renderCards(vi.fn<ProfilerOnRenderCallback>())
    fireEvent.click(within(view.container).getByRole('button', { name: words.groupDetails }))
    const dialog = screen.getByRole('dialog', { name: words.groupDetailsTitle })
    const memberTitles = () => [...dialog.querySelectorAll<HTMLElement>('.group-member-item .context-title')]
      .map((element) => element.textContent)
    expect(memberTitles()).toEqual(['Note body', 'Ask body', 'Member body'])
    resetGroupMemberSemanticProjectionVisitCountForTests()

    act(() => useGraph.getState().reorderGroupMembers(
      'group',
      ['group-member', 'ask', 'note'],
    ))

    expect(groupMemberSemanticProjectionVisitCountForTests()).toBe(3)
    expect(memberTitles()).toEqual(['Member body', 'Ask body', 'Note body'])
    resetGroupMemberSemanticProjectionVisitCountForTests()

    act(() => useGraph.getState().removeCardFromGroup('ask'))

    expect(groupMemberSemanticProjectionVisitCountForTests()).toBe(2)
    expect(memberTitles()).toEqual(['Member body', 'Note body'])
  })

  it('fails safe when Group projection change metadata is missing or skips a sequence', () => {
    renderCards(vi.fn<ProfilerOnRenderCallback>())
    resetGroupMemberSemanticProjectionVisitCountForTests()

    act(() => useGraph.setState((state) => {
      const seq = state.boardChangeSeq + 2
      return {
        cards: state.cards.map((card) => card.id === 'group-member'
          ? { ...card, blocks: [{ id: 'member-block', text: 'Hidden behind a sequence gap' }] }
          : card),
        boardChangeSeq: seq,
        lastBoardChange: {
          seq,
          source: 'commit',
          change: {
            cards: { updated: ['group-member'] },
            cardAspects: ['position'],
          },
        },
      }
    }))
    expect(groupMemberSemanticProjectionVisitCountForTests()).toBe(1)

    resetGroupMemberSemanticProjectionVisitCountForTests()
    act(() => useGraph.setState((state) => ({
      cards: state.cards.map((card) => card.id === 'group-member'
        ? { ...card, blocks: [{ id: 'member-block', text: 'Missing change metadata' }] }
        : card),
      boardChangeSeq: state.boardChangeSeq + 1,
      lastBoardChange: null,
    })))
    expect(groupMemberSemanticProjectionVisitCountForTests()).toBe(1)
  })

  it('updates connector chrome for zoom without rendering semantic Card content', () => {
    let setZoom!: (zoom: number) => void
    const semanticRender = vi.fn()
    function ZoomControl() {
      const store = useStoreApi()
      setZoom = (zoom) => store.setState({ transform: [0, 0, zoom] })
      return null
    }
    function SemanticBody() {
      semanticRender()
      return <div data-testid="semantic-body">A very large semantic body</div>
    }
    const view = render(
      <ReactFlowProvider>
        <ZoomControl />
        <CardShell id="shell" kind="note" selected={false} data={{ selectedCardCount: 0 }}>
          <SemanticBody />
        </CardShell>
      </ReactFlowProvider>,
    )
    const root = view.container.querySelector<HTMLElement>('.card')!
    const connectors = [...view.container.querySelectorAll<HTMLElement>('.card-connector')]
    expect(connectors).toHaveLength(2)
    expect(root.style.getPropertyValue('--e-connector-flow-size')).toBe('')

    const expectLocalChrome = (zoom: number) => {
      const scale = handleScaleForZoom(zoom)
      for (const connector of connectors) {
        expect(connector.style.getPropertyValue('--e-connector-flow-size'))
          .toBe(`${CONNECTOR_NODE_METRICS.diameter * scale}px`)
        expect(connector.style.getPropertyValue('--e-connector-flow-stroke'))
          .toBe(`${CONNECTOR_NODE_METRICS.stroke * scale}px`)
        expect(connector.style.getPropertyValue('--e-connector-flow-focus-ring'))
          .toBe(`${CONNECTOR_NODE_METRICS.focusRing * scale}px`)
        expect(connector.style.getPropertyValue('--e-connector-hit-inner-scale'))
          .toBe(connectorHitScaleForZoom(zoom).toFixed(3))
      }
    }

    expectLocalChrome(1)
    expect(semanticRender).toHaveBeenCalledOnce()
    act(() => setZoom(0.5))
    expectLocalChrome(0.5)
    act(() => setZoom(2))
    expectLocalChrome(2)
    expect(semanticRender).toHaveBeenCalledOnce()
  })

  it('still commits the owning Card for semantic and rendered-frame changes', () => {
    const commits = new Map<string, number>()
    renderCards((id, phase) => {
      if (phase === 'update') commits.set(id, (commits.get(id) ?? 0) + 1)
    })

    const changeAndExpectCommit = (owner: string, change: () => void) => {
      commits.clear()
      act(change)
      expect(commits.get(owner) ?? 0, owner).toBeGreaterThan(0)
    }

    changeAndExpectCommit('shell', () => patchCard('shell', { title: 'Changed shell title' }))
    expect(screen.getByText('Changed shell title')).toBeInTheDocument()

    changeAndExpectCommit('shell', () => patchCard('shell', {
      headerColor: '#F1666D',
      headerFill: 'full',
      size: { width: 320, height: 180 },
    }))
    expect(screen.getByText('Changed shell title').closest('.card')).toHaveClass('fixed-h', 'fill-full')

    changeAndExpectCommit('note', () => patchCard('note', {
      blocks: [{ id: 'note-block', text: 'Changed note body' }],
    }))
    expect(screen.getByText('Changed note body')).toBeInTheDocument()

    changeAndExpectCommit('ask', () => patchCard('ask', {
      blocks: [{ id: 'ask-block', text: 'Changed ask body' }],
    }))
    expect(screen.getByText('Changed ask body')).toBeInTheDocument()

    changeAndExpectCommit('conversation', () => patchCard('conversation', {
      blocks: [{ id: 'conversation-block', text: 'Changed conversation body' }],
    }))
    expect(screen.getByText('Changed conversation body')).toBeInTheDocument()

    changeAndExpectCommit('group', () => patchCard('group', { title: 'Changed group title' }))
    expect(screen.getByRole('button', { name: 'Group title' })).toHaveTextContent('Changed group title')

    changeAndExpectCommit('group', () => patchCard('group-member', {
      blocks: [{ id: 'member-block', text: 'Changed member body' }],
    }))

    const mod = useGraph.getState().graph().cardById('mod')!.modV2!
    changeAndExpectCommit('mod', () => patchCard('mod', {
      modV2: { ...mod, title: 'Changed Mod' },
    }))
    expect(screen.getByRole('button', { name: 'Mod title' })).toHaveTextContent('Changed Mod')

    changeAndExpectCommit('title', () => patchCard('title', {
      blocks: [{ id: 'title-block', text: 'Changed title body' }],
      size: { width: 300, height: 120 },
    }))
    expect(screen.getByDisplayValue('Changed title body')).toHaveClass('title-card-input')
  })
})
