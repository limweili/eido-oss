// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { memo, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sourceChangeStatus } from '../../brain/sourceContext'
import { useGraph } from '../../graph/store'
import {
  resetTextHasContentScanCountForTests,
  textHasContentScanCountForTests,
} from '../../graph/graphHelpers'
import type { Card, Connection, FollowUpMessage, Output, OutputVersion, RunRecord } from '../../graph/types'
import { renderMarkdown } from '../../shared/markdown'
import { words } from '../../shared/words'
import { OverlayProvider } from '../../ui/overlays'
import { DESIGN_TIMING_MS } from '../../ui/tokens'
import { ResultCard } from './ResultCard'

const { followUpBubbleRender } = vi.hoisted(() => ({ followUpBubbleRender: vi.fn() }))

vi.mock('../../shared/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/markdown')>()
  return { ...actual, renderMarkdown: vi.fn(actual.renderMarkdown) }
})

vi.mock('./ResultFollowUpBubble', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ResultFollowUpBubble')>()
  const InstrumentedFollowUpBubble = memo((props: ComponentProps<typeof actual.FollowUpBubble>) => {
    followUpBubbleRender()
    return <actual.FollowUpBubble {...props} />
  })
  return { ...actual, FollowUpBubble: InstrumentedFollowUpBubble }
})

const chosenText = '  Exact **chosen** text\nwith its spacing.  '

const sourceCard: Card = {
  id: 'source',
  kind: 'note',
  title: 'Live source',
  blocks: [{ id: 'source-body', text: 'Changed source text' }],
  position: { x: -300, y: 0 },
}

const askCard: Card = {
  id: 'ask',
  kind: 'askAi',
  blocks: [{ id: 'ask-body', text: 'Write the answer.' }],
  position: { x: 0, y: 0 },
}

const resultCard: Card = {
  id: 'result',
  kind: 'result',
  blocks: [{ id: 'result-body', text: '' }],
  position: { x: 100, y: 200 },
}

const producingConnection: Connection = {
  id: 'ask-result',
  from: { cardId: askCard.id },
  to: { cardId: resultCard.id },
  strength: 'strong',
  polarity: 'helps',
  role: 'feeds',
}

const run: RunRecord = {
  id: 'run-2',
  startedAt: '2026-07-18T00:00:00.000Z',
  finishedAt: '2026-07-18T00:00:01.000Z',
  askAiCardId: askCard.id,
  model: 'openai/fable-5',
  usedCardIds: [sourceCard.id],
  usedConnectionIds: [],
  modIds: [],
  appliedMods: [],
  compiledInstruction: 'Frozen instruction',
  producedVersionId: 'v2',
  status: 'done',
}

const chosenVersion: OutputVersion = {
  id: 'v2',
  number: 2,
  text: chosenText,
  createdAt: '2026-07-18T00:00:01.000Z',
  fromRunId: run.id,
  accepted: true,
  provisional: true,
  provisionalReason: 'canceled',
  sourceContext: {
    version: 1,
    sources: [
      {
        cardId: sourceCard.id,
        kind: sourceCard.kind,
        label: 'Original source',
        hash: 'old-source-hash',
      },
      {
        cardId: 'deleted-source',
        kind: 'note',
        label: 'Deleted source',
        hash: 'deleted-source-hash',
      },
    ],
  },
  followUpThread: {
    messages: [
      {
        id: 'question',
        role: 'user',
        text: 'What would this cost?',
        createdAt: '2026-07-18T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'answer',
        role: 'assistant',
        text: 'About two thousand dollars.',
        createdAt: '2026-07-18T00:00:03.000Z',
        status: 'complete',
      },
    ],
  },
}

const multiVersionOutput: Output = {
  id: 'output',
  resultCardId: resultCard.id,
  chosenVersionId: chosenVersion.id,
  versions: [
    {
      id: 'v1',
      number: 1,
      text: 'Earlier answer',
      createdAt: '2026-07-17T00:00:00.000Z',
      fromRunId: 'run-1',
    },
    chosenVersion,
  ],
}

function nodeProps(): NodeProps {
  return {
    id: resultCard.id,
    selected: true,
    data: { selectedCardCount: 1 },
  } as unknown as NodeProps
}

function renderResult() {
  return render(
    <OverlayProvider>
      <ReactFlowProvider>
        <ResultCard {...nodeProps()} />
      </ReactFlowProvider>
    </OverlayProvider>,
  )
}

describe('Plain Result composition', () => {
  const clipboardWrite = vi.fn<(text: string) => Promise<void>>()
  const createVersionNote = vi.fn()
  const dismissSourceChanges = vi.fn()
  const requestCardFocus = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    HTMLElement.prototype.scrollTo = vi.fn()
    clipboardWrite.mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    })
    useGraph.setState({
      cards: [sourceCard, askCard, resultCard],
      connections: [],
      outputs: [multiVersionOutput],
      runs: [run],
      intentLog: [],
      undoStack: [],
      redoStack: [],
      selection: null,
      selectedCardIds: [resultCard.id],
      activeTool: 'select',
      hydrated: false,
      createVersionNote,
      dismissSourceChanges,
      requestCardFocus,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('uses the Result signal, thread, composer, and foot grammars without changing callback payloads', async () => {
    const currentStatus = sourceChangeStatus(useGraph.getState().snapshot(), chosenVersion)
    expect(currentStatus).not.toBeNull()

    const multi = renderResult()
    const meta = multi.container.querySelector<HTMLElement>('.card-meta')!
    expect(meta).toBeInTheDocument()
    expect(meta).toHaveClass('t-micro')
    expect(meta).toHaveTextContent('Fable 5')
    expect(meta.textContent).not.toContain('·')
    expect(meta.querySelector('.model-badge')).toBeNull()

    const sourceTrigger = within(meta).getByRole('button', { name: words.sourceChanged })
    expect(sourceTrigger).toHaveClass('source-change-trigger')
    expect(sourceTrigger).toHaveTextContent(/^!$/)
    fireEvent.pointerEnter(sourceTrigger)
    act(() => vi.advanceTimersByTime(DESIGN_TIMING_MS.intent))
    expect(screen.getByRole('tooltip')).toHaveTextContent(words.sourceChanged)
    fireEvent.pointerLeave(sourceTrigger)

    fireEvent.click(sourceTrigger)
    let sourcePopover = screen.getByRole('dialog', { name: words.sourceChanged })
    expect(within(sourcePopover).getByText(words.sourceChangedDetail)).toBeInTheDocument()
    expect(within(sourcePopover).queryByText('Changed', { exact: true })).not.toBeInTheDocument()
    const deletedSource = within(sourcePopover).getByText('Deleted source')
    expect(deletedSource.closest('button, [role="menuitem"]')).toBeNull()
    expect(deletedSource.closest('.source-change-deleted-row')).toHaveTextContent(
      words.sourceChangedDeleted,
    )

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: words.sourceChanged })).not.toBeInTheDocument()

    fireEvent.click(sourceTrigger)
    sourcePopover = screen.getByRole('dialog', { name: words.sourceChanged })
    fireEvent.click(within(sourcePopover).getByRole('menuitem', { name: sourceCard.title! }))
    expect(requestCardFocus).toHaveBeenCalledWith(sourceCard.id)
    expect(screen.queryByRole('dialog', { name: words.sourceChanged })).not.toBeInTheDocument()

    fireEvent.click(sourceTrigger)
    sourcePopover = screen.getByRole('dialog', { name: words.sourceChanged })
    const dismiss = within(sourcePopover).getByRole('button', { name: words.sourceChangedDismiss })
    expect(dismiss).toHaveClass('e-button', 'e-button--quiet')
    fireEvent.click(dismiss)
    expect(dismissSourceChanges).toHaveBeenCalledOnce()
    expect(dismissSourceChanges).toHaveBeenCalledWith(chosenVersion.id, currentStatus!.signature)

    act(() => useGraph.setState({ cards: [askCard, resultCard] }))
    fireEvent.click(sourceTrigger)
    sourcePopover = screen.getByRole('dialog', { name: words.sourceChanged })
    expect(
      within(sourcePopover).getByRole('button', { name: words.sourceChangedDismiss }),
    ).toHaveFocus()
    act(() => {
      useGraph.setState({
        outputs: [{
          ...multiVersionOutput,
          versions: [
            multiVersionOutput.versions[0]!,
            { ...chosenVersion, sourceContext: undefined },
          ],
        }],
      })
    })
    expect(screen.queryByRole('dialog', { name: words.sourceChanged })).not.toBeInTheDocument()
    act(() => useGraph.setState({ outputs: [multiVersionOutput] }))
    expect(screen.queryByRole('dialog', { name: words.sourceChanged })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: `Version 2 — ${words.provisionalCanceled}` })).toHaveClass('provisional')
    expect(screen.queryByText(words.provisionalCanceled)).not.toBeInTheDocument()
    expect(multi.container.querySelector('.e-callout')).toBeNull()

    const userBubble = screen.getByRole('group', { name: words.you })
    const assistantBubble = screen.getByRole('group', { name: words.followUpAssistant })
    expect(userBubble).toHaveClass('followup-bubble', 'user')
    expect(assistantBubble).toHaveClass('followup-bubble', 'assistant')
    expect(multi.container.querySelector('.bubble-speaker')).toBeNull()
    expect(within(assistantBubble).getByRole('button', { name: words.turnIntoNote })).toHaveClass(
      'e-icon-button',
      'e-button--quiet',
    )
    expect(within(assistantBubble).getByRole('button', { name: words.copy })).toHaveClass(
      'e-icon-button',
      'e-button--quiet',
    )
    await act(async () => {
      fireEvent.click(within(assistantBubble).getByRole('button', { name: words.copy }))
      await Promise.resolve()
    })
    expect(clipboardWrite).toHaveBeenCalledWith('About two thousand dollars.')
    clipboardWrite.mockClear()

    const composer = multi.container.querySelector<HTMLElement>('.followup-ask')!
    expect(composer).toBeInTheDocument()
    expect(multi.container.querySelector('.card-body .followup-ask')).toBeNull()
    const composerField = within(composer).getByRole('textbox')
    expect(composerField.tagName).toBe('TEXTAREA')
    expect(composerField).toHaveClass('e-field')
    const send = within(composer).getByRole('button', { name: words.interjectionSend })
    expect(send).toHaveClass('e-icon-button', 'e-button--primary', 'e-button--field-mate')
    expect(send.querySelector('.lucide-arrow-up')).toBeInTheDocument()
    expect(screen.queryByText(words.followUpTravelHint)).not.toBeInTheDocument()

    const foot = multi.container.querySelector<HTMLElement>('.card-foot')!
    for (const name of [
      words.copy,
      words.turnIntoNote,
      words.makeVariations,
      words.followUp,
      words.keepThis,
      words.moreActions,
    ]) {
      expect(within(foot).getByRole('button', { name })).toHaveClass('e-icon-button', 'e-button--compact')
    }
    const keep = within(foot).getByRole('button', { name: words.keepThis })
    expect(keep).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerEnter(keep)
    act(() => vi.advanceTimersByTime(DESIGN_TIMING_MS.intent))
    expect(screen.getByText(words.unkeep, { selector: '[role="tooltip"]' })).toBeVisible()
    fireEvent.pointerLeave(keep)
    expect(within(foot).getAllByRole('button')).toHaveLength(6)
    expect(foot.querySelector('.e-state-word')).toBeNull()
    expect(within(foot).queryByText(words.done)).not.toBeInTheDocument()
    expect(multi.container.querySelector('.mini-btn')).toBeNull()

    fireEvent.click(within(foot).getByRole('button', { name: words.moreActions }))
    expect(screen.getByRole('menu', { name: words.resultActions })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: words.showWhatAiUsed })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(foot).getByRole('button', { name: words.copy }))
      await Promise.resolve()
    })
    expect(clipboardWrite).toHaveBeenCalledWith(chosenText)
    fireEvent.click(within(foot).getByRole('button', { name: words.turnIntoNote }))
    expect(createVersionNote).toHaveBeenCalledWith(
      chosenVersion.id,
      chosenText,
      { x: resultCard.position.x + 300, y: resultCard.position.y },
      'version',
    )

    multi.unmount()
    const loneFailure: Output = {
      id: 'lone-output',
      resultCardId: resultCard.id,
      chosenVersionId: 'lone-version',
      versions: [{
        id: 'lone-version',
        number: 1,
        text: 'Partial answer',
        createdAt: '2026-07-18T00:00:00.000Z',
        fromRunId: 'missing-run',
        provisional: true,
        provisionalReason: 'failed',
      }],
    }
    useGraph.setState({ outputs: [loneFailure], runs: [] })
    const lone = renderResult()
    expect(lone.container.querySelector('.version-switcher')).toBeNull()
    expect(lone.container.querySelectorAll('.e-callout')).toHaveLength(1)
    expect(screen.getByText(words.provisionalFailed)).toBeInTheDocument()
  })

  it('keeps running status in the body without a Result foot indicator', () => {
    // The body is where the answer will appear, so it holds a placeholder rather
    // than a label. Two words for one state made the Card louder than the answer.
    const runningRun: RunRecord = {
      ...run,
      status: 'running',
      finishedAt: undefined,
      producedVersionId: undefined,
    }
    useGraph.setState({
      connections: [producingConnection],
      outputs: [],
      runs: [runningRun],
    })

    const view = renderResult()
    const resultText = view.container.querySelector<HTMLElement>('.result-text')!

    expect(within(resultText).queryByText(words.runningState)).not.toBeInTheDocument()
    const pulse = resultText.querySelector('.streaming-dot')!
    expect(pulse).toBeInTheDocument()
    // Named, because a pulse says nothing to a reader who cannot see it move.
    expect(pulse).toHaveAttribute('aria-label', words.runningState)

    const foot = view.container.querySelector<HTMLElement>('.card-foot')!
    expect(foot.querySelector('.e-state-word')).toBeNull()
    expect(within(foot).queryByText(words.runningState)).not.toBeInTheDocument()
  })

  it('keeps late Result links mounted in the ordinary rich-DOM root', () => {
    const longText = `${'Long result paragraph. '.repeat(80)}\n\n[Reach the end](https://eido.test/result-end)`
    useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [{ ...chosenVersion, text: longText }],
      }],
    })

    const view = renderResult()

    expect(view.container.querySelector('.result-text a[href="https://eido.test/result-end"]')).toHaveTextContent(
      'Reach the end',
    )
  })

  it('reuses the answer and unchanged follow-up rows across shell and selection updates', () => {
    const view = renderResult()
    const answer = view.container.querySelector('.result-text')!
    const userMessage = screen.getByRole('group', { name: words.you })
    const assistantMessage = screen.getByRole('group', { name: words.followUpAssistant })

    // This models a controlled-node replacement that changes only shell
    // authority. The selected flag and data object change, but the chosen
    // version and its immutable discussion do not.
    view.rerender(
      <OverlayProvider>
        <ReactFlowProvider>
          <ResultCard
            {...nodeProps()}
            selected={false}
            data={{ selectedCardCount: 0 }}
          />
        </ReactFlowProvider>
      </OverlayProvider>,
    )

    expect(view.container.querySelector('.result-text')).toBe(answer)
    expect(screen.getByRole('group', { name: words.you })).toBe(userMessage)
    expect(screen.getByRole('group', { name: words.followUpAssistant })).toBe(assistantMessage)

    // A settled follow-up replacement invalidates its own row while leaving
    // the preceding user row and the main answer native nodes in place.
    act(() => {
      useGraph.setState({
        outputs: [{
          ...multiVersionOutput,
          versions: [{
            ...chosenVersion,
            followUpThread: {
              messages: chosenVersion.followUpThread!.messages.map((message) => (
                message.id === 'answer' ? { ...message, text: 'A changed answer.' } : message
              )),
            },
          }],
        }],
      })
    })

    expect(view.container.querySelector('.result-text')).toBe(answer)
    expect(screen.getByRole('group', { name: words.you })).toBe(userMessage)
    expect(screen.getByRole('group', { name: words.followUpAssistant })).toBe(assistantMessage)
    expect(assistantMessage).toHaveTextContent('A changed answer.')
  })

  it('does not rescan a million-character Result has-content predicate on selection', () => {
    const blankVersion: OutputVersion = {
      ...chosenVersion,
      text: ' '.repeat(1_000_000),
      sourceContext: undefined,
      followUpThread: undefined,
    }
    useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [blankVersion],
        chosenVersionId: blankVersion.id,
      }],
    })
    const view = renderResult()
    expect(within(view.container).getByRole('button', { name: words.turnIntoNote })).toBeDisabled()
    resetTextHasContentScanCountForTests()

    view.rerender(
      <OverlayProvider>
        <ReactFlowProvider>
          <ResultCard
            {...nodeProps()}
            selected={false}
            data={{ selectedCardCount: 0 }}
          />
        </ReactFlowProvider>
      </OverlayProvider>,
    )

    expect(textHasContentScanCountForTests()).toBe(0)
    act(() => useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [{ ...blankVersion, text: 'Now present' }],
        chosenVersionId: blankVersion.id,
      }],
    }))
    expect(textHasContentScanCountForTests()).toBe(1)
    expect(within(view.container).getByText('Now present')).toBeInTheDocument()
    expect(within(view.container).getByRole('button', { name: words.turnIntoNote })).toBeEnabled()
  })

  it('does not rescan a million-character Conversation Result predicate on selection', () => {
    const conversationCard: Card = {
      id: 'conversation-source',
      kind: 'conversation',
      blocks: [{ id: 'conversation-source-body', text: 'Discuss it.' }],
      position: { x: 0, y: 0 },
    }
    const blankVersion: OutputVersion = {
      ...chosenVersion,
      text: ' '.repeat(1_000_000),
      transcript: undefined,
      sourceContext: undefined,
      followUpThread: undefined,
    }
    useGraph.setState({
      cards: [conversationCard, resultCard],
      connections: [{
        id: 'conversation-result',
        from: { cardId: conversationCard.id },
        to: { cardId: resultCard.id },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      }],
      outputs: [{
        ...multiVersionOutput,
        versions: [blankVersion],
        chosenVersionId: blankVersion.id,
      }],
      runs: [],
    })
    const view = renderResult()
    expect(within(view.container).getByRole('button', { name: words.turnIntoNote })).toBeDisabled()
    resetTextHasContentScanCountForTests()

    view.rerender(
      <OverlayProvider>
        <ReactFlowProvider>
          <ResultCard
            {...nodeProps()}
            selected={false}
            data={{ selectedCardCount: 0 }}
          />
        </ReactFlowProvider>
      </OverlayProvider>,
    )

    expect(textHasContentScanCountForTests()).toBe(0)
    act(() => useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [{
          ...blankVersion,
          text: '',
          transcript: [{
            id: 'conversation-present',
            speakerKind: 'participant',
            speakerName: 'Participant',
            text: 'Conversation present',
          }],
        }],
        chosenVersionId: blankVersion.id,
      }],
    }))
    expect(textHasContentScanCountForTests()).toBe(1)
    expect(within(view.container).getByText('Conversation present')).toBeInTheDocument()
    expect(within(view.container).getByRole('button', { name: words.turnIntoNote })).toBeEnabled()
  })

  it('does not reparse a large unchanged follow-up thread when the main answer streams', () => {
    const messages = Array.from({ length: 128 }, (_, index) => ({
      id: `follow-up-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `Follow-up row ${index}. ${'unchanged prose '.repeat(24)}`,
      createdAt: `2026-07-18T00:00:${String(index).padStart(2, '0')}.000Z`,
      status: 'complete' as const,
    }))
    const threadedVersion: OutputVersion = {
      ...chosenVersion,
      followUpThread: { messages },
    }
    useGraph.setState({
      outputs: [{ ...multiVersionOutput, versions: [threadedVersion] }],
    })

    vi.mocked(renderMarkdown).mockClear()
    followUpBubbleRender.mockClear()
    const view = renderResult()
    expect(renderMarkdown).toHaveBeenCalledTimes(messages.length + 1)
    expect(followUpBubbleRender).toHaveBeenCalledTimes(messages.length)

    vi.mocked(renderMarkdown).mockClear()
    followUpBubbleRender.mockClear()
    act(() => {
      useGraph.setState({
        outputs: [{
          ...multiVersionOutput,
          versions: [{
            ...threadedVersion,
            text: `${threadedVersion.text} And the answer continues.`,
            // Keep the exact immutable message array while the chosen answer
            // receives a new streamed version object.
            followUpThread: { ...threadedVersion.followUpThread!, messages },
          }],
        }],
      })
    })

    expect(renderMarkdown).toHaveBeenCalledTimes(1)
    expect(followUpBubbleRender).not.toHaveBeenCalled()
    expect(view.container.querySelector('.result-text')).toHaveTextContent('And the answer continues.')
    expect(view.container.querySelectorAll('.followup-bubble')).toHaveLength(messages.length)
  })

  it('does not revisit settled follow-up statuses across shell and selection updates', () => {
    let statusVisits = 0
    const messages = Array.from({ length: 256 }, (_, index) => {
      const message = {
        id: `settled-${index}`,
        role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        text: `Settled follow-up ${index}`,
        createdAt: '2026-07-18T00:00:03.000Z',
      } as FollowUpMessage
      Object.defineProperty(message, 'status', {
        enumerable: true,
        get: () => {
          statusVisits += 1
          return 'complete'
        },
      })
      return message
    })
    const threadedVersion: OutputVersion = {
      ...chosenVersion,
      followUpThread: { messages },
    }
    useGraph.setState({
      outputs: [{ ...multiVersionOutput, versions: [threadedVersion] }],
    })
    const view = renderResult()
    expect(statusVisits).toBeGreaterThanOrEqual(messages.length)
    statusVisits = 0

    view.rerender(
      <OverlayProvider>
        <ReactFlowProvider>
          <ResultCard
            {...nodeProps()}
            selected={false}
            data={{ selectedCardCount: 0 }}
          />
        </ReactFlowProvider>
      </OverlayProvider>,
    )

    expect(statusVisits).toBe(0)

    const streamingMessage: FollowUpMessage = {
      id: 'new-streaming-message',
      role: 'assistant',
      text: 'Still writing',
      createdAt: '2026-07-18T00:00:04.000Z',
      status: 'streaming',
    }
    act(() => useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [{
          ...threadedVersion,
          followUpThread: { messages: [...messages, streamingMessage] },
        }],
      }],
    }))

    const foot = view.container.querySelector<HTMLElement>('.card-foot')!
    expect(foot.querySelector('.e-state-word')).toBeNull()
  })

  it('shows a bare pulse on a follow-up reply without a Result foot indicator', () => {
    const writingVersion: OutputVersion = {
      ...chosenVersion,
      followUpThread: {
        messages: [{
          id: 'writing-answer',
          role: 'assistant',
          text: '',
          createdAt: '2026-07-18T00:00:03.000Z',
          status: 'streaming',
        }],
      },
    }
    useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [writingVersion],
      }],
    })

    const view = renderResult()

    expect(within(view.container).queryByText(words.transcriptStreaming)).not.toBeInTheDocument()
    const pulse = view.container.querySelector('.followup-bubble .streaming-dot')!
    expect(pulse).toHaveAttribute('aria-label', words.transcriptStreaming)

    const foot = view.container.querySelector<HTMLElement>('.card-foot')!
    expect(foot.querySelector('.e-state-word')).toBeNull()
    expect(within(foot).queryByText(words.runningState)).not.toBeInTheDocument()
  })

  it('does not offer settled-only actions while a follow-up reply is streaming', () => {
    const writingVersion: OutputVersion = {
      ...chosenVersion,
      followUpThread: {
        messages: [{
          id: 'writing-answer',
          role: 'assistant',
          text: 'Partial reply',
          createdAt: '2026-07-18T00:00:03.000Z',
          status: 'streaming',
        }],
      },
    }
    useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [writingVersion],
      }],
    })

    const view = renderResult()
    const assistant = within(view.container).getByRole('group', { name: words.followUpAssistant })
    const composer = view.container.querySelector<HTMLElement>('.followup-ask')!

    expect(within(assistant).queryByRole('button', { name: words.copy })).not.toBeInTheDocument()
    expect(within(assistant).queryByRole('button', { name: words.turnIntoNote }))
      .not.toBeInTheDocument()
    expect(within(composer).getByRole('button', { name: words.stop })).toHaveClass(
      'e-button--field-mate',
    )
  })

  it('does not offer empty Result or follow-up content as a new Note', () => {
    useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [{
          ...chosenVersion,
          text: ' \n ',
          followUpThread: {
            messages: [{
              id: 'empty-answer',
              role: 'assistant',
              text: '',
              createdAt: '2026-07-18T00:00:03.000Z',
              status: 'streaming',
            }],
          },
        }],
      }],
    })

    const view = renderResult()
    const foot = view.container.querySelector<HTMLElement>('.card-foot')!
    const assistant = screen.getByRole('group', { name: words.followUpAssistant })

    expect(within(foot).getByRole('button', { name: words.turnIntoNote })).toBeDisabled()
    expect(within(assistant).queryByRole('button', { name: words.turnIntoNote })).not.toBeInTheDocument()
  })

  it('surfaces a failed Ask run after its empty Result version is removed', () => {
    const failedRun: RunRecord = {
      ...run,
      id: 'failed-run',
      producedVersionId: 'removed-version',
      status: 'failed',
      errorMessage: 'Provider unavailable',
    }
    useGraph.setState({
      connections: [{
        id: 'ask-result',
        from: { cardId: askCard.id },
        to: { cardId: resultCard.id },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      }],
      outputs: [{ id: 'empty-output', resultCardId: resultCard.id, versions: [] }],
      runs: [failedRun],
    })

    const failed = renderResult()

    expect(failed.container.querySelectorAll('.e-callout')).toHaveLength(1)
    expect(screen.getByText(words.resultFailureNextStep)).toBeInTheDocument()
    const foot = failed.container.querySelector<HTMLElement>('.card-foot')!
    expect(foot.querySelector('.e-state-word')).toBeNull()
    expect(within(foot).queryByText(words.couldntRun)).not.toBeInTheDocument()
  })

  it('rechecks version ownership only when the versions or latest Ask run change', () => {
    let versionVisits = 0
    const earlierVersion = { ...multiVersionOutput.versions[0]! }
    Object.defineProperty(earlierVersion, 'fromRunId', {
      enumerable: true,
      get: () => {
        versionVisits += 1
        return 'run-1'
      },
    })
    const versions = [earlierVersion, chosenVersion]
    useGraph.setState({
      connections: [producingConnection],
      outputs: [{ ...multiVersionOutput, versions }],
    })
    const view = renderResult()
    expect(versionVisits).toBeGreaterThan(0)
    versionVisits = 0

    view.rerender(
      <OverlayProvider>
        <ReactFlowProvider>
          <ResultCard
            {...nodeProps()}
            selected={false}
            data={{ selectedCardCount: 0 }}
          />
        </ReactFlowProvider>
      </OverlayProvider>,
    )

    expect(versionVisits).toBe(0)

    const failedRun: RunRecord = {
      ...run,
      id: 'failed-run-without-version',
      producedVersionId: 'eventual-version',
      status: 'failed',
      errorMessage: 'Provider unavailable',
    }
    act(() => useGraph.setState({ runs: [run, failedRun] }))
    expect(versionVisits).toBeGreaterThan(0)
    expect(screen.getByText(words.resultFailureNextStep)).toBeInTheDocument()

    act(() => useGraph.setState({
      outputs: [{
        ...multiVersionOutput,
        versions: [...versions, {
          id: 'eventual-version',
          number: 3,
          text: '',
          createdAt: '2026-07-18T00:00:04.000Z',
          fromRunId: failedRun.id,
        }],
      }],
    }))
    expect(screen.queryByText(words.resultFailureNextStep)).not.toBeInTheDocument()
  })

  it('follows the answer down the card while the result is still streaming', () => {
    // The reader watching an answer arrive should not have to chase it. This
    // was follow-up behaviour first; a plain result stream earns the same.
    const streamingRun: RunRecord = { ...run, id: 'streaming-run', status: 'running' }
    useGraph.setState({
      connections: [producingConnection],
      outputs: [{
        id: 'out',
        resultCardId: resultCard.id,
        chosenVersionId: 'v-stream',
        versions: [{
          id: 'v-stream',
          number: 1,
          text: 'The answer so far',
          createdAt: '2026-07-18T00:00:00.000Z',
          fromRunId: streamingRun.id,
        }],
      }],
      runs: [streamingRun],
    })

    const view = renderResult()
    const scrollTo = HTMLElement.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>
    scrollTo.mockClear()

    // A chunk lands.
    act(() => {
      useGraph.setState((state) => ({
        outputs: state.outputs.map((output) => ({
          ...output,
          versions: output.versions.map((version) => (
            version.id === 'v-stream'
              ? { ...version, text: 'The answer so far, and a good deal more of it' }
              : version
          )),
        })),
      }))
    })

    expect(scrollTo).toHaveBeenCalled()

    // The reader scrolls away from the end and takes ownership of the position.
    const body = view.container.querySelector<HTMLElement>('.card-body')!
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 1_000 })
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 200 })
    body.scrollTop = 0
    fireEvent.scroll(body)
    scrollTo.mockClear()

    act(() => {
      useGraph.setState((state) => ({
        outputs: state.outputs.map((output) => ({
          ...output,
          versions: output.versions.map((version) => (
            version.id === 'v-stream' ? { ...version, text: `${version.text} and more still` } : version
          )),
        })),
      }))
    })

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('names length as the thing to change when that is why the run failed', () => {
    // The generic line sends the reader to check a key that is working. What
    // they can actually act on is the size of what they connected.
    const tooLongRun: RunRecord = {
      ...run,
      id: 'too-long-run',
      producedVersionId: 'removed-version',
      status: 'failed',
      errorMessage: 'errTooLong',
    }
    useGraph.setState({
      connections: [{
        id: 'ask-result',
        from: { cardId: askCard.id },
        to: { cardId: resultCard.id },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      }],
      outputs: [{ id: 'empty-output', resultCardId: resultCard.id, versions: [] }],
      runs: [tooLongRun],
    })

    renderResult()

    expect(screen.getByText(words.errTooLong)).toBeInTheDocument()
    expect(screen.queryByText(words.resultFailureNextStep)).not.toBeInTheDocument()
  })
  it('shows the trail of the version being read, and follows the version switch', () => {
    // The trail is provenance, so it belongs to the answer on screen. Starting a
    // run chooses the version it will fill, which is why there is no separate
    // live case here: the running run IS the run behind the chosen version.
    const earlierRun: RunRecord = {
      ...run,
      id: 'run-1',
      producedVersionId: 'v1',
      toolSteps: [{ kind: 'search', detail: 'what the earlier answer rests on' }],
    }
    useGraph.setState({
      connections: [producingConnection],
      runs: [earlierRun, { ...run, toolSteps: [{ kind: 'search', detail: 'what the answer rests on' }] }],
    })

    const chosen = renderResult()
    expect(within(chosen.container).getByText('Looked up 1 thing')).toBeInTheDocument()

    // The rows are built only when the reader reaches for them, so this asks
    // the way a reader would.
    const disclosure = chosen.container.querySelector('details.tool-trail') as HTMLDetailsElement
    act(() => {
      disclosure.open = true
      disclosure.dispatchEvent(new Event('toggle'))
    })

    expect(within(chosen.container).getByText('what the answer rests on')).toBeInTheDocument()
    expect(within(chosen.container).queryByText('what the earlier answer rests on')).not.toBeInTheDocument()
    cleanup()

    useGraph.setState({ outputs: [{ ...multiVersionOutput, chosenVersionId: 'v1' }] })

    const earlier = renderResult()
    const earlierDisclosure = earlier.container.querySelector('details.tool-trail') as HTMLDetailsElement
    act(() => {
      earlierDisclosure.open = true
      earlierDisclosure.dispatchEvent(new Event('toggle'))
    })

    expect(within(earlier.container).getByText('what the earlier answer rests on')).toBeInTheDocument()
    expect(within(earlier.container).queryByText('what the answer rests on')).not.toBeInTheDocument()
  })

  it('gives each follow-up reply its own trail, at the top of that reply', () => {
    // A follow-up is its own piece of research. One trail at the top of the Card
    // would claim to cover answers it never touched.
    const researchedVersion: OutputVersion = {
      ...chosenVersion,
      followUpThread: {
        messages: [{
          id: 'answer',
          role: 'assistant',
          text: 'It shipped last week.',
          createdAt: '2026-07-18T00:00:03.000Z',
          status: 'complete',
          toolSteps: [{ kind: 'search', detail: 'what this reply rests on' }],
        }],
      },
    }
    useGraph.setState({
      runs: [{ ...run, toolSteps: [{ kind: 'search', detail: 'what the answer rests on' }] }],
      outputs: [{ ...multiVersionOutput, versions: [researchedVersion] }],
    })

    const view = renderResult()
    const bubble = view.container.querySelector<HTMLElement>('.followup-bubble.assistant')!
    const trail = bubble.querySelector('details.tool-trail') as HTMLDetailsElement

    expect(within(bubble).getByText('Looked up 1 thing')).toBeInTheDocument()
    act(() => {
      trail.open = true
      trail.dispatchEvent(new Event('toggle'))
    })

    expect(within(bubble).getByText('what this reply rests on')).toBeInTheDocument()
    expect(within(bubble).queryByText('what the answer rests on')).not.toBeInTheDocument()
  })
})
