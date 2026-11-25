import type { NodeProps } from '@xyflow/react'
import { ArrowUp, Check, Copy, Eye, FilePlus2, GitBranch, MessageCircle, MoreHorizontal } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useGraph } from '../../graph/store'
import { cancelAiRun, makeVariations } from '../../brain/runEngine'
import {
  cancelFollowUp,
  isFollowUpRunning,
  runFollowUp,
  subscribeFollowUpActivity,
} from '../../brain/followUpRunner'
import { chosenVersion, textHasContent } from '../../graph/graphHelpers'
import type { FollowUpMessage } from '../../graph/types'
import { modelLabel } from '../../brain/models'
import { followCardTextLink } from '../cardLinks'
import { writeTextToClipboard } from '../../shared/clipboardText'
import { renderMarkdown } from '../../shared/markdown'
import { useAutoGrow } from '../../shared/useAutoGrow'
import { words } from '../../shared/words'
import { Button, Callout, IconButton, Menu, MenuItem, Popover, TextArea } from '../../ui/primitives'
import {
  useIsAskRunning,
  useIsConversationResult,
  useOutputForResultCard,
  useProducingAskId,
  useRunById,
  useSourceChangeStatus,
} from '../graphSelectors'
import { VersionContext } from '../VersionContext'
import {
  dragBlockingClass,
  highlightableTextDragBlockingClass,
  preserveCardSelectionOnTextRangeClick,
  useRetainedCardScrollPosition,
  useWheelGate,
} from '../cardInteraction'
import { BudgetMarker } from './BudgetMarker'
import { RunToolTrail } from './RunToolTrail'
import { CardShell } from './CardShell'
import { useCardHighlights } from './useCardHighlights'
import { ConversationResultCard } from './ConversationResultCard'
import { SourceChangedBadge } from './SourceChangedBadge'
import { VersionSwitcher } from './VersionSwitcher'
import { makeBudgetLabel, provisionalReasonLabel } from './cardChrome'

import { FollowUpBubble, type RenderedFollowUpMessage } from './ResultFollowUpBubble'

// A Result card renders either a plain Ask AI output or, when its source is a
// Conversation (or it already holds a transcript), a lightweight chat transcript.
export const ResultCard = memo(function ResultCard(props: NodeProps) {
  const isConversation = useIsConversationResult(props.id)
  return isConversation ? <ConversationResultCard {...props} /> : <PlainResultCard {...props} />
}, (previous, next) => (
  previous.id === next.id
  && previous.selected === next.selected
  && previous.data === next.data
))

function PlainResultCard({ id, selected, data }: NodeProps) {
  // Narrow, index-backed subscriptions (#91/#108): this card re-renders only
  // when its semantic inputs, presence, or local interaction state change —
  // not on every commit anywhere on the board.
  // Geometry belongs to React Flow while the board is moving. Subscribing the
  // complete Card object here made every position-only update rebuild this
  // large semantic subtree. Presence is the only reactive Card fact this view
  // needs; action handlers read the latest position at the moment they run.
  const cardPresent = useGraph((s) => Boolean(s.graph().cardById(id)))
  const output = useOutputForResultCard(id)
  const askAiCardId = useProducingAskId(id)
  const latestAskRun = useGraph((s) => {
    if (!askAiCardId) return undefined
    const runs = s.graph().runsForCard(askAiCardId)
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index]
      if ((run?.kind ?? 'ask') === 'ask') return run
    }
    return undefined
  })
  const chooseVersion = useGraph((s) => s.chooseVersion)
  const setVersionAccepted = useGraph((s) => s.setVersionAccepted)
  const createVersionNote = useGraph((s) => s.createVersionNote)
  const setKeyPromptOpen = useGraph((s) => s.setKeyPromptOpen)
  const dismissSourceChanges = useGraph((s) => s.dismissSourceChanges)
  const activeTool = useGraph((s) => s.activeTool)

  const [copied, setCopied] = useState(false)
  const [copiedFollowUpMessageId, setCopiedFollowUpMessageId] = useState<string | null>(null)
  const [varying, setVarying] = useState(false)
  const [variationFallbackVersionId, setVariationFallbackVersionId] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [footActionsOpen, setFootActionsOpen] = useState(false)
  const [followUpDraft, setFollowUpDraft] = useState('')
  const bodyScrollRef = useRef<HTMLDivElement | null>(null)
  const currentIdeaId = useGraph((s) => s.currentIdeaId)
  const bodyWheelGate = useWheelGate(!!selected, bodyScrollRef)
  const {
    pinnedToEndRef: bodyPinnedRef,
    rememberScrollPosition,
  } = useRetainedCardScrollPosition(currentIdeaId, id, bodyScrollRef)
  // Whether the reader is sitting at the end of the body. One ref for the
  // whole body, because the body is one scroller: the result and the
  // discussion under it stream into the same box and share a reading position.
  const followUpInputRef = useAutoGrow(followUpDraft, false, { skipWhileFocused: false })
  const highlightRootRef = useRef<HTMLDivElement | null>(null)
  const dragBlock = dragBlockingClass(!!selected)
  const textDragBlock = highlightableTextDragBlockingClass(activeTool, !!selected)

  const versions = output?.versions ?? []
  const chosen = chosenVersion(output)
  const chosenId = output?.chosenVersionId ?? chosen?.id
  const chosenVersionId = chosen?.id ?? ''
  const subscribeToChosenFollowUp = useCallback(
    (subscriber: () => void) => subscribeFollowUpActivity(chosenVersionId, subscriber),
    [chosenVersionId],
  )
  const readChosenFollowUpActivity = useCallback(
    () => Boolean(chosenVersionId && isFollowUpRunning(chosenVersionId)),
    [chosenVersionId],
  )
  const followUpActive = useSyncExternalStore(
    subscribeToChosenFollowUp,
    readChosenFollowUpActivity,
    () => false,
  )
  const renderedVersion = useMemo(() => {
    if (!varying || textHasContent(chosen?.text ?? '')) return chosen
    return versions.find((version) => version.id === variationFallbackVersionId) ?? chosen
  }, [chosen, variationFallbackVersionId, varying, versions])
  const renderedVersionId = renderedVersion?.id
  // Reading residency already bounds how many rich Cards exist. Keep one
  // complete Result root across Passive and Live authority so activation
  // cannot replace a late link/control between pointer-down and click.
  // A new variation is selected before its first chunk exists. Keep the last
  // complete answer painted during that gap; switch to the new version as
  // soon as it has prose, without adding another Card or scroll surface.
  const chosenText = renderedVersion?.text ?? ''
  const hasText = useMemo(() => textHasContent(chosenText), [chosenText])
  const chosenHtml = useMemo(
    () => (hasText ? renderMarkdown(chosenText) : ''),
    [chosenText, hasText],
  )
  const renderedRun = useRunById(renderedVersion?.fromRunId)
  const running = useIsAskRunning(askAiCardId)
  const canFollowUp = hasText && renderedRun?.status === 'done' && !running && !varying
  const followUpThread = renderedVersion?.followUpThread
  const followUpMessages = followUpThread?.messages ?? []
  // Card position and selection updates can re-render a Result while its
  // retained discussion is unchanged. Markdown parsing is content work, so
  // keep it keyed to the immutable message array instead of repeating it on
  // every board gesture frame.
  const renderedFollowUpCacheRef = useRef(new Map<string, RenderedFollowUpMessage>())
  const renderedFollowUpMessages = useMemo(() => {
    const previous = renderedFollowUpCacheRef.current
    const next = new Map<string, RenderedFollowUpMessage>()
    const rendered: RenderedFollowUpMessage[] = []

    for (const message of followUpMessages) {
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

    renderedFollowUpCacheRef.current = next
    return rendered
  }, [followUpMessages])
  const retainedFollowUpRunning = useMemo(
    () => followUpMessages.some((message) => message.status === 'streaming'),
    [followUpMessages],
  )
  const followUpRunning = followUpActive || retainedFollowUpRunning
  const lastFollowUpText = followUpMessages[followUpMessages.length - 1]?.text ?? ''
  // Highlight painting needs a new boundary when either the answer HTML or the
  // immutable discussion array changes. Keep that boundary identity-based: a
  // geometry/selection render must not join every follow-up's text merely to
  // decide that nothing changed.
  const highlightRenderedKey = useMemo(
    () => ({ answerHtml: chosenHtml, followUpMessages }),
    [chosenHtml, followUpMessages],
  )

  const resultRunning = running || varying

  // Stay with the text while it is being written. This began as follow-up
  // behaviour and applies to the result itself for the same reason: a reader
  // watching an answer arrive should not have to chase it down the card.
  //
  // A finished result is deliberately left alone. Only a body that something is
  // streaming into scrolls itself, so switching versions or opening an old
  // Result still starts where the reader expects, at the top.
  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el || !bodyPinnedRef.current) return
    if (!followUpThread && !resultRunning) return
    el.scrollTo({ top: el.scrollHeight })
  }, [followUpThread, followUpMessages.length, lastFollowUpText, chosenText, resultRunning, selected])

  const onBodyScroll = () => {
    const el = bodyScrollRef.current
    if (!el) return
    rememberScrollPosition()
    // A reader who leaves the end owns their reading position while chunks
    // arrive. Returning near the end resumes live scrolling.
    bodyPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const sourceStatus = useSourceChangeStatus(renderedVersion)

  const budgetCardLabel = makeBudgetLabel()

  useCardHighlights(id, highlightRootRef, highlightRenderedKey)

  // The trail belongs to the version being read, so switching versions switches
  // provenance with it. Starting a run chooses the version it will fill, so the
  // chosen version IS the running one and no separate live branch is needed. A
  // branch here was visibly wrong: the trail blinked out for a frame at the
  // moment the run stopped and the answer began to stream. The fallback covers
  // only the gap before any version exists.
  //
  // Undefined, not an empty array, when the run used no tools: almost every
  // Card on a board is that Card, and this way each one mounts nothing rather
  // than a component that renders null. The Run's own array is passed through
  // untouched, so a memoised trail does not re-render while an answer streams.
  const trailRun = renderedRun ?? latestAskRun
  const toolSteps = trailRun?.toolSteps?.length ? trailRun.toolSteps : undefined
  const latestRunHasOutput = useMemo(() => Boolean(
    latestAskRun && versions.some((version) => (
      version.fromRunId === latestAskRun.id || version.id === latestAskRun.producedVersionId
    )),
  ), [latestAskRun, versions])
  const showFailedRunCallout = Boolean(
    !resultRunning && latestAskRun?.status === 'failed' && !latestRunHasOutput,
  )
  // The callout says what to do next, not what went wrong, so most failures
  // share one line. A refusal for length is the exception worth naming: the
  // generic line sends the reader to check a key that is working, when the
  // thing to change is the size of what they connected.
  const failureNextStep =
    latestAskRun?.errorMessage === 'errTooLong' ? words.errTooLong : words.resultFailureNextStep
  const provisionalLabel = provisionalReasonLabel(renderedVersion?.provisionalReason)
  const showProvisionalCallout = Boolean(
    !showFailedRunCallout && renderedVersion?.provisional && versions.length <= 1,
  )
  const showKeepAction = Boolean(versions.length > 1 && renderedVersion)
  const showCancelAction = Boolean(resultRunning && askAiCardId)
  const showContextAction = Boolean(renderedRun)
  const footActionCount = 4 + Number(showKeepAction) + Number(showCancelAction) + Number(showContextAction)
  const overflowContext = showContextAction && footActionCount > 5
  const overflowVariations = footActionCount - Number(overflowContext) > 5
  const showActionOverflow = overflowContext || overflowVariations

  useEffect(() => {
    if (!showActionOverflow) setFootActionsOpen(false)
  }, [showActionOverflow])

  const onTurnFollowUpIntoNote = useCallback((message: FollowUpMessage) => {
    if (!renderedVersionId || !message.text.trim()) return
    const position = useGraph.getState().graph().cardById(id)?.position
    if (!position) return
    createVersionNote(
      renderedVersionId,
      message.text,
      { x: position.x + 300, y: position.y + 40 },
      'followup',
      message.id,
    )
  }, [renderedVersionId, createVersionNote, id])

  const onCopyFollowUp = useCallback(async (message: FollowUpMessage) => {
    setCopiedFollowUpMessageId(message.id)
    const clear = () => {
      setCopiedFollowUpMessageId((current) => current === message.id ? null : current)
    }
    setTimeout(clear, 1200)
    if (!(await writeTextToClipboard(message.text))) clear()
  }, [])

  if (!cardPresent) return null

  const onCopy = async () => {
    if (!renderedVersion) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
    if (!(await writeTextToClipboard(renderedVersion.text))) setCopied(false)
  }

  const onTurnIntoNote = () => {
    if (!renderedVersion?.text.trim()) return
    const position = useGraph.getState().graph().cardById(id)?.position
    if (!position) return
    createVersionNote(
      renderedVersion.id,
      renderedVersion.text,
      { x: position.x + 300, y: position.y },
      'version',
    )
  }

  const onMakeVariations = async () => {
    if (!askAiCardId || varying || running) return
    setVariationFallbackVersionId(chosen?.id ?? null)
    setVarying(true)
    const outcome = await makeVariations(askAiCardId, 1)
    setVarying(false)
    setVariationFallbackVersionId(null)
    if (!outcome.ok && outcome.reason === 'no-key') setKeyPromptOpen(true)
  }

  const onOpenFollowUp = () => {
    if (!renderedVersion || !canFollowUp) return
    followUpInputRef.current?.focus()
  }

  const onSendFollowUp = async () => {
    const text = followUpDraft.trim()
    if (!renderedVersion || !text || followUpRunning || running || varying) return
    setFollowUpDraft('')
    const outcome = await runFollowUp(renderedVersion.id, text)
    if (!outcome.ok) {
      if (outcome.reason === 'no-key') {
        setFollowUpDraft(text)
        setKeyPromptOpen(true)
      }
    }
  }

  return (
    <CardShell
      id={id}
      kind="result"
      selected={!!selected}
      data={data}
    >
      <div className="card-body" ref={bodyWheelGate} onScroll={onBodyScroll}>
        <VersionSwitcher
          versions={versions}
          chosenId={renderedVersionId ?? chosenId}
          selected={!!selected}
          onChoose={(versionId) => output && chooseVersion(output.id, versionId)}
          style={{ marginBottom: 8 }}
        />
        {(renderedRun || sourceStatus) && (
          <div className="card-meta t-micro">
            {renderedRun && (
              <span className="card-meta__model" title={renderedRun.model}>
                {modelLabel(renderedRun.model)}
              </span>
            )}
            <SourceChangedBadge
              status={sourceStatus}
              selected={!!selected}
              onDismiss={(signature) => dismissSourceChanges(renderedVersion!.id, signature)}
            />
          </div>
        )}
        <BudgetMarker budget={renderedRun?.contextBudget} label={budgetCardLabel} selected={!!selected} />
        {toolSteps && (
          <RunToolTrail steps={toolSteps} running={resultRunning} selected={!!selected} />
        )}
        <div ref={highlightRootRef} className={`result-highlight-root ${textDragBlock}`}>
          <ResultText html={chosenHtml} hasText={hasText} loading={varying || running} />
          {showFailedRunCallout ? (
            <Callout tone="avoid" className="result-provisional-callout">
              {failureNextStep}
            </Callout>
          ) : showProvisionalCallout ? (
            <Callout
              tone={renderedVersion?.provisionalReason === 'failed' ? 'avoid' : 'attention'}
              className="result-provisional-callout"
            >
              {provisionalLabel}
            </Callout>
          ) : null}
          {renderedVersion && followUpThread && (
            <FollowUpThread
              messages={renderedFollowUpMessages}
              copiedMessageId={copiedFollowUpMessageId}
              onCopy={onCopyFollowUp}
              onTurnIntoNote={onTurnFollowUpIntoNote}
            />
          )}
        </div>
      </div>
      <div className={`card-foot ${dragBlock}`}>
        <IconButton
          label={copied ? words.copied : words.copy}
          tooltipOpen={copied}
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
            disabled={!askAiCardId || varying || running}
          />
        )}
        <IconButton
          label={words.followUp}
          icon={<MessageCircle aria-hidden="true" />}
          size="compact"
          onClick={onOpenFollowUp}
          disabled={!canFollowUp}
        />
        {showKeepAction && renderedVersion && (
          <IconButton
            label={words.keepThis}
            tooltip={renderedVersion.accepted ? words.unkeep : words.keepThis}
            icon={<Check aria-hidden="true" />}
            size="compact"
            className="result-foot-keep e-icon-button--go-selected"
            pressed={Boolean(renderedVersion.accepted)}
            onClick={() => output && setVersionAccepted(output.id, renderedVersion.id)}
          />
        )}
        {resultRunning && askAiCardId && (
          <Button
            variant="quiet"
            size="compact"
            onClick={() => cancelAiRun(askAiCardId)}
          >
            {words.cancel}
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
                  disabled={!askAiCardId || varying || running}
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
      {renderedVersion && canFollowUp && (selected || Boolean(followUpThread)) && (
        <div className={`followup-ask ${dragBlock}`}>
          <div className="followup-compose">
            <TextArea
              ref={followUpInputRef}
              className="followup-input"
              prose
              rows={1}
              placeholder={words.followUpPlaceholder}
              value={followUpDraft}
              onChange={(e) => setFollowUpDraft(e.target.value)}
              onClick={preserveCardSelectionOnTextRangeClick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !followUpRunning) {
                  e.preventDefault()
                  void onSendFollowUp()
                }
              }}
            />
            {followUpRunning && (
              <Button
                variant="quiet"
                size="field-mate"
                onClick={() => renderedVersion && cancelFollowUp(renderedVersion.id)}
              >
                {words.stop}
              </Button>
            )}
            <IconButton
              label={words.interjectionSend}
              icon={<ArrowUp aria-hidden="true" />}
              variant="primary"
              size="field-mate"
              className="followup-send"
              onClick={() => void onSendFollowUp()}
              disabled={!followUpDraft.trim() || followUpRunning}
            />
          </div>
        </div>
      )}
      {contextOpen && renderedVersion && (
        <VersionContext version={renderedVersion} onClose={() => setContextOpen(false)} />
      )}
    </CardShell>
  )
}

// The answer may contain a million characters, but selection does not change
// one byte of it. Keep React from comparing that retained HTML on the hot
// selection handoff.
const ResultText = memo(function ResultText({
  html,
  hasText,
  loading,
}: {
  html: string
  hasText: boolean
  loading: boolean
}) {
  if (hasText) {
    return (
      <>
        <div
          className="result-text markdown e-prose t-prose-m"
          onClick={followCardTextLink}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {loading && (
          <span className="streaming-dot" role="status" aria-label={words.runningState} />
        )}
      </>
    )
  }

  return (
    <div className="result-text e-prose t-prose-m">
      {loading ? (
        // The pulse carries the live state without adding a footer indicator;
        // it remains named for readers who cannot see it pulse.
        <span className="streaming-dot" role="status" aria-label={words.runningState} />
      ) : (
        <span className="result-empty">{words.resultEmpty}</span>
      )}
    </div>
  )
})

// Selection changes the one enclosing result root's pointer authority. The
// retained discussion itself is immutable during that handoff, so keep its
// potentially hundreds of rows out of React's selection/drag reconciliation.
const FollowUpThread = memo(function FollowUpThread({
  messages,
  copiedMessageId,
  onCopy,
  onTurnIntoNote,
}: {
  messages: readonly RenderedFollowUpMessage[]
  copiedMessageId: string | null
  onCopy: (message: FollowUpMessage) => Promise<void>
  onTurnIntoNote: (message: FollowUpMessage) => void
}) {
  return (
    <div className="followup-thread">
      {messages.map((row) => (
        <FollowUpBubble
          key={row.message.id}
          {...row}
          copied={copiedMessageId === row.message.id}
          onCopy={onCopy}
          onTurnIntoNote={onTurnIntoNote}
        />
      ))}
    </div>
  )
})
