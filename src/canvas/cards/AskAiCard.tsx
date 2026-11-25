import type { NodeProps } from '@xyflow/react'
import { Eye, Globe, Route, SquareTerminal } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGraph } from '../../graph/store'
import { gatherConnectedThoughtWithCachedSummaries } from '../../brain/contextCompaction'
import { budgetFor } from '../../brain/modelWindows'
import {
  cancelAiRun,
  cancelChain,
  resumeResearchRun,
  runChain,
  type ChainOutcome,
} from '../../brain/runEngine'
import { chainRunPreview, extraRunCount } from '../../brain/chainStaleness'
import { modelLabel } from '../../brain/models'
import { cardLabel, cardTextFromBlocks } from '../../graph/graphHelpers'
import { DEFAULT_CHAIN_CONFIRM_THRESHOLD, DEFAULT_COMPACTION_MODE } from '../../graph/types'
import {
  isProfileReviewExecution,
  resolveProfileReviewModel,
} from '../../shared/profileReviewPolicy'
import { words } from '../../shared/words'
import {
  Button,
  Callout,
  Chip,
  IconButton,
  Picker,
  Segmented,
  StateWord,
  Tooltip,
} from '../../ui/primitives'
import { ChainPreview } from '../ChainPreview'
import { ContextPeek } from '../ContextPeek'
import { useBoardSnapshot } from '../graphSelectors'
import {
  canEditSelectedCard,
  dragBlockingClass,
  resultPlacementContextFromNodeData,
  useRelativeScrollPosition,
  useWheelGate,
} from '../cardInteraction'
import { CardShell } from './CardShell'
import {
  armCardPointerEditIntent,
  consumeCardEditIntent,
  subscribeToCardEditIntent,
} from './cardEditIntent'
import { HighlightableText } from './HighlightableText'
import { MarkdownCardEditor, type EditorFocusPoint } from './MarkdownCardEditor'
import { agenticReachFor } from '../../brain/agenticRun'
import { researchDepthOf } from '../../brain/researchDepth'
import { researchJobOf } from '../../brain/researchJobMeta'
import { reachModeOf } from '../../brain/reachMode'

type LocalState = 'idle' | 'running' | 'done' | 'fresh' | 'failed'

// The four research depths as the Card offers them: the shirt size a person
// presses, and the two numbers that size turns on. Order is cheapest first,
// matching the default.
//
// The numbers used to hover in a tooltip and are now standing text beside the
// keys (founder decision 2026-08-18). A tooltip is drawn on the document, not
// in the Card, so on a coloured Card it arrived as a black pill from another
// world and it landed on top of the very sentence it was explaining. Money is
// also not a thing to make someone hunt for with a pointer: the price of the
// press you are about to make should simply be readable.
const RESEARCH_DEPTHS = [
  { value: 'S', label: words.researchDepthS, cost: words.researchDepthSHint },
  { value: 'M', label: words.researchDepthM, cost: words.researchDepthMHint },
  { value: 'L', label: words.researchDepthL, cost: words.researchDepthLHint },
  { value: 'XL', label: words.researchDepthXL, cost: words.researchDepthXLHint },
] as const
type ResearchDepthChoice = (typeof RESEARCH_DEPTHS)[number]['value']

export function AskAiCard({ id, selected, data }: NodeProps) {
  const card = useGraph(useShallow((s) => {
    const found = s.graph().cardById(id)
    return {
      exists: Boolean(found),
      blocks: found?.blocks,
      agentic: found?.agentic,
      model: found?.model,
      meta: found?.meta,
    }
  }))
  const setCardText = useGraph((s) => s.setCardText)
  const recordCardContentEdited = useGraph((s) => s.recordCardContentEdited)
  const setCardModel = useGraph((s) => s.setCardModel)
  const setCardReach = useGraph((s) => s.setCardReach)
  const setCardResearchDepth = useGraph((s) => s.setCardResearchDepth)
  const linkupKeyPresent = useGraph((s) => s.linkupKeyPresent)
  const provider = useGraph((s) => s.settings.provider ?? 'openrouter')
  const providerOwnsTools = agenticReachFor(provider) === 'provider-owned'
  const defaultModel = useGraph((s) => s.settings.model)
  const modelChoices = useGraph((s) => s.settings.models)
  const setKeyPromptOpen = useGraph((s) => s.setKeyPromptOpen)
  const addMod = useGraph((s) => s.addMod)
  const runningRun = useGraph((s) =>
    s.graph().runsForCard(id).some((r) => (r.kind ?? 'ask') === 'ask' && r.status === 'running'),
  )
  const [state, setState] = useState<LocalState>('idle')
  const [error, setError] = useState<string | null>(null)
  // Whether this Card is holding a Run press behind the research question.
  // Set by every Run press on a research-armed Card, cleared by the depth
  // press that answers it, the Cancel that withdraws it, or the globe cycling
  // away, so the callout exists exactly while the decision is open (#971).
  const [researchNotice, setResearchNotice] = useState(false)
  const [peekOpen, setPeekOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'gate' | 'peek' | null>(null)
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

  const profileReview = isProfileReviewExecution()
  const agentic = card.agentic === true
  // Research uses the optional Linkup key. Other web tools remain available
  // with the OpenRouter key, and installed CLIs run their own tool loop.
  const reach: 'off' | 'web' | 'research' = !agentic
    ? 'off'
    : linkupKeyPresent && reachModeOf(card) === 'research'
      ? 'research'
      : 'web'
  const reachWord = reach === 'off'
    ? words.reachTurnOnWeb
    : reach === 'web'
      ? words.reachWebOn
      : words.reachResearchOn
  const currentModel = resolveProfileReviewModel(card.model || defaultModel)
  // Show a slug not in the model list (e.g. an older card) so it still shows.
  const isCustom = !modelChoices.includes(currentModel)
  const running = state === 'running' || runningRun
  // The open research question, derived rather than stored alone: cycling the
  // globe away or a run starting stands it down without anyone remembering to
  // close it.
  const researchAsking = researchNotice && reach === 'research' && !providerOwnsTools && !running
  // The depth the Card would run at, which is also the key the callout marks:
  // the last one pressed, or S for a Card never asked.
  const researchDepth = researchDepthOf(card)
  // Resume exists only while a paid job is standing with no run listening,
  // and only where Eido itself runs the tools: research-armed, off a harness.
  const researchJob = researchJobOf(card)
  const savedResearchArmed =
    agentic && linkupKeyPresent && reachModeOf(card) === 'research'
  const canResume =
    savedResearchArmed && !providerOwnsTools && !running && researchJob !== null

  // Run always creates a new version for the pressed Ask. The chain engine
  // heals only stale upstream steps, unless the user chooses to re-run
  // everything. If the press would trigger more than the Settings threshold
  // of extra steps, the "what will run" preview asks first (#137).
  const startChain = async (everything: boolean) => {
    setPreviewMode(null)
    setError(null)
    setState('running')
    const outcome = await runChain(id, {
      everything,
      rerunTarget: !everything,
      resultPlacementContext: resultPlacementContextFromNodeData(data),
    })
    applyChainOutcome(outcome)
  }

  const applyChainOutcome = (outcome: ChainOutcome) => {
    if (outcome.ok && outcome.status === 'done') {
      setState('done')
    } else if (outcome.ok && outcome.status === 'fresh') {
      setState('fresh')
    } else if (outcome.ok) {
      setState('idle')
    } else if (outcome.reason === 'no-key') {
      setState('idle')
      setKeyPromptOpen(true)
    } else {
      setState('failed')
      const base = words[outcome.message as keyof typeof words] ?? words.errGeneric
      const failedCardId = outcome.steps[outcome.steps.length - 1]?.cardId
      const failedCard =
        failedCardId && failedCardId !== id
          ? useGraph.getState().cards.find((c) => c.id === failedCardId)
          : undefined
      setError(failedCard ? `${words.chainStoppedAt} “${cardLabel(failedCard)}”: ${base}` : base)
    }
  }

  // The tail of every path that actually starts a run: the chain-size gate,
  // then the chain itself.
  const proceedToRun = async () => {
    const store = useGraph.getState()
    const statuses = chainRunPreview(store.snapshot(), id)
    const threshold = store.settings.chainConfirmThreshold ?? DEFAULT_CHAIN_CONFIRM_THRESHOLD
    if (extraRunCount(statuses, id) > threshold) {
      setPreviewMode('gate')
      return
    }
    await startChain(false)
  }

  const onRun = async () => {
    if (running) {
      cancelChain(id)
      cancelAiRun(id)
      return
    }
    // On a research-armed Card the first Run press opens the question instead
    // of running: which depth, at which cost. Every press asks (#971), because
    // a second run spends the same money as the first. The depth keys under
    // the question only set the dial; this same key, pressed again, is the
    // consent that spends (founder decision 2026-08-18).
    if (reach === 'research' && !providerOwnsTools && !researchAsking) {
      setResearchNotice(true)
      return
    }
    setResearchNotice(false)
    await proceedToRun()
  }

  // A depth press only prepares: it pins the choice on the Card, where the run
  // engine reads it and the next reload finds it, and nothing starts. The
  // question stays open, holding Run, because a key that both chose and spent
  // gave a person no way to change their mind between the two.
  const onResearchDepth = (depth: ResearchDepthChoice) => {
    setCardResearchDepth(id, depth)
  }

  // Re-attach to the paid job whose id is standing in card.meta: poll it out
  // and land its answer, submitting nothing new.
  const onResume = async () => {
    setResearchNotice(false)
    setError(null)
    setState('running')
    const outcome = await resumeResearchRun(id, {
      resultPlacementContext: resultPlacementContextFromNodeData(data),
    })
    if (outcome.ok) {
      setState(outcome.status === 'done' ? 'done' : 'idle')
    } else {
      setState('failed')
      setError(words[outcome.message as keyof typeof words] ?? words.errGeneric)
    }
  }

  const stateLabel =
    running
      ? words.runningState
      : state === 'done'
        ? words.done
        : state === 'fresh'
          ? words.upToDate
          : state === 'failed'
            ? words.couldntRun
            : words.ready
  const stateTone = running
    ? 'running'
    : state === 'failed'
      ? 'failed'
      : 'neutral'

  return (
    <CardShell
      id={id}
      kind="askAi"
      selected={!!selected}
      data={data}
      headActions={
        <>
          <Tooltip content={words.addMod}>
            <button
              className={`add-mod-btn ${dragBlock}`}
              aria-label={words.addMod}
              onClick={(e) => {
                e.stopPropagation()
                addMod(id)
              }}
            >
              <span aria-hidden="true">+</span>
            </button>
          </Tooltip>
        </>
      }
    >
      <div
        className={editing ? 'card-body editing' : 'card-body'}
        ref={bodyWheelGate}
        onScroll={rememberScrollPosition}
      >
        <div className="card-kind card-eyebrow t-micro">
          {words.askAiHeading}
        </div>
        {editing ? (
          <MarkdownCardEditor
            ariaLabel={words.askAiHeading}
            placeholder={words.askAiPlaceholder}
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
            placeholder={words.askAiPlaceholder}
            ariaLabel={words.askAiHeading}
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
      </div>
      {/* The prompt body is the sole fixed-height scroller. Keep the picker and
          run callouts in one opaque dock immediately above the action foot so
          they stay pinned while the prompt reaches its final line. */}
      <div className="card-run-dock">
        <div className={`model-pick ${dragBlock}`}>
          <span className="model-pick-label t-micro">{words.modelLabel}</span>
          <Picker
            ariaLabel={words.modelLabel}
            emptyLabel={words.none}
            className={dragBlock}
            variant="compact"
            value={currentModel}
            options={[
              ...modelChoices.map((slug) => ({ value: slug, label: modelLabel(slug) })),
              ...(isCustom ? [{ value: currentModel, label: modelLabel(currentModel) }] : []),
            ]}
            onValueChange={(model) => setCardModel(id, model)}
            disabled={profileReview}
          />
        </div>
        {error && <Callout tone="avoid" className="card-run-callout">{error}</Callout>}
        {/* The research question, holding the press it interrupted. Every first
            Run press on a research-armed Card raises it, because every run
            spends the same money as the first (#971). It states its one fact and
            carries the four depth keys, the sanctioned exception to callouts
            carrying no controls (SYSTEM.md 6.7a). The keys only set the dial;
            the question names the key that spends, which is Run itself, so a
            person can change their mind between choosing and paying. Cycling the
            globe off research stands the question down and starts nothing. */}
        {researchAsking && (
          <Callout tone="attention" className="card-run-callout web-reach-note reach-note">
            <span className="web-reach-note-words reach-note-words">{words.reachResearchNote}</span>
            {/* A segmented control, not four loose keys: this is one choice with
                four answers, which is exactly what the control means, and its
                chosen cell is a solid ink pill. The keys wore an attention tint
                before and the tint was not saying "this one" loudly enough
                against a callout already tinted attention (founder report
                2026-08-18). Solid ink is the state grammar's own selected
                treatment and the same one Settings uses for reasoning, so a
                person meets it twice and learns it once. */}
            <span className="web-reach-depths reach-depths">
              <Segmented
                ariaLabel={words.researchDepthChoiceLabel}
                className={`web-reach-depth-pick reach-depth-pick ${dragBlock}`}
                value={researchDepth}
                options={RESEARCH_DEPTHS}
                onValueChange={onResearchDepth}
              />
              <span className="web-reach-depth-cost reach-depth-cost t-micro">
                {RESEARCH_DEPTHS.find(({ value }) => value === researchDepth)?.cost}
              </span>
            </span>
          </Callout>
        )}
      </div>
      <div className="card-foot">
        {/* Run stays Run while the research question is open, because that is
            the key the question asks for: pick a depth, then press it again.
            Standing the question down is the globe's job, one key over, since
            what the question is about is the mode the Card is in. */}
        <Button
          variant={running ? 'quiet' : 'primary'}
          size="compact"
          className={dragBlock}
          onClick={onRun}
        >
          {running ? words.cancel : words.run}
        </Button>
        {/* Resume stands beside Run only while a paid research job has no run
            listening to it: after a cancel, a crash, or a quit mid-poll. It
            re-attaches by polling the standing job, never submitting, and it
            leaves the moment a run consumes the job's terminal state. */}
        {canResume && (
          <Tooltip content={words.researchResumeHint}>
            <Button
              size="compact"
              className={dragBlock}
              onClick={() => void onResume()}
            >
              {words.researchResume}
            </Button>
          </Tooltip>
        )}
        {/* The globe stands beside Run because it changes what a press of Run
            will do. One control, cycling Off, Web, Research, Off: the depth
            menu it replaces asked the user a question about machinery, and
            the model now answers that per call (founder decision 2026-08-18).
            The one question the user genuinely owns is how much of the web a
            run may touch, and a cycle keeps that question one key wide.

            Off and Web are the same weight of decision, so they share the
            quiet-key and go-tint grammar every toggle already speaks. Research
            is not: it arms a job that runs for minutes and cannot be called
            back, so the globe steps out of the go family into attention, the
            hue this system reserves for "needs your eye", and the words for
            what that means arrive when they matter, on the first Run press
            (see onRun). With no Linkup key there is nothing for Research to
            run, so the cycle is Off, Web, Off and the third state never
            pretends.

            On a local harness there is nothing to cycle: the harness brings
            its own tools and Eido asserts nothing over the bridge. The chip
            stays selected, and says so, because the CLI owns the run's tool
            loop.

            Three words for three states, and no more. An armed globe names its
            mode; an off globe names the press, because a control doing nothing
            has no state worth naming. The tooltip and the label are the same
            words on purpose: what a pointer is told and what a screen reader is
            told should not be two different claims about one button. */}
        {providerOwnsTools ? (
          <Chip
            tone="go"
            className={`agent-chip ${dragBlock}`}
            ariaLabel={words.agentHarness}
            tooltip={words.agentHarnessHint}
          >
            <SquareTerminal size={14} aria-hidden="true" />
          </Chip>
        ) : (
          <IconButton
            label={reachWord}
            tooltip={reachWord}
            icon={<Globe aria-hidden="true" />}
            size="compact"
            pressed={reach !== 'off'}
            className={[
              'web-reach-toggle',
              'reach-toggle',
              'e-icon-button--go-selected',
              reach === 'research' && 'web-reach-toggle--research',
              reach === 'research' && 'reach-toggle--research',
              dragBlock,
            ].filter(Boolean).join(' ')}
            onClick={(e) => {
              e.stopPropagation()
              // Cycling the globe stands the open research question down:
              // the question was about the mode the Card is leaving.
              setResearchNotice(false)
              const next =
                reach === 'off'
                  ? 'web'
                  : reach === 'web' && linkupKeyPresent
                    ? 'research'
                    : 'off'
              setCardReach(id, next)
            }}
          />
        )}
        <IconButton
          label={words.showWhatAiUsed}
          icon={<Eye aria-hidden="true" />}
          size="compact"
          className={dragBlock}
          onClick={() => setPeekOpen(true)}
        />
        <IconButton
          label={words.whatWillRun}
          icon={<Route aria-hidden="true" />}
          size="compact"
          className={dragBlock}
          onClick={() => setPreviewMode('peek')}
        />
        <StateWord tone={stateTone} className="ask-ai-state-word">
          <span className="ask-ai-state-word__label">{stateLabel}</span>
        </StateWord>
      </div>
      {peekOpen && <AskContextPeek askAiCardId={id} onClose={() => setPeekOpen(false)} />}
      {previewMode && (
        <ChainPreview
          targetAskAiCardId={id}
          mode={previewMode}
          onRun={(everything) => void startChain(everything)}
          onClose={() => setPreviewMode(null)}
        />
      )}
    </CardShell>
  )
}

function AskContextPeek({ askAiCardId, onClose }: { askAiCardId: string; onClose: () => void }) {
  const settings = useGraph((state) => state.settings)
  const onReorder = useGraph((state) => state.reorderContextItems)
  const board = useBoardSnapshot()
  const compiled = useMemo(() => {
    const card = board.cards.find((candidate) => candidate.id === askAiCardId)
    const model = resolveProfileReviewModel(card?.model || settings.model)
    return gatherConnectedThoughtWithCachedSummaries(board, askAiCardId, {
      budgetTokens: budgetFor(model, settings.provider ?? 'openrouter'),
      mode: settings.compactionMode ?? DEFAULT_COMPACTION_MODE,
    })
  }, [askAiCardId, board, settings.compactionMode, settings.model, settings.provider])

  return <ContextPeek compiled={compiled} onReorder={onReorder} onClose={onClose} />
}
