import { useMemo, useRef, useState, type ReactNode } from 'react'
import { chainRunPreview, extraRunCount, type ChainStepStatus } from '../brain/chainStaleness'
import { gatherConnectedThought } from '../brain/compiler'
import { budgetFor } from '../brain/modelWindows'
import { cardById, cardLabel } from '../graph/graphHelpers'
import { useGraph } from '../graph/store'
import { DEFAULT_COMPACTION_MODE } from '../graph/types'
import { resolveProfileReviewModel } from '../shared/profileReviewPolicy'
import { words } from '../shared/words'
import { Badge, Button, Chip, ContextRow } from '../ui/primitives'
import { ModalShell } from '../ui/overlays'
import { useBoardSnapshot } from './graphSelectors'

type ChainPreviewProps = {
  targetAskAiCardId: string
  mode: 'gate' | 'peek'
  onRun: (everything: boolean) => void
  onClose: () => void
}

const REASON_WORDS: Record<ChainStepStatus['reason'], string> = {
  'source-changed': words.chainTagSourceChanged,
  'never-ran': words.chainTagNeverRan,
  'upstream-ran': words.chainTagUpstream,
  fresh: words.upToDate,
}

// A read-only plan projection. Opening this surface never runs or spends.
export function ChainPreview({ targetAskAiCardId, mode: _mode, onRun, onClose }: ChainPreviewProps) {
  const [open, setOpen] = useState(true)
  const pendingRunRef = useRef<boolean | null>(null)
  const board = useBoardSnapshot()
  const statuses = useMemo(
    () => chainRunPreview(board, targetAskAiCardId),
    [board, targetAskAiCardId],
  )
  const settings = useGraph((state) => state.settings)
  const budgetTouched = useMemo(() => {
    const targetCard = board.cards.find((card) => card.id === targetAskAiCardId)
    if (!targetCard) return false
    const model = resolveProfileReviewModel(targetCard.model || settings.model)
    const compiled = gatherConnectedThought(board, targetAskAiCardId, {
      budgetTokens: budgetFor(model, settings.provider ?? 'openrouter'),
      mode: settings.compactionMode ?? DEFAULT_COMPACTION_MODE,
      summaries: new Map(),
    })
    return Boolean(
      compiled.budget
      && (compiled.budget.compactedCardIds.length > 0 || compiled.budget.droppedCardIds.length > 0),
    )
  }, [board, settings.compactionMode, settings.model, settings.provider, targetAskAiCardId])

  const willRun = statuses.filter((status) => status.willRun)
  const extra = extraRunCount(statuses, targetAskAiCardId)
  const allFresh = willRun.length === 0
  const runLabel = willRun.length <= 1
    ? words.chainRunOne
    : `${words.chainRunMany} ${willRun.length} ${words.chainCardsWord}`

  const requestRun = (everything: boolean) => {
    pendingRunRef.current = everything
    setOpen(false)
  }

  return (
    <ModalShell
      open={open}
      title={words.whatWillRun}
      titleMeta={<Badge>{statuses.length}</Badge>}
      className="context-surface chain-context-surface"
      dismissOnBackdrop
      onDismiss={() => setOpen(false)}
      onExitComplete={() => {
        const pendingRun = pendingRunRef.current
        if (pendingRun === null) onClose()
        else onRun(pendingRun)
      }}
      footer={
        <>
          <Button variant="ghost" onClick={() => requestRun(true)}>
            {words.chainRunEverything}
          </Button>
          <Button onClick={() => setOpen(false)}>{words.cancel}</Button>
          {!allFresh && (
            <Button variant="primary" onClick={() => requestRun(false)}>
              {_mode === 'gate' && extra > 0 ? runLabel : words.run}
            </Button>
          )}
        </>
      }
    >
      <div className="context-surface__rows chain-context-surface__rows">
        {statuses.map((status) => {
          const card = cardById(board, status.step.cardId)
          const isTarget = status.step.cardId === targetAskAiCardId
          const runIndex = status.willRun ? willRun.indexOf(status) + 1 : undefined
          return (
            <ContextRow
              key={status.step.id}
              rank={runIndex ?? '–'}
              title={card ? cardLabel(card) : status.step.cardId}
              status={chainStatus(status, isTarget, budgetTouched && isTarget)}
              dimmed={!status.willRun}
              meta={status.reason === 'fresh' ? undefined : REASON_WORDS[status.reason]}
            />
          )
        })}
      </div>
    </ModalShell>
  )
}

function chainStatus(status: ChainStepStatus, isTarget: boolean, budgetTouched: boolean): ReactNode {
  return (
    <>
      {status.reason === 'source-changed' && (
        <Chip
          tone="attention"
          tooltip={words.chainTagSourceChanged}
          ariaLabel={words.chainTagSourceChanged}
        >
          !
        </Chip>
      )}
      {status.reason === 'never-ran' && <Chip tone="scope">{words.chainTagNew}</Chip>}
      {status.reason === 'upstream-ran' && <Chip tone="scope">{words.chainTagUpstreamChip}</Chip>}
      {status.reason === 'fresh' && <Chip tone="scope">{words.chainTagReused}</Chip>}
      {budgetTouched && <Chip tone="attention">{words.peekStatusCompacted}</Chip>}
      {isTarget && <Chip tone="scope">{words.chainThisCard}</Chip>}
    </>
  )
}
