// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as conversationRunner from '../../brain/conversationRunner'
import * as runEngine from '../../brain/runEngine'
import { useGraph } from '../../graph/store'
import type { Card, Connection, Output, OutputVersion, RunKind, RunRecord } from '../../graph/types'
import { words } from '../../shared/words'
import { OverlayProvider } from '../../ui/overlays'
import { ConversationResultCard } from './ConversationResultCard'
import { GroupCard } from './GroupCard'

const member: Card = {
  id: 'source', kind: 'note', title: 'Source note',
  blocks: [{ id: 'source-body', text: 'Changed source' }],
  position: { x: -300, y: 0 }, groupId: 'group',
}
const conversation: Card = {
  id: 'conversation', kind: 'conversation',
  blocks: [{ id: 'conversation-body', text: 'Should we ship?' }],
  position: { x: 0, y: 0 }, conversationStyle: 'critique', conversationTurns: 3,
}
const conversationResult: Card = {
  id: 'conversation-result', kind: 'result',
  blocks: [{ id: 'conversation-result-body', text: '' }], position: { x: 200, y: 100 },
}
const group: Card = {
  id: 'group', kind: 'group', title: 'Launch group',
  blocks: [{ id: 'group-body', text: '' }], position: { x: 500, y: 100 },
  compressionPrompt: 'Keep only the decision.', model: 'openai/fable-5',
}
const conversationConnection: Connection = {
  id: 'conversation-result-connection',
  from: { cardId: conversation.id }, to: { cardId: conversationResult.id },
  strength: 'strong', polarity: 'helps', role: 'feeds',
}

function chosenVersion(
  id: string,
  fromRunId: string,
  text: string,
  transcript?: OutputVersion['transcript'],
): OutputVersion {
  return {
    id, number: 2, text, fromRunId, transcript,
    createdAt: '2026-07-18T00:00:01.000Z',
    accepted: true, provisional: true, provisionalReason: 'canceled',
    sourceContext: {
      version: 1,
      sources: [{ cardId: member.id, kind: member.kind, label: 'Original source', hash: 'old-hash' }],
    },
  }
}

const conversationVersion = chosenVersion('conversation-v2', 'conversation-run', 'Fallback', [
  { id: 'critic', speakerKind: 'participant', speakerName: 'Critic', text: 'First concern' },
  { id: 'question', speakerKind: 'user', speakerName: 'You', text: 'What next?' },
])
const groupVersion = chosenVersion('group-v2', 'group-run', 'Compressed decision')

function output(id: string, resultCardId: string, chosen: OutputVersion): Output {
  return {
    id, resultCardId, chosenVersionId: chosen.id,
    versions: [
      {
        id: `${id}-v1`, number: 1, text: 'Earlier version',
        createdAt: '2026-07-17T00:00:00.000Z', fromRunId: `${chosen.fromRunId}-1`,
      },
      chosen,
    ],
  }
}

function doneRun(id: string, cardId: string, producedVersionId: string, kind: RunKind): RunRecord {
  return {
    id, askAiCardId: cardId, producedVersionId, kind,
    startedAt: '2026-07-18T00:00:00.000Z', finishedAt: '2026-07-18T00:00:01.000Z',
    model: 'openai/fable-5', usedCardIds: [member.id], usedConnectionIds: [],
    modIds: [], appliedMods: [], compiledInstruction: 'Frozen instruction', status: 'done',
  }
}

const conversationOutput = output('conversation-output', conversationResult.id, conversationVersion)
const groupOutput = output('group-output', group.id, groupVersion)
const conversationRun = doneRun('conversation-run', conversation.id, conversationVersion.id, 'conversation')
const groupRun = doneRun('group-run', group.id, groupVersion.id, 'groupDigest')

function props(id: string): NodeProps {
  return { id, selected: true, data: { selectedCardCount: 1 } } as unknown as NodeProps
}

function renderCard(children: ReactNode) {
  if (!document.getElementById('eido-overlay-root')) {
    const overlayRoot = document.createElement('div')
    overlayRoot.id = 'eido-overlay-root'
    document.body.append(overlayRoot)
  }
  return render(
    <OverlayProvider>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </OverlayProvider>,
  )
}

function reset(cards: Card[], connections: Connection[], outputs: Output[], runs: RunRecord[]) {
  useGraph.setState({
    cards, connections, outputs, runs,
    intentLog: [], undoStack: [], redoStack: [],
    selection: null, selectedCardIds: [], activeTool: 'select', hydrated: false,
  })
}

describe('Conversation Result and Group shared result chrome', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = () => undefined
    reset(
      [member, conversation, conversationResult],
      [conversationConnection],
      [conversationOutput],
      [conversationRun],
    )
  })
  afterEach(() => {
    cleanup()
    document.getElementById('eido-overlay-root')?.remove()
    vi.restoreAllMocks()
  })

  it('composes shared chrome at each consumer while preserving their distinct surface', () => {
    const conversationView = renderCard(<ConversationResultCard {...props(conversationResult.id)} />)
    const conversationMeta = conversationView.container.querySelector<HTMLElement>('.card-meta')!
    expect(conversationMeta).toHaveClass('t-micro')
    expect(conversationMeta.querySelector('.model-badge')).toBeNull()
    expect(conversationMeta.querySelector('.source-change-trigger')).toBeInTheDocument()
    expect(conversationView.container.querySelector('.version-switcher .provisional')).toBeInTheDocument()
    expect(conversationView.container.querySelector('.provisional-banner')).toBeNull()
    expect(conversationView.container.querySelector('.e-callout')).toBeNull()

    expect(conversationView.container.querySelector('.bubble-speaker')).toBeNull()
    expect(screen.getByRole('group', { name: 'Critic' })).toHaveTextContent('First concern')
    expect(screen.getByRole('group', { name: words.you })).toHaveTextContent('What next?')

    const composer = conversationView.container.querySelector<HTMLElement>('.interjection')!
    expect(within(composer).getByRole('textbox')).toHaveClass('e-field')
    const continueButton = within(composer).getByRole('button', { name: words.continueRun })
    expect(continueButton).toHaveClass('e-icon-button', 'e-button--primary')
    expect(continueButton.querySelector('.lucide-arrow-up')).toBeInTheDocument()

    const conversationFoot = conversationView.container.querySelector<HTMLElement>('.card-foot')!
    for (const name of [words.copy, words.turnIntoNote, words.makeVariations, words.keepThis, words.showWhatAiUsed]) {
      expect(within(conversationFoot).getByRole('button', { name })).toHaveClass('e-icon-button')
    }
    expect(within(conversationFoot).getByRole('button', { name: words.keepThis })).toHaveAttribute('aria-pressed', 'true')
    expect(conversationFoot.querySelector('.e-state-word')).toBeNull()
    expect(conversationView.container.querySelector('.mini-btn')).toBeNull()
    conversationView.unmount()

    reset([member, group], [], [groupOutput], [groupRun])
    const groupView = renderCard(<GroupCard {...props(group.id)} />)
    const outerFoot = groupView.container.querySelector<HTMLElement>('.group-foot')!
    const details = within(outerFoot).getByRole('button', { name: words.groupDetails })
    expect(details).toHaveClass('e-button', 'e-button--quiet', 'e-button--compact', 'nodrag')
    fireEvent.click(details)

    const groupDialog = screen.getByRole('dialog', { name: words.groupDetailsTitle })
    expect(groupDialog).toHaveClass('e-modal-shell', 'group-modal')
    expect(groupDialog).toHaveTextContent(words.groupDetailsNote)
    expect(within(groupDialog).getByRole('textbox', { name: words.groupName }))
      .toHaveClass('e-field')
    expect(within(groupDialog).getByRole('textbox', { name: words.groupPrompt }))
      .toHaveClass('e-field', 'e-textarea')
    expect(within(groupDialog).getByText(words.groupDigest)).toHaveClass('t-title')
    expect(within(groupDialog).getByText(words.groupMembers)).toHaveClass('t-title')
    const memberDrag = within(groupDialog).getByRole('button', { name: words.dragToRearrange })
    expect(memberDrag).toHaveClass('e-icon-button', 'e-button--compact')
    expect(memberDrag).toHaveAttribute('draggable', 'true')
    expect(memberDrag.querySelector('.lucide-grip-vertical')).toBeInTheDocument()
    const review = document.querySelector<HTMLElement>('.group-version-review')!
    expect(review.querySelector('.card-meta')).toHaveClass('t-micro')
    expect(review.querySelector('.card-meta .source-change-trigger')).toBeInTheDocument()
    expect(review.querySelector('.version-switcher .provisional')).toBeInTheDocument()
    expect(review.querySelector('.provisional-banner')).toBeNull()
    expect(review.querySelector('.e-callout')).toBeNull()

    const actions = review.querySelector<HTMLElement>('.group-version-actions')!
    expect(actions.querySelectorAll('.e-button--primary')).toHaveLength(1)
    expect(within(actions).getByRole('button', { name: words.groupCompress })).toHaveClass('e-button--primary')
    for (const name of [words.copy, words.keepThis, words.showWhatAiUsed]) {
      expect(within(actions).getByRole('button', { name })).toHaveClass('e-icon-button')
    }
    expect(within(actions).getByRole('button', { name: words.keepThis })).toHaveAttribute('aria-pressed', 'true')
    expect(actions.querySelectorAll('.e-state-word')).toHaveLength(1)
    expect(actions.querySelector('.mini-btn')).toBeNull()
  })

  it('keeps variation activity in the transcript and status out of the Result foot', async () => {
    let finishVariation!: (outcome: Awaited<ReturnType<
      typeof conversationRunner.makeConversationVariations
    >>) => void
    vi.spyOn(conversationRunner, 'makeConversationVariations').mockImplementationOnce(() => (
      new Promise((resolve) => {
        finishVariation = resolve
      })
    ))
    const view = renderCard(<ConversationResultCard {...props(conversationResult.id)} />)
    const foot = view.container.querySelector<HTMLElement>('.card-foot')!

    fireEvent.click(within(foot).getByRole('button', { name: words.makeVariations }))

    const transcript = view.container.querySelector<HTMLElement>('.transcript')!
    await waitFor(() => expect(
      within(transcript).getByRole('status', { name: words.runningState }),
    ).toHaveClass('streaming-dot'))
    expect(foot.querySelector('.e-state-word')).toBeNull()

    await act(async () => {
      finishVariation({
        ok: true,
        versionId: conversationVersion.id,
        status: 'done',
        artifacts: Object.freeze([]),
      })
      await Promise.resolve()
    })
    expect(within(transcript).queryByRole('status', { name: words.runningState }))
      .not.toBeInTheDocument()
  })

  it('reuses transcript rows across shell updates and preserves unchanged rows during a stream append', () => {
    const view = renderCard(<ConversationResultCard {...props(conversationResult.id)} />)
    const transcript = view.container.querySelector<HTMLElement>('.transcript')!
    const firstRow = within(transcript).getAllByRole('group', { name: 'Critic' })[0]
    const secondRow = within(transcript).getByRole('group', { name: words.you })

    view.rerender(
      <OverlayProvider>
        <ReactFlowProvider>
          <ConversationResultCard
            {...props(conversationResult.id)}
            selected={false}
            data={{ selectedCardCount: 0 }}
          />
        </ReactFlowProvider>
      </OverlayProvider>,
    )

    expect(within(transcript).getAllByRole('group', { name: 'Critic' })[0]).toBe(firstRow)
    expect(within(transcript).getByRole('group', { name: words.you })).toBe(secondRow)

    act(() => {
      useGraph.setState({
        outputs: [{
          ...conversationOutput,
          versions: [{
            ...conversationVersion,
            transcript: [
              ...(conversationVersion.transcript ?? []),
              {
                id: 'answer',
                speakerKind: 'participant',
                speakerName: 'Critic',
                text: 'The final concern is addressed.',
              },
            ],
          }],
        }],
      })
    })

    expect(within(transcript).getAllByRole('group', { name: 'Critic' })[0]).toBe(firstRow)
    expect(within(transcript).getByRole('group', { name: words.you })).toBe(secondRow)
    expect(screen.getByText('The final concern is addressed.')).toBeInTheDocument()
  })

  it('pairs one next-step callout with the failed state for a lone conversation draft or failed compression', async () => {
    const user = userEvent.setup()
    const failedConversationVersion: OutputVersion = {
      ...conversationVersion,
      number: 1,
      provisionalReason: 'failed',
    }
    reset(
      [member, conversation, conversationResult],
      [conversationConnection],
      [{
        id: 'failed-conversation-output',
        resultCardId: conversationResult.id,
        chosenVersionId: failedConversationVersion.id,
        versions: [failedConversationVersion],
      }],
      [conversationRun],
    )

    const conversationView = renderCard(<ConversationResultCard {...props(conversationResult.id)} />)
    const conversationCallouts = conversationView.container.querySelectorAll('.e-callout')
    expect(conversationCallouts).toHaveLength(1)
    expect(conversationCallouts[0]).toHaveClass('e-callout--avoid')
    expect(within(conversationCallouts[0] as HTMLElement).getByText(words.resultFailureNextStep)).toBeInTheDocument()
    expect(conversationView.container).not.toHaveTextContent(words.provisionalFailed)
    expect(conversationView.container.querySelector('.card-foot .e-state-word')).toBeNull()
    expect(within(conversationView.container).queryByText(words.couldntRun)).not.toBeInTheDocument()
    conversationView.unmount()

    vi.spyOn(runEngine, 'runGroupCompression').mockResolvedValueOnce({
      ok: false,
      reason: 'failed',
      message: 'Provider unavailable',
      artifacts: Object.freeze([]),
    })
    reset([member, group], [], [groupOutput], [groupRun])
    renderCard(<GroupCard {...props(group.id)} />)
    await user.click(screen.getByRole('button', { name: words.groupDetails }))
    await user.click(screen.getByRole('button', { name: words.groupCompress }))

    const groupReview = document.querySelector<HTMLElement>('.group-version-review')!
    await waitFor(() => expect(within(groupReview).getByText(words.couldntRun)).toHaveClass('e-state-word--failed'))
    const groupCallouts = groupReview.querySelectorAll('.e-callout')
    expect(groupCallouts).toHaveLength(1)
    expect(groupCallouts[0]).toHaveClass('e-callout--avoid')
    expect(within(groupCallouts[0] as HTMLElement).getByText(words.resultFailureNextStep)).toBeInTheDocument()
    expect(groupReview.querySelector('.version-switcher .provisional')).toBeInTheDocument()

    const failedStoreRun: RunRecord = {
      ...groupRun,
      status: 'failed',
      errorMessage: 'Provider unavailable',
    }
    act(() => useGraph.setState({ runs: [failedStoreRun] }))
    const implicitRetry: RunRecord = {
      ...groupRun,
      id: 'implicit-group-retry',
      status: 'running',
      finishedAt: undefined,
      producedVersionId: undefined,
    }
    act(() => useGraph.setState({ runs: [failedStoreRun, implicitRetry] }))
    await waitFor(() => expect(within(groupReview).getByText(words.runningState)).toHaveClass('e-state-word--running'))
    expect(groupReview.querySelector('.e-callout')).toBeNull()

    act(() => useGraph.setState({
      runs: [failedStoreRun, { ...implicitRetry, status: 'done', finishedAt: '2026-07-18T00:00:02.000Z' }],
    }))
    await waitFor(() => expect(within(groupReview).getByText(words.ready)).toHaveClass('e-state-word--neutral'))
    expect(groupReview.querySelector('.e-callout')).toBeNull()
    expect(groupReview).not.toHaveTextContent(words.couldntRun)
  })

  it('unwinds nested Version Context before shared group deletion confirmation', async () => {
    const user = userEvent.setup()
    reset([member, group], [], [groupOutput], [groupRun])
    renderCard(<GroupCard {...props(group.id)} />)

    await user.click(screen.getByRole('button', { name: words.groupDetails }))
    const groupDialog = await screen.findByRole('dialog', { name: words.groupDetailsTitle })
    const versionInvoker = within(groupDialog).getByRole('button', { name: words.showWhatAiUsed })
    await user.click(versionInvoker)

    const versionTitle = `${words.versionContextTitle} — v${groupVersion.number}`
    const versionDialog = await screen.findByRole('dialog', { name: versionTitle })
    expect(screen.getByRole('dialog', { name: words.groupDetailsTitle, hidden: true }))
      .toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    const versionBackdrop = versionDialog.parentElement!
    expect(versionBackdrop).toHaveAttribute('data-state', 'exiting')
    expect(screen.getByRole('dialog', { name: words.groupDetailsTitle, hidden: true }))
      .toBeInTheDocument()
    fireEvent.transitionEnd(versionBackdrop, { propertyName: 'opacity' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: versionTitle, hidden: true })).toBeNull()
    })
    expect(screen.getByRole('dialog', { name: words.groupDetailsTitle })).toBe(groupDialog)
    await waitFor(() => expect(versionInvoker).toHaveFocus())

    await user.click(screen.getByRole('button', { name: words.deleteGroup }))
    let dialog = await screen.findByRole('dialog', { name: words.deleteGroup })
    expect(dialog).toHaveTextContent(words.deleteGroupConfirm)

    await user.click(within(dialog).getByRole('button', { name: words.cancel }))
    fireEvent.transitionEnd(dialog.parentElement!, { propertyName: 'opacity' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: words.deleteGroup })).toBeNull())
    expect(useGraph.getState().cards.some(card => card.id === group.id)).toBe(true)

    await user.click(screen.getByRole('button', { name: words.deleteGroup }))
    dialog = await screen.findByRole('dialog', { name: words.deleteGroup })
    await user.click(within(dialog).getByRole('button', { name: words.deleteGroup }))
    fireEvent.transitionEnd(dialog.parentElement!, { propertyName: 'opacity' })

    await waitFor(() => {
      expect(useGraph.getState().cards.some(card => card.id === group.id)).toBe(false)
    })
  })
})
