import type { Mod } from '../mods/model'
import type { ModValuesSnapshot } from '../mods/snapshot'
import type { LocalHtmlPreview } from '../shared/localHtmlPreview'
import type { AiProvider, ProviderModelSettingsMap } from '../brain/aiProviderTypes'
import type { RunToolStep } from '../brain/agenticRun'
import type { ProviderRouteProvenance } from './providerRouteProvenance'
import type { SettingsEnvelope } from '../persistence/settingsEnvelope'

export type { AiProvider } from '../brain/aiProviderTypes'
export type { RunToolStep } from '../brain/agenticRun'

// The one property graph (Concept 1). The user never meets any of these words —
// the canvas boundary and shared/words.ts translate everything into plain language.

export type CardKind = 'note' | 'askAi' | 'result' | 'mod' | 'group' | 'conversation' | 'title'

export type ActorKind = 'user' | 'agent' | 'system'

/**
 * Durable identity stamped by a trusted commit seam. `client` is display
 * data declared by the connecting client; only `kind` is a trust claim.
 */
export type CardAuthorship = Readonly<{
  kind: ActorKind
  client: string
  sessionId: string
}>

// ---- Conversation: the room and the schedule (orchestration card) --------------
// A Conversation owns a shared topic, a Style, and how many turns each scheduled
// participant gets. Incoming Ask AI cards become participants; incoming Notes and
// Results become Shared Conversation Context; incoming Mods become top-level
// guidance. The Conversation never speaks — only participants write the transcript.

export type ConversationStyle = 'debate' | 'critique' | 'interview' | 'collaborate'

export const CONVERSATION_STYLES: ConversationStyle[] = [
  'debate',
  'critique',
  'interview',
  'collaborate',
]

export type ConversationSettings = {
  topic: string // the shared subject every participant discusses
  style: ConversationStyle
  turnsPerParticipant: number
}

export type CardHeaderFill = 'half' | 'full' | 'pattern'

// Where a Card's text came from, when the user did not write it themselves. Set
// when Eido reads a web page onto the board; absent on everything else, and
// absence is never backfilled. A source is a snapshot record, not a live link:
// nothing re-fetches it, so `retrievedAt` is the honest age of the text.
export type CardSource = {
  url: string
  retrievedAt: string
  title?: string
}

// A page that has been read and is ready to land on the board. The retrieval
// boundary produces it; the store turns it into a Note.
export type WebNotePage = {
  title: string
  url: string
  markdown: string
  retrievedAt: string
}

export type BlockKind = 'line' | 'heading' | 'bullet' | 'generated'

// A note's content is an ordered list of blocks even though the first editor feels
// like a plain text area. This leaves room for line-level connections later; for
// now line identity is best-effort.
export type Block = {
  id: string
  text: string
  kind?: BlockKind
}

export type CardAssetKind = 'image' | 'file'

export type CardAsset = {
  id: string
  kind: CardAssetKind
  name: string
  mimeType: string
  dataUrl: string
  // Binary byte size of the image/file encoded inside dataUrl (for compressed
  // images: the compressed bytes, not the original pasted file). Distinct from
  // the storage budget, which is measured on the dataUrl string itself.
  size: number
  createdAt: string
  // Optional compression metadata (#247). Assets saved before the compression
  // pipeline shipped lack all of these and must stay loadable as-is.
  width?: number
  height?: number
  originalSize?: number
  originalMimeType?: string
  compression?: 'compressed'
}

export type LinkPreviewStatus = 'loading' | 'ready' | 'fallback'

export type LinkPreview = Readonly<{
  url: string
  status: LinkPreviewStatus
  title?: string
  description?: string
  siteName?: string
}>

// ---- Card: the thing on the board ----------------------------------------------

export type Card = {
  id: string
  kind: CardKind
  // Absent on pre-authorship Cards. Absence is preserved and interpreted as
  // user-created work rather than backfilled with invented provenance.
  createdBy?: CardAuthorship
  lastModifiedBy?: CardAuthorship
  title?: string
  headerColor?: string
  headerFill?: CardHeaderFill
  blocks: Block[]
  assets?: CardAsset[]
  // note only: the FIRST web URL this Note previews, and its durable preview.
  // Every shipped build's Profile validator knows this exact key, so it stays
  // where it is and keeps meaning what it always meant.
  linkPreview?: LinkPreview
  // note only: previews two and up, what the founder dismissed, and which
  // addresses have already been tried all live in the settings envelope below,
  // not here. See shared/linkPreview.ts. A new top-level Card key does not make
  // an older build ignore one setting, it makes that build refuse the whole
  // Profile revision, which is what the envelope exists to prevent (ADR 0040).
  // Read a Note's previews through noteLinkPreviews().
  localHtmlPreview?: LocalHtmlPreview // note only: an opaque local source plus static snapshot
  compressionPrompt?: string // group only: how the digest should be written
  modV2?: Mod
  model?: string // askAi only: the AI model this card runs with (else the default)
  // conversation only: the Style and turns-per-participant. The shared topic lives
  // in the card's blocks (the body editor), like a note's text.
  conversationStyle?: ConversationStyle
  conversationTurns?: number
  // note only: the body text scale lives in the settings envelope below, not
  // here. See graph/noteFontSize.ts. The retired top-level `fontSize` field is
  // still accepted by the persistence validator so Profiles that already
  // carry it keep opening, but nothing writes it.
  source?: CardSource // note only: the web page this card's text was read from
  // askAi only: an Agentic Run, in which the model may call tools rather than
  // answering from the compiled instruction alone (ADR 0033). Absent = off.
  agentic?: boolean
  zIndex?: number // durable layer order inside its safe card class
  position: { x: number; y: number }
  size?: { width: number; height: number }
  groupId?: string // a group container, when we add them (left as room)
  meta?: Record<string, unknown>
}

// ---- Highlights: visual emphasis the user paints over card text -----------------
// A highlight never changes the card's text and never reaches AI context. It is a
// saved pointer: "this text, on that card, under this tag". Tags carry the color.

export type HighlightTag = {
  id: string
  name: string
  color: string // a palette id from graph/highlights.ts (e.g. 'yellow'), picked for the user
  createdAt: string
}

export type Highlight = {
  id: string
  cardId: string
  tagId: string
  text: string // the exact text that was highlighted, as the user saw it
  occurrence: number // which match of `text` within the card's readable text (0-based)
  createdAt: string
}

// ---- Connection: where the meaning lives (Concept 2) ---------------------------

export type Anchor = {
  cardId: string
  blockId?: string // absent = whole card (v3 default); present = a specific line (later)
}

export type ConnectionStrength = 'strong' | 'weak'
export type ConnectionPolarity = 'helps' | 'pushesAgainst'
export type ConnectionRole = 'feeds' | 'modifies'
export type ConnectionGroupMode = 'full' | 'compress'

export type Connection = {
  id: string
  from: Anchor // directed: from feeds/modifies to
  to: Anchor
  strength: ConnectionStrength // magnitude (refinement)
  polarity: ConnectionPolarity // tension; user-facing words are Helps/Avoid (ADR 0018)
  role: ConnectionRole // plain arrow (feeds) vs the wireframe's coil (modifies)
  // Why this path was rejected (Avoid connections). Additive: absent = no
  // reason; older saves stay valid with no migration.
  reason?: string
  meta?: {
    contextOrder?: number
    groupMode?: ConnectionGroupMode
    [key: string]: unknown
  }
}

// ---- Outputs & versions: the idea is never final (Concept 5) -------------------

export type SourceContextFingerprint = {
  cardId: string
  kind: CardKind
  label: string
  groupMode?: ConnectionGroupMode
  hash: string
}

export type SourceContextSnapshot = {
  version: 1
  sources: SourceContextFingerprint[]
}

// One message in a Conversation transcript. The transcript is the source of truth
// for a Conversation Result; the UI only renders it (Concept 5).
export type TranscriptSpeakerKind = 'participant' | 'user'

export type TranscriptMessage = {
  id: string
  speakerKind: TranscriptSpeakerKind
  speakerName: string
  participantCardId?: string // present for AI participants
  text: string
  turnNumber?: number // participant turn number (per participant); absent for user
  streaming?: boolean // true while this message is still being written
}

export type FollowUpRole = 'user' | 'assistant'

export type FollowUpStatus = 'complete' | 'streaming' | 'stopped' | 'failed'

export type FollowUpMessage = {
  id: string
  role: FollowUpRole
  text: string
  createdAt: string
  status: FollowUpStatus
  // What this reply looked up, when the run it continues was an Agentic Run.
  // Recorded per message rather than per version, because each follow-up is its
  // own piece of research and the reader needs to know which answer rests on
  // what. Same shape and same open vocabulary as a run's own steps (ADR 0035).
  toolSteps?: RunToolStep[]
}

export type FollowUpThread = {
  messages: FollowUpMessage[]
  collapsed?: boolean
}

export type OutputVersion = {
  id: string
  number: number // v1, v2, v3…
  text: string
  createdAt: string
  fromRunId: string
  digestKey?: string // group digest versions: prompt + member text fingerprint
  accepted?: boolean // kept is an independent latch, not the version currently viewed
  // Conversation Result versions carry a structured transcript. A version that was
  // canceled or failed mid-run is kept as a Provisional Version.
  transcript?: TranscriptMessage[]
  provisional?: boolean
  provisionalReason?: 'canceled' | 'failed'
  provisionalMessage?: string // hover detail for the small error indicator
  followUpThread?: FollowUpThread
  sourceContext?: SourceContextSnapshot
  sourceChangeDismissedSignature?: string
}

export type Output = {
  id: string
  resultCardId: string
  versions: OutputVersion[]
  chosenVersionId?: string // the version currently viewed
}

// ---- Run record: what happened, and from what (Concept 5) ----------------------

type AppliedModCommon = {
  modCardId: string
  // Conversation-only attribution for a Mod scoped to one participant.
  // Absent means the Mod applies to the whole run.
  participantCardId?: string
  appliedInstructions: string[]
}

export type LegacyAppliedMod = AppliedModCommon & {
  // Absent on legacy records so their persisted byte shape does not change.
  modVersion?: never
  controlValues: Record<string, unknown>
}

export type V2AppliedMod = AppliedModCommon & {
  modVersion: 2
  controlValues: ModValuesSnapshot
}

export type AppliedMod = LegacyAppliedMod | V2AppliedMod

export type RunStatus = 'running' | 'done' | 'failed' | 'canceled'

export type RunKind = 'ask' | 'groupDigest' | 'conversation'

export type ReasoningEffort = 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none'

// One stored vocabulary for every provider, ordered from least thinking to
// most. Vendors name their rungs differently; those names are display words
// chosen at the Settings boundary, so nothing saved with an Idea ever depends
// on which CLI was selected when it was saved.
export const REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

// Which rungs each provider actually exposes. A provider/model with no rung
// for a step omits that step; the remaining rungs keep their order and place.
//
// Claude Code dropped its 'none' rung on 2026-08-20. Eido builds its command
// with '--effort', which has no off value, so choosing Off sent 'low' and the
// control promised something it could not deliver. The CLI does document a
// separate '--no-thinking' flag; offering Off again means wiring that flag,
// not restoring this entry.
const REASONING_EFFORTS_BY_PROVIDER: Readonly<Record<AiProvider, readonly ReasoningEffort[]>> = {
  openrouter: REASONING_EFFORTS,
  'claude-code': ['low', 'medium', 'high', 'xhigh'],
  codex: ['low', 'medium', 'high', 'xhigh'],
  antigravity: ['low', 'medium', 'high'],
}

// `gemini-3.1-pro` does not advertise a medium rung in `agy`; the provider
// still exposes the complete AGY ladder for Flash, while the Settings picker
// narrows itself to the selected model's actual CLI vocabulary.
const ANTIGRAVITY_EFFORTS_BY_MODEL: Readonly<Record<string, readonly ReasoningEffort[]>> = {
  'gemini-3.7-flash': ['low', 'medium', 'high'],
  'gemini-3.1-pro': ['low', 'high'],
}

export function reasoningEffortsFor(provider: AiProvider, model?: string): readonly ReasoningEffort[] {
  if (provider === 'antigravity' && model) {
    return ANTIGRAVITY_EFFORTS_BY_MODEL[model] ?? REASONING_EFFORTS_BY_PROVIDER[provider]
  }
  return REASONING_EFFORTS_BY_PROVIDER[provider]
}

// A saved choice a provider cannot show still has to land somewhere: step to
// the nearest rung rather than leave the control with nothing selected. Ties
// go up the ladder, so a missing 'minimal' reads as 'low', never as 'off'.
export function nearestReasoningEffort(
  provider: AiProvider,
  effort: ReasoningEffort,
  model?: string,
): ReasoningEffort {
  const available = reasoningEffortsFor(provider, model)
  if (available.includes(effort)) return effort
  const target = REASONING_EFFORTS.indexOf(effort)
  const distance = (candidate: ReasoningEffort) => Math.abs(REASONING_EFFORTS.indexOf(candidate) - target)
  return available.reduce((best, candidate) => (distance(candidate) <= distance(best) ? candidate : best))
}

// How Eido handles context that outgrows a model's budget (ADR 0015):
// 'never' leaves text full and trims with a note, 'when-needed' shortens the
// weakest parts once the budget is hit, 'eager' always shortens weak links.
export type CompactionMode = 'never' | 'when-needed' | 'eager'

export const COMPACTION_MODES: CompactionMode[] = ['never', 'when-needed', 'eager']

export const DEFAULT_CHAIN_CONFIRM_THRESHOLD = 2
export const DEFAULT_COMPACTION_MODE: CompactionMode = 'when-needed'

export type BoardAiSettings = {
  model: string
  models: string[]
  reasoningEffort: ReasoningEffort
  // Absent on older Boards, which always used OpenRouter. Local harness
  // selection is kept with the Idea so its model choice remains reproducible.
  provider?: AiProvider
  // Provider-specific catalogs preserve each harness's model selection when
  // the user switches providers. Absent on older Boards.
  providerModels?: ProviderModelSettingsMap
  // Idea-level guidance injected only at the AI network boundary. Optional so
  // saves from before the setting existed keep loading unchanged.
  systemPrompt?: string
  // Ask before a chain run triggers more than this many extra steps (ADR 0014).
  // Optional so older saves load; normalization fills the default.
  chainConfirmThreshold?: number
  compactionMode?: CompactionMode
}

// What a Conversation run remembers, so its Context view can explain the transcript
// without re-deriving it: the settings, who spoke, the shared inputs, the top-level
// Mods, and the exact per-turn instruction behind each message.
export type ConversationParticipantRecord = {
  cardId: string
  name: string
  model: string
  role: string // the participant's own Ask AI instruction
  // Guidance connected to this participant's source card. Optional so
  // conversation provenance saved before participant scoping remains valid.
  participantMods?: ConversationModRecord[]
}

export type ConversationModRecord = {
  cardId: string
  label: string
  instructions: string[]
}

export type ConversationTurnRecord = {
  speakerName: string
  participantCardId: string
  currentTurn: number
  totalTurns: number
  instruction: string // the exact text sent for this turn
}

export type ConversationProvenance = {
  settings: ConversationSettings
  participants: ConversationParticipantRecord[]
  sharedContext: { cardId: string; label: string; text: string }[]
  topLevelMods: ConversationModRecord[]
  turns: ConversationTurnRecord[]
}

// Trusted attribution for Runs initiated through the Agent execution gateway.
// Absence is intentionally the legacy/user-origin form. This is supplied by the
// execution boundary, never compiled from card or request content.
export type AgentRunAttribution = Readonly<{
  kind: 'agent'
  client: string
  sessionId: string
}>

export type RunRecord = {
  id: string
  startedAt: string
  finishedAt?: string
  askAiCardId: string
  model: string // the AI model this run used — traced back per version
  provider?: AiProvider // absent = OpenRouter for runs recorded before local harnesses
  usedCardIds: string[] // exactly what the compiler included
  usedConnectionIds: string[]
  usedGroupDigests?: { groupCardId: string; versionId: string; connectionId: string }[]
  modIds: string[]
  appliedMods: AppliedMod[]
  compiledInstruction: string // the EXACT text sent — powers "show what AI used"
  producedVersionId?: string
  status: RunStatus
  triggeredBy?: AgentRunAttribution
  aiAccessPhases?: readonly ProviderRouteProvenance[]
  errorMessage?: string
  kind?: RunKind // absent = 'ask' (kept for older saves)
  conversation?: ConversationProvenance
  // What the context budget did to this run (ADR 0015). Absent = nothing was
  // shortened or left out. Never silent: this powers the result marker.
  contextBudget?: RunContextBudget
  // The chain plan this run executed under (#139, lean form). Present only on
  // chain-target runs; single runs record nothing extra. Stripped from intent
  // log clones to keep saves bounded.
  plan?: ExecutionPlanRecord
  // What the model did during an Agentic Run: what it searched for, which pages
  // it opened. Absent = it used no tools. Kept with the produced version so an
  // answer can be traced to what it read. Page text is never stored: the
  // address is the provenance and the answer is the content. Stripped from
  // intent log clones, like plans, so a long run cannot amplify the save.
  toolSteps?: RunToolStep[]
  // Whether this run was allowed to call tools at all, which is not the same
  // question as whether it used any. A follow-up continues the run it hangs
  // off, so it needs the run's own answer rather than the Card's current
  // switch, which the user may have flipped since. Absent = not agentic, so a
  // Board written here still opens in a build that never heard of the flag.
  agentic?: true
}

export type RunContextBudget = {
  budgetTokens: number
  estimatedTokens: number
  finalTokens: number
  compactedCardIds: string[]
  droppedCardIds: string[]
  mode: CompactionMode
}

// The lean, serializable shape of an execution plan (ADR 0013): step ids,
// kinds, card ids, dependencies, policy names — never copied card content.
// Recorded on chain runs (#139) so provenance can show a chain's shape.
export type ExecutionStepRecord = {
  id: string
  kind: 'ask' | 'groupDigest'
  cardId: string
  dependsOn: string[]
  connectionId?: string
  contextPolicy?: { name: string; version: number }
}

export type ExecutionPlanRecord = {
  version: 1
  rootCardId: string
  steps: ExecutionStepRecord[]
}

// A cached compaction summary (ADR 0015): a card compacts once and is reused
// until its text or the boundary-injected Idea system prompt changes.
export type CompactionSummary = {
  cardId: string
  fingerprint: string
  summary: string
  model: string
  createdAt: string
}

// ---- Intent log: append-only history for timeline-style projections -----------

type IntentEventBase = {
  id: string
  at: string
  ideaId?: string
  // Causal metadata stamped by the commit funnel (ADR 0016). Optional so
  // events appended before the funnel existed — and older saves — stay valid.
  commitId?: string
  actorId?: string
  clientTxnId?: string
  seq?: number
}

export type IntentClaimedTransitionEvidence = {
  version: 1
  count: number
  sha256: string
}

export type IntentLogEvent =
  | (IntentEventBase & {
      type: 'card.created'
      cardId: string
      data: {
        card: Card
        sourceCardId?: string
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'group.created'
      cardId: string
      data: {
        card: Card
        memberChanges?: Record<string, { from?: string; to?: string }>
      }
    })
  | (IntentEventBase & {
      type: 'card.deleted'
      cardId: string
      data: {
        card: Card
        connections: Connection[]
        memberIds?: string[]
        outputs?: Output[]
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'card.moved'
      cardId: string
      data: {
        moves: Array<{
          cardId: string
          from: Card['position']
          to: Card['position']
          previousGroupId?: string
          nextGroupId?: string
        }>
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'card.resized'
      cardId: string
      data: {
        from?: Card['size']
        to?: Card['size']
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'cards.arranged'
      cardId: string
      data: {
        changes: Array<{
          cardId: string
          before: {
            position: Card['position']
            size?: Card['size']
            groupId?: string
          }
          after: {
            position: Card['position']
            size?: Card['size']
            groupId?: string
          }
        }>
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'card.layer.changed'
      cardId: string
      data: {
        direction: 'front' | 'back'
        changes: Array<{ cardId: string; from?: number; to: number }>
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'card.content.edited'
      cardId: string
      data:
        | {
             field:
               | 'body'
               | 'title'
               | 'groupPrompt'
               | 'modControl'
               | 'conversationSettings'
             textLength?: number
             contentSha256?: string
             claimedTransitionEvidence?: IntentClaimedTransitionEvidence
           }
        | {
            field: 'model' | 'identity'
            claimedTransitionEvidence?: IntentClaimedTransitionEvidence
          }
        | {
            field: 'assets'
            action: 'add' | 'remove'
            assetId: string
            claimedTransitionEvidence?: IntentClaimedTransitionEvidence
          }
    })
  | (IntentEventBase & {
      type: 'group.members.changed'
      cardId: string
      data: {
        memberChanges: Record<string, { from?: string; to?: string }>
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'connection.created'
      connectionId: string
      data: {
        connection: Connection
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'connection.deleted'
      connectionId: string
      data: {
        connection: Connection
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'connection.changed'
      connectionId: string
      data: {
        before: Connection
        after: Connection
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      // 'run.continued' is the one legal transition OUT of a terminal status:
      // continuing a conversation reopens its run (issue #189), after which it
      // settles exactly once more.
      type: 'run.started' | 'run.continued' | 'run.completed' | 'run.failed' | 'run.canceled'
      runId: string
      data: { run: RunRecord; message?: string }
    })
  | (IntentEventBase & {
      type:
        | 'group.compression.started'
        | 'group.compression.completed'
        | 'group.compression.failed'
        | 'group.compression.canceled'
      cardId: string
      runId: string
      versionId?: string
      data: { run: RunRecord; message?: string }
    })
  | (IntentEventBase & {
      type: 'version.chosen'
      versionId: string
      data: {
        outputId: string
        previousVersionId?: string
        nextVersionId: string
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'version.acceptance.changed'
      versionId: string
      data: {
        outputId: string
        from: boolean
        to: boolean
        claimedTransitionEvidence?: IntentClaimedTransitionEvidence
      }
    })
  | (IntentEventBase & {
      type: 'version.note.created'
      versionId: string
      cardId: string
      data: {
        outputId?: string
        resultCardId?: string
        noteCardId: string
        source: 'version' | 'followup' | 'conversation'
        sourceMessageId?: string
        textLength: number
      }
    })
  | (IntentEventBase & {
      type: 'followup.message.added'
      versionId: string
      data: {
        outputId?: string
        resultCardId?: string
        message: FollowUpMessage
      }
    })
  | (IntentEventBase & {
      type: 'followup.message.finished'
      versionId: string
      data: {
        outputId?: string
        resultCardId?: string
        message: FollowUpMessage
      }
    })
  | (IntentEventBase & {
      type: 'followup.thread.cleared'
      versionId: string
      data: {
        outputId?: string
        resultCardId?: string
        previousMessages: FollowUpMessage[]
      }
    })

// What a call site hands to the commit funnel: the semantic event minus every
// field the funnel stamps (identity plus ADR 0016 causal metadata).
type WithoutIntentEventStamp<T> = T extends unknown
  ? Omit<T, 'id' | 'at' | 'ideaId' | 'commitId' | 'actorId' | 'clientTxnId' | 'seq'>
  : never
export type IntentLogEventDraft = WithoutIntentEventStamp<IntentLogEvent>

// ---- The whole saved board -----------------------------------------------------

export type SavedBoard = {
  version: 1
  cards: Card[]
  connections: Connection[]
  outputs: Output[]
  runs: RunRecord[]
  highlights?: Highlight[]
  highlightTags?: HighlightTag[]
  intentLog?: IntentLogEvent[]
  /** @deprecated — ignored since the zoom-bands epic (#300); retained so old saves parse and inspection tools stay honest. */
  visualDecayEnabled?: boolean
  aiSettings?: BoardAiSettings
  // The Board's settings envelope (ADR 0040): Board-level preferences that are
  // not AI settings. Open and tolerantly read, so a key from a build this one
  // has never met rides through untouched and never fails a Board. Read it
  // through the settings envelope helpers, never bare.
  settings?: SettingsEnvelope
  // Cached compaction summaries (ADR 0015); optional so older saves load.
  compactionSummaries?: CompactionSummary[]
  updatedAt: string
}

// ---- Ideas: local workspaces ---------------------------------------------------

export type IdeaSummary = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  // The Idea's settings envelope (ADR 0040), on the same terms as the Board's.
  settings?: SettingsEnvelope
}

export type IdeaExport = {
  version: 1
  exportedAt: string
  idea: IdeaSummary
  board: SavedBoard
}
