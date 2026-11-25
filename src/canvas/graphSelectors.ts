// Narrow, index-backed selectors for canvas cards (#91/#108). Card components
// previously subscribed to whole Board arrays (cards, connections, outputs,
// runs) and scanned them locally — so every commit anywhere re-rendered every
// mounted card. These hooks subscribe to exactly the answer a card needs,
// resolved through the store's graph index (O(1)), and re-render only when
// that answer's identity changes. The store mutates immutably per item, so
// untouched entities keep their identity across commits.

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { sourceChangeStatus, type SourceChangeStatus } from '../brain/sourceContext'
import type { BoardChange } from '../graph/boardChange'
import type { BoardGraphIndex } from '../graph/graphIndex'
import { useGraph } from '../graph/store'
import type { Card, FollowUpMessage, Output, OutputVersion, RunRecord, SavedBoard } from '../graph/types'

export function useCard(cardId: string): Card | undefined {
  return useGraph((s) => s.graph().cardById(cardId))
}

export function useOutputForResultCard(resultCardId: string) {
  return useGraph((s) => s.graph().outputForResultCard(resultCardId))
}

export function useRunForVersion(versionId: string | undefined): RunRecord | undefined {
  return useGraph((s) => (versionId ? s.graph().runForVersion(versionId) : undefined))
}

export function useRunById(runId: string | undefined): RunRecord | undefined {
  return useGraph((s) => (runId ? s.graph().runById(runId) : undefined))
}

// The Ask AI card that produces this result card, if any (first incoming ask).
export function useProducingAskId(resultCardId: string): string | undefined {
  return useGraph((s) => {
    const graph = s.graph()
    for (const connection of graph.incomingConnections(resultCardId)) {
      if (graph.cardById(connection.from.cardId)?.kind === 'askAi') return connection.from.cardId
    }
    return undefined
  })
}

export function useIsAskRunning(askAiCardId: string | undefined): boolean {
  return useGraph((s) => {
    if (!askAiCardId) return false
    return s
      .graph()
      .runsForCard(askAiCardId)
      .some((run) => (run.kind ?? 'ask') === 'ask' && run.status === 'running')
  })
}

// True when this result card renders a conversation transcript.
export function useIsConversationResult(resultCardId: string): boolean {
  return useGraph((s) => {
    const graph = s.graph()
    for (const connection of graph.incomingConnections(resultCardId)) {
      if (graph.cardById(connection.from.cardId)?.kind === 'conversation') return true
    }
    const output = graph.outputForResultCard(resultCardId)
    return Boolean(output?.versions.some((version) => version.transcript))
  })
}

export function useGroupMembers(groupId: string): readonly Card[] {
  // membersOf returns a cached array per index build; useShallow keeps the
  // component quiet when a rebuild produces an equal member list.
  return useGraph(useShallow((s) => s.graph().membersOf(groupId)))
}

function boardOf(state: {
  cards: Card[]
  connections: SavedBoard['connections']
  outputs: SavedBoard['outputs']
  runs: RunRecord[]
  compactionSummaries?: SavedBoard['compactionSummaries']
}): SavedBoard {
  return {
    version: 1,
    cards: state.cards,
    connections: state.connections,
    outputs: state.outputs,
    runs: state.runs,
    compactionSummaries: state.compactionSummaries,
    updatedAt: '',
  }
}

let sourceChangeStatusDerivationCount = 0
let sourceFollowUpProjectionVisitCount = 0
let sourceFollowUpProjectionBuildCount = 0
let sourceGroupMemberProjectionVisitCount = 0

function deriveSourceChangeStatus(
  board: SavedBoard,
  version: OutputVersion,
): SourceChangeStatus | null {
  sourceChangeStatusDerivationCount += 1
  return sourceChangeStatus(board, version)
}

export function sourceChangeStatusDerivationCountForTests(): number {
  return sourceChangeStatusDerivationCount
}

export function resetSourceChangeStatusDerivationCountForTests(): void {
  sourceChangeStatusDerivationCount = 0
  sourceFollowUpProjectionVisitCount = 0
  sourceFollowUpProjectionBuildCount = 0
  sourceGroupMemberProjectionVisitCount = 0
}

export function sourceFollowUpProjectionVisitCountForTests(): number {
  return sourceFollowUpProjectionVisitCount
}

export function sourceFollowUpProjectionBuildCountForTests(): number {
  return sourceFollowUpProjectionBuildCount
}

export function sourceGroupMemberProjectionVisitCountForTests(): number {
  return sourceGroupMemberProjectionVisitCount
}

// Alias with the shorter name used by a few focused callers. Both counters
// remain numeric and content-free: they report work, never source values.
export function sourceGroupProjectionVisitCountForTests(): number {
  return sourceGroupMemberProjectionVisitCount
}

const settledFollowUpSourceCache = new WeakMap<FollowUpMessage, boolean>()

type SettledFollowUpSemanticCacheEntry = {
  messages: readonly FollowUpMessage[]
  lastMessage: FollowUpMessage | undefined
  fields: readonly unknown[]
}

type SourceSemanticProjectionCache = {
  cards: readonly Card[] | undefined
  outputs: readonly Output[] | undefined
  changeSeq: number | undefined
  sourceContext: OutputVersion['sourceContext'] | undefined
  dismissedSignature: OutputVersion['sourceChangeDismissedSignature'] | undefined
  projection: readonly unknown[] | undefined
  dependencyCardIds: Set<string>
  dependencyOutputIds: Set<string>
  outputResultCardIds: Map<string, string>
  chosenResultSemanticsByCardId: Map<string, ChosenResultSemanticCacheEntry>
  settledFollowUpsByCardId: Map<string, SettledFollowUpSemanticCacheEntry>
  activeResultCardIds: Set<string>
}

type ChosenResultSemanticCacheEntry = {
  outputId: string | undefined
  resultCardId: string
  versionId: string
  text: string
  digestKey: string | undefined
  transcript: OutputVersion['transcript']
  followUpFields: readonly unknown[]
}

const EMPTY_FOLLOW_UP_MESSAGES: readonly FollowUpMessage[] = []

function createSourceSemanticProjectionCache(): SourceSemanticProjectionCache {
  return {
    cards: undefined,
    outputs: undefined,
    changeSeq: undefined,
    sourceContext: undefined,
    dismissedSignature: undefined,
    projection: undefined,
    dependencyCardIds: new Set(),
    dependencyOutputIds: new Set(),
    outputResultCardIds: new Map(),
    chosenResultSemanticsByCardId: new Map(),
    settledFollowUpsByCardId: new Map(),
    activeResultCardIds: new Set(),
  }
}

function shallowProjectionEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

function isSettledFollowUpSource(message: FollowUpMessage): boolean {
  const cached = settledFollowUpSourceCache.get(message)
  if (cached !== undefined) return cached
  // Match settledFollowUpMessages without rescanning an unchanged large string
  // on every unrelated store commit. Streaming and failed messages are known
  // to be excluded before touching their growing text.
  const settled =
    message.status !== 'streaming' &&
    message.status !== 'failed' &&
    Boolean(message.text.trim())
  settledFollowUpSourceCache.set(message, settled)
  return settled
}

function settledFollowUpSemantics(
  cache: SourceSemanticProjectionCache,
  resultCardId: string,
  messages: readonly FollowUpMessage[],
): readonly unknown[] {
  cache.activeResultCardIds.add(resultCardId)
  const cached = cache.settledFollowUpsByCardId.get(resultCardId)
  // Position-only commits and streamed answer text preserve the immutable
  // discussion array. This exact identity path keeps all of its rows out of
  // every drag frame and out of unrelated writes to the chosen version.
  if (cached?.messages === messages) return cached.fields

  const lastMessage = messages[messages.length - 1]
  // Follow-up chunks update the final streaming row in place through a new
  // immutable array. The settled prefix is unchanged, and both old and new
  // rows are excluded from downstream context, so this is a genuine O(1)
  // semantic no-op even when the prefix has tens of thousands of messages.
  if (
    cached &&
    cached.messages.length === messages.length &&
    cached.lastMessage?.id === lastMessage?.id &&
    cached.lastMessage !== lastMessage &&
    !isSettledFollowUpSource(cached.lastMessage) &&
    !isSettledFollowUpSource(lastMessage)
  ) {
    cache.settledFollowUpsByCardId.set(resultCardId, {
      messages,
      lastMessage,
      fields: cached.fields,
    })
    return cached.fields
  }

  sourceFollowUpProjectionBuildCount += 1
  const fields: unknown[] = []

  // Only settled messages flow downstream. Flatten their exact hashed fields
  // so collapsing a thread, tool-step writes, and streaming chunks keep the
  // shallow projection equal.
  for (const message of messages) {
    sourceFollowUpProjectionVisitCount += 1
    if (!isSettledFollowUpSource(message)) continue
    fields.push(message.role, message.text)
  }

  // An excluded streaming/failed/blank update creates a new version object
  // but can leave downstream source semantics unchanged. Canonicalize the
  // equal projection so the outer shallow selector still suppresses hashing.
  const canonical = cached && shallowProjectionEqual(cached.fields, fields)
    ? cached.fields
    : fields
  cache.settledFollowUpsByCardId.set(resultCardId, { messages, lastMessage, fields: canonical })
  return canonical
}

function appendChosenResultSemantics(
  projection: unknown[],
  cache: SourceSemanticProjectionCache,
  graph: BoardGraphIndex,
  resultCardId: string,
): void {
  cache.dependencyCardIds.add(resultCardId)
  const output = graph.outputForResultCard(resultCardId)
  if (output) {
    cache.dependencyOutputIds.add(output.id)
    cache.outputResultCardIds.set(output.id, resultCardId)
  }
  const chosen = graph.chosenVersionForResultCard(resultCardId)
  if (!chosen) {
    cache.settledFollowUpsByCardId.delete(resultCardId)
    cache.chosenResultSemanticsByCardId.delete(resultCardId)
    projection.push('chosen-result:missing')
    return
  }

  const followUpFields = settledFollowUpSemantics(
    cache,
    resultCardId,
    chosen.followUpThread?.messages ?? EMPTY_FOLLOW_UP_MESSAGES,
  )
  cache.chosenResultSemanticsByCardId.set(resultCardId, {
    outputId: output?.id,
    resultCardId,
    versionId: chosen.id,
    text: chosen.text,
    digestKey: chosen.digestKey,
    transcript: chosen.transcript,
    followUpFields,
  })

  projection.push(
    'chosen-result',
    chosen.id,
    chosen.text,
    chosen.digestKey,
    chosen.transcript,
    'chosen-result-follow-ups',
    followUpFields,
  )
}

function appendSourceSemantics(
  projection: unknown[],
  cache: SourceSemanticProjectionCache,
  graph: BoardGraphIndex,
  card: Card,
  groupMode?: NonNullable<
    OutputVersion['sourceContext']
  >['sources'][number]['groupMode'],
): void {
  // These are the refs/primitives read by sourcePayload() plus the title that
  // labels an already-changed source in badge details. Position, size, layer,
  // and header treatment deliberately stay out.
  cache.dependencyCardIds.add(card.id)
  projection.push('card', card.id, card.kind, card.title, card.blocks, card.assets)

  if (card.kind === 'mod') {
    projection.push(
      'mod',
      card.modV2?.kind,
      card.modV2?.title,
      card.modV2?.state,
      card.modV2?.treatOverride,
    )
  }

  if (card.kind === 'conversation') {
    projection.push(
      'conversation',
      card.conversationStyle,
      card.conversationTurns,
    )
  }

  if (card.kind === 'result') {
    appendChosenResultSemantics(projection, cache, graph, card.id)
  }

  if (card.kind === 'group') {
    const resolvedMode = groupMode ?? 'digest'
    const members = graph.membersOf(card.id)
    projection.push(
      'group',
      resolvedMode,
      resolvedMode === 'full' ? undefined : card.compressionPrompt,
      members.length,
    )
    for (const member of members) {
      sourceGroupMemberProjectionVisitCount += 1
      // Group fingerprints recursively include each member payload, including
      // a Result member's chosen output, in saved-board order.
      projection.push('group-member', member.id)
      appendSourceSemantics(projection, cache, graph, member)
    }
    if (resolvedMode === 'compress') {
      appendChosenResultSemantics(projection, cache, graph, card.id)
    }
  }
}

function sourceSemanticProjection(
  state: Pick<ReturnType<typeof useGraph.getState>, 'cards' | 'outputs' | 'graph' | 'lastBoardChange' | 'boardChangeSeq'>,
  sourceContext: OutputVersion['sourceContext'],
  dismissedSignature: OutputVersion['sourceChangeDismissedSignature'],
  cache: SourceSemanticProjectionCache,
): readonly unknown[] {
  const sources = sourceContext?.sources
  if (!sources?.length) return EMPTY_SOURCE_SEMANTICS

  const sameSemanticContext =
    cache.sourceContext === sourceContext &&
    cache.dismissedSignature === dismissedSignature
  if (sameSemanticContext && cache.projection) {
    if (cache.cards === state.cards && cache.outputs === state.outputs) {
      return cache.projection
    }

    const change = state.lastBoardChange
    if (
      change &&
      cache.changeSeq !== undefined &&
      change.seq === cache.changeSeq + 1 &&
      sourceChangeDoesNotAffectProjection(change.change, cache, state.outputs)
    ) {
      // Advance the observed graph references and sequence without rebuilding
      // source rows. This is the geometry/write fast path: no body reads, no
      // Group member walk, and no Follow-up row visit.
      cache.cards = state.cards
      cache.outputs = state.outputs
      cache.changeSeq = change.seq
      return cache.projection
    }
  }

  const graph = state.graph()
  cache.activeResultCardIds.clear()
  cache.dependencyCardIds.clear()
  cache.dependencyOutputIds.clear()
  cache.outputResultCardIds.clear()
  cache.chosenResultSemanticsByCardId.clear()
  const projection: unknown[] = [
    'source-context',
    dismissedSignature,
    sources.length,
  ]
  for (const source of sources) {
    projection.push('source', source.cardId, source.groupMode)
    const card = graph.cardById(source.cardId)
    if (!card) {
      projection.push('source:deleted')
      continue
    }
    appendSourceSemantics(projection, cache, graph, card, source.groupMode)
  }
  // A sourced Group can gain and lose Result members for the whole lifetime
  // of one downstream version. Retain only entries reached by this projection
  // so the interaction cache stays bounded to currently relevant Cards.
  for (const resultCardId of cache.settledFollowUpsByCardId.keys()) {
    if (!cache.activeResultCardIds.has(resultCardId)) {
      cache.settledFollowUpsByCardId.delete(resultCardId)
    }
  }
  cache.cards = state.cards
  cache.outputs = state.outputs
  cache.changeSeq = state.lastBoardChange?.seq ?? state.boardChangeSeq
  cache.sourceContext = sourceContext
  cache.dismissedSignature = dismissedSignature
  cache.projection = projection
  return projection
}

const EMPTY_SOURCE_SEMANTICS: readonly unknown[] = []
const STRUCTURAL_SOURCE_NEUTRAL_ASPECTS = new Set(['position', 'size', 'layer'])

function sourceChangeDoesNotAffectProjection(
  change: BoardChange,
  cache: SourceSemanticProjectionCache,
  outputs: readonly Output[],
): boolean {
  const cardChange = change.cards
  if (cardChange) {
    if (cardChange.added?.length || cardChange.removed?.length) return false
    const updated = cardChange.updated ?? []
    if (updated.length) {
      // Group membership changes can add a previously unseen member to a
      // sourced Group, so they need a projection rebuild even when that new
      // member is not in the prior dependency set.
      if (change.cardAspects?.includes('grouping')) return false
      if (!change.cardAspects?.length) return false
      if (!change.cardAspects.every((aspect) => STRUCTURAL_SOURCE_NEUTRAL_ASPECTS.has(aspect))) {
        if (updated.some((id) => cache.dependencyCardIds.has(id))) return false
        // Content changes to unrelated Cards do not alter a frozen source
        // projection. This is still O(updated IDs), never O(board contents).
      }
    }
  }

  const outputChange = change.outputs
  if (outputChange) {
    if (outputChange.added?.length || outputChange.removed?.length) return false
    for (const outputId of outputChange.updated ?? []) {
      if (!cache.dependencyOutputIds.has(outputId)) continue
      const resultCardId = cache.outputResultCardIds.get(outputId)
      const previous = resultCardId
        ? cache.chosenResultSemanticsByCardId.get(resultCardId)
        : undefined
      const output = outputs.find((candidate) => candidate.id === outputId)
      if (!resultCardId || !previous || !output || output.resultCardId !== resultCardId) return false
      const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
      const chosen = output.versions.find((version) => version.id === chosenId)
      if (!chosen || chosen.id !== previous.versionId) return false
      const followUpFields = settledFollowUpSemantics(
        cache,
        resultCardId,
        chosen.followUpThread?.messages ?? EMPTY_FOLLOW_UP_MESSAGES,
      )
      if (
        chosen.text !== previous.text ||
        chosen.digestKey !== previous.digestKey ||
        chosen.transcript !== previous.transcript ||
        followUpFields !== previous.followUpFields
      ) return false
      cache.chosenResultSemanticsByCardId.set(resultCardId, {
        ...previous,
        outputId,
        followUpFields,
      })
    }
  }
  return true
}

// Source-changed badge state without a broad/content-proportional
// subscription. Store commits first pass through a shallow projection of the
// exact semantic refs and primitives used by sourcePayload(). Geometry-only
// commits therefore keep the projection identity and never invoke hashing.
export function useSourceChangeStatus(
  version: OutputVersion | undefined,
): SourceChangeStatus | null {
  const sourceContext = version?.sourceContext
  const dismissedSignature = version?.sourceChangeDismissedSignature
  // One small cache belongs to one mounted badge and one frozen source
  // context. It dies on unmount/context replacement instead of retaining
  // discussions from every Result ever visited on this Board.
  const projectionCache = useMemo(
    () => createSourceSemanticProjectionCache(),
    [sourceContext],
  )
  // sourceChangeStatus reads only these two fields. Keeping a semantic-only
  // version prevents streamed answer text and other Output presentation writes
  // from invalidating the expensive derivation.
  const semanticVersion = useMemo(() => {
    if (!sourceContext) return undefined
    return {
      sourceContext,
      sourceChangeDismissedSignature: dismissedSignature,
    } as OutputVersion
  }, [dismissedSignature, sourceContext])
  const sourceSemantics = useGraph(
    useShallow((state) =>
      sourceSemanticProjection(state, sourceContext, dismissedSignature, projectionCache),
    ),
  )
  return useMemo(() => {
    if (!semanticVersion?.sourceContext?.sources.length) return null
    return deriveSourceChangeStatus(
      boardOf(useGraph.getState()),
      semanticVersion,
    )
  }, [semanticVersion, sourceSemantics])
}

// One-off board view for handlers that need a SavedBoard without subscribing.
export function boardSnapshotNow(): SavedBoard {
  return boardOf(useGraph.getState())
}

// Reactive board view for components that need to re-render when the board changes.
export function useBoardSnapshot(): SavedBoard {
  return useGraph(useShallow(boardOf))
}
