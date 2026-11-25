import {
  type Card,
  type Connection,
  type IntentLogEvent,
  type Output,
  type SavedBoard,
} from './types'

export type TimelineProjection = {
  cards: Card[]
  connections: Connection[]
  ghostCardIds: Set<string>
  ghostConnectionIds: Set<string>
  eventIndex: number
  eventCount: number
  at: string
}

export type TimelineRange = {
  startAt: string
  endAt: string
  startMs: number
  endMs: number
}

type TimelineBoard = Pick<SavedBoard, 'cards' | 'connections' | 'intentLog'> & {
  outputs?: Output[]
}

// What the projector can't reconstruct, it borrows from the present:
// content edits only log text lengths, so replayed cards would come back with
// their creation-time (usually empty) words; result cards keep their words in
// output versions, never in blocks. Both are filled in at projection time.
type TimelineContentSources = {
  liveCardById: Map<string, Card>
  outputByCardId: Map<string, Output>
  versionChoicesByOutputId: Map<string, TimelineVersionChoice[]>
  versionEventIndexById: Map<string, number>
}

type TimelineVersionChoice = {
  atMs: number
  eventIndex: number
  versionId: string
}

type TimelineProjectionState = {
  cards: Map<string, Card>
  connections: Map<string, Connection>
  ghostCards: Map<string, GhostCard>
  ghostConnections: Map<string, GhostConnection>
}

type TimelineCheckpoint = TimelineProjectionState & {
  eventIndex: number
}

export type TimelineProjector = {
  range: TimelineRange | null
  projectAt: (at: string | number | Date) => TimelineProjection
  projectThrough: (eventIndex: number) => TimelineProjection
}

const TIMELINE_CHECKPOINT_INTERVAL = 500

type GhostCard = {
  card: Card
  deletedAt: string
}

type GhostConnection = {
  connection: Connection
  deletedAt: string
}

export function normalizeCardForTimeline(card: Card): Card {
  // Historical Intent Log payloads are digest-bound evidence; current Mod
  // snapshots already carry canonical `modV2`.
  return card
}

export function sortedTimelineEvents(events: IntentLogEvent[] = []): IntentLogEvent[] {
  return events
    .map((event, index) => ({ event, index, ms: Date.parse(event.at) }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((a, b) => a.ms - b.ms || a.index - b.index)
    .map((item) => item.event)
}

export function timelineRange(events: IntentLogEvent[] = []): TimelineRange | null {
  const sorted = sortedTimelineEvents(events)
  return rangeFromSortedEvents(sorted)
}

export function createTimelineProjector(board: TimelineBoard): TimelineProjector {
  const events = sortedTimelineEvents(board.intentLog)
  const eventTimes = events.map((event) => Date.parse(event.at))
  const sources = contentSourcesFromBoard(board, events)
  const checkpoints = buildTimelineCheckpoints(board, events, sources)

  return {
    range: rangeFromSortedEvents(events),
    projectAt: (at) => projectBoardAtFromCheckpoints(events, eventTimes, checkpoints, sources, at),
    // Playback may address one ordered event at a time even when several
    // events share a timestamp. This is an in-memory projection only.
    projectThrough: (eventIndex) => projectBoardThroughEventIndex(events, eventTimes, checkpoints, sources, eventIndex),
  }
}

function contentSourcesFromBoard(board: TimelineBoard, events: IntentLogEvent[] = []): TimelineContentSources {
  const outputByCardId = new Map<string, Output>()
  const versionChoicesByOutputId = new Map<string, TimelineVersionChoice[]>()
  const versionEventIndexById = new Map<string, number>()
  for (const [index, event] of events.entries()) {
    const eventIndex = index + 1
    if (event.type === 'card.deleted') {
      for (const output of event.data.outputs ?? []) outputByCardId.set(output.resultCardId, output)
    }
    if (
      (event.type === 'run.started' || event.type === 'run.continued' || event.type === 'run.completed') &&
      event.data.run.producedVersionId &&
      !versionEventIndexById.has(event.data.run.producedVersionId)
    ) {
      versionEventIndexById.set(event.data.run.producedVersionId, eventIndex)
    }
    if (
      (event.type === 'group.compression.started' ||
        event.type === 'group.compression.completed' ||
        event.type === 'group.compression.failed' ||
        event.type === 'group.compression.canceled') &&
      event.versionId &&
      !versionEventIndexById.has(event.versionId)
    ) {
      versionEventIndexById.set(event.versionId, eventIndex)
    }
    if (event.type === 'version.chosen') {
      const ms = Date.parse(event.at)
      if (!Number.isFinite(ms)) continue
      const choices = versionChoicesByOutputId.get(event.data.outputId) ?? []
      choices.push({ atMs: ms, eventIndex, versionId: event.data.nextVersionId })
      versionChoicesByOutputId.set(event.data.outputId, choices)
    }
  }
  for (const output of board.outputs ?? []) outputByCardId.set(output.resultCardId, output)

  return {
    liveCardById: new Map(board.cards.map((card) => [card.id, card])),
    outputByCardId,
    versionChoicesByOutputId,
    versionEventIndexById,
  }
}

function rangeFromSortedEvents(events: IntentLogEvent[]): TimelineRange | null {
  const sorted = events
  if (sorted.length === 0) return null
  const startMs = Date.parse(sorted[0].at)
  const endMs = Date.parse(sorted[sorted.length - 1].at)
  return {
    startAt: sorted[0].at,
    endAt: sorted[sorted.length - 1].at,
    startMs,
    endMs,
  }
}

export function projectBoardAt(board: TimelineBoard, at: string | number | Date): TimelineProjection {
  const events = sortedTimelineEvents(board.intentLog)
  return projectBoardAtSortedEvents(board, events, at)
}

function projectBoardAtSortedEvents(
  board: TimelineBoard,
  events: IntentLogEvent[],
  at: string | number | Date,
): TimelineProjection {
  const targetMs = coerceTime(at)
  const sources = contentSourcesFromBoard(board, events)
  const state = rewindBoardToTimelineStart(board, events)

  let eventIndex = 0
  for (const event of events) {
    if (Date.parse(event.at) > targetMs) break
    eventIndex += 1
    applyEvent(event, state.cards, state.connections, state.ghostCards, state.ghostConnections, sources)
  }

  return projectionFromState(state, eventIndex, events.length, targetMs, sources)
}

function buildTimelineCheckpoints(
  board: TimelineBoard,
  events: IntentLogEvent[],
  sources: TimelineContentSources,
): TimelineCheckpoint[] {
  const state = rewindBoardToTimelineStart(board, events)
  const checkpoints: TimelineCheckpoint[] = [checkpointFromState(0, state)]

  for (let index = 0; index < events.length; index += 1) {
    applyEvent(events[index], state.cards, state.connections, state.ghostCards, state.ghostConnections, sources)
    const eventIndex = index + 1
    if (eventIndex % TIMELINE_CHECKPOINT_INTERVAL === 0 || eventIndex === events.length) {
      checkpoints.push(checkpointFromState(eventIndex, state))
    }
  }

  return checkpoints
}

function projectBoardAtFromCheckpoints(
  events: IntentLogEvent[],
  eventTimes: number[],
  checkpoints: TimelineCheckpoint[],
  sources: TimelineContentSources,
  at: string | number | Date,
): TimelineProjection {
  const targetMs = coerceTime(at)
  const targetEventIndex = eventIndexAtOrBefore(eventTimes, targetMs)
  return projectBoardThroughEventIndex(events, eventTimes, checkpoints, sources, targetEventIndex, targetMs)
}

function projectBoardThroughEventIndex(
  events: IntentLogEvent[],
  eventTimes: number[],
  checkpoints: TimelineCheckpoint[],
  sources: TimelineContentSources,
  eventIndex: number,
  targetMs = playbackTargetMs(eventTimes, eventIndex),
): TimelineProjection {
  const targetEventIndex = clampEventIndex(eventIndex, events.length)
  const checkpoint = checkpointAtOrBefore(checkpoints, targetEventIndex)
  const state = cloneProjectionState(checkpoint)

  for (let index = checkpoint.eventIndex; index < targetEventIndex; index += 1) {
    applyEvent(events[index], state.cards, state.connections, state.ghostCards, state.ghostConnections, sources)
  }

  return projectionFromState(state, targetEventIndex, events.length, targetMs, sources)
}

function playbackTargetMs(eventTimes: number[], eventIndex: number): number {
  if (eventTimes.length === 0) return Date.now()
  const clampedIndex = clampEventIndex(eventIndex, eventTimes.length)
  return clampedIndex === 0 ? eventTimes[0] - 1 : eventTimes[clampedIndex - 1]
}

function clampEventIndex(eventIndex: number, eventCount: number): number {
  return Math.max(0, Math.min(eventCount, Math.trunc(eventIndex)))
}

function rewindBoardToTimelineStart(board: TimelineBoard, events: IntentLogEvent[]): TimelineProjectionState {
  const state: TimelineProjectionState = {
    cards: new Map(board.cards.map((card) => [card.id, normalizeCardForTimeline(card)])),
    connections: new Map(board.connections.map((connection) => [connection.id, connection])),
    ghostCards: new Map(),
    ghostConnections: new Map(),
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    reverseEvent(events[index], state.cards, state.connections)
  }

  return state
}

function projectionFromState(
  state: TimelineProjectionState,
  eventIndex: number,
  eventCount: number,
  targetMs: number,
  sources: TimelineContentSources,
): TimelineProjection {
  return {
    cards: [
      ...state.cards.values(),
      ...[...state.ghostCards.values()].map((ghost) => normalizeCardForTimeline(ghost.card)),
    ].map((card) => withResultTextAt(card, sources, targetMs, eventIndex)),
    connections: [
      ...state.connections.values(),
      ...[...state.ghostConnections.values()].map((ghost) => ghost.connection),
    ],
    ghostCardIds: new Set(state.ghostCards.keys()),
    ghostConnectionIds: new Set(state.ghostConnections.keys()),
    eventIndex,
    eventCount,
    at: new Date(targetMs).toISOString(),
  }
}

function checkpointFromState(eventIndex: number, state: TimelineProjectionState): TimelineCheckpoint {
  return {
    eventIndex,
    ...cloneProjectionState(state),
  }
}

function cloneProjectionState(state: TimelineProjectionState): TimelineProjectionState {
  return {
    cards: new Map(state.cards),
    connections: new Map(state.connections),
    ghostCards: new Map(state.ghostCards),
    ghostConnections: new Map(state.ghostConnections),
  }
}

function eventIndexAtOrBefore(eventTimes: number[], targetMs: number): number {
  let low = 0
  let high = eventTimes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (eventTimes[middle] <= targetMs) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function checkpointAtOrBefore(checkpoints: TimelineCheckpoint[], eventIndex: number): TimelineCheckpoint {
  let low = 0
  let high = checkpoints.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (checkpoints[middle].eventIndex <= eventIndex) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return checkpoints[Math.max(0, low - 1)]
}

function coerceTime(value: string | number | Date): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : Date.now()
}

// Content edits never carry the text, so a replayed card keeps the words it has
// on the board today; only structure (existence, position, size, links) is
// replayed. Deleted cards keep their deletion-time snapshot.
function withLiveContent(card: Card, sources: TimelineContentSources): Card {
  const live = sources.liveCardById.get(card.id)
  if (!live) return card
  return {
    ...card,
    title: live.title,
    blocks: live.blocks,
    assets: live.assets,
    model: live.model,
    headerColor: live.headerColor,
    headerFill: live.headerFill,
  }
}

// A result card's words live in its output versions. Show the newest version
// that existed at the target time unless an explicit choice had already
// happened. For older boards without choice events, fall back to the current
// chosen version once all versions exist.
function withResultTextAt(
  card: Card,
  sources: TimelineContentSources,
  targetMs: number,
  targetEventIndex: number,
): Card {
  const output = sources.outputByCardId.get(card.id)
  if (!output || output.versions.length === 0) return card
  const visible = output.versions
    .map((version, index) => ({
      version,
      index,
      ms: Date.parse(version.createdAt),
      eventIndex: sources.versionEventIndexById.get(version.id),
    }))
    .filter(({ ms, eventIndex }) => {
      return Number.isFinite(ms) && ms <= targetMs && (eventIndex === undefined || eventIndex <= targetEventIndex)
    })
    .sort((a, b) => a.ms - b.ms || a.index - b.index)
  if (visible.length === 0) return card
  const visibleById = new Map(visible.map(({ version }) => [version.id, version]))
  const explicitChoices = sources.versionChoicesByOutputId.get(output.id) ?? []
  const explicitChoice = [...explicitChoices].reverse().find((choice) => {
    return choice.eventIndex <= targetEventIndex && choice.atMs <= targetMs && visibleById.has(choice.versionId)
  })
  const legacyChosen = output.versions.find((version) => version.id === output.chosenVersionId)
  const shown =
    (explicitChoice ? visibleById.get(explicitChoice.versionId) : undefined) ??
    (explicitChoices.length === 0 && visible.length === output.versions.length ? legacyChosen : undefined) ??
    visible[visible.length - 1]?.version
  if (!shown) return card
  return { ...card, blocks: [{ id: `${card.id}-projected-output`, text: shown.text }] }
}

function reverseEvent(
  event: IntentLogEvent,
  cards: Map<string, Card>,
  connections: Map<string, Connection>,
) {
  switch (event.type) {
    case 'card.created':
      cards.delete(event.cardId)
      break
    case 'group.created':
      cards.delete(event.cardId)
      applyMemberChanges(cards, event.data.memberChanges, 'from')
      break
    case 'card.deleted':
      cards.set(event.cardId, normalizeCardForTimeline(event.data.card))
      for (const connection of event.data.connections) connections.set(connection.id, connection)
      for (const memberId of event.data.memberIds ?? []) {
        const member = cards.get(memberId)
        if (member) cards.set(memberId, { ...member, groupId: event.cardId })
      }
      break
    case 'card.moved':
      for (const move of event.data.moves) {
        const card = cards.get(move.cardId)
        if (card) {
          cards.set(move.cardId, { ...card, position: move.from, groupId: move.previousGroupId })
        }
      }
      break
    case 'card.resized': {
      const card = cards.get(event.cardId)
      if (card) cards.set(event.cardId, { ...card, size: event.data.from })
      break
    }
    case 'cards.arranged':
      applyCardArrangements(cards, event.data.changes, 'before')
      break
    case 'card.layer.changed':
      applyCardLayers(cards, event.data.changes, 'from')
      break
    case 'card.content.edited':
      break
    case 'group.members.changed':
      applyMemberChanges(cards, event.data.memberChanges, 'from')
      break
    case 'connection.created':
      connections.delete(event.connectionId)
      break
    case 'connection.deleted':
      connections.set(event.connectionId, event.data.connection)
      break
    case 'connection.changed':
      connections.set(event.connectionId, event.data.before)
      break
    case 'run.started':
    case 'run.continued':
    case 'run.completed':
    case 'run.failed':
    case 'run.canceled':
    case 'group.compression.started':
    case 'group.compression.completed':
    case 'group.compression.failed':
    case 'group.compression.canceled':
    case 'version.chosen':
    case 'version.acceptance.changed':
    case 'version.note.created':
    case 'followup.message.added':
    case 'followup.message.finished':
    case 'followup.thread.cleared':
      break
  }
}

function applyEvent(
  event: IntentLogEvent,
  cards: Map<string, Card>,
  connections: Map<string, Connection>,
  ghostCards: Map<string, GhostCard>,
  ghostConnections: Map<string, GhostConnection>,
  sources: TimelineContentSources,
) {
  switch (event.type) {
    case 'card.created':
      cards.set(event.cardId, withLiveContent(normalizeCardForTimeline(event.data.card), sources))
      ghostCards.delete(event.cardId)
      break
    case 'group.created':
      cards.set(event.cardId, withLiveContent(normalizeCardForTimeline(event.data.card), sources))
      ghostCards.delete(event.cardId)
      applyMemberChanges(cards, event.data.memberChanges, 'to')
      break
    case 'card.deleted':
      cards.delete(event.cardId)
      ghostCards.set(event.cardId, { card: event.data.card, deletedAt: event.at })
      for (const connection of event.data.connections) {
        connections.delete(connection.id)
        ghostConnections.set(connection.id, { connection, deletedAt: event.at })
      }
      for (const memberId of event.data.memberIds ?? []) {
        const member = cards.get(memberId)
        if (member) cards.set(memberId, { ...member, groupId: undefined })
      }
      break
    case 'card.moved':
      for (const move of event.data.moves) {
        const card = cards.get(move.cardId)
        if (card) cards.set(move.cardId, { ...card, position: move.to, groupId: move.nextGroupId })
      }
      break
    case 'card.resized': {
      const card = cards.get(event.cardId)
      if (card) cards.set(event.cardId, { ...card, size: event.data.to })
      break
    }
    case 'cards.arranged':
      applyCardArrangements(cards, event.data.changes, 'after')
      break
    case 'card.layer.changed':
      applyCardLayers(cards, event.data.changes, 'to')
      break
    case 'card.content.edited':
      break
    case 'group.members.changed':
      applyMemberChanges(cards, event.data.memberChanges, 'to')
      break
    case 'connection.created':
      connections.set(event.connectionId, event.data.connection)
      ghostConnections.delete(event.connectionId)
      break
    case 'connection.deleted':
      connections.delete(event.connectionId)
      ghostConnections.set(event.connectionId, { connection: event.data.connection, deletedAt: event.at })
      break
    case 'connection.changed':
      connections.set(event.connectionId, event.data.after)
      break
    case 'run.started':
    case 'run.continued':
    case 'run.completed':
    case 'run.failed':
    case 'run.canceled':
    case 'group.compression.started':
    case 'group.compression.completed':
    case 'group.compression.failed':
    case 'group.compression.canceled':
    case 'version.chosen':
    case 'version.acceptance.changed':
    case 'version.note.created':
    case 'followup.message.added':
    case 'followup.message.finished':
    case 'followup.thread.cleared':
      break
  }
}

function applyCardArrangements(
  cards: Map<string, Card>,
  changes: Extract<IntentLogEvent, { type: 'cards.arranged' }>['data']['changes'],
  side: 'before' | 'after',
): void {
  for (const change of changes) {
    const card = cards.get(change.cardId)
    if (!card) continue
    const state = change[side]
    const updated: Card = {
      ...card,
      position: { ...state.position },
      ...(state.size === undefined ? {} : { size: { ...state.size } }),
      ...(state.groupId === undefined ? {} : { groupId: state.groupId }),
    }
    if (state.size === undefined) delete updated.size
    if (state.groupId === undefined) delete updated.groupId
    cards.set(change.cardId, updated)
  }
}

function applyCardLayers(
  cards: Map<string, Card>,
  changes: Extract<IntentLogEvent, { type: 'card.layer.changed' }>['data']['changes'],
  side: 'from' | 'to',
): void {
  for (const change of changes) {
    const card = cards.get(change.cardId)
    if (!card) continue
    const zIndex = change[side]
    if (zIndex === undefined) {
      const { zIndex: _zIndex, ...withoutLayer } = card
      cards.set(change.cardId, withoutLayer)
    } else {
      cards.set(change.cardId, { ...card, zIndex })
    }
  }
}

function applyMemberChanges(
  cards: Map<string, Card>,
  changes: Record<string, { from?: string; to?: string }> | undefined,
  side: 'from' | 'to',
) {
  if (!changes) return
  for (const [cardId, change] of Object.entries(changes)) {
    const card = cards.get(cardId)
    if (!card) continue
    cards.set(cardId, { ...card, groupId: change[side] })
  }
}
