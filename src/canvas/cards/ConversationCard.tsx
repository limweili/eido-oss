import type { NodeProps } from '@xyflow/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGraph } from '../../graph/store'
import { cardTextFromBlocks } from '../../graph/graphHelpers'
import { cancelConversation, runConversation } from '../../brain/conversationRunner'
import { CONVERSATION_STYLES, type ConversationStyle } from '../../graph/types'
import { words } from '../../shared/words'
import { Button, Callout, Picker, StateWord, Stepper } from '../../ui/primitives'
import { canEditSelectedCard, dragBlockingClass, useRelativeScrollPosition, useWheelGate } from '../cardInteraction'
import { CardShell } from './CardShell'
import {
  armCardPointerEditIntent,
  consumeCardEditIntent,
  subscribeToCardEditIntent,
} from './cardEditIntent'
import { HighlightableText } from './HighlightableText'
import { MarkdownCardEditor, type EditorFocusPoint } from './MarkdownCardEditor'

const STYLE_LABEL: Record<ConversationStyle, string> = {
  debate: words.conversationStyleDebate,
  critique: words.conversationStyleCritique,
  interview: words.conversationStyleInterview,
  collaborate: words.conversationStyleCollaborate,
}

// The Conversation card: the room and the schedule. It owns the shared topic, the
// Style, and how many turns each participant gets. It never speaks — incoming Ask
// AI cards do. Kept intentionally small: three settings, no workflow form.
export function ConversationCard({ id, selected, data }: NodeProps) {
  const card = useGraph(useShallow((s) => {
    const found = s.graph().cardById(id)
    return {
      exists: Boolean(found),
      blocks: found?.blocks,
      conversationStyle: found?.conversationStyle,
      conversationTurns: found?.conversationTurns,
    }
  }))
  const setCardText = useGraph((s) => s.setCardText)
  const recordCardContentEdited = useGraph((s) => s.recordCardContentEdited)
  const setConversationStyle = useGraph((s) => s.setConversationStyle)
  const setConversationTurns = useGraph((s) => s.setConversationTurns)
  const setKeyPromptOpen = useGraph((s) => s.setKeyPromptOpen)
  // Is a run for this Conversation currently in progress?
  const running = useGraph((s) =>
    s.graph().runsForCard(id).some((r) => r.kind === 'conversation' && r.status === 'running'),
  )

  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editIntentVersion, setEditIntentVersion] = useState(0)
  const editingRef = useRef(false)
  const editStartTextRef = useRef('')
  const editFocusPointRef = useRef<EditorFocusPoint>(null)
  const pointerFocusRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const currentIdeaId = useGraph((s) => s.currentIdeaId)
  const text = card.blocks ? cardTextFromBlocks(card.blocks) : ''
  const activeTool = useGraph((s) => s.activeTool)
  const canEdit = canEditSelectedCard({ activeTool, data, selected: !!selected })
  const bodyWheelGate = useWheelGate(editing, bodyRef)
  const dragBlock = dragBlockingClass(!!selected)
  const { rememberScrollPosition, restoreScrollPosition } = useRelativeScrollPosition(
    currentIdeaId,
    id,
    bodyRef,
  )

  function beginEditing(focusPoint: EditorFocusPoint) {
    if (editingRef.current) return
    editingRef.current = true
    editFocusPointRef.current = focusPoint
    rememberScrollPosition()
    editStartTextRef.current = text
    setEditing(true)
  }

  function startEditing(focusPoint: EditorFocusPoint = null) {
    if (activeTool !== 'select' || !canEdit || editingRef.current) return
    const pointerIntent = consumeCardEditIntent(currentIdeaId, id)
    if (focusPoint && pointerIntent === undefined) return
    beginEditing(pointerIntent ?? focusPoint)
  }

  function armPointerEditIntent(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target
    if (
      e.button !== 0 ||
      e.shiftKey ||
      e.metaKey ||
      e.ctrlKey ||
      activeTool !== 'select' ||
      (target instanceof Element && target.closest('a'))
    ) {
      return
    }
    pointerFocusRef.current = true
    armCardPointerEditIntent({
      ideaId: currentIdeaId,
      cardId: id,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      onClear: e.pointerType === 'mouse'
        ? () => { pointerFocusRef.current = false }
        : undefined,
    })
  }

  function commitTextEdit(nextText: string) {
    if (nextText !== editStartTextRef.current) recordCardContentEdited(id)
    editStartTextRef.current = nextText
  }

  function finishEditing(nextText: string) {
    if (!editingRef.current) return
    editingRef.current = false
    rememberScrollPosition()
    commitTextEdit(nextText)
    setEditing(false)
  }

  // Selection makes this Card eligible to edit; only a stationary content
  // release (or an explicit keyboard activation) mounts the rich editor.
  useLayoutEffect(() => {
    if (canEdit && !editing) {
      const focusPoint = consumeCardEditIntent(currentIdeaId, id)
      if (focusPoint !== undefined) {
        beginEditing(focusPoint)
        return
      }
    }
    if (activeTool !== 'select' && editing) finishEditing(text)
  }, [activeTool, canEdit, currentIdeaId, editIntentVersion, editing, id, text])

  useLayoutEffect(() => subscribeToCardEditIntent(
    currentIdeaId,
    id,
    () => setEditIntentVersion((version) => version + 1),
  ), [currentIdeaId, id])

  useLayoutEffect(() => {
    restoreScrollPosition()
  }, [editing, restoreScrollPosition])

  if (!card.exists) return null

  const style = card.conversationStyle ?? 'debate'
  const turns = card.conversationTurns ?? 3

  const onRun = async () => {
    setError(null)
    const outcome = await runConversation(id)
    if (outcome.ok) return
    if (outcome.reason === 'no-key') {
      setKeyPromptOpen(true)
    } else {
      setError(words[outcome.message as keyof typeof words] ?? words.errGeneric)
    }
  }

  const stateLabel = running ? words.runningState : error ? words.couldntRun : words.ready
  const stateTone = running ? 'running' : error ? 'failed' : 'neutral'

  return (
    <CardShell id={id} kind="conversation" selected={!!selected} data={data}>
      <div
        className={editing ? 'card-body editing' : 'card-body'}
        ref={bodyWheelGate}
        onScroll={rememberScrollPosition}
      >
        <div className="card-kind card-eyebrow t-micro">
          {words.conversationHeading}
        </div>
        {editing ? (
          <MarkdownCardEditor
            ariaLabel={words.conversationHeading}
            placeholder={words.conversationTopicPlaceholder}
            markdown={text}
            focusPoint={editFocusPointRef.current}
            onBlur={finishEditing}
            onChange={(nextText) => setCardText(id, nextText)}
            onContentReady={restoreScrollPosition}
          />
        ) : (
          <HighlightableText
            cardId={id}
            text={text}
            placeholder={words.conversationTopicPlaceholder}
            ariaLabel={words.conversationHeading}
            selected={!!selected}
            onPointerDown={armPointerEditIntent}
            onEditPoint={startEditing}
            onFocus={(event) => {
              if (pointerFocusRef.current) {
                pointerFocusRef.current = false
                return
              }
              const target = event.target
              if (target instanceof Element && target.closest('a')) return
              startEditing()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              startEditing()
            }}
          />
        )}
        <div className="conversation-controls">
          <div className={`model-pick ${dragBlock}`}>
            <span className="model-pick-label t-micro">{words.conversationStyle}</span>
            <Picker
              ariaLabel={words.conversationStyle}
              emptyLabel={words.none}
              className={dragBlock}
              variant="compact"
              value={style}
              options={CONVERSATION_STYLES.map((conversationStyle) => ({
                value: conversationStyle,
                label: STYLE_LABEL[conversationStyle],
              }))}
              onValueChange={(conversationStyle) => {
                setConversationStyle(id, conversationStyle)
                recordCardContentEdited(id, 'conversationSettings')
              }}
            />
          </div>
          <div className={`model-pick ${dragBlock}`}>
            <span className="model-pick-label t-micro">{words.conversationTurns}</span>
            <Stepper
              label={words.conversationTurns}
              value={turns}
              min={1}
              max={20}
              decrementLabel={words.decreaseConversationTurns}
              incrementLabel={words.increaseConversationTurns}
              onValueChange={(nextTurns) => {
                setConversationTurns(id, nextTurns)
                recordCardContentEdited(id, 'conversationSettings')
              }}
            />
          </div>
        </div>
      </div>
      {error && <Callout tone="avoid" className="card-run-callout">{error}</Callout>}
      <div className="card-foot">
        <Button
          variant={running ? 'quiet' : 'primary'}
          size="compact"
          className={dragBlock}
          onClick={running ? () => cancelConversation(id) : onRun}
        >
          {running ? words.conversationCancel : words.conversationRun}
        </Button>
        <StateWord tone={stateTone}>{stateLabel}</StateWord>
      </div>
    </CardShell>
  )
}
