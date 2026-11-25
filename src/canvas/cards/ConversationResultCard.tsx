import type { NodeProps } from '@xyflow/react'
import { ArrowUp, Check, Copy, Eye, FilePlus2, GitBranch, MoreHorizontal } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useGraph } from '../../graph/store'
import {
  cancelConversation,
  makeConversationVariations,
  runConversation,
} from '../../brain/conversationRunner'
import { flattenTranscript, userMessage } from '../../brain/transcript'
import { modelLabel } from '../../brain/models'
import { chosenVersion, textHasContent } from '../../graph/graphHelpers'
import type { TranscriptMessage } from '../../graph/types'
import { followCardTextLink } from '../cardLinks'
import { writeTextToClipboard } from '../../shared/clipboardText'
import { renderMarkdown } from '../../shared/markdown'
import { words } from '../../shared/words'
import { Button, Callout, Field, IconButton, Menu, MenuItem, Popover, StateWord } from '../../ui/primitives'
import { VersionContext } from '../VersionContext'
import {
  useOutputForResultCard,
  useRunForVersion,
  useSourceChangeStatus,
} from '../graphSelectors'
import {
  dragBlockingClass,
  highlightableTextDragBlockingClass,
  preserveCardSelectionOnTextRangeClick,
  useRetainedCardScrollPosition,
  useWheelGate,
} from '../cardInteraction'
import { BudgetMarker } from './BudgetMarker'
import { CardShell } from './CardShell'
import { SourceChangedBadge } from './SourceChangedBadge'
import { useCardHighlights } from './useCardHighlights'
import { VersionSwitcher } from './VersionSwitcher'
import { makeBudgetLabel, provisionalReasonLabel } from './cardChrome'

// The Conversation Result: a lightweight chat-style transcript with a small input
// for user Interjections, live streaming, cancel/continue, and a Provisional marker
// for runs that were stopped or failed. The transcript data is the source of truth
// (Concept 5) — this only renders it.
export const ConversationResultCard = memo(function ConversationResultCard({ id, selected, data }: NodeProps) {
  // Narrow, index-backed subscriptions (#91/#108): streaming chunks into
  // OTHER cards no longer re-render this one.
  // Position changes are gesture geometry, not transcript changes. Keep the
  // large semantic view subscribed only to presence and read its latest
  // position on demand for the one action that needs it.
  const cardPresent = useGraph((s) => Boolean(s.graph().cardById(id)))
  const output = useOutputForResultCard(id)
  const conversationCardId = useGraph((s) => {
    const graph = s.graph()
    for (const connection of graph.incomingConnections(id)) {
      if (graph.cardById(connection.from.cardId)?.kind === 'conversation') return connection.from.cardId
    }
    return undefined
  })
  const chooseVersion = useGraph((s) => s.chooseVersion)
  const setVersionAccepted = useGraph((s) => s.setVersionAccepted)
  const createVersionNote = useGraph((s) => s.createVersionNote)
  const appendTranscriptMessage = useGraph((s) => s.appendTranscriptMessage)
  const setKeyPromptOpen = useGraph((s) => s.setKeyPromptOpen)
  const dismissSourceChanges = useGraph((s) => s.dismissSourceChanges)
  const activeTool = useGraph((s) => s.activeTool)

  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [varying, setVarying] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [footActionsOpen, setFootActionsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const currentIdeaId = useGraph((s) => s.currentIdeaId)
  const transcriptWheelGate = useWheelGate(!!selected, scrollRef)
  const {
    pinnedToEndRef: pinnedRef,
    rememberScrollPosition,
  } = useRetainedCardScrollPosition(currentIdeaId, id, scrollRef)
  const dragBlock = dragBlockingClass(!!selected)
  const textDragBlock = highlightableTextDragBlockingClass(activeTool, !!selected)
  // Follow the live stream only while the reader is already at the bottom. Once
  // they scroll up to read, stop yanking them down until they return to the end.
  const versions = output?.versions ?? []
  const chosen = chosenVersion(output)
  const chosenId = output?.chosenVersionId ?? chosen?.id
  const transcript = chosen?.transcript ?? []
  const renderedTranscriptCacheRef = useRef(new Map<string, RenderedTranscriptMessage>())
  const renderedTranscript = useMemo(() => {
    const previous = renderedTranscriptCacheRef.current
    const next = new Map<string, RenderedTranscriptMessage>()
    const rendered: RenderedTranscriptMessage[] = []

    for (const message of transcript) {
      if (!message.text.trim() && !message.streaming) continue
      const cached = previous.get(message.id)
      const row = cached?.message === message
        ? cached
        : {
            message,
            html: message.text.trim() ? renderMarkdown(message.text) : '',
          }
      next.set(message.id, row)
      rendered.push(row)
    }

    renderedTranscriptCacheRef.current = next
    return rendered
  }, [transcript])
  const chosenText = useMemo(
    () => (chosen ? flattenTranscript(transcript) || chosen.text : ''),
    [chosen, transcript],
  )
  const hasText = useMemo(() => textHasContent(chosenText), [chosenText])
  const chosenRun = useRunForVersion(chosen?.id)
  const sourceStatus = useSourceChangeStatus(chosen)

  const running = useGraph((s) =>
    Boolean(
      chosenId &&
        s.graph().runForVersion(chosenId)?.kind === 'conversation' &&
        s.graph().runForVersion(chosenId)?.status === 'running',
    ),
  )

  // The transcript is readable text like any note — it carries highlights too.
  // The row projection is the invalidation boundary for highlights. Passing
  // the complete flattened transcript here made dependency comparison revisit
  // the whole prose string even when only shell authority changed.
  useCardHighlights(id, scrollRef, renderedTranscript)

  // Keep the latest message in view as the transcript grows / streams — but only
  // when the reader is pinned to the bottom (see onTranscriptScroll).
  const lastText = transcript[transcript.length - 1]?.text ?? ''
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTo({ top: el.scrollHeight })
  }, [lastText, transcript.length, selected])

  const onTranscriptScroll = () => {
    const el = scrollRef.current
    if (!el) return
    rememberScrollPosition()
    // Pinned if within ~48px of the end; scrolling up unpins and stops auto-follow.
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const provisionalLabel = provisionalReasonLabel(chosen?.provisionalReason)
  const showFailedProvisional = Boolean(
    chosen?.provisional && chosen.provisionalReason === 'failed' && versions.length <= 1,
  )
  const showProvisionalCallout = Boolean(
    !showFailedProvisional && chosen?.provisional && versions.length <= 1,
  )
  const budgetCardLabel = makeBudgetLabel()
  const showKeepAction = Boolean(versions.length > 1 && chosen)
  const showContextAction = Boolean(chosenRun)
  const footActionCount = 3 + Number(showKeepAction) + Number(running) + Number(showContextAction)
  const overflowContext = showContextAction && footActionCount > 5
  const overflowVariations = footActionCount - Number(overflowContext) > 5
  const showActionOverflow = overflowContext || overflowVariations
  useEffect(() => {
    if (!showActionOverflow) setFootActionsOpen(false)
  }, [showActionOverflow])

  if (!cardPresent) return null

  const onCopy = async () => {
    if (!hasText) return
    if (await writeTextToClipboard(chosenText)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }

  const onTurnIntoNote = () => {
    if (!hasText || !chosen) return
    const position = useGraph.getState().graph().cardById(id)?.position
    if (!position) return
    createVersionNote(chosen.id, chosenText, { x: position.x + 300, y: position.y }, 'conversation')
  }

  const onMakeVariations = async () => {
    if (!conversationCardId || varying || running) return
    setVarying(true)
    let outcome: Awaited<ReturnType<typeof makeConversationVariations>> | undefined
    try {
      outcome = await makeConversationVariations(conversationCardId, 3)
    } finally {
      setVarying(false)
    }
    if (outcome && !outcome.ok && outcome.reason === 'no-key') setKeyPromptOpen(true)
  }

  const onSend = async () => {
    const text = draft.trim()
    if (!text || !chosen) return
    setDraft('')
    if (running) {
      // Mid-run: append now; the next AI turn will see it (no interruption).
      appendTranscriptMessage(chosen.id, userMessage(text, words.you))
      return
    }
    // Not running: continue the conversation in place (same version).
    if (!conversationCardId) return
    const outcome = await runConversation(conversationCardId, {
      continueInVersionId: chosen.id,
      leadingUserMessage: text,
      rounds: 1,
    })
    if (!outcome.ok && outcome.reason === 'no-key') setKeyPromptOpen(true)
  }

  return (
    <CardShell
      id={id}
      kind="result"
      selected={!!selected}
      data={data}
    >
      <div className="card-body">
        <VersionSwitcher
          versions={versions}
          chosenId={chosenId}
          selected={!!selected}
          onChoose={(versionId) => output && chooseVersion(output.id, versionId)}
          style={{ marginBottom: 8 }}
        />
        {(chosenRun || sourceStatus) && (
          <div className="card-meta t-micro">
            {chosenRun && (
              <span className="card-meta__model" title={chosenRun.model}>
                {modelLabel(chosenRun.model)}
              </span>
            )}
            <SourceChangedBadge
              status={sourceStatus}
              selected={!!selected}
              onDismiss={(signature) => dismissSourceChanges(chosen!.id, signature)}
            />
          </div>
        )}

        <BudgetMarker budget={chosenRun?.contextBudget} label={budgetCardLabel} selected={!!selected} />

        <div
          className={`transcript ${textDragBlock}`}
          ref={transcriptWheelGate}
          onScroll={onTranscriptScroll}
        >
          <ConversationTranscript messages={renderedTranscript} running={running || varying} />
        </div>

        {showFailedProvisional ? (
          <Callout tone="avoid" className="result-provisional-callout">
            {words.resultFailureNextStep}
          </Callout>
        ) : showProvisionalCallout ? (
          <Callout
            tone="attention"
            className="result-provisional-callout"
          >
            {provisionalLabel}
          </Callout>
        ) : null}

        <div className={`interjection ${dragBlock}`}>
          <Field
            prose
            placeholder={words.interjectionPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={preserveCardSelectionOnTextRangeClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onSend()
              }
            }}
          />
          <IconButton
            label={running ? words.interjectionSend : words.continueRun}
            icon={<ArrowUp aria-hidden="true" />}
            variant="primary"
            size="field-mate"
            className="interjection-send"
            onClick={() => void onSend()}
            disabled={!draft.trim()}
          />
        </div>
      </div>

      <div className={`card-foot ${dragBlock}`}>
        <IconButton
          label={copied ? words.copied : words.copy}
          icon={<Copy aria-hidden="true" />}
          size="compact"
          onClick={onCopy}
          disabled={!hasText}
        />
        <IconButton
          label={words.turnIntoNote}
          icon={<FilePlus2 aria-hidden="true" />}
          size="compact"
          onClick={onTurnIntoNote}
          disabled={!hasText}
        />
        {!overflowVariations && (
          <IconButton
            label={words.makeVariations}
            icon={<GitBranch aria-hidden="true" />}
            size="compact"
            onClick={onMakeVariations}
            disabled={!conversationCardId || varying || running}
          />
        )}
        {showKeepAction && chosen && (
          <IconButton
            label={words.keepThis}
            tooltip={chosen.accepted ? words.unkeep : words.keepThis}
            icon={<Check aria-hidden="true" />}
            size="compact"
            className="result-foot-keep e-icon-button--go-selected"
            pressed={Boolean(chosen.accepted)}
            onClick={() => output && setVersionAccepted(output.id, chosen.id, !chosen.accepted)}
          />
        )}
        {running && conversationCardId && (
          <Button
            variant="quiet"
            size="compact"
            onClick={() => cancelConversation(conversationCardId)}
          >
            {words.conversationCancel}
          </Button>
        )}
        {showContextAction && !overflowContext && (
          <IconButton
            label={words.showWhatAiUsed}
            icon={<Eye aria-hidden="true" />}
            size="compact"
            onClick={() => setContextOpen(true)}
          />
        )}
        {showActionOverflow && (
          <Popover
            open={footActionsOpen}
            onOpenChange={setFootActionsOpen}
            trigger={
              <IconButton
                label={words.moreActions}
                icon={<MoreHorizontal aria-hidden="true" />}
                size="compact"
              />
            }
          >
            <Menu ariaLabel={words.resultActions}>
              {overflowVariations && (
                <MenuItem
                  disabled={!conversationCardId || varying || running}
                  onClick={() => {
                    setFootActionsOpen(false)
                    void onMakeVariations()
                  }}
                >
                  {words.makeVariations}
                </MenuItem>
              )}
              {overflowContext && (
                <MenuItem
                  onClick={() => {
                    setFootActionsOpen(false)
                    setContextOpen(true)
                  }}
                >
                  {words.showWhatAiUsed}
                </MenuItem>
              )}
            </Menu>
          </Popover>
        )}
      </div>

      {contextOpen && chosen && <VersionContext version={chosen} onClose={() => setContextOpen(false)} />}
    </CardShell>
  )
}, (previous, next) => (
  previous.id === next.id
  && previous.selected === next.selected
  && previous.data === next.data
))

type RenderedTranscriptMessage = {
  message: TranscriptMessage
  html: string
}

// Selection authority changes the transcript scroller's `nodrag` class, not
// its immutable rows. Keep those rows out of React's hot selection/drag path.
const ConversationTranscript = memo(function ConversationTranscript({
  messages,
  running,
}: {
  messages: readonly RenderedTranscriptMessage[]
  running: boolean
}) {
  if (messages.length === 0) {
    return running ? (
      <StateWord tone="running" className="result-empty">{words.runningState}</StateWord>
    ) : (
      <span className="result-empty t-prose-m">{words.transcriptEmpty}</span>
    )
  }

  const hasStreamingMessage = messages.some((row) => row.message.streaming)
  return (
    <>
      {messages.map((row) => <ConversationTranscriptRow key={row.message.id} {...row} />)}
      {running && !hasStreamingMessage && (
        <span className="streaming-dot" role="status" aria-label={words.runningState} />
      )}
    </>
  )
})

const ConversationTranscriptRow = memo(function ConversationTranscriptRow({
  message,
  html,
}: RenderedTranscriptMessage) {
  return (
    <div
      className={`bubble ${message.speakerKind}`}
      role="group"
      aria-label={message.speakerKind === 'user' ? words.you : message.speakerName}
    >
      {html ? (
        <div
          className="bubble-text markdown e-prose t-prose-s"
          onClick={followCardTextLink}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : message.streaming ? (
        <StateWord tone="running" className="bubble-text result-empty">
          {words.transcriptStreaming}
        </StateWord>
      ) : (
        <div className="bubble-text result-empty t-prose-s">{words.transcriptStreaming}</div>
      )}
      {message.streaming && message.text.trim() && <span className="streaming-dot" aria-hidden="true" />}
    </div>
  )
})
