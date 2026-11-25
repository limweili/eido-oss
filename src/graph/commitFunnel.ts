import { enablePatches, setAutoFreeze, produceWithPatches, applyPatches, type Patch } from 'immer'
import { newId } from '../shared/ids'
import type { HistoryEntry } from './history'
import type {
  Card,
  CompactionSummary,
  Connection,
  Highlight,
  HighlightTag,
  IntentLogEvent,
  IntentLogEventDraft,
  Output,
  RunRecord,
} from './types'

// The commit funnel (ADR 0016): the ONLY writer to live board state, the
// session undo ring, and the Intent Log. This module holds the pure parts —
// patch capture, event stamping, undo-ring entry shape — and the store wires
// them to zustand's set/get in store.ts.

enablePatches()
// Store code also has explicit state-only progress writes that expect plain,
// writable objects; auto-frozen produce output would make those throw.
setAutoFreeze(false)

// Session undo ring cap (ADR 0016: "~100, session-only"). One cap for the one
// unified stack shared by patch entries and interaction-summary semantic entries.
export const UNDO_RING_LIMIT = 100

// The slice of GraphState a commit's updater may mutate. The Intent Log is
// deliberately absent: the funnel owns log appends; updaters cannot touch it.
export type BoardCommitState = {
  cards: Card[]
  connections: Connection[]
  outputs: Output[]
  runs: RunRecord[]
  highlights: Highlight[]
  highlightTags: HighlightTag[]
  compactionSummaries: CompactionSummary[]
}

// commitId is null exactly when the commit was EMPTY — nothing was written,
// so no identity was allocated.
export type CommitResult = { commitId: string | null; changed: boolean }

// One mutating commit = one ring entry: the mechanical inverse+forward patches
// captured by produceWithPatches. These patches serve the undo ring ONLY —
// change-describing event payloads come from the shared card-diff classifiers
// in history.ts (issue #184), never from these JSON-pointer patches.
export type PatchUndoEntry = {
  kind: 'patches'
  id: string
  commitId: string
  label: string
  createdAt: string
  inversePatches: Patch[]
  forwardPatches: Patch[]
}

// The unified session undo stack. Patch entries are captured by mutating
// commits; a few interaction-finalization paths still use semantic entries
// when the state change already happened as no-undo progress frames.
export type UndoEntry = HistoryEntry | PatchUndoEntry

export function isPatchUndoEntry(entry: UndoEntry): entry is PatchUndoEntry {
  return 'kind' in entry && entry.kind === 'patches'
}

// Run a commit's updater under mechanical patch capture.
export function captureCommitPatches<T extends object>(
  base: T,
  updater: (draft: T) => void,
): { next: T; forwardPatches: Patch[]; inversePatches: Patch[] } {
  const [next, forwardPatches, inversePatches] = produceWithPatches(base, updater)
  return { next, forwardPatches, inversePatches }
}

// Replay one ring entry against the current board slice. Patch paths are
// positional, so this is only safe under strict stack discipline: undo/redo
// always applies the newest entry first.
export function applyRingPatches<T extends object>(base: T, patches: Patch[]): T {
  return applyPatches(base, patches)
}

// Stable per-client actor identity (ADR 0002 causal metadata — recorded now,
// unused today). Persisted in localStorage so one install keeps one identity;
// falls back to a session-scoped id where storage is unavailable (tests, SSR).
const ACTOR_ID_KEY = 'eido-v3-actor-id'
let sessionActorId: string | null = null

export function getActorId(): string {
  if (sessionActorId) return sessionActorId
  try {
    const existing = localStorage.getItem(ACTOR_ID_KEY)
    if (existing) {
      sessionActorId = existing
      return existing
    }
    const fresh = newId('actor')
    localStorage.setItem(ACTOR_ID_KEY, fresh)
    sessionActorId = fresh
    return fresh
  } catch {
    sessionActorId = newId('actor')
    return sessionActorId
  }
}

export type EventStampContext = {
  commitId: string
  actorId: string
  clientTxnId: string
  at: string
  ideaId?: string
  retainedEvents: IntentLogEvent[]
}

// Stamp the caller's event drafts with identity and the commit's causal
// metadata. Every stamped field sits AFTER the draft spread so a runtime-
// malformed draft (e.g. parsed from imported data) can never override what
// the funnel asserts about identity and causality.
export function stampIntentEvents(
  drafts: IntentLogEventDraft[],
  ctx: EventStampContext,
): IntentLogEvent[] {
  const baseSeq = ctx.retainedEvents.reduce(
    (maximum, event) =>
      typeof event.seq === 'number' && Number.isFinite(event.seq) ? Math.max(maximum, event.seq) : maximum,
    0,
  )
  return drafts.map(
    (draft, index) =>
      ({
        ...draft,
        id: newId('evt'),
        at: ctx.at,
        ...(ctx.ideaId ? { ideaId: ctx.ideaId } : {}),
        commitId: ctx.commitId,
        actorId: ctx.actorId,
        clientTxnId: ctx.clientTxnId,
        seq: baseSeq + index + 1,
      }) as IntentLogEvent,
  )
}

// Call-site helper: mutate draft cards toward a functionally-computed next
// array, field by field, so Immer captures granular patches (per-card
// position/size/groupId) instead of one whole-array replacement. Whole-array
// patches would make undo revert unrelated later edits; granular patches keep
// undo scoped to what the commit actually changed. Only structural fields are
// covered — converted call sites must not change anything else through this.
export function assignStructuralCardChanges(draftCards: Card[], nextCards: Card[]): void {
  if (draftCards.length !== nextCards.length) {
    throw new Error('assignStructuralCardChanges expects an id-aligned next array (no adds/removes)')
  }
  for (let i = 0; i < draftCards.length; i += 1) {
    const current = draftCards[i]
    const next = nextCards[i]
    if (current.id !== next.id) {
      throw new Error('assignStructuralCardChanges expects an id-aligned next array (no reorders)')
    }
    if (current.position.x !== next.position.x || current.position.y !== next.position.y) {
      current.position = { x: next.position.x, y: next.position.y }
    }
    const sizeChanged =
      current.size !== next.size &&
      (current.size?.width !== next.size?.width || current.size?.height !== next.size?.height)
    if (sizeChanged) {
      if (next.size) current.size = { width: next.size.width, height: next.size.height }
      else delete current.size
    }
    if (current.groupId !== next.groupId) {
      if (next.groupId === undefined) delete current.groupId
      else current.groupId = next.groupId
    }
  }
}
