import type {
  Card,
  CardAsset,
  CardAssetKind,
  CardKind,
  CompactionSummary,
  Connection,
  ConnectionPolarity,
  ConnectionRole,
  ConnectionStrength,
  Highlight,
  HighlightTag,
  IdeaExport,
  IdeaSummary,
  IntentLogEvent,
  Output,
  RunKind,
  RunRecord,
  RunStatus,
  SavedBoard,
} from '../../graph/types'
import { isValidMod } from '../../mods'

export const PROFILE_FIXTURE_SCHEMA_VERSION = 1 as const
export const PROFILE_FIXTURE_CORPUS_SHA256 = '698ebd967f765fc9dea286bfbc04a9fd7c59fc9bdda836c528bae50694f53714'

export const PROFILE_FIXTURE_SEAMS = [
  'profile-source',
  'profile-validation',
  'profile-normalization',
  'asset-closure',
  'profile-transaction',
  'profile-reload',
  'profile-ownership',
  'profile-recovery',
  'portable-export',
  'agent-gateway',
  'platform-evidence',
] as const

export type FixtureTargetSeam = (typeof PROFILE_FIXTURE_SEAMS)[number]
export type FixtureKind = 'input' | 'expected-result' | 'scenario'
export type PrivacyClass = 'synthetic-public'

export const PROFILE_FIXTURE_VALIDATION_CODES = [
  'duplicate-case-id',
  'missing-required-case',
  'invalid-case-metadata',
  'invalid-case-data',
  'invalid-json-value',
  'missing-durable-class',
  'missing-durable-structure',
  'invalid-active-idea',
  'missing-board-reference',
  'duplicate-or-missing-id',
  'invalid-closed-enum',
  'invalid-connection-reference',
  'invalid-asset-reference',
  'invalid-output-reference',
  'invalid-run-reference',
  'invalid-intent-reference',
  'invalid-highlight-reference',
  'invalid-compaction-reference',
  'missing-platform-evidence',
  'private-material',
  'executable-mod-content',
] as const

export type ProfileFixtureValidationCode = (typeof PROFILE_FIXTURE_VALIDATION_CODES)[number]

export type ProfileFixtureValidationIssue = {
  code: ProfileFixtureValidationCode
  caseId?: string
  detail: string
}

export const PROFILE_FIXTURE_SEAM_COVERAGE: Record<FixtureTargetSeam, true> = {
  'profile-source': true,
  'profile-validation': true,
  'profile-normalization': true,
  'asset-closure': true,
  'profile-transaction': true,
  'profile-reload': true,
  'profile-ownership': true,
  'profile-recovery': true,
  'portable-export': true,
  'agent-gateway': true,
  'platform-evidence': true,
}

export const PROFILE_FIXTURE_KIND_COVERAGE: Record<FixtureKind, true> = {
  input: true,
  'expected-result': true,
  scenario: true,
}

export const PROFILE_FIXTURE_VALIDATION_CODE_COVERAGE: Record<ProfileFixtureValidationCode, true> = {
  'duplicate-case-id': true,
  'missing-required-case': true,
  'invalid-case-metadata': true,
  'invalid-case-data': true,
  'invalid-json-value': true,
  'missing-durable-class': true,
  'missing-durable-structure': true,
  'invalid-active-idea': true,
  'missing-board-reference': true,
  'duplicate-or-missing-id': true,
  'invalid-closed-enum': true,
  'invalid-connection-reference': true,
  'invalid-asset-reference': true,
  'invalid-output-reference': true,
  'invalid-run-reference': true,
  'invalid-intent-reference': true,
  'invalid-highlight-reference': true,
  'invalid-compaction-reference': true,
  'missing-platform-evidence': true,
  'private-material': true,
  'executable-mod-content': true,
}

const CARD_KIND_COVERAGE: Record<CardKind, true> = {
  note: true,
  askAi: true,
  result: true,
  mod: true,
  group: true,
  conversation: true,
  title: true,
}

const CARD_ASSET_KIND_COVERAGE: Record<CardAssetKind, true> = { image: true, file: true }
const CONNECTION_STRENGTH_COVERAGE: Record<ConnectionStrength, true> = { strong: true, weak: true }
const CONNECTION_POLARITY_COVERAGE: Record<ConnectionPolarity, true> = { helps: true, pushesAgainst: true }
const CONNECTION_ROLE_COVERAGE: Record<ConnectionRole, true> = { feeds: true, modifies: true }
const RUN_STATUS_COVERAGE: Record<RunStatus, true> = { running: true, done: true, failed: true, canceled: true }
const RUN_KIND_COVERAGE: Record<RunKind, true> = { ask: true, groupDigest: true, conversation: true }
const INTENT_EVENT_TYPE_COVERAGE: Record<IntentLogEvent['type'], true> = {
  'card.created': true,
  'group.created': true,
  'card.deleted': true,
  'card.moved': true,
  'card.resized': true,
  'cards.arranged': true,
  'card.layer.changed': true,
  'card.content.edited': true,
  'group.members.changed': true,
  'connection.created': true,
  'connection.deleted': true,
  'connection.changed': true,
  'run.started': true,
  'run.continued': true,
  'run.completed': true,
  'run.failed': true,
  'run.canceled': true,
  'group.compression.started': true,
  'group.compression.completed': true,
  'group.compression.failed': true,
  'group.compression.canceled': true,
  'version.chosen': true,
  'version.acceptance.changed': true,
  'version.note.created': true,
  'followup.message.added': true,
  'followup.message.finished': true,
  'followup.thread.cleared': true,
}

export type DurableBoardClass =
  | 'cards'
  | 'blocks'
  | 'connections'
  | 'groups'
  | 'intent-metadata'
  | 'outputs'
  | 'versions'
  | 'runs'
  | 'transcripts'
  | 'follow-ups'
  | 'intent-log'
  | 'assets'
  | 'board-settings'
  | 'highlights'
  | 'compaction-summaries'

export type SupportedProfileSource = {
  format: 'eido-v3'
  version: SavedBoard['version']
  activeIdeaId: string
  durableClasses: DurableBoardClass[]
  ideas: IdeaSummary[]
  boards: Record<string, SavedBoard>
}

export type AlphaProfileV1 = {
  format: 'eido-profile'
  schemaVersion: 1
  revision: number
  activeIdeaId: string
  ideas: IdeaSummary[]
  boards: Record<string, SavedBoard>
  source: { kind: 'copy-first-eido-v3'; copiedAt: string }
}

// Extend this union when an Alpha Profile schema ships. The exhaustive schema
// fixture map below then makes the missing corpus case a compile-time failure.
export type ShippedAlphaProfile = AlphaProfileV1

const FIXTURE_AT = '2026-01-01T00:00:00.000Z'
const FIXTURE_FINISHED_AT = '2026-01-01T00:00:01.000Z'
const SYNTHETIC_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const SYNTHETIC_PNG_SHA256 = '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460'

export const SYNTHETIC_MAIN_IDEA: IdeaSummary = {
  id: 'idea-main',
  name: 'Synthetic Main',
  createdAt: FIXTURE_AT,
  updatedAt: FIXTURE_AT,
  lastOpenedAt: FIXTURE_AT,
}

export const SYNTHETIC_SECOND_IDEA: IdeaSummary = {
  id: 'idea-second',
  name: 'Synthetic Second',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  lastOpenedAt: '2026-01-02T00:00:00.000Z',
}

export const SYNTHETIC_PNG_ASSET: CardAsset = {
  id: 'asset-note-image',
  kind: 'image',
  name: 'synthetic-note.png',
  mimeType: 'image/png',
  dataUrl: `data:image/png;base64,${SYNTHETIC_PNG_BASE64}`,
  size: 68,
  createdAt: FIXTURE_AT,
  width: 1,
  height: 1,
  originalSize: 68,
  originalMimeType: 'image/png',
  compression: 'compressed',
}

export const SYNTHETIC_GROUP_CARD: Card = {
  id: 'card-group',
  kind: 'group',
  position: { x: 0, y: 0 },
  blocks: [{ id: 'block-group', text: 'Synthetic group', kind: 'heading' }],
}

export const SYNTHETIC_NOTE_CARD: Card = {
  id: 'card-note',
  kind: 'note',
  groupId: SYNTHETIC_GROUP_CARD.id,
  position: { x: 120, y: 80 },
  blocks: [{ id: 'block-note', text: 'Synthetic source note', kind: 'line' }],
  assets: [SYNTHETIC_PNG_ASSET],
}

export const SYNTHETIC_ASK_CARD: Card = {
  id: 'card-ask',
  kind: 'askAi',
  position: { x: 420, y: 80 },
  blocks: [{ id: 'block-ask', text: 'Synthetic question', kind: 'line' }],
  model: 'synthetic/model',
}

export const SYNTHETIC_RESULT_CARD: Card = {
  id: 'card-result',
  kind: 'result',
  position: { x: 720, y: 80 },
  blocks: [{ id: 'block-result', text: 'Synthetic result', kind: 'generated' }],
}

export const SYNTHETIC_MOD_CARD: Card = {
  id: 'card-mod',
  kind: 'mod',
  position: { x: 420, y: 280 },
  blocks: [{ id: 'block-mod', text: 'Synthetic Mod', kind: 'line' }],
  modV2: {
    kind: 'slider',
    title: 'Synthetic Mod',
    accent: 'synthetic-accent',
    state: {
      steps: 0,
      stops: [],
      items: [{ id: 'control-1', label: 'SPECIFICITY', v: 50, frame: 'Specificity: {value}/100.' }],
    },
    treatOverride: null,
  },
}

export const SYNTHETIC_CONVERSATION_CARD: Card = {
  id: 'card-conversation',
  kind: 'conversation',
  position: { x: 720, y: 280 },
  blocks: [{ id: 'block-conversation', text: 'Synthetic topic', kind: 'line' }],
  conversationStyle: 'critique',
  conversationTurns: 2,
}

export const SYNTHETIC_CONVERSATION_RESULT_CARD: Card = {
  id: 'card-conversation-result',
  kind: 'result',
  position: { x: 1020, y: 280 },
  blocks: [{ id: 'block-conversation-result', text: 'Synthetic conversation result', kind: 'generated' }],
}

export const SYNTHETIC_TITLE_CARD: Card = {
  id: 'card-title',
  kind: 'title',
  position: { x: 0, y: -120 },
  blocks: [{ id: 'block-title', text: 'Synthetic title', kind: 'heading' }],
}

// Settings-envelope vectors (#1307). `card.meta` is the Card's settings
// envelope, so these are the shapes a downgrade has to survive: a key no
// shipped build defines, and a known key holding a value from a build this one
// has never met. Neither may fail a Card, a Board, or a Profile.
export const SYNTHETIC_UNKNOWN_SETTINGS_CARD: Card = {
  id: 'card-unknown-settings',
  kind: 'note',
  position: { x: 120, y: 480 },
  blocks: [{ id: 'block-unknown-settings', text: 'Synthetic note from a newer build', kind: 'line' }],
  meta: {
    linkPreviewDismissedUrl: 'https://example.invalid/dismissed',
    futurePanel: { collapsed: true, order: ['a', 'b'], weight: 0.5, absent: null },
  },
}

export const SYNTHETIC_FOREIGN_SETTINGS_CARD: Card = {
  id: 'card-foreign-settings',
  kind: 'askAi',
  position: { x: 420, y: 480 },
  blocks: [{ id: 'block-foreign-settings', text: 'Synthetic question from a newer build', kind: 'line' }],
  meta: {
    reachMode: 'exhaustive',
    researchDepth: 7,
    researchJob: { id: '', submittedAt: 42 },
  },
}

// The Note body scale after it moved into the envelope (#1308). The migration
// has two directions to survive: a Board an older build wrote, which still
// carries the scale as the retired top-level `fontSize` field named 'large',
// and a Board this build writes, which carries the scale as a step on the Note
// text ladder inside the envelope and no longer carries the field at all. Both
// must read as the scale the person picked, and both must open in a build that
// predates the move.
export const SYNTHETIC_LEGACY_FONT_SIZE_CARD = {
  id: 'card-legacy-font-size',
  kind: 'note',
  position: { x: 120, y: 720 },
  blocks: [{ id: 'block-legacy-font-size', text: 'Synthetic note saved before the scale moved', kind: 'line' }],
  fontSize: 'large',
}

export const SYNTHETIC_MIGRATED_FONT_SIZE_CARD: Card = {
  id: 'card-migrated-font-size',
  kind: 'note',
  position: { x: 420, y: 720 },
  blocks: [{ id: 'block-migrated-font-size', text: 'Synthetic note saved after the scale moved', kind: 'line' }],
  meta: { noteFontSize: 1 },
}

// The one settings-shaped failure that is still allowed to refuse a record: a
// container that is not a plain object is corruption, not a preference.
export const SYNTHETIC_MALFORMED_SETTINGS_CARD = {
  id: 'card-malformed-settings',
  kind: 'note',
  position: { x: 720, y: 480 },
  blocks: [{ id: 'block-malformed-settings', text: 'Synthetic note with a corrupt envelope', kind: 'line' }],
  meta: ['not', 'a', 'record'],
}

// Board-level settings-envelope vectors (#1307). `SavedBoard.aiSettings` is a
// pure settings bag and `SavedBoard.settings` is the Board's own envelope, so
// these are the shapes a Board-level downgrade has to survive: a key no build
// in this tree defines, and a known key holding a value from a build this one
// has never met. Neither may fail a Board or a Profile in THIS build or in any
// build after it.
export const SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS = {
  model: 'synthetic/model',
  models: ['synthetic/model'],
  // A reasoning rung and a compaction mode from a build that added one.
  reasoningEffort: 'ultra',
  compactionMode: 'obsessive',
  // A whole setting no build in this tree defines.
  futureRunKnob: { retries: 3, backoff: 'linear' },
}

export const SYNTHETIC_UNKNOWN_BOARD_SETTINGS = {
  futureBoardPanel: { collapsed: true, order: ['a', 'b'] },
  gridSnap: 12,
}

export const SYNTHETIC_CONNECTIONS: Connection[] = [
  {
    id: 'connection-note-ask',
    from: { cardId: SYNTHETIC_NOTE_CARD.id, blockId: 'block-note' },
    to: { cardId: SYNTHETIC_ASK_CARD.id, blockId: 'block-ask' },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  },
  {
    id: 'connection-ask-result',
    from: { cardId: SYNTHETIC_ASK_CARD.id },
    to: { cardId: SYNTHETIC_RESULT_CARD.id },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  },
  {
    id: 'connection-mod-ask',
    from: { cardId: SYNTHETIC_MOD_CARD.id },
    to: { cardId: SYNTHETIC_ASK_CARD.id },
    strength: 'weak',
    polarity: 'helps',
    role: 'modifies',
  },
  {
    id: 'connection-ask-conversation',
    from: { cardId: SYNTHETIC_ASK_CARD.id },
    to: { cardId: SYNTHETIC_CONVERSATION_CARD.id },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  },
  {
    id: 'connection-note-conversation',
    from: { cardId: SYNTHETIC_NOTE_CARD.id },
    to: { cardId: SYNTHETIC_CONVERSATION_CARD.id },
    strength: 'weak',
    polarity: 'helps',
    role: 'feeds',
  },
  {
    id: 'connection-mod-conversation',
    from: { cardId: SYNTHETIC_MOD_CARD.id },
    to: { cardId: SYNTHETIC_CONVERSATION_CARD.id },
    strength: 'strong',
    polarity: 'helps',
    role: 'modifies',
  },
  {
    id: 'connection-conversation-result',
    from: { cardId: SYNTHETIC_CONVERSATION_CARD.id },
    to: { cardId: SYNTHETIC_CONVERSATION_RESULT_CARD.id },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  },
]

export const SYNTHETIC_ASK_RUN: RunRecord = {
  id: 'run-main',
  startedAt: FIXTURE_AT,
  finishedAt: FIXTURE_FINISHED_AT,
  askAiCardId: SYNTHETIC_ASK_CARD.id,
  model: 'synthetic/model',
  usedCardIds: [SYNTHETIC_NOTE_CARD.id],
  usedConnectionIds: ['connection-note-ask'],
  modIds: [SYNTHETIC_MOD_CARD.id],
  appliedMods: [{ modCardId: SYNTHETIC_MOD_CARD.id, controlValues: { 'control-1': 5 }, appliedInstructions: ['Specificity: 5/10'] }],
  compiledInstruction: 'Use the synthetic source note to answer the synthetic question.',
  producedVersionId: 'version-result-1',
  status: 'done',
  kind: 'ask',
}

export const SYNTHETIC_CONVERSATION_RUN: RunRecord = {
  id: 'run-conversation',
  startedAt: '2026-01-01T00:01:00.000Z',
  finishedAt: '2026-01-01T00:01:02.000Z',
  askAiCardId: SYNTHETIC_CONVERSATION_CARD.id,
  model: 'synthetic/model',
  usedCardIds: [SYNTHETIC_ASK_CARD.id, SYNTHETIC_NOTE_CARD.id, SYNTHETIC_MOD_CARD.id],
  usedConnectionIds: ['connection-ask-conversation', 'connection-note-conversation', 'connection-mod-conversation'],
  modIds: [SYNTHETIC_MOD_CARD.id],
  appliedMods: [{ modCardId: SYNTHETIC_MOD_CARD.id, controlValues: { 'control-1': 5 }, appliedInstructions: ['Specificity: 5/10'] }],
  compiledInstruction: 'Critique the synthetic topic using the shared synthetic note.',
  producedVersionId: 'version-conversation-1',
  status: 'done',
  kind: 'conversation',
  conversation: {
    settings: { topic: 'Synthetic topic', style: 'critique', turnsPerParticipant: 2 },
    participants: [{ cardId: SYNTHETIC_ASK_CARD.id, name: 'Synthetic participant', model: 'synthetic/model', role: 'Offer a concise critique.' }],
    sharedContext: [{ cardId: SYNTHETIC_NOTE_CARD.id, label: 'Synthetic source note', text: 'Synthetic source note' }],
    topLevelMods: [{ cardId: SYNTHETIC_MOD_CARD.id, label: 'Synthetic Mod', instructions: ['Specificity: 5/10'] }],
    turns: [
      { speakerName: 'Synthetic participant', participantCardId: SYNTHETIC_ASK_CARD.id, currentTurn: 1, totalTurns: 2, instruction: 'Offer turn one of the synthetic critique.' },
      { speakerName: 'Synthetic participant', participantCardId: SYNTHETIC_ASK_CARD.id, currentTurn: 2, totalTurns: 2, instruction: 'Offer turn two of the synthetic critique.' },
    ],
  },
}

export const SYNTHETIC_OUTPUTS: Output[] = [
  {
    id: 'output-result',
    resultCardId: SYNTHETIC_RESULT_CARD.id,
    chosenVersionId: SYNTHETIC_ASK_RUN.producedVersionId,
    versions: [
      {
        id: 'version-result-1',
        number: 1,
        text: 'Synthetic answer',
        createdAt: FIXTURE_FINISHED_AT,
        fromRunId: SYNTHETIC_ASK_RUN.id,
        followUpThread: {
          messages: [
            { id: 'follow-up-user-1', role: 'user', text: 'Why?', createdAt: FIXTURE_FINISHED_AT, status: 'complete' },
            { id: 'follow-up-assistant-1', role: 'assistant', text: 'Because this is synthetic.', createdAt: '2026-01-01T00:00:02.000Z', status: 'complete' },
          ],
        },
        sourceContext: {
          version: 1,
          sources: [{ cardId: SYNTHETIC_NOTE_CARD.id, kind: 'note', label: 'Synthetic source note', hash: 'synthetic-source-hash' }],
        },
      },
    ],
  },
  {
    id: 'output-conversation',
    resultCardId: SYNTHETIC_CONVERSATION_RESULT_CARD.id,
    chosenVersionId: SYNTHETIC_CONVERSATION_RUN.producedVersionId,
    versions: [
      {
        id: 'version-conversation-1',
        number: 1,
        text: 'Synthetic participant: A synthetic critique.',
        createdAt: '2026-01-01T00:01:02.000Z',
        fromRunId: SYNTHETIC_CONVERSATION_RUN.id,
        transcript: [
          {
            id: 'transcript-participant-1',
            speakerKind: 'participant',
            speakerName: 'Synthetic participant',
            participantCardId: SYNTHETIC_ASK_CARD.id,
            text: 'A synthetic critique.',
            turnNumber: 1,
            streaming: false,
          },
          {
            id: 'transcript-participant-2',
            speakerKind: 'participant',
            speakerName: 'Synthetic participant',
            participantCardId: SYNTHETIC_ASK_CARD.id,
            text: 'A second synthetic critique.',
            turnNumber: 2,
            streaming: false,
          },
        ],
      },
    ],
  },
]

export const SYNTHETIC_CARD_CREATED_EVENT: IntentLogEvent = {
  id: 'event-note-created',
  at: FIXTURE_AT,
  ideaId: SYNTHETIC_MAIN_IDEA.id,
  type: 'card.created',
  cardId: SYNTHETIC_NOTE_CARD.id,
  data: { card: SYNTHETIC_NOTE_CARD },
  commitId: 'commit-synthetic-1',
  actorId: 'actor-synthetic',
  clientTxnId: 'txn-synthetic-1',
  seq: 1,
}

export const SYNTHETIC_RUN_COMPLETED_EVENT: IntentLogEvent = {
  id: 'event-run-completed',
  at: FIXTURE_FINISHED_AT,
  ideaId: SYNTHETIC_MAIN_IDEA.id,
  type: 'run.completed',
  runId: SYNTHETIC_ASK_RUN.id,
  data: { run: SYNTHETIC_ASK_RUN },
  commitId: 'commit-synthetic-2',
  actorId: 'actor-synthetic',
  clientTxnId: 'txn-synthetic-2',
  seq: 2,
}

export const SYNTHETIC_HIGHLIGHT_TAG: HighlightTag = {
  id: 'tag-1',
  name: 'Synthetic tag',
  color: 'yellow',
  createdAt: FIXTURE_AT,
}

export const SYNTHETIC_HIGHLIGHT: Highlight = {
  id: 'highlight-1',
  cardId: SYNTHETIC_NOTE_CARD.id,
  tagId: SYNTHETIC_HIGHLIGHT_TAG.id,
  text: 'Synthetic',
  occurrence: 0,
  createdAt: FIXTURE_AT,
}

export const SYNTHETIC_COMPACTION_SUMMARY: CompactionSummary = {
  cardId: SYNTHETIC_NOTE_CARD.id,
  fingerprint: 'synthetic-fingerprint',
  summary: 'Synthetic summary',
  model: 'synthetic/model',
  createdAt: FIXTURE_AT,
}

export const SYNTHETIC_MAIN_BOARD: SavedBoard = {
  version: 1,
  updatedAt: FIXTURE_AT,
  cards: [
    SYNTHETIC_GROUP_CARD,
    SYNTHETIC_NOTE_CARD,
    SYNTHETIC_ASK_CARD,
    SYNTHETIC_RESULT_CARD,
    SYNTHETIC_MOD_CARD,
    SYNTHETIC_CONVERSATION_CARD,
    SYNTHETIC_CONVERSATION_RESULT_CARD,
    SYNTHETIC_TITLE_CARD,
  ],
  connections: SYNTHETIC_CONNECTIONS,
  outputs: SYNTHETIC_OUTPUTS,
  runs: [SYNTHETIC_ASK_RUN, SYNTHETIC_CONVERSATION_RUN],
  intentLog: [SYNTHETIC_CARD_CREATED_EVENT, SYNTHETIC_RUN_COMPLETED_EVENT],
  aiSettings: { model: 'synthetic/model', models: ['synthetic/model'], reasoningEffort: 'low' },
  highlights: [SYNTHETIC_HIGHLIGHT],
  highlightTags: [SYNTHETIC_HIGHLIGHT_TAG],
  compactionSummaries: [SYNTHETIC_COMPACTION_SUMMARY],
}

export const SYNTHETIC_SECOND_BOARD: SavedBoard = {
  version: 1,
  updatedAt: '2026-01-02T00:00:00.000Z',
  cards: [{ id: 'card-second', kind: 'note', position: { x: 0, y: 0 }, blocks: [{ id: 'block-second', text: 'Synthetic second Idea', kind: 'line' }] }],
  connections: [],
  outputs: [],
  runs: [],
  intentLog: [],
  aiSettings: { model: 'synthetic/model', models: ['synthetic/model'], reasoningEffort: 'low' },
}

export const PROFILE_DURABLE_STRUCTURE_CHECKS: Record<DurableBoardClass, (board: SavedBoard) => boolean> = {
  cards: (board) => board.cards.length > 0,
  blocks: (board) => board.cards.some((card) => card.blocks.length > 0),
  connections: (board) => board.connections.length > 0,
  groups: (board) => board.cards.some((card) => card.kind === 'group'),
  'intent-metadata': (board) => (board.intentLog ?? []).some(hasCausalIntentMetadata),
  outputs: (board) => board.outputs.length > 0,
  versions: (board) => board.outputs.some((output) => output.versions.length > 0),
  runs: (board) => board.runs.length > 0,
  transcripts: (board) => board.outputs.some((output) => output.versions.some((version) => (version.transcript?.length ?? 0) > 0)),
  'follow-ups': (board) => board.outputs.some((output) => output.versions.some((version) => (version.followUpThread?.messages.length ?? 0) > 0)),
  'intent-log': (board) => (board.intentLog?.length ?? 0) > 0,
  assets: (board) => board.cards.some((card) => (card.assets?.length ?? 0) > 0),
  'board-settings': (board) => board.aiSettings !== undefined,
  highlights: (board) => (board.highlights?.length ?? 0) > 0 && (board.highlightTags?.length ?? 0) > 0,
  'compaction-summaries': (board) => (board.compactionSummaries?.length ?? 0) > 0,
}

export const PROFILE_DURABLE_CLASS_COVERAGE: Record<DurableBoardClass, true> = {
  cards: true,
  blocks: true,
  connections: true,
  groups: true,
  'intent-metadata': true,
  outputs: true,
  versions: true,
  runs: true,
  transcripts: true,
  'follow-ups': true,
  'intent-log': true,
  assets: true,
  'board-settings': true,
  highlights: true,
  'compaction-summaries': true,
}

export const SAVED_BOARD_DURABLE_CLASS_BRIDGE: Record<keyof SavedBoard, DurableBoardClass | 'schema-metadata'> = {
  version: 'schema-metadata',
  cards: 'cards',
  connections: 'connections',
  outputs: 'outputs',
  runs: 'runs',
  highlights: 'highlights',
  highlightTags: 'highlights',
  'intentLog': 'intent-log',
  visualDecayEnabled: 'schema-metadata',
  aiSettings: 'board-settings',
  // The Board's settings envelope (ADR 0040) belongs to the same durable class
  // as its AI settings: both are Board-level preferences, neither is content.
  settings: 'board-settings',
  compactionSummaries: 'compaction-summaries',
  updatedAt: 'schema-metadata',
}

export const SUPPORTED_PROFILE_SOURCE: SupportedProfileSource = {
  format: 'eido-v3',
  version: 1,
  activeIdeaId: SYNTHETIC_MAIN_IDEA.id,
  durableClasses: Object.keys(PROFILE_DURABLE_CLASS_COVERAGE) as DurableBoardClass[],
  ideas: [SYNTHETIC_MAIN_IDEA, SYNTHETIC_SECOND_IDEA],
  boards: {
    [SYNTHETIC_MAIN_IDEA.id]: SYNTHETIC_MAIN_BOARD,
    [SYNTHETIC_SECOND_IDEA.id]: SYNTHETIC_SECOND_BOARD,
  },
}

export const ALPHA_PROFILE_V1: AlphaProfileV1 = {
  format: 'eido-profile',
  schemaVersion: 1,
  revision: 7,
  activeIdeaId: SUPPORTED_PROFILE_SOURCE.activeIdeaId,
  ideas: SUPPORTED_PROFILE_SOURCE.ideas,
  boards: SUPPORTED_PROFILE_SOURCE.boards,
  source: { kind: 'copy-first-eido-v3', copiedAt: '2026-01-03T00:00:00.000Z' },
}

const PENDING_MAIN_BOARD: SavedBoard = {
  ...SYNTHETIC_MAIN_BOARD,
  updatedAt: '2026-01-03T00:00:01.000Z',
  cards: SYNTHETIC_MAIN_BOARD.cards.map((card) => card.id === SYNTHETIC_NOTE_CARD.id
    ? { ...card, blocks: [{ id: 'block-note', text: 'Synthetic source note after pending edit', kind: 'line' }] }
    : card),
  intentLog: [
    ...(SYNTHETIC_MAIN_BOARD.intentLog ?? []),
    {
      id: 'event-note-edited',
      at: '2026-01-03T00:00:01.000Z',
      ideaId: SYNTHETIC_MAIN_IDEA.id,
      type: 'card.content.edited',
      cardId: SYNTHETIC_NOTE_CARD.id,
      data: { field: 'body', textLength: 40 },
      commitId: 'commit-synthetic-3',
      actorId: 'actor-synthetic',
      clientTxnId: 'txn-synthetic-3',
      seq: 3,
    },
  ],
}

export const ALPHA_PROFILE_V1_REVISION_8: AlphaProfileV1 = {
  ...ALPHA_PROFILE_V1,
  revision: 8,
  boards: { ...ALPHA_PROFILE_V1.boards, [SYNTHETIC_MAIN_IDEA.id]: PENDING_MAIN_BOARD },
}

const REORDERED_PROFILE_SOURCE: SupportedProfileSource = {
  ...SUPPORTED_PROFILE_SOURCE,
  ideas: [...SUPPORTED_PROFILE_SOURCE.ideas].reverse(),
  boards: {
    [SYNTHETIC_SECOND_IDEA.id]: SYNTHETIC_SECOND_BOARD,
    [SYNTHETIC_MAIN_IDEA.id]: {
      ...SYNTHETIC_MAIN_BOARD,
      cards: [...SYNTHETIC_MAIN_BOARD.cards].reverse(),
      connections: [...SYNTHETIC_MAIN_BOARD.connections].reverse(),
    },
  },
}

const DUPLICATE_MISSING_ID_PROFILE = {
  ...SUPPORTED_PROFILE_SOURCE,
  boards: {
    ...SUPPORTED_PROFILE_SOURCE.boards,
    [SYNTHETIC_MAIN_IDEA.id]: {
      ...SYNTHETIC_MAIN_BOARD,
      cards: [
        ...SYNTHETIC_MAIN_BOARD.cards,
        { ...SYNTHETIC_TITLE_CARD, id: SYNTHETIC_NOTE_CARD.id },
        { kind: 'note', position: { x: 50, y: 50 }, blocks: [{ id: 'block-without-card-id', text: 'Synthetic missing Card ID' }] },
      ],
    },
  },
}

const MISSING_ASSET_PROFILE = {
  ...SUPPORTED_PROFILE_SOURCE,
  boards: {
    ...SUPPORTED_PROFILE_SOURCE.boards,
    [SYNTHETIC_MAIN_IDEA.id]: {
      ...SYNTHETIC_MAIN_BOARD,
      cards: SYNTHETIC_MAIN_BOARD.cards.map((card) => card.id === SYNTHETIC_NOTE_CARD.id
        ? {
            ...card,
            assets: [{
              id: SYNTHETIC_PNG_ASSET.id,
              kind: SYNTHETIC_PNG_ASSET.kind,
              name: SYNTHETIC_PNG_ASSET.name,
              mimeType: SYNTHETIC_PNG_ASSET.mimeType,
              size: SYNTHETIC_PNG_ASSET.size,
              createdAt: SYNTHETIC_PNG_ASSET.createdAt,
            }],
          }
        : card),
    },
  },
}

const IMAGE_HEAVY_ASSETS: CardAsset[] = Array.from({ length: 64 }, (_, index) => ({
  ...SYNTHETIC_PNG_ASSET,
  id: `asset-image-heavy-${String(index + 1).padStart(2, '0')}`,
  name: `synthetic-image-${String(index + 1).padStart(2, '0')}.png`,
}))

const IMAGE_HEAVY_PROFILE: SupportedProfileSource = {
  ...SUPPORTED_PROFILE_SOURCE,
  boards: {
    ...SUPPORTED_PROFILE_SOURCE.boards,
    [SYNTHETIC_MAIN_IDEA.id]: {
      ...SYNTHETIC_MAIN_BOARD,
      cards: SYNTHETIC_MAIN_BOARD.cards.map((card) => card.id === SYNTHETIC_NOTE_CARD.id ? { ...card, assets: IMAGE_HEAVY_ASSETS } : card),
    },
  },
}

const PORTABLE_MAIN_IDEA_EXPORT: IdeaExport = {
  version: 1,
  exportedAt: '2026-01-04T00:00:00.000Z',
  idea: SYNTHETIC_MAIN_IDEA,
  board: SYNTHETIC_MAIN_BOARD,
}

const PORTABLE_LOGICAL_IDS = {
  ideaIds: [SYNTHETIC_MAIN_IDEA.id],
  cardIds: SYNTHETIC_MAIN_BOARD.cards.map((card) => card.id),
  blockIds: SYNTHETIC_MAIN_BOARD.cards.flatMap((card) => card.blocks.map((block) => block.id)),
  assetIds: SYNTHETIC_MAIN_BOARD.cards.flatMap((card) => (card.assets ?? []).map((asset) => asset.id)),
  connectionIds: SYNTHETIC_MAIN_BOARD.connections.map((connection) => connection.id),
  outputIds: SYNTHETIC_MAIN_BOARD.outputs.map((output) => output.id),
  versionIds: SYNTHETIC_MAIN_BOARD.outputs.flatMap((output) => output.versions.map((version) => version.id)),
  messageIds: SYNTHETIC_MAIN_BOARD.outputs.flatMap((output) => output.versions.flatMap((version) => [
    ...(version.transcript ?? []).map((message) => message.id),
    ...(version.followUpThread?.messages ?? []).map((message) => message.id),
  ])),
  runIds: SYNTHETIC_MAIN_BOARD.runs.map((run) => run.id),
  intentEventIds: (SYNTHETIC_MAIN_BOARD.intentLog ?? []).map((event) => event.id),
  highlightIds: (SYNTHETIC_MAIN_BOARD.highlights ?? []).map((highlight) => highlight.id),
  highlightTagIds: (SYNTHETIC_MAIN_BOARD.highlightTags ?? []).map((tag) => tag.id),
}

const PORTABLE_CLOSURE_IDS = [...new Set(Object.values(PORTABLE_LOGICAL_IDS).flat())]

type ProfileFixtureDefinition<Data> = {
  schemaVersion: typeof PROFILE_FIXTURE_SCHEMA_VERSION
  id: string
  kind: FixtureKind
  targetSeam: FixtureTargetSeam
  expectedObservableOutcome: string
  privacyClass: PrivacyClass
  data: Data
}

export const profileFixtureCorpus = [
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'supported-multi-idea-source',
    kind: 'input',
    targetSeam: 'profile-source',
    expectedObservableOutcome: 'Two synthetic Ideas load with the declared active Idea and every durable Board class structurally present.',
    privacyClass: 'synthetic-public',
    data: SUPPORTED_PROFILE_SOURCE,
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'alpha-profile-v1-expected',
    kind: 'expected-result',
    targetSeam: 'profile-normalization',
    expectedObservableOutcome: 'The supported source maps to the Friends Alpha v1 logical Profile shape at revision 7.',
    privacyClass: 'synthetic-public',
    data: ALPHA_PROFILE_V1,
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'malformed-profile-input',
    kind: 'input',
    targetSeam: 'profile-validation',
    expectedObservableOutcome: 'Malformed input is rejected explicitly without creating an empty replacement Profile.',
    privacyClass: 'synthetic-public',
    data: { rawPayload: '{not valid json', expectedCode: 'malformed-json' },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'unsupported-future-profile',
    kind: 'input',
    targetSeam: 'profile-validation',
    expectedObservableOutcome: 'A future Profile version is refused with compatibility state rather than normalized down.',
    privacyClass: 'synthetic-public',
    data: { profile: { format: 'eido-profile', schemaVersion: 99, revision: 1, activeIdeaId: 'idea-future', ideas: [], boards: {} }, expectedCode: 'unsupported-profile-version' },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'reordered-serialization-input',
    kind: 'input',
    targetSeam: 'profile-normalization',
    expectedObservableOutcome: 'A concrete reordered Profile preserves logical IDs while its record-key serialization canonicalizes byte-for-byte.',
    privacyClass: 'synthetic-public',
    data: {
      profile: REORDERED_PROFILE_SOURCE,
      equivalentToCaseId: 'supported-multi-idea-source',
      expectedLogicalIds: {
        activeIdeaId: SUPPORTED_PROFILE_SOURCE.activeIdeaId,
        ideaIds: SUPPORTED_PROFILE_SOURCE.ideas.map((idea) => idea.id).sort(compareOrdinal),
        boardIds: Object.keys(SUPPORTED_PROFILE_SOURCE.boards).sort(compareOrdinal),
        mainCardIds: SYNTHETIC_MAIN_BOARD.cards.map((card) => card.id).sort(compareOrdinal),
      },
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'duplicate-and-missing-id-input',
    kind: 'input',
    targetSeam: 'profile-validation',
    expectedObservableOutcome: 'The feedable malformed Profile exposes both a duplicate Card ID and a Card without an ID.',
    privacyClass: 'synthetic-public',
    data: { profile: DUPLICATE_MISSING_ID_PROFILE, expectedCodes: ['duplicate-id', 'missing-id'] },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'missing-asset-reference-input',
    kind: 'input',
    targetSeam: 'asset-closure',
    expectedObservableOutcome: 'The concrete Profile contains logical image metadata with the declared asset bytes absent.',
    privacyClass: 'synthetic-public',
    data: { profile: MISSING_ASSET_PROFILE, missingAssetId: SYNTHETIC_PNG_ASSET.id },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'image-heavy-input',
    kind: 'input',
    targetSeam: 'asset-closure',
    expectedObservableOutcome: 'The concrete Profile carries 64 independently identified, valid synthetic PNG assets.',
    privacyClass: 'synthetic-public',
    data: { profile: IMAGE_HEAVY_PROFILE, assetCount: IMAGE_HEAVY_ASSETS.length },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'interrupted-write-input',
    kind: 'input',
    targetSeam: 'profile-transaction',
    expectedObservableOutcome: 'The prior and pending revisions are both feedable, while the interruption record selects revision 7 as visible.',
    privacyClass: 'synthetic-public',
    data: {
      prior: ALPHA_PROFILE_V1,
      pending: ALPHA_PROFILE_V1_REVISION_8,
      interruption: { phase: 'before-commit', retryableCommandId: 'command-synthetic-1' },
      expectedVisibleRevision: ALPHA_PROFILE_V1.revision,
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'future-declarative-mod-input',
    kind: 'input',
    targetSeam: 'profile-validation',
    expectedObservableOutcome: 'The fixture carries unknown declarative Mod fields for future compatibility tests; it certifies no runtime behavior.',
    privacyClass: 'synthetic-public',
    data: {
      template: {
        templateId: 'mod-future-template',
        modV2: {
          kind: 'select',
          title: 'Future-shaped synthetic Mod',
          accent: 'synthetic-future-accent',
          state: {
            picked: 0,
            options: [
              { id: 'option-future-a', label: 'A', frame: 'Choose A.' },
              { id: 'option-future-b', label: 'B', frame: 'Choose B.' },
            ],
          },
          treatOverride: null,
        },
        futureFields: { wires: [{ from: 'option-future-a', to: 'future-port' }], provenance: { source: 'synthetic' } },
      },
      stampedInstance: {
        instanceId: 'mod-stamp-future',
        templateId: 'mod-future-template',
        modV2: {
          kind: 'select',
          title: 'Future-shaped synthetic Mod',
          accent: 'synthetic-future-accent',
          state: {
            picked: 0,
            options: [
              { id: 'option-instance-a', label: 'A', frame: 'Choose A.' },
              { id: 'option-instance-b', label: 'B', frame: 'Choose B.' },
            ],
          },
          treatOverride: null,
        },
        frozen: true,
      },
      evidenceLevel: 'fixture-only',
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'settings-envelope-tolerant-read-input',
    kind: 'input',
    targetSeam: 'profile-validation',
    expectedObservableOutcome: 'A Card with an unknown settings key and a Card with foreign values under known keys both validate and hydrate with the envelope unchanged, each setting reading as its documented default; a Card holding the retired top-level Note scale and a Card holding the migrated scale in the envelope both read as the scale the person picked and both open under the pre-envelope validator; a Board carrying an unknown key and a foreign value in its AI settings, and a Board carrying its own settings envelope, both validate and hydrate unchanged with every unrecognised value reading as its documented default; only a settings envelope that is not a plain object is refused.',
    privacyClass: 'synthetic-public',
    data: {
      unknownKeyCard: SYNTHETIC_UNKNOWN_SETTINGS_CARD,
      foreignValueCard: SYNTHETIC_FOREIGN_SETTINGS_CARD,
      legacyFontSizeCard: SYNTHETIC_LEGACY_FONT_SIZE_CARD,
      migratedFontSizeCard: SYNTHETIC_MIGRATED_FONT_SIZE_CARD,
      malformedEnvelopeCard: SYNTHETIC_MALFORMED_SETTINGS_CARD,
      foreignBoardAiSettings: SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS,
      unknownBoardSettings: SYNTHETIC_UNKNOWN_BOARD_SETTINGS,
      expectedBoardAiRuntimeDefaults: { reasoningEffort: 'medium', compactionMode: 'when-needed' },
      expectedRuntimeDefaults: { reachMode: 'web', researchDepth: 'S', researchJob: null, noteFontSize: 2 },
      expectedMigratedNoteFontSize: 1,
      expectedLegacyNoteFontSize: 'large',
      expectedMalformedOutcome: 'refused',
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'atomic-transaction-rollback-scenario',
    kind: 'scenario',
    targetSeam: 'profile-transaction',
    expectedObservableOutcome: 'A future adapter can inject failure before commit and compare the visible result exactly with the revision-7 input.',
    privacyClass: 'synthetic-public',
    data: {
      before: ALPHA_PROFILE_V1,
      attempted: ALPHA_PROFILE_V1_REVISION_8,
      command: { id: 'command-synthetic-1', expectedRevision: 7, actorId: 'actor-synthetic', clientTxnId: 'txn-synthetic-3' },
      injectFailureAt: 'before-commit',
      expected: ALPHA_PROFILE_V1,
      evidenceLevel: 'fixture-only',
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'wal-reload-scenario',
    kind: 'scenario',
    targetSeam: 'profile-reload',
    expectedObservableOutcome: 'A future WAL adapter can write and reopen the same revision-8 logical Profile against this vector.',
    privacyClass: 'synthetic-public',
    data: { written: ALPHA_PROFILE_V1_REVISION_8, expectedReopened: ALPHA_PROFILE_V1_REVISION_8, journalMode: 'wal', evidenceLevel: 'fixture-only' },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'busy-lock-scenario',
    kind: 'scenario',
    targetSeam: 'profile-ownership',
    expectedObservableOutcome: 'A future ownership adapter can admit owner A and return stable busy for owner B against revision 7.',
    privacyClass: 'synthetic-public',
    data: {
      profile: ALPHA_PROFILE_V1,
      requests: [
        { ownerId: 'owner-a', mode: 'mutable', expectedOutcome: 'acquired' },
        { ownerId: 'owner-b', mode: 'mutable', expectedOutcome: 'busy' },
      ],
      evidenceLevel: 'fixture-only',
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'corruption-recovery-scenario',
    kind: 'scenario',
    targetSeam: 'profile-recovery',
    expectedObservableOutcome: 'A future recovery adapter can choose the newest complete verified candidate and report the corrupt candidate.',
    privacyClass: 'synthetic-public',
    data: {
      candidates: [
        { id: 'revision-7', profile: ALPHA_PROFILE_V1, complete: true, digestValid: true },
        { id: 'revision-8-corrupt', profile: ALPHA_PROFILE_V1_REVISION_8, complete: false, digestValid: false },
      ],
      expectedSelectedId: 'revision-7',
      expectedRejectedIds: ['revision-8-corrupt'],
      evidenceLevel: 'fixture-only',
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'portable-export-import-restore-duplicate-scenario',
    kind: 'scenario',
    targetSeam: 'portable-export',
    expectedObservableOutcome: 'Future export, import, restore, and Duplicate adapters share one complete synthetic logical/archive vector.',
    privacyClass: 'synthetic-public',
    data: {
      archive: PORTABLE_MAIN_IDEA_EXPORT,
      manifest: {
        format: 'eido-portable',
        version: 1,
        logicalIds: PORTABLE_LOGICAL_IDS,
        assets: [{ id: SYNTHETIC_PNG_ASSET.id, sha256: SYNTHETIC_PNG_SHA256, size: SYNTHETIC_PNG_ASSET.size }],
        excludedPhysicalState: ['wal', 'locks', 'caches', 'credentials', 'derived-indexes'],
      },
      import: { targetProfileId: 'profile-fresh', expectedIdeaId: SYNTHETIC_MAIN_IDEA.id },
      restore: { currentRevision: 8, sourceRevision: 7, expectedNewRevision: 9 },
      duplicate: {
        sourceIdeaId: SYNTHETIC_MAIN_IDEA.id,
        targetIdeaId: 'idea-main-copy',
        remapIds: Object.fromEntries(PORTABLE_CLOSURE_IDS.map((id) => [id, `${id}-copy`] as const)),
      },
      evidenceLevel: 'fixture-only',
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'agent-gateway-allow-deny-scenario',
    kind: 'scenario',
    targetSeam: 'agent-gateway',
    expectedObservableOutcome: 'Future gateways can feed attributed domain commands and compare explicit admission or denial without raw persistence access.',
    privacyClass: 'synthetic-public',
    data: {
      requests: [
        {
          command: { version: 1, id: 'gateway-card-create', type: 'card.create', expectedRevision: 7, actorId: 'agent-synthetic', clientTxnId: 'gateway-txn-1', payload: { ideaId: SYNTHETIC_MAIN_IDEA.id, card: { ...SYNTHETIC_NOTE_CARD, id: 'card-gateway-created' } } },
          expected: { admitted: true, nextRevision: 8 },
        },
        {
          command: { version: 1, id: 'gateway-connection-create', type: 'connection.create', expectedRevision: 8, actorId: 'agent-synthetic', clientTxnId: 'gateway-txn-2', payload: { ideaId: SYNTHETIC_MAIN_IDEA.id, connection: { ...SYNTHETIC_CONNECTIONS[0], id: 'connection-gateway-created' } } },
          expected: { admitted: true, nextRevision: 9 },
        },
        { command: { version: 1, id: 'gateway-raw-storage', type: 'raw-storage', expectedRevision: 9, actorId: 'agent-synthetic', clientTxnId: 'gateway-txn-3', payload: { statement: 'synthetic statement' } }, expected: { admitted: false, code: 'capability-denied' } },
        { command: { version: 1, id: 'gateway-generic-patch', type: 'generic-patch', expectedRevision: 9, actorId: 'agent-synthetic', clientTxnId: 'gateway-txn-4', payload: { path: '/synthetic', value: 'synthetic' } }, expected: { admitted: false, code: 'capability-denied' } },
      ],
      evidenceLevel: 'fixture-only',
    },
  },
  {
    schemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION,
    id: 'macos-arm64-windows-x64-evidence-scenario',
    kind: 'scenario',
    targetSeam: 'platform-evidence',
    expectedObservableOutcome: 'The same fixture inputs are enumerated for future native runs on macOS arm64 and Windows x64; neither entry claims a pass.',
    privacyClass: 'synthetic-public',
    data: {
      platformEvidence: [
        { platform: 'macos-arm64', fixtureSchemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION, fixtureIds: ['supported-multi-idea-source', 'wal-reload-scenario'], evidenceKind: 'input-vector', certified: false },
        { platform: 'windows-x64', fixtureSchemaVersion: PROFILE_FIXTURE_SCHEMA_VERSION, fixtureIds: ['supported-multi-idea-source', 'wal-reload-scenario'], evidenceKind: 'input-vector', certified: false },
      ],
      evidenceLevel: 'fixture-only',
    },
  },
] as const satisfies readonly ProfileFixtureDefinition<unknown>[]

export type ProfileFixtureCase = (typeof profileFixtureCorpus)[number]
export type ProfileFixtureId = ProfileFixtureCase['id']

export const SAVED_BOARD_SCHEMA_FIXTURE_IDS: Record<SavedBoard['version'], ProfileFixtureId> = {
  1: 'supported-multi-idea-source',
}

export type AlphaProfileSchemaVersion = ShippedAlphaProfile['schemaVersion']
export const ALPHA_PROFILE_SCHEMA_FIXTURE_IDS: Record<AlphaProfileSchemaVersion, ProfileFixtureId> = {
  1: 'alpha-profile-v1-expected',
}

const REQUIRED_CASE_COVERAGE: Record<ProfileFixtureId, true> = {
  'supported-multi-idea-source': true,
  'alpha-profile-v1-expected': true,
  'malformed-profile-input': true,
  'unsupported-future-profile': true,
  'reordered-serialization-input': true,
  'duplicate-and-missing-id-input': true,
  'missing-asset-reference-input': true,
  'image-heavy-input': true,
  'interrupted-write-input': true,
  'future-declarative-mod-input': true,
  'settings-envelope-tolerant-read-input': true,
  'atomic-transaction-rollback-scenario': true,
  'wal-reload-scenario': true,
  'busy-lock-scenario': true,
  'corruption-recovery-scenario': true,
  'portable-export-import-restore-duplicate-scenario': true,
  'agent-gateway-allow-deny-scenario': true,
  'macos-arm64-windows-x64-evidence-scenario': true,
}

const CASE_DATA_VALIDATORS: Record<ProfileFixtureId, (data: unknown) => boolean> = {
  'supported-multi-idea-source': isSupportedProfileShape,
  'alpha-profile-v1-expected': isAlphaProfileV1Shape,
  'malformed-profile-input': (data) => isRecord(data) && typeof data.rawPayload === 'string' && data.expectedCode === 'malformed-json',
  'unsupported-future-profile': (data) => isRecord(data) && isRecord(data.profile) && data.profile.schemaVersion === 99 && data.expectedCode === 'unsupported-profile-version',
  'reordered-serialization-input': isReorderedFixtureData,
  'duplicate-and-missing-id-input': isDuplicateMissingFixtureData,
  'missing-asset-reference-input': isMissingAssetFixtureData,
  'image-heavy-input': isImageHeavyFixtureData,
  'interrupted-write-input': (data) => isRecord(data) && isAlphaProfileV1Shape(data.prior) && isAlphaProfileV1Shape(data.pending) && isRecord(data.interruption) && data.interruption.phase === 'before-commit' && data.expectedVisibleRevision === 7,
  'future-declarative-mod-input': (data) => isRecord(data)
    && isRecord(data.template)
    && data.template.templateId === 'mod-future-template'
    && isValidMod(data.template.modV2)
    && isRecord(data.stampedInstance)
    && data.stampedInstance.templateId === data.template.templateId
    && isValidMod(data.stampedInstance.modV2)
    && data.evidenceLevel === 'fixture-only',
  'settings-envelope-tolerant-read-input': (data) => isRecord(data)
    && isCardWithSettingsEnvelope(data.unknownKeyCard)
    && isCardWithSettingsEnvelope(data.foreignValueCard)
    && isCardWithSettingsEnvelope(data.migratedFontSizeCard)
    && isRecord(data.legacyFontSizeCard)
    && data.legacyFontSizeCard.fontSize === data.expectedLegacyNoteFontSize
    && data.legacyFontSizeCard.meta === undefined
    && isRecord(data.malformedEnvelopeCard)
    && Array.isArray(data.malformedEnvelopeCard.meta)
    && isRecord(data.expectedRuntimeDefaults)
    && isRecord(data.foreignBoardAiSettings)
    && data.foreignBoardAiSettings.reasoningEffort === 'ultra'
    && isRecord(data.foreignBoardAiSettings.futureRunKnob)
    && isRecord(data.unknownBoardSettings)
    && isRecord(data.expectedBoardAiRuntimeDefaults)
    && data.expectedMalformedOutcome === 'refused',
  'atomic-transaction-rollback-scenario': (data) => isRecord(data) && isAlphaProfileV1Shape(data.before) && isAlphaProfileV1Shape(data.attempted) && isAlphaProfileV1Shape(data.expected) && isRecord(data.command) && data.injectFailureAt === 'before-commit' && data.evidenceLevel === 'fixture-only',
  'wal-reload-scenario': (data) => isRecord(data) && isAlphaProfileV1Shape(data.written) && isAlphaProfileV1Shape(data.expectedReopened) && data.journalMode === 'wal' && data.evidenceLevel === 'fixture-only',
  'busy-lock-scenario': (data) => isRecord(data) && isAlphaProfileV1Shape(data.profile) && Array.isArray(data.requests) && data.requests.length === 2 && data.evidenceLevel === 'fixture-only',
  'corruption-recovery-scenario': (data) => isRecord(data) && Array.isArray(data.candidates) && data.candidates.length === 2 && data.expectedSelectedId === 'revision-7' && data.evidenceLevel === 'fixture-only',
  'portable-export-import-restore-duplicate-scenario': isPortableFixtureData,
  'agent-gateway-allow-deny-scenario': isGatewayFixtureData,
  'macos-arm64-windows-x64-evidence-scenario': (data) => isRecord(data) && Array.isArray(data.platformEvidence) && data.evidenceLevel === 'fixture-only',
}

export function canonicalProfileFixtureCorpusJson(corpus: readonly ProfileFixtureCase[] = profileFixtureCorpus): string {
  const sortedCorpus = [...corpus].sort((left, right) => compareOrdinal(left.id, right.id))
  return JSON.stringify(canonicalizeJsonValue(sortedCorpus))
}

export function validateProfileFixtureCorpus(
  corpus: readonly ProfileFixtureCase[] = profileFixtureCorpus,
): ProfileFixtureValidationIssue[] {
  const issues: ProfileFixtureValidationIssue[] = []
  const seenIds = new Set<string>()
  const knownSeams = new Set<string>(Object.keys(PROFILE_FIXTURE_SEAM_COVERAGE))
  const knownKinds = new Set<string>(Object.keys(PROFILE_FIXTURE_KIND_COVERAGE))

  const scan = inspectJsonTree(corpus)
  if (!scan.validJson) addIssue(issues, 'invalid-json-value', undefined, 'Fixture corpus values must be finite, plain JSON without accessors, symbols, holes, cycles, or serialization hooks.')
  if (scan.privateMaterial) addIssue(issues, 'private-material', undefined, 'Fixture corpus contains a private-path or credential-shaped value, including decoded data-URL bytes.')
  if (scan.executableContent) addIssue(issues, 'executable-mod-content', undefined, 'Fixture corpus contains executable-shaped content, including decoded data-URL bytes.')
  if (scan.validJson) {
    try {
      const roundTripped = JSON.parse(JSON.stringify(corpus)) as unknown
      if (JSON.stringify(canonicalizeJsonValue(roundTripped)) !== JSON.stringify(canonicalizeJsonValue(corpus))) {
        addIssue(issues, 'invalid-json-value', undefined, 'Fixture corpus must round-trip through JSON without observable change.')
      }
    } catch {
      addIssue(issues, 'invalid-json-value', undefined, 'Fixture corpus must serialize and parse as JSON.')
    }
  }

  for (const fixture of corpus as ReadonlyArray<ProfileFixtureDefinition<unknown>>) {
    if (typeof fixture.id === 'string' && seenIds.has(fixture.id)) addIssue(issues, 'duplicate-case-id', fixture.id, 'Fixture case IDs must be unique.')
    if (typeof fixture.id === 'string') seenIds.add(fixture.id)
    if (
      fixture.schemaVersion !== PROFILE_FIXTURE_SCHEMA_VERSION
      || typeof fixture.id !== 'string'
      || fixture.id.length === 0
      || !(fixture.id in REQUIRED_CASE_COVERAGE)
      || typeof fixture.expectedObservableOutcome !== 'string'
      || fixture.expectedObservableOutcome.length === 0
      || !knownSeams.has(fixture.targetSeam)
      || !knownKinds.has(fixture.kind)
      || fixture.privacyClass !== 'synthetic-public'
    ) {
      addIssue(issues, 'invalid-case-metadata', typeof fixture.id === 'string' ? fixture.id : undefined, 'Every fixture needs schema v1, a known seam and kind, an observable outcome, and the synthetic privacy class.')
    }
    const validator = CASE_DATA_VALIDATORS[fixture.id as ProfileFixtureId]
    if (validator) {
      let validCaseData = false
      try {
        validCaseData = validator(fixture.data)
      } catch {
        validCaseData = false
      }
      if (!validCaseData) addIssue(issues, 'invalid-case-data', fixture.id, 'Fixture data does not match the concrete scenario contract for its case ID.')
    }
  }

  for (const requiredId of Object.keys(REQUIRED_CASE_COVERAGE) as ProfileFixtureId[]) {
    if (!seenIds.has(requiredId)) addIssue(issues, 'missing-required-case', requiredId, 'Required Profile corpus case is absent.')
  }

  const source = corpus.find((fixture) => fixture.id === 'supported-multi-idea-source') as ProfileFixtureCase | undefined
  const sourceData = source?.data as unknown
  validateSupportedSource(source?.id, sourceData, issues)
  validatePlatformEvidence(corpus, issues)
  return issues
}

function validateSupportedSource(caseId: string | undefined, value: unknown, issues: ProfileFixtureValidationIssue[]) {
  if (!isSupportedProfileShape(value)) {
    addIssue(issues, 'invalid-active-idea', caseId, 'Supported source must be a concrete eido-v3 Profile source.')
    return
  }
  const ideaIds = new Set(value.ideas.map((idea) => idea.id))
  if (!ideaIds.has(value.activeIdeaId)) addIssue(issues, 'invalid-active-idea', caseId, 'Supported source active Idea must exist in its Idea list.')
  for (const durableClass of Object.keys(PROFILE_DURABLE_CLASS_COVERAGE) as DurableBoardClass[]) {
    if (!value.durableClasses.includes(durableClass)) addIssue(issues, 'missing-durable-class', caseId, `Supported source is missing durable class ${durableClass}.`)
  }
  for (const ideaId of ideaIds) {
    const board = value.boards[ideaId]
    if (!board) addIssue(issues, 'missing-board-reference', caseId, `Idea ${ideaId} has no Board.`)
    else if (!isSavedBoardShape(board)) addIssue(issues, 'missing-durable-structure', caseId, `Idea ${ideaId} does not contain a SavedBoard-shaped record.`)
    else validateBoard(caseId, ideaId, board, issues)
  }
  const mainBoard = value.boards[SYNTHETIC_MAIN_IDEA.id]
  if (!isSavedBoardShape(mainBoard)) {
    addIssue(issues, 'missing-board-reference', caseId, 'The synthetic main Idea has no Board.')
    return
  }
  for (const durableClass of Object.keys(PROFILE_DURABLE_STRUCTURE_CHECKS) as DurableBoardClass[]) {
    if (!PROFILE_DURABLE_STRUCTURE_CHECKS[durableClass](mainBoard)) addIssue(issues, 'missing-durable-structure', caseId, `Supported source has no structural ${durableClass} fixture.`)
  }
}

function validateBoard(caseId: string | undefined, ideaId: string, board: SavedBoard, issues: ProfileFixtureValidationIssue[]) {
  const cards = Array.isArray(board.cards) ? board.cards as unknown[] : []
  const cardById = new Map<string, Record<string, unknown>>()
  const blockIdsByCard = new Map<string, Set<string>>()
  const assetIds = new Set<string>()

  for (const cardValue of cards) {
    if (!isRecord(cardValue) || typeof cardValue.id !== 'string' || cardValue.id.length === 0 || cardById.has(cardValue.id)) {
      addIssue(issues, 'duplicate-or-missing-id', caseId, `Board ${ideaId} contains a duplicate or missing Card ID.`)
      continue
    }
    cardById.set(cardValue.id, cardValue)
    if (typeof cardValue.kind !== 'string' || !(cardValue.kind in CARD_KIND_COVERAGE)) addIssue(issues, 'invalid-closed-enum', caseId, `Board ${ideaId} contains an unknown Card kind.`)
    if (cardValue.kind === 'mod' && (!isValidMod(cardValue.modV2) || cardValue.mod !== undefined)) {
      addIssue(issues, 'invalid-closed-enum', caseId, `Mod Card ${cardValue.id} does not contain one current v2 Mod document.`)
    }
    const blockIds = new Set<string>()
    if (!Array.isArray(cardValue.blocks)) addIssue(issues, 'missing-durable-structure', caseId, `Card ${cardValue.id} has no block collection.`)
    for (const block of Array.isArray(cardValue.blocks) ? cardValue.blocks : []) {
      if (!isRecord(block) || typeof block.id !== 'string' || block.id.length === 0 || blockIds.has(block.id)) addIssue(issues, 'duplicate-or-missing-id', caseId, `Card ${cardValue.id} contains a duplicate or missing Block ID.`)
      else blockIds.add(block.id)
    }
    blockIdsByCard.set(cardValue.id, blockIds)
    if (cardValue.groupId !== undefined) {
      const group = typeof cardValue.groupId === 'string' ? cards.find((candidate) => isRecord(candidate) && candidate.id === cardValue.groupId) : undefined
      if (!isRecord(group) || group.kind !== 'group') addIssue(issues, 'invalid-connection-reference', caseId, `Card ${cardValue.id} references a missing group Card.`)
    }
    for (const asset of Array.isArray(cardValue.assets) ? cardValue.assets : []) validateAsset(caseId, ideaId, asset, assetIds, issues)
  }

  const connectionIds = new Set<string>()
  for (const connection of Array.isArray(board.connections) ? board.connections as unknown[] : []) {
    if (!isRecord(connection) || typeof connection.id !== 'string' || connection.id.length === 0 || connectionIds.has(connection.id)) {
      addIssue(issues, 'duplicate-or-missing-id', caseId, `Board ${ideaId} contains a duplicate or missing Connection ID.`)
      continue
    }
    connectionIds.add(connection.id)
    if (
      typeof connection.strength !== 'string' || !(connection.strength in CONNECTION_STRENGTH_COVERAGE)
      || typeof connection.polarity !== 'string' || !(connection.polarity in CONNECTION_POLARITY_COVERAGE)
      || typeof connection.role !== 'string' || !(connection.role in CONNECTION_ROLE_COVERAGE)
    ) addIssue(issues, 'invalid-closed-enum', caseId, `Connection ${connection.id} contains unknown closed-enum metadata.`)
    if (!anchorExists(connection.from, cardById, blockIdsByCard) || !anchorExists(connection.to, cardById, blockIdsByCard)) addIssue(issues, 'invalid-connection-reference', caseId, `Connection ${connection.id} references a missing Card or Card-local Block.`)
  }

  const outputs = Array.isArray(board.outputs) ? board.outputs as unknown[] : []
  const runs = Array.isArray(board.runs) ? board.runs as unknown[] : []
  const runById = new Map<string, Record<string, unknown>>()
  for (const run of runs) {
    if (!isRecord(run) || typeof run.id !== 'string' || run.id.length === 0 || runById.has(run.id)) addIssue(issues, 'duplicate-or-missing-id', caseId, `Board ${ideaId} contains a duplicate or missing Run ID.`)
    else runById.set(run.id, run)
  }
  const versionById = new Map<string, { version: Record<string, unknown>; output: Record<string, unknown> }>()
  const outputIds = new Set<string>()

  for (const output of outputs) {
    if (!isRecord(output) || typeof output.id !== 'string' || output.id.length === 0 || outputIds.has(output.id)) {
      addIssue(issues, 'duplicate-or-missing-id', caseId, `Board ${ideaId} contains a duplicate or missing Output ID.`)
      continue
    }
    outputIds.add(output.id)
    if (typeof output.resultCardId !== 'string' || cardById.get(output.resultCardId)?.kind !== 'result' || !Array.isArray(output.versions)) {
      addIssue(issues, 'invalid-output-reference', caseId, 'Every Output must reference a result Card and carry versions.')
      continue
    }
    for (const version of output.versions) {
      if (!isRecord(version) || typeof version.id !== 'string' || versionById.has(version.id)) {
        addIssue(issues, 'invalid-output-reference', caseId, `Output ${output.id} has a duplicate or missing version ID.`)
        continue
      }
      versionById.set(version.id, { version, output })
    }
    if (typeof output.chosenVersionId !== 'string' || !output.versions.some((version) => isRecord(version) && version.id === output.chosenVersionId)) addIssue(issues, 'invalid-output-reference', caseId, `Output ${output.id} must choose one of its versions.`)
  }

  for (const [versionId, { version }] of versionById) {
    if (typeof version.fromRunId !== 'string' || !runById.has(version.fromRunId)) addIssue(issues, 'invalid-output-reference', caseId, `Version ${versionId} must reference an existing producing Run.`)
    for (const message of Array.isArray(version.transcript) ? version.transcript : []) {
      if (!isRecord(message) || message.speakerKind !== 'participant' || typeof message.participantCardId !== 'string' || cardById.get(message.participantCardId)?.kind !== 'askAi') addIssue(issues, 'invalid-output-reference', caseId, `Transcript participant in ${versionId} must reference an Ask AI Card.`)
    }
  }

  for (const runValue of runs) validateRun(caseId, runValue, cardById, connectionIds, versionById, issues)
  const eventIds = new Set<string>()
  let previousSequence = 0
  for (const event of Array.isArray(board.intentLog) ? board.intentLog as unknown[] : []) {
    if (!isRecord(event) || typeof event.id !== 'string' || event.id.length === 0 || eventIds.has(event.id)) addIssue(issues, 'duplicate-or-missing-id', caseId, `Board ${ideaId} contains a duplicate or missing Intent event ID.`)
    else eventIds.add(event.id)
    validateIntentEvent(caseId, event, cardById, runById, issues)
    if (isRecord(event) && typeof event.seq === 'number') {
      if (!Number.isInteger(event.seq) || event.seq <= previousSequence) addIssue(issues, 'invalid-intent-reference', caseId, 'Intent event sequence numbers must increase strictly.')
      previousSequence = event.seq
    }
  }

  const tagIds = new Set<string>()
  for (const tag of Array.isArray(board.highlightTags) ? board.highlightTags as unknown[] : []) {
    if (!isRecord(tag) || typeof tag.id !== 'string' || tag.id.length === 0 || tagIds.has(tag.id)) addIssue(issues, 'duplicate-or-missing-id', caseId, `Board ${ideaId} contains a duplicate or missing highlight tag ID.`)
    else tagIds.add(tag.id)
  }
  const highlightIds = new Set<string>()
  for (const highlight of Array.isArray(board.highlights) ? board.highlights as unknown[] : []) {
    if (!isRecord(highlight) || typeof highlight.id !== 'string' || highlight.id.length === 0 || highlightIds.has(highlight.id)) addIssue(issues, 'duplicate-or-missing-id', caseId, `Board ${ideaId} contains a duplicate or missing Highlight ID.`)
    else highlightIds.add(highlight.id)
    if (!isRecord(highlight) || typeof highlight.cardId !== 'string' || !cardById.has(highlight.cardId) || typeof highlight.tagId !== 'string' || !tagIds.has(highlight.tagId)) addIssue(issues, 'invalid-highlight-reference', caseId, 'Highlights must reference existing Cards and tags.')
  }
  for (const summary of Array.isArray(board.compactionSummaries) ? board.compactionSummaries as unknown[] : []) {
    if (!isRecord(summary) || typeof summary.cardId !== 'string' || !cardById.has(summary.cardId)) addIssue(issues, 'invalid-compaction-reference', caseId, 'Compaction summaries must reference existing Cards.')
  }
}

function validateAsset(
  caseId: string | undefined,
  ideaId: string,
  value: unknown,
  seenIds: Set<string>,
  issues: ProfileFixtureValidationIssue[],
) {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || seenIds.has(value.id)) {
    addIssue(issues, 'invalid-asset-reference', caseId, `Board ${ideaId} has a duplicate or missing asset ID.`)
    return
  }
  seenIds.add(value.id)
  if (typeof value.kind !== 'string' || !(value.kind in CARD_ASSET_KIND_COVERAGE)) addIssue(issues, 'invalid-closed-enum', caseId, `Asset ${value.id} has an unknown kind.`)
  if (typeof value.mimeType !== 'string' || typeof value.dataUrl !== 'string' || typeof value.size !== 'number' || !Number.isInteger(value.size) || value.size < 0 || typeof value.createdAt !== 'string') {
    addIssue(issues, 'invalid-asset-reference', caseId, `Asset ${value.id} is missing bytes or durable metadata.`)
    return
  }
  const decoded = decodeBase64DataUrl(value.dataUrl)
  if (!decoded || decoded.mimeType !== value.mimeType || decoded.bytes.length !== value.size) {
    addIssue(issues, 'invalid-asset-reference', caseId, `Asset ${value.id} bytes must decode and match MIME and size metadata.`)
    return
  }
  if (value.mimeType === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    const signatureMatches = signature.every((byte, index) => decoded.bytes[index] === byte)
    const width = readUint32Be(decoded.bytes, 16)
    const height = readUint32Be(decoded.bytes, 20)
    if (!signatureMatches || (typeof value.width === 'number' && value.width !== width) || (typeof value.height === 'number' && value.height !== height)) addIssue(issues, 'invalid-asset-reference', caseId, `PNG asset ${value.id} must carry PNG bytes matching declared dimensions.`)
  }
}

function validateRun(
  caseId: string | undefined,
  value: unknown,
  cardById: Map<string, Record<string, unknown>>,
  connectionIds: Set<string>,
  versionById: Map<string, { version: Record<string, unknown>; output: Record<string, unknown> }>,
  issues: ProfileFixtureValidationIssue[],
) {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.askAiCardId !== 'string' || typeof value.status !== 'string' || !(value.status in RUN_STATUS_COVERAGE)) {
    addIssue(issues, 'invalid-run-reference', caseId, 'Run records require IDs, a target Card, and a known status.')
    return
  }
  const kind = value.kind === undefined ? 'ask' : value.kind
  if (typeof kind !== 'string' || !(kind in RUN_KIND_COVERAGE)) addIssue(issues, 'invalid-closed-enum', caseId, `Run ${value.id} has an unknown kind.`)
  const expectedTargetKind = kind === 'conversation' ? 'conversation' : kind === 'groupDigest' ? 'group' : 'askAi'
  if (cardById.get(value.askAiCardId)?.kind !== expectedTargetKind) addIssue(issues, 'invalid-run-reference', caseId, `Run ${value.id} target Card does not match its run kind.`)
  if (!Array.isArray(value.usedCardIds) || value.usedCardIds.some((id) => typeof id !== 'string' || !cardById.has(id))) addIssue(issues, 'invalid-run-reference', caseId, `Run ${value.id} references missing input Cards.`)
  if (!Array.isArray(value.usedConnectionIds) || value.usedConnectionIds.some((id) => typeof id !== 'string' || !connectionIds.has(id))) addIssue(issues, 'invalid-run-reference', caseId, `Run ${value.id} references missing Connections.`)
  if (!Array.isArray(value.modIds) || value.modIds.some((id) => typeof id !== 'string' || cardById.get(id)?.kind !== 'mod')) addIssue(issues, 'invalid-run-reference', caseId, `Run ${value.id} references missing Mod Cards.`)
  if (value.status === 'done' && (typeof value.finishedAt !== 'string' || typeof value.producedVersionId !== 'string' || versionById.get(value.producedVersionId)?.version.fromRunId !== value.id)) addIssue(issues, 'invalid-run-reference', caseId, `Done Run ${value.id} must point to its produced version and finish time.`)
  if (kind === 'conversation') validateConversationProvenance(caseId, value.id, value.conversation, cardById, issues)
}

function validateConversationProvenance(
  caseId: string | undefined,
  runId: string,
  value: unknown,
  cardById: Map<string, Record<string, unknown>>,
  issues: ProfileFixtureValidationIssue[],
) {
  if (!isRecord(value) || !isRecord(value.settings) || !Array.isArray(value.participants) || !Array.isArray(value.sharedContext) || !Array.isArray(value.topLevelMods) || !Array.isArray(value.turns)) {
    addIssue(issues, 'invalid-run-reference', caseId, `Conversation Run ${runId} lacks frozen provenance.`)
    return
  }
  const participantIds = new Set<string>()
  for (const participant of value.participants) {
    if (!isRecord(participant) || typeof participant.cardId !== 'string' || cardById.get(participant.cardId)?.kind !== 'askAi') addIssue(issues, 'invalid-run-reference', caseId, `Conversation Run ${runId} has an invalid participant.`)
    else participantIds.add(participant.cardId)
  }
  if (value.sharedContext.some((entry) => !isRecord(entry) || typeof entry.cardId !== 'string' || !cardById.has(entry.cardId))) addIssue(issues, 'invalid-run-reference', caseId, `Conversation Run ${runId} has invalid shared context.`)
  if (value.topLevelMods.some((entry) => !isRecord(entry) || typeof entry.cardId !== 'string' || cardById.get(entry.cardId)?.kind !== 'mod')) addIssue(issues, 'invalid-run-reference', caseId, `Conversation Run ${runId} has invalid Mod provenance.`)
  if (value.turns.some((turn) => !isRecord(turn) || typeof turn.participantCardId !== 'string' || !participantIds.has(turn.participantCardId))) addIssue(issues, 'invalid-run-reference', caseId, `Conversation Run ${runId} has a turn outside its participant set.`)
}

function validateIntentEvent(
  caseId: string | undefined,
  value: unknown,
  cardById: Map<string, Record<string, unknown>>,
  runById: Map<string, Record<string, unknown>>,
  issues: ProfileFixtureValidationIssue[],
) {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.at !== 'string' || typeof value.type !== 'string' || !(value.type in INTENT_EVENT_TYPE_COVERAGE) || !hasCausalIntentMetadata(value as unknown as IntentLogEvent)) {
    addIssue(issues, 'invalid-intent-reference', caseId, 'Intent events require a known type plus durable causal metadata.')
    return
  }
  if (value.type === 'card.created') {
    if (typeof value.cardId !== 'string' || !cardById.has(value.cardId) || !isRecord(value.data) || !isRecord(value.data.card) || value.data.card.id !== value.cardId) addIssue(issues, 'invalid-intent-reference', caseId, 'card.created must carry the created Card matching cardId.')
  }
  if (value.type === 'run.completed') {
    if (typeof value.runId !== 'string' || !runById.has(value.runId) || !isRecord(value.data) || !isRecord(value.data.run) || value.data.run.id !== value.runId) addIssue(issues, 'invalid-intent-reference', caseId, 'run.completed must carry the completed Run matching runId.')
  }
}

function validatePlatformEvidence(corpus: readonly ProfileFixtureCase[], issues: ProfileFixtureValidationIssue[]) {
  const platformCase = corpus.find((fixture) => fixture.id === 'macos-arm64-windows-x64-evidence-scenario') as ProfileFixtureCase | undefined
  const data = platformCase?.data as unknown
  const evidence = isRecord(data) && Array.isArray(data.platformEvidence) ? data.platformEvidence : []
  const required = new Set(['macos-arm64', 'windows-x64'])
  for (const entry of evidence) {
    if (
      !isRecord(entry)
      || typeof entry.platform !== 'string'
      || !required.has(entry.platform)
      || entry.fixtureSchemaVersion !== PROFILE_FIXTURE_SCHEMA_VERSION
      || !Array.isArray(entry.fixtureIds)
      || !entry.fixtureIds.includes('supported-multi-idea-source')
      || entry.evidenceKind !== 'input-vector'
      || entry.certified !== false
    ) continue
    required.delete(entry.platform)
  }
  if (required.size > 0) addIssue(issues, 'missing-platform-evidence', platformCase?.id, 'Both native platforms require structured unexecuted input-vector evidence; literals or pass claims are insufficient.')
}

type JsonInspection = { validJson: boolean; privateMaterial: boolean; executableContent: boolean }

function inspectJsonTree(value: unknown): JsonInspection {
  const result: JsonInspection = { validJson: true, privateMaterial: false, executableContent: false }
  inspectJsonNode(value, new Set<object>(), result)
  return result
}

function inspectJsonNode(value: unknown, ancestors: Set<object>, result: JsonInspection) {
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') {
    inspectString(value, result)
    if (value.startsWith('data:')) {
      const decoded = decodeBase64DataUrl(value)
      if (decoded) inspectString(new TextDecoder().decode(decoded.bytes), result)
      else result.validJson = false
    }
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) result.validJson = false
    return
  }
  if (typeof value !== 'object') {
    result.validJson = false
    return
  }
  if (ancestors.has(value)) {
    result.validJson = false
    return
  }
  let prototype: object | null
  let keys: (string | symbol)[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    result.validJson = false
    return
  }
  if (Array.isArray(value)) {
    if (keys.some((key) => typeof key === 'symbol') || Object.keys(value).length !== value.length) result.validJson = false
  } else if (prototype !== Object.prototype && prototype !== null) {
    result.validJson = false
  }
  ancestors.add(value)
  for (const key of keys) {
    if (key === 'length' && Array.isArray(value)) continue
    if (typeof key !== 'string') {
      result.validJson = false
      continue
    }
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      result.validJson = false
      continue
    }
    if (!descriptor || !('value' in descriptor)) {
      result.validJson = false
      continue
    }
    if (descriptor.enumerable !== true) result.validJson = false
    inspectString(key, result)
    inspectJsonNode(descriptor.value, ancestors, result)
  }
  ancestors.delete(value)
}

function inspectString(value: string, result: JsonInspection) {
  const privatePatterns = [
    /(?:^|[\\/])\.eido(?:[\\/]|$)/i,
    /(?:^|[\\/])Users[\\/][^\\/]+/i,
    /private-user-home/i,
    /api[_-]?key/i,
    /authorization\s*:/i,
    /bearer\s+[a-z0-9._-]+/i,
    /(?:^|[^a-z0-9])sk-[a-z0-9_-]{8,}/i,
    /(?:access|refresh|auth)[_-]?token\s*[=:]/i,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
  ]
  const executablePatterns = [
    /<script\b/i,
    /javascript\s*:/i,
    /\bfunction\s*(?:[a-z_$][\w$]*)?\s*\(/i,
    /\beval\s*\(/i,
    /\brequire\s*\(/i,
    /\bimport\s*\(/i,
    /\bchild_process\b/i,
    /\bprocess\.(?:env|binding|mainModule)\b/i,
  ]
  if (privatePatterns.some((pattern) => pattern.test(value))) result.privateMaterial = true
  if (executablePatterns.some((pattern) => pattern.test(value))) result.executableContent = true
}

function canonicalizeJsonValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
  if (typeof value !== 'object') throw new TypeError('Canonical JSON accepts only plain JSON values.')
  if (ancestors.has(value)) throw new TypeError('Canonical JSON rejects cycles.')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map((entry) => canonicalizeJsonValue(entry, ancestors))
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Canonical JSON rejects non-plain objects.')
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort(compareOrdinal)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) throw new TypeError('Canonical JSON rejects accessors.')
      result[key] = canonicalizeJsonValue(descriptor.value, ancestors)
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function decodeBase64DataUrl(value: string): { mimeType: string; bytes: Uint8Array } | null {
  if (!value.startsWith('data:')) return null
  const commaIndex = value.indexOf(',')
  if (commaIndex < 0) return null

  const metadataParts = value.slice(5, commaIndex).split(';')
  const mimeType = metadataParts.shift()?.trim() || 'text/plain'
  if (metadataParts.pop()?.trim().toLowerCase() !== 'base64') return null
  if (metadataParts.some((parameter) => parameter.trim().length === 0)) return null

  let encoded = value.slice(commaIndex + 1).replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null
  if (encoded.includes('=') && encoded.length % 4 !== 0) return null
  const remainder = encoded.length % 4
  if (remainder === 1) return null
  if (remainder > 0) encoded += '='.repeat(4 - remainder)
  try {
    const decoded = atob(encoded)
    return { mimeType, bytes: Uint8Array.from(decoded, (character) => character.charCodeAt(0)) }
  } catch {
    return null
  }
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  if (bytes.length < offset + 4) return -1
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function anchorExists(
  value: unknown,
  cardById: Map<string, Record<string, unknown>>,
  blockIdsByCard: Map<string, Set<string>>,
): boolean {
  if (!isRecord(value) || typeof value.cardId !== 'string' || !cardById.has(value.cardId)) return false
  return value.blockId === undefined || (typeof value.blockId === 'string' && blockIdsByCard.get(value.cardId)?.has(value.blockId) === true)
}

function hasCausalIntentMetadata(event: IntentLogEvent): boolean {
  return typeof event.commitId === 'string'
    && typeof event.actorId === 'string'
    && typeof event.clientTxnId === 'string'
    && typeof event.seq === 'number'
    && Number.isInteger(event.seq)
}

function isReorderedFixtureData(data: unknown): boolean {
  if (!isRecord(data) || !isSupportedProfileShape(data.profile) || data.equivalentToCaseId !== 'supported-multi-idea-source' || !isRecord(data.expectedLogicalIds)) return false
  const expected = data.expectedLogicalIds
  return expected.activeIdeaId === data.profile.activeIdeaId
    && stringArraysEqual(expected.ideaIds, data.profile.ideas.map((idea) => idea.id).sort(compareOrdinal))
    && stringArraysEqual(expected.boardIds, Object.keys(data.profile.boards).sort(compareOrdinal))
    && stringArraysEqual(expected.mainCardIds, data.profile.boards[SYNTHETIC_MAIN_IDEA.id]?.cards.map((card) => card.id).sort(compareOrdinal))
}

function isDuplicateMissingFixtureData(data: unknown): boolean {
  if (!isRecord(data) || !isRecord(data.profile) || !Array.isArray(data.expectedCodes) || !data.expectedCodes.includes('duplicate-id') || !data.expectedCodes.includes('missing-id')) return false
  const board = mainBoardRecord(data.profile)
  if (!board || !Array.isArray(board.cards)) return false
  const ids = board.cards.filter(isRecord).map((card) => card.id).filter((id): id is string => typeof id === 'string')
  return ids.length !== new Set(ids).size && board.cards.some((card) => !isRecord(card) || typeof card.id !== 'string')
}

function isMissingAssetFixtureData(data: unknown): boolean {
  if (!isRecord(data) || !isRecord(data.profile) || typeof data.missingAssetId !== 'string') return false
  const board = mainBoardRecord(data.profile)
  if (!board || !Array.isArray(board.cards)) return false
  const assets = board.cards.filter(isRecord).flatMap((card) => Array.isArray(card.assets) ? card.assets : [])
  return assets.some((asset) => isRecord(asset) && asset.id === data.missingAssetId && !Object.prototype.hasOwnProperty.call(asset, 'dataUrl'))
}

function isImageHeavyFixtureData(data: unknown): boolean {
  if (!isRecord(data) || !isSupportedProfileShape(data.profile) || typeof data.assetCount !== 'number') return false
  const board = data.profile.boards[SYNTHETIC_MAIN_IDEA.id]
  if (!board) return false
  const assets = board.cards.flatMap((card) => card.assets ?? [])
  return assets.length === data.assetCount
    && new Set(assets.map((asset) => asset.id)).size === assets.length
    && assets.every((asset) => asset.kind === 'image' && asset.mimeType === 'image/png' && decodeBase64DataUrl(asset.dataUrl)?.bytes.length === asset.size)
}

function isPortableFixtureData(data: unknown): boolean {
  if (!isRecord(data)) return false
  const archive = data.archive
  const manifest = data.manifest
  const duplicate = data.duplicate
  if (!isRecord(archive) || !isRecord(archive.board) || !isRecord(manifest) || !isRecord(manifest.logicalIds) || !isRecord(duplicate) || data.evidenceLevel !== 'fixture-only') return false
  const remapIds = duplicate.remapIds
  if (!isRecord(remapIds)) return false
  const board = archive.board as unknown as SavedBoard
  if (!Array.isArray(board.cards) || !Array.isArray(board.connections) || !Array.isArray(board.outputs) || !Array.isArray(board.runs)) return false
  const expectedIds = portableLogicalIdsForBoard(board)
  if (JSON.stringify(canonicalizeJsonValue(manifest.logicalIds)) !== JSON.stringify(canonicalizeJsonValue(expectedIds))) return false
  const closureIds = [...new Set(Object.values(expectedIds).flat())]
  if (!closureIds.every((id) => remapIds[id] === `${id}-copy`)) return false
  const assets = Array.isArray(manifest.assets) ? manifest.assets : []
  return assets.some((asset) => isRecord(asset) && asset.id === SYNTHETIC_PNG_ASSET.id && asset.sha256 === SYNTHETIC_PNG_SHA256 && asset.size === SYNTHETIC_PNG_ASSET.size)
}

function isGatewayFixtureData(data: unknown): boolean {
  if (!isRecord(data) || !Array.isArray(data.requests) || data.requests.length !== 4 || data.evidenceLevel !== 'fixture-only') return false
  const observed = new Map<string, Record<string, unknown>>()
  for (const request of data.requests) {
    if (!isRecord(request) || !isRecord(request.command) || !isRecord(request.expected)) return false
    const command = request.command
    if (
      command.version !== 1
      || typeof command.id !== 'string'
      || typeof command.type !== 'string'
      || typeof command.expectedRevision !== 'number'
      || typeof command.actorId !== 'string'
      || typeof command.clientTxnId !== 'string'
      || !isRecord(command.payload)
    ) return false
    observed.set(command.type, request.expected)
  }
  return observed.get('card.create')?.admitted === true
    && observed.get('connection.create')?.admitted === true
    && observed.get('raw-storage')?.admitted === false
    && observed.get('raw-storage')?.code === 'capability-denied'
    && observed.get('generic-patch')?.admitted === false
    && observed.get('generic-patch')?.code === 'capability-denied'
}

function portableLogicalIdsForBoard(board: SavedBoard): typeof PORTABLE_LOGICAL_IDS {
  return {
    ideaIds: [SYNTHETIC_MAIN_IDEA.id],
    cardIds: board.cards.map((card) => card.id),
    blockIds: board.cards.flatMap((card) => card.blocks.map((block) => block.id)),
    assetIds: board.cards.flatMap((card) => (card.assets ?? []).map((asset) => asset.id)),
    connectionIds: board.connections.map((connection) => connection.id),
    outputIds: board.outputs.map((output) => output.id),
    versionIds: board.outputs.flatMap((output) => output.versions.map((version) => version.id)),
    messageIds: board.outputs.flatMap((output) => output.versions.flatMap((version) => [
      ...(version.transcript ?? []).map((message) => message.id),
      ...(version.followUpThread?.messages ?? []).map((message) => message.id),
    ])),
    runIds: board.runs.map((run) => run.id),
    intentEventIds: (board.intentLog ?? []).map((event) => event.id),
    highlightIds: (board.highlights ?? []).map((highlight) => highlight.id),
    highlightTagIds: (board.highlightTags ?? []).map((tag) => tag.id),
  }
}

function mainBoardRecord(profile: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(profile.boards)) return null
  const board = profile.boards[SYNTHETIC_MAIN_IDEA.id]
  return isRecord(board) ? board : null
}

function stringArraysEqual(left: unknown, right: unknown): boolean {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => typeof value === 'string' && value === right[index])
}

function isSupportedProfileShape(value: unknown): value is SupportedProfileSource {
  return isRecord(value)
    && value.format === 'eido-v3'
    && value.version === 1
    && typeof value.activeIdeaId === 'string'
    && Array.isArray(value.durableClasses)
    && Array.isArray(value.ideas)
    && value.ideas.every(isIdeaSummary)
    && isRecord(value.boards)
}

function isAlphaProfileV1Shape(value: unknown): value is AlphaProfileV1 {
  return isRecord(value)
    && value.format === 'eido-profile'
    && value.schemaVersion === 1
    && typeof value.revision === 'number'
    && Number.isInteger(value.revision)
    && typeof value.activeIdeaId === 'string'
    && Array.isArray(value.ideas)
    && value.ideas.every(isIdeaSummary)
    && isRecord(value.boards)
    && isRecord(value.source)
    && value.source.kind === 'copy-first-eido-v3'
    && typeof value.source.copiedAt === 'string'
}

function isIdeaSummary(value: unknown): value is IdeaSummary {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.lastOpenedAt === 'string'
}

function isSavedBoardShape(value: unknown): value is SavedBoard {
  return isRecord(value)
    && value.version === 1
    && typeof value.updatedAt === 'string'
    && Array.isArray(value.cards)
    && Array.isArray(value.connections)
    && Array.isArray(value.outputs)
    && Array.isArray(value.runs)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCardWithSettingsEnvelope(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.kind === 'string'
    && value.kind in CARD_KIND_COVERAGE
    && Array.isArray(value.blocks)
    && isRecord(value.meta)
    && Object.keys(value.meta).length > 0
}

function addIssue(
  issues: ProfileFixtureValidationIssue[],
  code: ProfileFixtureValidationCode,
  caseId: string | undefined,
  detail: string,
) {
  if (!issues.some((issue) => issue.code === code)) issues.push({ code, ...(caseId ? { caseId } : {}), detail })
}
