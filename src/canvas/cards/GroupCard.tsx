import type { NodeProps } from '@xyflow/react'
import { Check, Copy, Eye, GripVertical, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { buildGroupDigestInstruction, groupMemberCompressionText } from '../../brain/groupDigestFreshness'
import { modelLabel } from '../../brain/models'
import { cancelAiRun, runGroupCompression } from '../../brain/runEngine'
import { cardLabel, chosenVersion, textHasContent } from '../../graph/graphHelpers'
import { useGraph } from '../../graph/store'
import type { BoardChange } from '../../graph/boardChange'
import type { Card, Output } from '../../graph/types'
import { followCardTextLink } from '../cardLinks'
import { writeTextToClipboard } from '../../shared/clipboardText'
import { renderMarkdown } from '../../shared/markdown'
import {
  isProfileReviewExecution,
  resolveProfileReviewModel,
} from '../../shared/profileReviewPolicy'
import { cardKindLabels, words } from '../../shared/words'
import { ModalShell, useDialogs } from '../../ui/overlays'
import {
  Button,
  Callout,
  Field,
  FieldLabel,
  IconButton,
  Picker,
  StateWord,
  TextArea,
} from '../../ui/primitives'
import {
  boardSnapshotNow,
  useOutputForResultCard,
  useRunById,
  useSourceChangeStatus,
} from '../graphSelectors'
import { dragBlockingClass, useWheelGate } from '../cardInteraction'
import { VersionContext } from '../VersionContext'
import { CardShell } from './CardShell'
import { SourceChangedBadge } from './SourceChangedBadge'
import { VersionSwitcher } from './VersionSwitcher'
import { provisionalReasonLabel } from './cardChrome'

let groupMemberSemanticProjectionVisitCount = 0
let groupMemberDetailsProjectionCount = 0

export function groupMemberSemanticProjectionVisitCountForTests(): number {
  return groupMemberSemanticProjectionVisitCount
}

export function resetGroupMemberSemanticProjectionVisitCountForTests(): void {
  groupMemberSemanticProjectionVisitCount = 0
}

export function groupMemberDetailsProjectionCountForTests(): number {
  return groupMemberDetailsProjectionCount
}

export function resetGroupMemberDetailsProjectionCountForTests(): void {
  groupMemberDetailsProjectionCount = 0
}

function groupMemberDetailsText(
  board: ReturnType<typeof boardSnapshotNow>,
  member: Card,
): string {
  groupMemberDetailsProjectionCount += 1
  return groupMemberCompressionText(board, member)
}

type GroupMemberSemanticProjectionCache = {
  cards: readonly Card[] | undefined
  outputs: ReturnType<typeof useGraph.getState>['outputs'] | undefined
  changeSeq: number | undefined
  members: readonly Card[]
  memberIds: Set<string>
  resultOutputIds: Set<string>
  resultOutputs: Map<string, Output>
}

function createGroupMemberSemanticProjectionCache(): GroupMemberSemanticProjectionCache {
  return {
    cards: undefined,
    outputs: undefined,
    changeSeq: undefined,
    members: [],
    memberIds: new Set(),
    resultOutputIds: new Set(),
    resultOutputs: new Map(),
  }
}

const GROUP_MEMBER_GEOMETRY_ASPECTS = new Set(['position', 'size', 'layer'])

type GroupMemberRenderedField = 'id' | 'kind' | 'title' | 'blocks' | 'modV2'

const GROUP_MEMBER_RENDERED_FIELD_RECORD = {
  id: true,
  kind: true,
  title: true,
  blocks: true,
  modV2: true,
} satisfies Record<GroupMemberRenderedField, true>

const GROUP_MEMBER_RENDERED_FIELDS = Object.keys(
  GROUP_MEMBER_RENDERED_FIELD_RECORD,
) as GroupMemberRenderedField[]

function sameGroupMemberRenderedSemantics(
  previous: readonly Card[],
  next: readonly Card[],
): boolean {
  if (previous.length !== next.length) return false
  return next.every((member, index) => {
    const prior = previous[index]
    return Boolean(prior) && GROUP_MEMBER_RENDERED_FIELDS.every(
      (field) => Object.is(prior[field], member[field]),
    )
  })
}

function sameResultOutputs(
  previous: ReadonlyMap<string, Output>,
  next: ReadonlyMap<string, Output>,
): boolean {
  if (previous.size !== next.size) return false
  for (const [outputId, output] of next) {
    if (previous.get(outputId) !== output) return false
  }
  return true
}

function groupMemberChangeIsSemantic(
  state: ReturnType<typeof useGraph.getState>,
  groupId: string,
  change: BoardChange,
  cache: GroupMemberSemanticProjectionCache,
): boolean {
  const cardChange = change.cards
  if (cardChange) {
    if ((cardChange.removed ?? []).some((cardId) => cache.memberIds.has(cardId))) return true
    for (const cardId of cardChange.added ?? []) {
      if (state.graph().cardById(cardId)?.groupId === groupId) return true
    }
    const updated = cardChange.updated ?? []
    if (updated.length) {
      if (!change.cardAspects?.length) {
        if (updated.some((cardId) => cache.memberIds.has(cardId))) return true
      } else if (!change.cardAspects.every((aspect) => GROUP_MEMBER_GEOMETRY_ASPECTS.has(aspect))) {
        // Group membership and saved member order are semantics here. Other
        // content changes matter only when they touch a current member.
        if (change.cardAspects.includes('grouping') || change.cardAspects.includes('order')) return true
        if (updated.some((cardId) => cache.memberIds.has(cardId))) return true
      }
    }
  }

  const outputChange = change.outputs
  if (outputChange) {
    if ((outputChange.removed ?? []).some((outputId) => cache.resultOutputIds.has(outputId))) return true
    for (const outputId of [...(outputChange.added ?? []), ...(outputChange.updated ?? [])]) {
      if (cache.resultOutputIds.has(outputId)) return true
      const output = state.outputs.find((candidate) => candidate.id === outputId)
      if (output && cache.memberIds.has(output.resultCardId)) return true
    }
  }
  return false
}

function groupMemberSemanticProjection(
  state: ReturnType<typeof useGraph.getState>,
  groupId: string,
  cache: GroupMemberSemanticProjectionCache,
): readonly Card[] {
  if (cache.cards === state.cards && cache.outputs === state.outputs) return cache.members

  const emission = state.lastBoardChange
  if (
    cache.cards &&
    cache.outputs &&
    emission &&
    cache.changeSeq !== undefined &&
    emission.seq === cache.changeSeq + 1 &&
    !groupMemberChangeIsSemantic(state, groupId, emission.change, cache)
  ) {
    cache.cards = state.cards
    cache.outputs = state.outputs
    cache.changeSeq = emission.seq
    return cache.members
  }

  const graph = state.graph()
  const members = [...graph.membersOf(groupId)]
  const memberIds = new Set<string>()
  const resultOutputIds = new Set<string>()
  const resultOutputs = new Map<string, Output>()
  for (const member of members) {
    groupMemberSemanticProjectionVisitCount += 1
    memberIds.add(member.id)
    if (member.kind !== 'result') continue
    const output = graph.outputForResultCard(member.id)
    if (output) {
      resultOutputIds.add(output.id)
      resultOutputs.set(output.id, output)
    }
  }
  const canonicalMembers =
    sameGroupMemberRenderedSemantics(cache.members, members) &&
    sameResultOutputs(cache.resultOutputs, resultOutputs)
      ? cache.members
      : members
  cache.cards = state.cards
  cache.outputs = state.outputs
  cache.changeSeq = emission?.seq ?? state.boardChangeSeq
  cache.members = canonicalMembers
  cache.memberIds = memberIds
  cache.resultOutputIds = resultOutputIds
  cache.resultOutputs = resultOutputs
  return canonicalMembers
}

export function GroupCard({ id, selected, data }: NodeProps) {
  const dialogs = useDialogs()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [compressState, setCompressState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const versionTextWheelGate = useWheelGate(true)
  const nameEditStartRef = useRef('')
  const promptEditStartRef = useRef('')
  // A Group's frame and details read semantics, not layout. Keep the live Card
  // objects behind a shallow signature so a member moving cannot wake the Group.
  const group = useGraph(useShallow((s) => {
    const found = s.graph().cardById(id)
    return {
      exists: Boolean(found),
      title: found?.title,
      compressionPrompt: found?.compressionPrompt,
      model: found?.model,
    }
  }))
  const memberProjectionCache = useMemo(
    () => createGroupMemberSemanticProjectionCache(),
    [id],
  )
  const members = useGraph((state) => groupMemberSemanticProjection(state, id, memberProjectionCache))
  const output = useOutputForResultCard(id)
  const defaultModel = useGraph((s) => s.settings.model)
  const modelChoices = useGraph((s) => s.settings.models)
  const setCardTitle = useGraph((s) => s.setCardTitle)
  const recordCardContentEdited = useGraph((s) => s.recordCardContentEdited)
  const setCardModel = useGraph((s) => s.setCardModel)
  const setPrompt = useGraph((s) => s.setGroupCompressionPrompt)
  const deleteCard = useGraph((s) => s.deleteCard)
  const removeCardFromGroup = useGraph((s) => s.removeCardFromGroup)
  const reorderGroupMembers = useGraph((s) => s.reorderGroupMembers)
  const chooseVersion = useGraph((s) => s.chooseVersion)
  const setVersionAccepted = useGraph((s) => s.setVersionAccepted)
  const setKeyPromptOpen = useGraph((s) => s.setKeyPromptOpen)
  const dismissSourceChanges = useGraph((s) => s.dismissSourceChanges)

  const versions = output?.versions ?? []
  const chosen = chosenVersion(output)
  const chosenId = output?.chosenVersionId ?? chosen?.id
  const chosenRun = useRunById(chosen?.fromRunId)
  const sourceStatus = useSourceChangeStatus(chosen)
  // The exact compression text is a details-panel affordance; compute it
  // reactively only while that panel can show it.
  const exactCompressionText = useGraph((s) => {
    if (!detailsOpen) return ''
    const groupCard = s.graph().cardById(id)
    if (!groupCard) return ''
    return buildGroupDigestInstruction(boardSnapshotNow(), groupCard, [...s.graph().membersOf(id)])
  })
  const runningStoreCompression = useGraph((s) =>
    s.graph().runsForCard(id).some((run) => run.status === 'running' && run.kind !== 'conversation'),
  )

  useEffect(() => {
    if (!runningStoreCompression) return
    setCompressState((state) => state === 'running' ? state : 'idle')
  }, [runningStoreCompression])

  const hasChosenText = useMemo(
    () => detailsOpen && textHasContent(chosen?.text ?? ''),
    [chosen?.text, detailsOpen],
  )

  if (!group.exists) return null

  const profileReview = isProfileReviewExecution()
  const currentModel = resolveProfileReviewModel(group.model || defaultModel)
  const isCustomModel = !modelChoices.includes(currentModel)
  const nameFieldId = `group-name-${id}`
  const promptFieldId = `group-prompt-${id}`
  const runningCompression = compressState === 'running' || runningStoreCompression
  const provisionalLabel = provisionalReasonLabel(chosen?.provisionalReason)
  const showFailedProvisional = Boolean(
    chosen?.provisional && chosen.provisionalReason === 'failed' && versions.length <= 1,
  )
  const showFailureCallout = !runningCompression && (compressState === 'failed' || showFailedProvisional)
  const showProvisionalCallout = Boolean(
    !runningCompression && !showFailureCallout && chosen?.provisional && versions.length <= 1,
  )
  const memberDetailsBoard = detailsOpen ? boardSnapshotNow() : null
  const compressStateLabel =
    runningCompression
      ? words.runningState
      : showFailureCallout
          ? words.couldntRun
          : compressState === 'done'
            ? words.done
            : words.ready

  const onCopyVersion = async () => {
    if (!chosen) return
    if (await writeTextToClipboard(chosen.text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }

  const onRunCompression = async () => {
    if (runningCompression) {
      cancelAiRun(id)
      return
    }
    setCompressState('running')
    const outcome = await runGroupCompression(id)
    if (outcome.ok && outcome.status === 'done') {
      setCompressState('done')
    } else if (outcome.ok && outcome.status === 'canceled') {
      setCompressState('idle')
    } else if (outcome.reason === 'no-key') {
      setCompressState('idle')
      setKeyPromptOpen(true)
    } else {
      setCompressState('failed')
    }
  }

  const onDeleteGroup = async () => {
    const groupId = id
    const confirmed = await dialogs.confirm({
      title: words.deleteGroup,
      message: words.deleteGroupConfirm,
      confirmLabel: words.deleteGroup,
      tone: 'danger',
    })
    if (!confirmed) return
    deleteCard(groupId)
    setDetailsOpen(false)
    setContextOpen(false)
  }

  const moveBefore = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return
    const ids = members.map((member) => member.id)
    const from = ids.indexOf(draggingId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    reorderGroupMembers(id, next)
  }

  return (
    <>
      <CardShell id={id} kind="group" selected={!!selected} data={data}>
        <div className="card-body group-frame-space" />
        <div className="card-foot group-foot">
          <Button
            size="compact"
            className={dragBlockingClass(!!selected)}
            onClick={() => setDetailsOpen(true)}
          >
            {words.groupDetails}
          </Button>
          <span className="run-state">
            {members.length} {members.length === 1 ? words.groupItemSingular : words.groupItemPlural}
          </span>
        </div>
      </CardShell>
      <ModalShell
        open={detailsOpen}
        title={words.groupDetailsTitle}
        subtitle={words.groupDetailsNote}
        dismissOnBackdrop
        className="group-modal"
        onDismiss={() => setDetailsOpen(false)}
        footer={
          <>
            <Button variant="danger" onClick={onDeleteGroup}>
              {words.deleteGroup}
            </Button>
            <Button onClick={() => setDetailsOpen(false)}>{words.close}</Button>
          </>
        }
      >
        {detailsOpen && (
          <>
        <div className="group-modal-section">
          <FieldLabel htmlFor={nameFieldId}>{words.groupName}</FieldLabel>
          <Field
            id={nameFieldId}
            className="group-modal-field"
            value={group.title ?? ''}
            placeholder={words.groupNamePlaceholder}
            onFocus={() => {
              nameEditStartRef.current = group.title ?? ''
            }}
            onBlur={(e) => {
              if (e.target.value !== nameEditStartRef.current) recordCardContentEdited(id, 'title')
            }}
            onChange={(e) => setCardTitle(id, e.target.value)}
          />
        </div>

        <div className="group-modal-section">
          <FieldLabel htmlFor={promptFieldId}>{words.groupPrompt}</FieldLabel>
          <TextArea
            id={promptFieldId}
            className="group-modal-field"
            value={group.compressionPrompt ?? ''}
            placeholder={words.groupPromptPlaceholder}
            onFocus={() => {
              promptEditStartRef.current = group.compressionPrompt ?? ''
            }}
            onBlur={(e) => {
              if (e.target.value !== promptEditStartRef.current) recordCardContentEdited(id, 'groupPrompt')
            }}
            onChange={(e) => setPrompt(id, e.target.value)}
          />
        </div>

        <div className="group-modal-section">
          <div className="group-modal-section__title t-label">{words.modelLabel}</div>
          <Picker
            className="group-modal-field"
            ariaLabel={words.modelLabel}
            emptyLabel={words.none}
            value={currentModel}
            options={[
              ...modelChoices.map((slug) => ({ value: slug, label: modelLabel(slug) })),
              ...(isCustomModel
                ? [{ value: currentModel, label: modelLabel(currentModel) }]
                : []),
            ]}
            onValueChange={(model) => setCardModel(id, model)}
            disabled={profileReview}
          />
        </div>

        <div className="group-modal-section">
          <div className="group-modal-section__title t-title">{words.groupDigest}</div>
          <div className="group-modal-panel group-version-review">
            <VersionSwitcher
              versions={versions}
              chosenId={chosenId}
              selected={!!selected}
              onChoose={(versionId) => output && chooseVersion(output.id, versionId)}
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
            {hasChosenText ? (
              <div
                className="result-text markdown e-prose t-prose-m group-version-text"
                ref={versionTextWheelGate}
                onClick={followCardTextLink}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(chosen!.text) }}
              />
            ) : (
              <div className="result-text e-prose t-prose-m group-version-text">
                {runningCompression ? (
                  <StateWord tone="running" className="result-empty">{words.runningState}</StateWord>
                ) : (
                  <span className="result-empty">{words.groupDigestEmpty}</span>
                )}
              </div>
            )}
            {showFailureCallout ? (
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
            <div className="group-version-actions">
              <Button
                variant={runningCompression ? 'quiet' : 'primary'}
                size="compact"
                onClick={onRunCompression}
                disabled={members.length === 0}
              >
                {runningCompression ? words.cancel : words.groupCompress}
              </Button>
              <IconButton
                label={copied ? words.copied : words.copy}
                icon={<Copy aria-hidden="true" />}
                size="compact"
                onClick={onCopyVersion}
                disabled={!hasChosenText}
              />
              {output && chosen && (
                <IconButton
                  label={words.keepThis}
                  tooltip={chosen.accepted ? words.unkeep : words.keepThis}
                  icon={<Check aria-hidden="true" />}
                  size="compact"
                  className="group-version-keep e-icon-button--go-selected"
                  pressed={Boolean(chosen.accepted)}
                  onClick={() => setVersionAccepted(output.id, chosen.id)}
                />
              )}
              {chosenRun && chosen && (
                <IconButton
                  label={words.showWhatAiUsed}
                  icon={<Eye aria-hidden="true" />}
                  size="compact"
                  onClick={() => setContextOpen(true)}
                />
              )}
              <StateWord
                tone={runningCompression ? 'running' : showFailureCallout ? 'failed' : 'neutral'}
              >
                {compressStateLabel}
              </StateWord>
            </div>
          </div>
        </div>

        <div className="group-modal-section">
          <div className="group-modal-section__title t-title">{words.groupMembers}</div>
          {members.length === 0 ? (
            <div className="group-empty t-hint">{words.groupNoMembers}</div>
          ) : (
            <div className="group-member-list">
              {members.map((member) => (
                <details
                  className={`peek-item context-item group-member-item t-ui ${
                    draggingId === member.id ? 'dragging' : ''
                  }`}
                  key={member.id}
                  onDragOver={(e) => {
                    if (!draggingId || draggingId === member.id) return
                    e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    moveBefore(member.id)
                    setDraggingId(null)
                  }}
                >
                  <summary>
                    <span className="context-title">{cardLabel(member)}</span>
                    <IconButton
                      className="group-member-remove"
                      variant="danger"
                      size="compact"
                      label={words.removeFromGroup}
                      icon={<X aria-hidden="true" />}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        removeCardFromGroup(member.id)
                      }}
                    />
                    <IconButton
                      className="group-member-drag"
                      variant="ghost"
                      size="compact"
                      label={words.dragToRearrange}
                      icon={<GripVertical aria-hidden="true" />}
                      draggable
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', member.id)
                        setDraggingId(member.id)
                      }}
                      onDragEnd={() => setDraggingId(null)}
                    />
                  </summary>
                  <div className="context-body group-member-body t-prose-s">
                    <span className="lbl t-label">{cardKindLabels[member.kind]}</span>
                    <pre>{groupMemberDetailsText(memberDetailsBoard!, member)}</pre>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        <details className="peek-raw">
          <summary>{words.seeExactText}</summary>
          <pre>{exactCompressionText}</pre>
        </details>
          </>
        )}
      </ModalShell>
      {contextOpen && chosen && <VersionContext version={chosen} onClose={() => setContextOpen(false)} />}
    </>
  )
}
