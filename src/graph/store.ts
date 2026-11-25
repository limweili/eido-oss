// The one graph (Concept 1). Everything reads and writes this single store; the
// canvas, the compiler, and the run engine are all just projections of it.

import { create } from 'zustand'
import type { Patch } from 'immer'
import type { InstalledKeychainBridge } from '../../electron/keychainBridgeContract'
import {
  DEFAULT_CONVERSATION_STYLE,
  DEFAULT_CONVERSATION_TURNS,
} from '../brain/conversationCompiler'
import { DEFAULT_COMPRESSION_PROMPT } from '../brain/groupDigestFreshness'
import { settleInterruptedFollowUps } from '../brain/followUpThread'
import { DEFAULT_MODEL, DEFAULT_MODEL_SLUGS, isOpenRouterSlug } from '../brain/models'
import {
  AI_PROVIDERS,
  DEFAULT_LOCAL_HARNESS_SETTINGS,
  defaultModelsForProvider,
  isAiProvider,
  replacementForRetiredProvider,
  isLocalHarness,
  type AiProvider,
  type LocalHarnessId,
  type LocalHarnessSettingsMap,
  type ProviderModelSettings,
  type ProviderModelSettingsMap,
} from '../brain/aiProviderTypes'
import { flattenTranscript } from '../brain/transcript'
import { RESEARCH_JOB_SETTING } from '../brain/researchJobMeta'
import {
  DEFAULT_RESEARCH_DEPTH,
  RESEARCH_DEPTH_SETTING,
  researchDepthOf,
} from '../brain/researchDepth'
import type { ResearchReasoningDepth } from '../brain/linkup'
import {
  REACH_MODE_SETTING,
  DEFAULT_REACH_MODE,
  reachModeOf,
  type ReachMode,
} from '../brain/reachMode'
import {
  clearSetting,
  hasSetting,
  setCardEnvelope,
  withCardEnvelope,
  writeSetting,
} from '../persistence/settingsEnvelope'
import type { SettingsEnvelope } from '../persistence/settingsEnvelope'
import { foreignBoardAiSettings, mergeForeignBoardAiSettings } from './boardAiSettings'
import {
  hasLegacyNoteFontSize,
  isNoteFontSize,
  noteFontSizeOf,
  NOTE_FONT_SIZE_SETTING,
  type NoteFontSize,
} from './noteFontSize'
import {
  attachmentPanelGrowth,
  type AttachmentPanelKind,
} from './attachmentPanelGrowth'
import { newId } from '../shared/ids'
import {
  firstWebUrlInText,
  linkPreviewAttempted,
  linkPreviewDismissed,
  LINK_PREVIEW_MAX_PER_NOTE,
  noteLinkPreviews,
  setNoteLinkPreviews,
  webUrlsInText,
  withLinkPreviewAttempt,
  withLinkPreviewDismissal,
} from '../shared/linkPreview'
import { parseProviderRouteProvenance } from './providerRouteProvenance'
import type {
  LocalHtmlPreviewCapture,
  LocalHtmlPreviewSource,
} from '../shared/localHtmlPreview'
import {
  isProfileReviewExecution,
  PROFILE_REVIEW_MODEL,
  resolveProfileReviewModel,
} from '../shared/profileReviewPolicy'
import { stableStringify } from '../shared/stableHash'
import { createSeedMod, normalizeMod, remapModPartIdentities } from '../mods'
import { availableProfileModTemplates } from '../persistence/profileBuiltInMods'
import { isProfileIntentActorId } from '../persistence/profileIntentActor'
import {
  DEFAULT_HIGHLIGHT_TAG_NAME,
  HIGHLIGHT_PALETTE,
  findTagByName,
  makeHighlightTag,
  migrateLegacyHighlights,
} from './highlights'
import {
  createIdea as createSavedIdea,
  currentStorageStatus,
  deleteIdea as deleteSavedIdea,
  emptyBoard,
  listIdeas,
  loadIdea as loadSavedIdea,
  loadInitialIdea,
  makeDebouncedSaver,
  makeSavedBoard,
  renameIdea as renameSavedIdea,
  saveIdeaBoard,
  type DebouncedSaver,
  type StorageStatus,
} from './save'
import { cardTextFromBlocks } from './graphHelpers'
import { graphIndexForBoard, type BoardGraphIndex } from './graphIndex'
import { isAgentUnadoptedCard } from './cardAuthorship'
import { REASONING_EFFORTS, nearestReasoningEffort } from './types'
import {
  UNDO_RING_LIMIT,
  applyRingPatches,
  assignStructuralCardChanges,
  captureCommitPatches,
  getActorId,
  isPatchUndoEntry,
  stampIntentEvents,
  type BoardCommitState,
  type CommitResult,
  type PatchUndoEntry,
  type UndoEntry,
} from './commitFunnel'
import {
  loadRecommendedModelCatalogState,
  migrateLegacyRecommendedModelCatalog,
  normalizeRecommendedModelCatalog,
  replaceRecommendedModel,
  saveRecommendedModelCatalog,
} from '../ui/recommendedModelCatalog'
import {
  deriveBoardChange,
  type BoardChangeEmission,
  type BoardChangeSource,
} from './boardChange'
import {
  applyHistoryAction,
  cardUpdateAction,
  structuralEventDrafts,
  groupMembersReorderedAction,
  prepareActionForApply,
  type CardStructuralPatch,
  type CardHistoryKind,
  type HistoryAction,
  type HistoryBoardState,
  type HistoryEntry,
} from './history'
import {
  COMPACTION_MODES,
  DEFAULT_CHAIN_CONFIRM_THRESHOLD,
  DEFAULT_COMPACTION_MODE,
} from './types'
import { contractFor } from './contextContracts'
import { planConnectionAddition } from './connectionAddition'
import {
  canJoinGroup,
  cardSize,
  maxLayer,
  orderedByLayer,
  placeCreatedCard,
  reconcileGroupMembership,
  storedLayer,
} from './cardPlacement'
import {
  ProfileRendererPersistenceError,
  type ProfileRendererAuthoritativeApplyResult,
  type ProfileRendererAuthoritativeUpdate,
  type ProfileRendererCommitState,
  type ProfileRendererHydration,
  type ProfileRendererPersistence,
  type ProfileRendererPersistenceSelection,
  type ProfileRendererSaveStatus,
  type ProfileRendererTerminalFailure,
} from './profileRendererPersistence'
import {
  captureDirectProfileModOrigin,
  type ProfileModOriginCompanion,
} from './profileModOrigins'
import type { GuiNewModOrigin, GuiUserModTemplate } from '../persistence/profileGuiProjection'
import type { ProfileRecoveryPointSummary } from '../persistence/profileServiceContract'
import type { ResultPlacementContext } from './resultCardPlacement'
import { ensureResultCardFor, feedsConnection, repairAskToAskConnections } from './resultRouting'
import type {
  BoardAiSettings,
  CompactionMode,
  CompactionSummary,
  Card,
  CardAuthorship,
  CardKind,
  CardAsset,
  LinkPreview,
  Anchor,
  Connection,
  Highlight,
  HighlightTag,
  ConnectionGroupMode,
  ConnectionPolarity,
  ConnectionStrength,
  ConversationProvenance,
  ConversationStyle,
  ConversationTurnRecord,
  FollowUpMessage,
  FollowUpStatus,
  IdeaSummary,
  IntentLogEvent,
  IntentLogEventDraft,
  Output,
  OutputVersion,
  RunContextBudget,
  RunRecord,
  RunToolStep,
  SavedBoard,
  WebNotePage,
  ReasoningEffort,
  SourceContextSnapshot,
  TranscriptMessage,
} from './types'
import {
  isInstalledKeychainBridge,
  loadApiCredential,
  loadLinkupCredential,
} from './apiCredential'

// A pasted address lands as a Markdown link, so the Note reads as the thing it
// points at rather than as a naked url, and the body keeps one unambiguous
// address for the preview to follow. The composed body is checked against the
// same reader the previews use: if it would not read back as this exact url,
// the plain text the founder pasted is kept instead.
function noteBodyForPastedLink(url: string, text: string): string {
  const labelled = `[${text}](${url})`
  return firstWebUrlInText(labelled) === url ? labelled : text
}

function sameLinkPreview(left: LinkPreview, right: LinkPreview): boolean {
  return left.url === right.url
    && left.status === right.status
    && left.title === right.title
    && left.description === right.description
    && left.siteName === right.siteName
}

export type SaveState = 'saving' | 'saved' | 'failed'

export type ProfileStartupState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'recovery-required'
  | 'failed'

// What's currently selected on the board — drives the side panel. Not part of the
// saved board.
export type Selection =
  | { kind: 'card'; id: string }
  | { kind: 'connection'; id: string }
  | null

export type CanvasTool = 'select' | 'pan' | 'highlight'

const DEFAULT_CANVAS_TOOL: CanvasTool = 'select'

// A one-shot "take me there" request; the canvas consumes it by centering on the
// card. requestId distinguishes repeated jumps to the same card.
export type CardFocusRequest = {
  cardId: string
  requestId: number
}

type Settings = {
  apiKey: string
  // The Linkup credential. Optional in the type, like every setting added after
  // the first, and absent is a valid supported state rather than setup left
  // undone: reach then runs through the provider's own tools, which see
  // less of what they read. Read it through `linkupKeyOf`, never bare.
  linkupKey?: string
  provider?: AiProvider
  harnesses?: LocalHarnessSettingsMap
  providerModels?: ProviderModelSettingsMap
  // The editable OpenRouter recommendations are one device-local catalog,
  // shared by every Idea. The optional shape keeps older
  // tests and hydrated renderer patches source-compatible.
  recommendedModelCatalog?: string[]
  // Runtime-only migration state loaded from device settings. It is never
  // serialized into a Board/Profile/Portable Export.
  recommendedModelCatalogExplicit?: boolean
  model: string // the default model for new Ask AI cards — always one of `models`
  models: string[] // the picker's choices, managed on the Settings page
  reasoningEffort: ReasoningEffort
  // Optional at the public store type so older test fixtures and transient
  // state patches remain valid; load normalization always supplies a string.
  systemPrompt?: string
  // Optional so test fixtures and older saved settings stay valid; the store
  // normalizes real values in. Read with the DEFAULT_* fallbacks.
  chainConfirmThreshold?: number
  compactionMode?: CompactionMode
  // Native Profile templates use record-axis identity wrappers.
  profileModLibrary?: GuiUserModTemplate[]
}

type StructuralMutationOptions = {
  recordHistory?: boolean
}

type CardClipboard = {
  cards: Card[]
  connections: Connection[]
}

// Everything a run start needs beyond its source card and kind (issue #189).
// The optional fields are per-kind extras; startRun assembles the RunRecord
// and Output Version from them so the public run actions stay thin wrappers.
type StartRunFields = {
  model: string
  usedCardIds: string[]
  usedConnectionIds: string[]
  modIds: string[]
  appliedMods: RunRecord['appliedMods']
  compiledInstruction: string
  usedGroupDigests?: RunRecord['usedGroupDigests']
  contextBudget?: RunRecord['contextBudget']
  plan?: RunRecord['plan']
  triggeredBy?: RunRecord['triggeredBy']
  aiAccessPhases?: RunRecord['aiAccessPhases']
  conversation?: ConversationProvenance
  digestKey?: string
  // Present (possibly empty) for conversation runs: their version carries a
  // transcript from the start, seeded on continuation.
  seedTranscript?: TranscriptMessage[]
  sourceContext?: SourceContextSnapshot
  resultPlacementContext?: ResultPlacementContext
  // Whether the run may call tools. Recorded on the run because a follow-up
  // continues the run, not the Card, and the Card's switch may have moved since.
  agentic?: true
}

type RunTerminalStatus = 'done' | 'failed' | 'canceled'

function cloneAiAccessPhases(
  phases: RunRecord['aiAccessPhases'],
): NonNullable<RunRecord['aiAccessPhases']> | undefined {
  if (phases === undefined) return undefined
  if (phases.length < 1 || phases.length > 100) {
    throw new Error('AI access provenance is invalid')
  }
  return Object.freeze(phases.map((phase) => {
    const parsed = parseProviderRouteProvenance(phase)
    if (!parsed) throw new Error('AI access provenance is invalid')
    return parsed
  }))
}

type DuplicateCardsOptions = {
  cloneConnections?: boolean
  position?: { x: number; y: number }
}

const SETTINGS_KEY = 'eido-v3-settings'

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (REASONING_EFFORTS.includes(value as ReasoningEffort)) {
    return value as ReasoningEffort
  }
  return 'medium'
}

type NormalizedAiSettings = BoardAiSettings & {
  provider: AiProvider
  providerModels: ProviderModelSettingsMap
  systemPrompt: string
}

type LegacyBoardAiSettings = Partial<BoardAiSettings> & {
  openrouterModelListFormat?: unknown
}

function defaultProviderModelSettings(
  recommendedModelCatalog: readonly string[] = DEFAULT_MODEL_SLUGS,
): ProviderModelSettingsMap {
  return Object.fromEntries(AI_PROVIDERS.map((provider) => {
    const models = provider === 'openrouter' ? [...recommendedModelCatalog] : defaultModelsForProvider(provider)
    return [provider, { model: models[0] ?? DEFAULT_MODEL, models }]
  })) as unknown as ProviderModelSettingsMap
}

function normalizeProviderModelSettings(
  value: unknown,
  fallback: ProviderModelSettings,
): ProviderModelSettings {
  const saved = (value ?? {}) as Partial<ProviderModelSettings>
  const rawModels = Array.isArray(saved.models)
    ? saved.models
        .filter((model): model is string => typeof model === 'string' && Boolean(model.trim()))
        .map((model) => model.trim())
    : []
  const models = Array.from(new Set(rawModels.length > 0 ? rawModels : fallback.models))
  const model = typeof saved.model === 'string' && saved.model.trim()
    ? saved.model.trim()
    : fallback.model
  if (!models.includes(model)) models.unshift(model)
  return { model, models }
}

// The harness model lists Eido shipped before, per provider. A saved list that
// still matches one of these exactly is last release's default, not a choice
// the user made, so it moves to the current default. A list the user edited
// matches none of these and is left exactly as they left it.
const SUPERSEDED_HARNESS_MODELS: Readonly<Record<LocalHarnessId, readonly (readonly string[])[]>> = {
  'claude-code': [['sonnet', 'opus', 'haiku']],
  codex: [['default']],
  antigravity: [['auto'], ['auto', 'pro', 'flash'], ['pro', 'flash', 'auto']],
}

function sameModelList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((model, index) => model === right[index])
}

function refreshedProviderCatalog(
  provider: AiProvider,
  selection: ProviderModelSettings,
): ProviderModelSettings {
  if (provider === 'openrouter') return selection
  const untouched = SUPERSEDED_HARNESS_MODELS[provider].some((list) => sameModelList(list, selection.models))
  if (!untouched) return selection
  const models = defaultModelsForProvider(provider)
  // Keep the model they picked when the new list still has it; a name the new
  // list dropped falls to the first entry rather than to nothing.
  return { model: models.includes(selection.model) ? selection.model : models[0]!, models }
}

function normalizeProviderModelSettingsMap(
  value: unknown,
  fallback: ProviderModelSettingsMap = defaultProviderModelSettings(),
): ProviderModelSettingsMap {
  const saved = (value ?? {}) as Partial<Record<AiProvider, unknown>>
  return Object.fromEntries(AI_PROVIDERS.map((provider) => [
    provider,
    refreshedProviderCatalog(provider, normalizeProviderModelSettings(saved[provider], fallback[provider])),
  ])) as ProviderModelSettingsMap
}

function defaultAiSettings(
  recommendedModelCatalog: readonly string[] = DEFAULT_MODEL_SLUGS,
): NormalizedAiSettings {
  return applyProfileReviewAiSettings({
    provider: 'openrouter',
    providerModels: defaultProviderModelSettings(recommendedModelCatalog),
    model: DEFAULT_MODEL,
    models: [...recommendedModelCatalog],
    reasoningEffort: 'medium',
    systemPrompt: '',
    chainConfirmThreshold: DEFAULT_CHAIN_CONFIRM_THRESHOLD,
    compactionMode: DEFAULT_COMPACTION_MODE,
  })
}

function applyProfileReviewAiSettings(settings: NormalizedAiSettings): NormalizedAiSettings {
  return isProfileReviewExecution()
    ? {
        ...settings,
        provider: 'openrouter',
        model: PROFILE_REVIEW_MODEL,
        models: [PROFILE_REVIEW_MODEL],
        providerModels: {
          ...settings.providerModels,
          openrouter: {
            model: PROFILE_REVIEW_MODEL,
            models: [PROFILE_REVIEW_MODEL],
          },
        },
      }
    : settings
}

function normalizeChainConfirmThreshold(value: unknown, fallback: number | undefined): number {
  const candidate = typeof value === 'number' ? value : fallback
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return DEFAULT_CHAIN_CONFIRM_THRESHOLD
  return Math.max(0, Math.floor(candidate))
}

function normalizeCompactionMode(value: unknown, fallback: CompactionMode | undefined): CompactionMode {
  if (COMPACTION_MODES.includes(value as CompactionMode)) return value as CompactionMode
  if (fallback && COMPACTION_MODES.includes(fallback)) return fallback
  return DEFAULT_COMPACTION_MODE
}

function normalizeAiSettings(
  value: unknown,
  fallback: BoardAiSettings = defaultAiSettings(),
): NormalizedAiSettings {
  const saved = (value ?? {}) as LegacyBoardAiSettings & { thinking?: unknown }
  // An absent provider is the legacy OpenRouter encoding. Never inherit the
  // provider from the previously active Idea.
  // A retired provider is not a broken save: it names a tool Eido dropped, so
  // the Idea opens on the provider that replaced it. Its model list is dropped
  // with it, because those names belonged to the retired tool and mean nothing
  // to the new one; the replacement's own list takes over.
  const retired = replacementForRetiredProvider(saved.provider)
  const provider = isAiProvider(saved.provider) ? saved.provider : retired ?? 'openrouter'
  const fallbackProviderModels = normalizeProviderModelSettingsMap(fallback.providerModels)
  const savedProviderModels = normalizeProviderModelSettingsMap(saved.providerModels, fallbackProviderModels)
  const providerFallback = savedProviderModels[provider]
  const fallbackModels = providerFallback.models.length > 0 ? providerFallback.models : DEFAULT_MODEL_SLUGS
  const rawModels =
    !retired && Array.isArray(saved.models) && saved.models.length > 0
      ? saved.models
          .filter((model): model is string => typeof model === 'string' && Boolean(model.trim()))
          .map((model) => model.trim())
      : fallbackModels
  const savedModels = Array.from(new Set(rawModels.length > 0 ? rawModels : fallbackModels))
  // `model` is read defensively, not trustingly. Since the bag became an
  // envelope (ADR 0040) the persistence validator checks its CONTAINER only, so
  // a `model` that is not a string now reaches this normaliser instead of being
  // refused on the way in. Calling `.trim()` on it threw, and a throw here
  // fails the whole Board load, which is the exact failure the envelope exists
  // to prevent. A non-string reads as absent, and the fallback chain below
  // supplies this build's documented default.
  const rawModel = typeof saved.model === 'string' ? saved.model.trim() : ''
  const savedModel = (retired ? '' : rawModel) || providerFallback.model || savedModels[0] || DEFAULT_MODEL
  if (!savedModels.includes(savedModel)) savedModels.unshift(savedModel)
  // The active provider's list is mirrored at the top level, so it gets the
  // same untouched-default refresh the rest of the catalog just had.
  const active = refreshedProviderCatalog(provider, { model: savedModel, models: savedModels })
  const model = active.model
  const models = [...active.models]

  const providerModels = {
    ...savedProviderModels,
    [provider]: { model, models: [...models] },
  } as ProviderModelSettingsMap
  return applyProfileReviewAiSettings({
    provider,
    providerModels,
    model,
    models,
    // A rung the chosen provider cannot show is not a choice the app can keep:
    // the picker steps it, so the store steps it too, and the run sends what
    // the picker reads. Legacy saves and retired-provider remaps land here.
    reasoningEffort: nearestReasoningEffort(
      provider,
      normalizeReasoningEffort(saved.reasoningEffort ?? saved.thinking ?? fallback.reasoningEffort),
      model,
    ),
    systemPrompt:
      typeof saved.systemPrompt === 'string'
        ? saved.systemPrompt
        : typeof fallback.systemPrompt === 'string'
          ? fallback.systemPrompt
          : '',
    chainConfirmThreshold: normalizeChainConfirmThreshold(saved.chainConfirmThreshold, fallback.chainConfirmThreshold),
    compactionMode: normalizeCompactionMode(saved.compactionMode, fallback.compactionMode),
  })
}

/**
 * The OpenRouter recommendations are device-local. Board settings still carry
 * an active model for backwards compatibility, but a board cannot replace the
 * shared catalog. A legacy/custom active slug is retained so opening an old
 * Idea never strands its selected model.
 */
function withRecommendedModelCatalog(
  settings: NormalizedAiSettings,
  catalog: readonly string[],
): NormalizedAiSettings {
  if (isProfileReviewExecution()) return settings
  const models = normalizeRecommendedModelCatalog(catalog)
  const savedOpenRouterModel = settings.providerModels.openrouter.model
  // The device catalog is the only source of the editable list. Profile/Board
  // settings contribute only the selected OpenRouter identity, which keeps
  // current singleton snapshots and legacy saves readable without importing
  // device metadata into Profile authority.
  const openRouterModel = settings.provider === 'openrouter'
    ? settings.model
    : savedOpenRouterModel
  const openRouterModels = normalizeRecommendedModelCatalog([...models, openRouterModel])
  const activeModels = settings.provider === 'openrouter' ? openRouterModels : settings.models
  return {
    ...settings,
    models: activeModels,
    providerModels: {
      ...settings.providerModels,
      openrouter: {
        model: openRouterModel,
        models: [...openRouterModels],
      },
    },
  }
}

type DeviceCatalogResolution = Readonly<{
  catalog: string[]
  explicit: boolean
}>

/**
 * Resolve the device-owned catalog before applying a Board/Profile snapshot.
 * Board model arrays are never promoted into this state: they contribute only
 * the selected identity through normalizeAiSettings. Legacy multi-entry lists
 * are imported by the compatibility seam immediately before this normalizer;
 * Profile Review deliberately leaves that device state untouched.
 */
function resolveDeviceCatalogForBoard(
  catalog: readonly string[],
  explicit: boolean,
): DeviceCatalogResolution {
  const normalizedCatalog = normalizeRecommendedModelCatalog(catalog)
  return { catalog: normalizedCatalog, explicit }
}

function resolveBoardAiSettings(
  value: unknown,
  fallback: BoardAiSettings,
  catalog: readonly string[],
  catalogExplicit: boolean,
): Readonly<{
  settings: NormalizedAiSettings
  catalog: string[]
  explicit: boolean
}> {
  const normalized = normalizeAiSettings(value, fallback)
  const migrated = migrateLegacyRecommendedModelCatalog(
    value,
    { models: [...catalog], explicit: catalogExplicit },
  )
  const deviceCatalog = resolveDeviceCatalogForBoard(migrated.models, migrated.explicit)
  const settings = withRecommendedModelCatalog(
    normalized,
    deviceCatalog.catalog,
  )
  return {
    settings,
    catalog: [...deviceCatalog.catalog],
    explicit: deviceCatalog.explicit,
  }
}

/**
 * New Profile/Portable Export writes keep the active model identity needed for
 * provenance, but never copy the device-owned OpenRouter catalog. Older Board
 * records still read through normalizeAiSettings unchanged.
 */
function stripDeviceOpenRouterCatalog(
  settings: BoardAiSettings,
): BoardAiSettings {
  const normalized = normalizeAiSettings(settings)
  const { systemPrompt, ...withoutSystemPrompt } = normalized
  const activeOpenRouterModel = normalized.provider === 'openrouter'
    ? normalized.model
    : normalized.providerModels.openrouter.model
  const providerModels = {
    ...withoutSystemPrompt.providerModels,
    openrouter: {
      model: activeOpenRouterModel,
      models: [activeOpenRouterModel],
    },
  } as ProviderModelSettingsMap
  return {
    ...withoutSystemPrompt,
    models: normalized.provider === 'openrouter' ? [normalized.model] : [...normalized.models],
    providerModels,
    ...(systemPrompt ? { systemPrompt } : {}),
  }
}

// `foreign` is every `aiSettings` key this build does not own, carried from the
// Board that was loaded (ADR 0040 rule 1). It goes in FIRST so that a key this
// build does own always wins: the foreign bag is a record of what a newer build
// wrote, not an override of what this one decided.
function boardAiSettingsFrom(
  settings: Settings,
  foreign: SettingsEnvelope = {},
): BoardAiSettings {
  const normalized = normalizeAiSettings({
    provider: settings.provider,
    providerModels: settings.providerModels,
    model: settings.model,
    models: settings.models,
    reasoningEffort: settings.reasoningEffort,
    systemPrompt: settings.systemPrompt,
    chainConfirmThreshold: settings.chainConfirmThreshold,
    compactionMode: settings.compactionMode,
  })
  const { systemPrompt, ...rest } = normalized
  const persisted = stripDeviceOpenRouterCatalog(rest)
  return mergeForeignBoardAiSettings(
    systemPrompt ? { ...persisted, systemPrompt } : persisted,
    foreign,
  )
}

// A missing Board aiSettings may borrow the current selected identity for
// compatibility, but its Idea-owned prompt must never leak from the previously
// active Idea. The device catalog remains outside this fallback entirely.
function boardAiSettingsFallback(settings: Settings): BoardAiSettings {
  const fallback = boardAiSettingsFrom(settings)
  const { systemPrompt: _systemPrompt, ...withoutPrompt } = fallback
  return withoutPrompt
}

/**
 * Apply one Board/Profile AI snapshot to the current renderer settings. The
 * three hydration seams (browser Idea load, packaged hydration, and an
 * authoritative Profile update) must share this exact catalog/selected-model
 * compatibility behavior; only the native Mod library is seam-specific.
 */
function settingsWithResolvedBoardAiSettings(
  current: Settings,
  value: unknown,
  profileModLibrary?: readonly GuiUserModTemplate[],
): Settings {
  const catalog = current.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS
  const catalogExplicit = current.recommendedModelCatalogExplicit === true
  // A wholly missing legacy bag may borrow the current selected identity.
  // Once a Board has a bag of its own, however, unreadable values belong to
  // that Board and fall back to this build's defaults—not to the previous
  // Idea's choices. This keeps one Idea from leaking policy into another.
  const fallback = value === undefined || value === null
    ? boardAiSettingsFallback(current)
    : defaultAiSettings(catalog)
  const resolved = resolveBoardAiSettings(
    value,
    fallback,
    catalog,
    catalogExplicit,
  )
  return {
    ...current,
    ...resolved.settings,
    recommendedModelCatalog: resolved.catalog,
    recommendedModelCatalogExplicit: resolved.explicit,
    ...(profileModLibrary === undefined ? {} : { profileModLibrary: [...profileModLibrary] }),
  }
}

function normalizeHarnesses(value: unknown): LocalHarnessSettingsMap {
  const saved = (value ?? {}) as Partial<Record<LocalHarnessId, { command?: unknown }>>
  return Object.fromEntries(AI_PROVIDERS.slice(1).map((provider) => {
    const command = saved[provider as LocalHarnessId]?.command
    return [provider, {
      command: typeof command === 'string' && command.trim()
        ? command.trim()
        : DEFAULT_LOCAL_HARNESS_SETTINGS[provider as LocalHarnessId].command,
    }]
  })) as LocalHarnessSettingsMap
}

// A board read from storage can hold follow-up replies stuck at 'streaming'
// whose stream died with the previous session (page reload mid-stream); they
// settle to 'stopped' here. Two seams feed this: the load path (boards from
// storage carry no live stream) and duplicateCurrentIdea's snapshot settle
// (settleBoardSnapshotForDuplicate) — the one caller that passes live session
// state through normalizeBoardForRuntime, pre-settled so no streaming status
// ever reaches this point from a live board (issue #267).
function settleBoardFollowUps(outputs: Output[]): Output[] {
  let changed = false
  const settled = outputs.map((output) => {
    let versionChanged = false
    const versions = output.versions.map((version) => {
      const thread = version.followUpThread
      if (!thread) return version
      const messages = settleInterruptedFollowUps(thread.messages)
      if (messages === thread.messages) return version
      versionChanged = true
      return { ...version, followUpThread: { ...thread, messages } }
    })
    if (!versionChanged) return output
    changed = true
    return { ...output, versions }
  })
  return changed ? settled : outputs
}

// Duplicating snapshots live session state, so a reply mid-stream at duplicate
// time would be frozen at 'streaming' inside the copy's saved board — an
// orphan until that idea's next load heals it (#266). Live streams are already
// stopped by the time this settle runs — duplicateCurrentIdea aborts them
// first (issue #286) — so this is the backstop for replies stuck at
// 'streaming' with no live run to abort (e.g. resurrected by redo after their
// stream died). The board passed in is never mutated: the settle maps to new
// message objects (issue #267). Returns the same board reference when nothing
// was streaming.
export function settleBoardSnapshotForDuplicate(board: SavedBoard): SavedBoard {
  const outputs = settleBoardFollowUps(board.outputs)
  return outputs === board.outputs ? board : { ...board, outputs }
}

// duplicateCurrentIdea must stop live follow-up streams before it snapshots,
// but the abort controllers live in brain/followUpRunner.ts, which imports
// this store — a store→runner import would be circular. So the runner hands
// its stop function to the store when its module loads. That makes the abort
// unbypassable: the only way to start a follow-up stream is that same module
// (runFollowUp), so whenever a live stream exists the stopper is registered,
// and it runs inside the store action itself — no caller can skip it. Given
// version ids with no active run, the stopper does nothing.
type FollowUpStreamStopper = (versionIds: string[]) => void
let stopLiveFollowUpStreams: FollowUpStreamStopper = () => {}
export function registerFollowUpStreamStopper(stopper: FollowUpStreamStopper): void {
  stopLiveFollowUpStreams = stopper
}

// Current Mods are coerced to safe shapes only at the SavedBoard/browser load
// boundary. normalizeMod returns the same object for a valid v2 document, so
// healthy cards (and their source-context hashes) pass through untouched.
function normalizeCardMod(card: Card): Card {
  if (card.modV2 === undefined) return card
  const modV2 = normalizeMod(card.modV2)
  if (modV2 === card.modV2) return card
  const { modV2: _invalidMod, ...withoutMod } = card
  return modV2 === undefined ? withoutMod : { ...withoutMod, modV2 }
}

function normalizeCardMods(cards: Card[]): Card[] {
  let changed = false
  const normalized = cards.map((card) => {
    const normalizedCard = normalizeCardMod(card)
    if (normalizedCard === card) return card
    changed = true
    return normalizedCard
  })
  return changed ? normalized : cards
}

function normalizeIntentLogCardMods(events: IntentLogEvent[]): IntentLogEvent[] {
  let changed = false
  const normalized = events.map((event) => {
    if (event.type !== 'card.created' && event.type !== 'group.created' && event.type !== 'card.deleted') {
      return event
    }
    const card = normalizeCardMod(event.data.card)
    if (card === event.data.card) return event
    changed = true
    return { ...event, data: { ...event.data, card } } as IntentLogEvent
  })
  return changed ? normalized : events
}

function normalizeBoardForRuntime(board: SavedBoard): SavedBoard {
  // makeSavedBoard preserves board.updatedAt exactly ('' stays '') and strips
  // retired save data. Legacy highlight migration runs
  // here (load path only) so snapshot() never mutates live state.
  const base = makeSavedBoard(board)
  const { cards, highlights, highlightTags } = migrateLegacyHighlights(base)
  const outputs = settleBoardFollowUps(base.outputs)
  // Older boards could wire a question straight into a question.
  return repairAskToAskConnections({
    ...base,
    cards: normalizeCardMods(cards),
    intentLog: normalizeIntentLogCardMods(base.intentLog ?? []),
    highlights,
    highlightTags,
    outputs,
  })
}

function boardWithResolvedAiSettings(board: SavedBoard, fallback: BoardAiSettings): SavedBoard {
  const normalized = normalizeBoardForRuntime(board)
  const resolved = normalizeAiSettings(normalized.aiSettings, fallback)
  const { systemPrompt, ...rest } = resolved
  const persisted = stripDeviceOpenRouterCatalog(rest)
  return { ...normalized, aiSettings: systemPrompt ? { ...persisted, systemPrompt } : persisted }
}

function loadSettings(_includeModLibrary = true): Settings {
  // The OpenRouter credential is hydrated separately from protected storage.
  // Harness commands and the OpenRouter Recommended Model Catalog are
  // device-local preferences; active Idea selections still travel through
  // aiSettings.
  const recommendedModelCatalogState = loadRecommendedModelCatalogState()
  const recommendedModelCatalog = recommendedModelCatalogState.models
  const base: Settings = {
    apiKey: '',
    linkupKey: '',
    harnesses: DEFAULT_LOCAL_HARNESS_SETTINGS,
    ...defaultAiSettings(recommendedModelCatalog),
    recommendedModelCatalog,
    recommendedModelCatalogExplicit: recommendedModelCatalogState.explicit,
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> & { thinking?: unknown }
      const normalized = normalizeAiSettings(saved, base)
      const deviceCatalog = normalizeRecommendedModelCatalog(recommendedModelCatalog)
      const resolved = withRecommendedModelCatalog(
        normalized,
        deviceCatalog,
      )
      return {
        apiKey: base.apiKey,
        linkupKey: base.linkupKey,
        harnesses: normalizeHarnesses(saved.harnesses),
        ...resolved,
        recommendedModelCatalog: deviceCatalog,
        recommendedModelCatalogExplicit: recommendedModelCatalogState.explicit,
      }
    }
  } catch {
    // A corrupt settings value must not poison every later write. Device settings
    // have no recovery-file convention, so clear only this key and recreate it on
    // the next settings change.
    try {
      localStorage.removeItem(SETTINGS_KEY)
    } catch {
      /* storage itself is unavailable; a later write will surface that failure */
    }
  }
  return base
}

function saveLocalHarnessSettings(harnesses: LocalHarnessSettingsMap): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const saved = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ...saved,
      harnesses,
    }))
  } catch {
    // Device settings are an optional convenience. A failed write must not
    // block a Board commit or make the Profile unavailable.
  }
}

// Retirement windows for the one-shot connection beats (#259 Phase 3): a
// touch past the CSS animation lengths, so an edge's own animation-end
// normally retires the beat first and these are only the backstop.
const CONNECT_PULSE_RETIRE_MS = 1100
const POLARITY_FLIP_RETIRE_MS = 350
let connectionFeelSeq = 0
const GROUP_PAD_X = 28
const GROUP_PAD_TOP = 46
const GROUP_PAD_BOTTOM = 30

function enclosingGroupFrame(cards: Card[]) {
  const minX = Math.min(...cards.map((c) => c.position.x))
  const minY = Math.min(...cards.map((c) => c.position.y))
  const maxX = Math.max(...cards.map((c) => c.position.x + cardSize(c).width))
  const maxY = Math.max(...cards.map((c) => c.position.y + cardSize(c).height))
  return {
    position: { x: minX - GROUP_PAD_X, y: minY - GROUP_PAD_TOP },
    size: {
      width: Math.max(320, maxX - minX + GROUP_PAD_X * 2),
      height: Math.max(220, maxY - minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM),
    },
  }
}

function cloneForLog<T>(value: T): T {
  // Plans stay lean but must not amplify through intent-log clones of runs
  // (#139): every run event would otherwise re-copy the chain shape.
  // Only run records carry a plan; keying on askAiCardId too keeps this from
  // stripping a same-named field off any other entity that gains one later.
  const record = value as Record<string, unknown>
  let stripped = value
  if (value && typeof value === 'object' && 'askAiCardId' in record) {
    // Tool steps are unbounded by design (ADR 0033 sets no cap), so they get
    // the same treatment as plans: kept on the run, never re-copied into every
    // run event.
    const { plan: _plan, toolSteps: _toolSteps, ...withoutAmplifiers } = record
    if ('plan' in record || 'toolSteps' in record) stripped = withoutAmplifiers as T
  }
  if (typeof structuredClone === 'function') return structuredClone(stripped)
  return JSON.parse(JSON.stringify(stripped)) as T
}

function canConnectCard(card: Card | undefined): card is Card {
  return Boolean(card && contractFor(card.kind).connectionDefaults.connectable)
}

function groupMembershipChanges(before: Card[], after: Card[]) {
  const beforeGroups = new Map(before.map((card) => [card.id, card.groupId]))
  const changes: Record<string, { from?: string; to?: string }> = {}
  for (const card of after) {
    if (!canJoinGroup(card)) continue
    const from = beforeGroups.get(card.id)
    const to = card.groupId
    if (from !== to) {
      changes[card.id] = {
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
      }
    }
  }
  return Object.keys(changes).length > 0 ? changes : undefined
}

function moveCardsInLayer(cards: Card[], ids: string[], direction: 'front' | 'back'): Card[] {
  const selectedIds = new Set(ids)
  const ordered = orderedByLayer(cards)
  const selected = ordered.filter((card) => selectedIds.has(card.id))
  if (selected.length === 0) return cards
  const rest = ordered.filter((card) => !selectedIds.has(card.id))
  const nextOrder = direction === 'front' ? [...rest, ...selected] : [...selected, ...rest]
  const layers = new Map(nextOrder.map((card, index) => [card.id, index]))
  return cards.map((card) => ({ ...card, zIndex: layers.get(card.id) ?? storedLayer(card, 0) }))
}

function cloneAnchor(anchor: Anchor, idMap: Map<string, string>, blockIdMap: Map<string, string>): Anchor {
  const cardId = idMap.get(anchor.cardId) ?? anchor.cardId
  return {
    cardId,
    ...(anchor.blockId ? { blockId: blockIdMap.get(anchor.blockId) ?? anchor.blockId } : {}),
  }
}

const DUPLICATE_OFFSET_STEP = { x: 40, y: 40 }
const DUPLICATE_OFFSET_TOLERANCE = 0.5
const DUPLICATE_OFFSET_MAX_STEPS = 1000

// Finds the first free slot along the default duplicate direction so repeated
// duplicates cascade like a staircase instead of stacking on the same spot.
// Only the set's origin (minX, minY) is checked, so multi-card and group
// duplicates move together as one shared offset.
function nextCascadeOffset(minX: number, minY: number, existingCards: Card[]) {
  let offset = { ...DUPLICATE_OFFSET_STEP }
  for (let step = 0; step < DUPLICATE_OFFSET_MAX_STEPS; step += 1) {
    const targetX = minX + offset.x
    const targetY = minY + offset.y
    const occupied = existingCards.some(
      (card) =>
        Math.abs(card.position.x - targetX) < DUPLICATE_OFFSET_TOLERANCE &&
        Math.abs(card.position.y - targetY) < DUPLICATE_OFFSET_TOLERANCE,
    )
    if (!occupied) return offset
    offset = { x: offset.x + DUPLICATE_OFFSET_STEP.x, y: offset.y + DUPLICATE_OFFSET_STEP.y }
  }
  return offset
}

function cloneCardsFrom(
  sourceCards: Card[],
  sourceConnections: Connection[],
  state: Pick<GraphState, 'cards' | 'connections'>,
  options: DuplicateCardsOptions = {},
) {
  const cardsToClone = orderedByLayer(sourceCards)
  if (cardsToClone.length === 0) return { cards: [], connections: [], ids: [] }

  const idMap = new Map<string, string>()
  const blockIdMap = new Map<string, string>()
  for (const card of cardsToClone) {
    idMap.set(card.id, newId(card.kind))
    for (const block of card.blocks) {
      blockIdMap.set(block.id, newId('blk'))
    }
  }

  const minX = Math.min(...cardsToClone.map((card) => card.position.x))
  const minY = Math.min(...cardsToClone.map((card) => card.position.y))
  const offset = options.position
    ? { x: options.position.x - minX, y: options.position.y - minY }
    : nextCascadeOffset(minX, minY, state.cards)
  const firstLayer = maxLayer(state.cards) + 1
  const cards = cardsToClone.map((card, index): Card => {
    const nextId = idMap.get(card.id)!
    const {
      assets: _assets,
      createdBy: _createdBy,
      groupId: _groupId,
      lastModifiedBy: _lastModifiedBy,
      modV2: _modV2,
      ...baseCard
    } = card
    const clonedModV2 = card.modV2
      ? remapModPartIdentities(
          card.modV2,
          ({ role }) => newId(`mod-${role}`),
        ).value
      : undefined
    const clonedGroupId = card.kind === 'title'
      ? undefined
      : card.groupId ? idMap.get(card.groupId) ?? card.groupId : undefined
    const assetIdMap = new Map(
      (card.assets ?? []).map((asset) => [asset.id, newId('asset')]),
    )
    const clonedLocalHtmlPreview = card.localHtmlPreview?.assetId
      ? {
          ...card.localHtmlPreview,
          assetId: assetIdMap.get(card.localHtmlPreview.assetId)!,
        }
      : card.localHtmlPreview
    return {
      ...baseCard,
      id: nextId,
      blocks: card.blocks.map((block) => ({ ...block, id: blockIdMap.get(block.id)! })),
      ...(card.assets === undefined
        ? {}
        : { assets: card.assets.map((asset) => ({ ...asset, id: assetIdMap.get(asset.id)! })) }),
      ...(clonedLocalHtmlPreview === undefined
        ? {}
        : { localHtmlPreview: clonedLocalHtmlPreview }),
      ...(clonedModV2 === undefined ? {} : { modV2: clonedModV2 }),
      ...(clonedGroupId === undefined ? {} : { groupId: clonedGroupId }),
      position: { x: card.position.x + offset.x, y: card.position.y + offset.y },
      zIndex: firstLayer + index,
    }
  })

  const allCardsById = new Map([...state.cards, ...cards].map((card) => [card.id, card]))
  const existingConnectionKeys = new Set(
    state.connections.map((connection) => `${connection.from.cardId}->${connection.to.cardId}:${connection.role}`),
  )
  const connections = options.cloneConnections
    ? sourceConnections.flatMap((connection) => {
        const from = cloneAnchor(connection.from, idMap, blockIdMap)
        const to = cloneAnchor(connection.to, idMap, blockIdMap)
        if (from.cardId === to.cardId) return []
        if (!idMap.has(connection.from.cardId) && !idMap.has(connection.to.cardId)) return []
        if (!canConnectCard(allCardsById.get(from.cardId)) || !canConnectCard(allCardsById.get(to.cardId))) return []
        const key = `${from.cardId}->${to.cardId}:${connection.role}`
        if (existingConnectionKeys.has(key)) return []
        existingConnectionKeys.add(key)
        return [{ ...connection, id: newId('conn'), from, to }]
      })
    : []

  return { cards, connections, ids: cards.map((card) => card.id) }
}

const PATCH_IDENTITY_COLLECTIONS = new Set([
  'cards',
  'connections',
  'outputs',
  'runs',
  'highlights',
  'highlightTags',
  'compactionSummaries',
] as const)

type PatchIdentityCollection =
  | 'cards'
  | 'connections'
  | 'outputs'
  | 'runs'
  | 'highlights'
  | 'highlightTags'
  | 'compactionSummaries'

function patchIdentity(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { id?: unknown; cardId?: unknown }
  const id = candidate.id ?? candidate.cardId
  return typeof id === 'string' ? id : undefined
}

function valueAtPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value
  for (const part of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[part]
  }
  return current
}

function identityItems(
  state: BoardCommitState,
  collection: PatchIdentityCollection,
): readonly unknown[] {
  return state[collection]
}

function authorityChangedAnyBoardCollection(
  before: BoardCommitState,
  after: BoardCommitState,
): boolean {
  return [...PATCH_IDENTITY_COLLECTIONS].some((collection) => (
    stableStringify(before[collection]) !== stableStringify(after[collection])
  ))
}

function rebasePatchUndoEntry(
  entry: PatchUndoEntry,
  before: BoardCommitState,
  after: BoardCommitState,
  authoritativeBefore: BoardCommitState = before,
  authoritativeAfter: BoardCommitState = after,
  authoritativeBoardChanged = authorityChangedAnyBoardCollection(
    authoritativeBefore,
    authoritativeAfter,
  ),
): PatchUndoEntry | null {
  // External authority is not a user commit, so it never mints an undo entry.
  // Existing user patches remain selective by following stable record ids;
  // a path changed or removed by authority is retired rather than allowed to
  // target a shifted record or reverse the newer external value.
  const identities = new Map<string, string>()
  const ambiguousIdentities = new Set<string>()
  const allPatches = [...entry.inversePatches, ...entry.forwardPatches]
  const replacesWholeCollection = allPatches.some((patch) => {
    const [collection] = patch.path
    return patch.path.length === 1
      && typeof collection === 'string'
      && PATCH_IDENTITY_COLLECTIONS.has(collection as PatchIdentityCollection)
  })
  if (replacesWholeCollection && authoritativeBoardChanged) {
    // A root-array Immer replacement cannot be rebased record by record. Even
    // when authority changed a related collection instead (for example, an
    // Agent Connection to a user-added Card), replaying the replacement can
    // erase Agent records or leave a dangling closure. Retire the whole entry.
    return null
  }
  for (const patch of allPatches) {
    const [collection, index] = patch.path
    if (typeof collection !== 'string'
      || !PATCH_IDENTITY_COLLECTIONS.has(collection as PatchIdentityCollection)
      || typeof index !== 'number') continue
    const key = `${collection}:${index}`
    const id = patchIdentity(patch.value)
    if (id && identities.has(key) && identities.get(key) !== id) {
      ambiguousIdentities.add(key)
      identities.delete(key)
    } else if (id && !ambiguousIdentities.has(key)) {
      identities.set(key, id)
    }
  }
  for (const patch of allPatches) {
    const [collection, index] = patch.path
    if (typeof collection !== 'string'
      || !PATCH_IDENTITY_COLLECTIONS.has(collection as PatchIdentityCollection)
      || typeof index !== 'number') continue
    const key = `${collection}:${index}`
    if (identities.has(key) || ambiguousIdentities.has(key)) continue
    const id = patchIdentity(identityItems(before, collection as PatchIdentityCollection)[index])
    if (id) identities.set(key, id)
  }

  const rebase = (patch: Patch): Patch | null => {
    const [collection, index, ...suffix] = patch.path
    if (typeof collection !== 'string'
      || !PATCH_IDENTITY_COLLECTIONS.has(collection as PatchIdentityCollection)
      || typeof index !== 'number') return patch
    const identityKey = `${collection}:${index}`
    if (ambiguousIdentities.has(identityKey)) return null
    const identity = identities.get(identityKey)
    if (!identity) return null
    const beforeItems = identityItems(before, collection as PatchIdentityCollection)
    const afterItems = identityItems(after, collection as PatchIdentityCollection)
    const beforeIndex = beforeItems.findIndex((item) => patchIdentity(item) === identity)
    const afterIndex = afterItems.findIndex((item) => patchIdentity(item) === identity)
    if (beforeIndex >= 0 && afterIndex < 0) return null
    if (beforeIndex < 0 && afterIndex >= 0) return null
    const authoritativeBeforeItems = identityItems(
      authoritativeBefore,
      collection as PatchIdentityCollection,
    )
    const authoritativeAfterItems = identityItems(
      authoritativeAfter,
      collection as PatchIdentityCollection,
    )
    const authoritativeBeforeIndex = authoritativeBeforeItems.findIndex(
      (item) => patchIdentity(item) === identity,
    )
    const authoritativeAfterIndex = authoritativeAfterItems.findIndex(
      (item) => patchIdentity(item) === identity,
    )
    if ((authoritativeBeforeIndex >= 0) !== (authoritativeAfterIndex >= 0)) return null
    if (authoritativeBeforeIndex >= 0 && authoritativeAfterIndex >= 0) {
      const beforeValue = valueAtPath(authoritativeBeforeItems[authoritativeBeforeIndex], suffix)
      const afterValue = valueAtPath(authoritativeAfterItems[authoritativeAfterIndex], suffix)
      if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) return null
    }
    const targetIndex = afterIndex >= 0 ? afterIndex : Math.min(index, afterItems.length)
    if (beforeIndex >= 0 && afterIndex >= 0) {
      const beforeValue = valueAtPath(beforeItems[beforeIndex], suffix)
      const afterValue = valueAtPath(afterItems[afterIndex], suffix)
      if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) return null
    }
    if (targetIndex === index) return patch
    return { ...patch, path: [collection, targetIndex, ...suffix] }
  }

  const inversePatches = entry.inversePatches.flatMap((patch) => {
    const rebased = rebase(patch)
    return rebased ? [rebased] : []
  })
  const forwardPatches = entry.forwardPatches.flatMap((patch) => {
    const rebased = rebase(patch)
    return rebased ? [rebased] : []
  })
  if (!inversePatches.length || !forwardPatches.length) return null
  if (inversePatches.every((patch, index) => patch === entry.inversePatches[index])
    && forwardPatches.every((patch, index) => patch === entry.forwardPatches[index])) {
    return entry
  }
  return { ...entry, inversePatches, forwardPatches }
}

function recordById<T extends { id: string }>(items: readonly T[], id: string): T | undefined {
  return items.find((item) => item.id === id)
}

function recordChangedByAuthority<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  id: string,
): boolean {
  return stableStringify(recordById(before, id)) !== stableStringify(recordById(after, id))
}

function structuralPatchOverlapsAuthority(
  patch: CardStructuralPatch,
  before: BoardCommitState,
  after: BoardCommitState,
): boolean {
  const beforeCard = recordById(before.cards, patch.id)
  const afterCard = recordById(after.cards, patch.id)
  if (!beforeCard || !afterCard) return beforeCard !== afterCard
  if (stableStringify(patch.before.position) !== stableStringify(patch.after.position)
    && stableStringify(beforeCard.position) !== stableStringify(afterCard.position)) return true
  if (stableStringify(patch.before.size) !== stableStringify(patch.after.size)
    && stableStringify(beforeCard.size) !== stableStringify(afterCard.size)) return true
  return patch.before.groupId !== patch.after.groupId
    && beforeCard.groupId !== afterCard.groupId
}

function cardClosureChangedByAuthority(
  cardIds: ReadonlySet<string>,
  before: BoardCommitState,
  after: BoardCommitState,
): boolean {
  if ([...cardIds].some((id) => recordChangedByAuthority(before.cards, after.cards, id))) {
    return true
  }
  const connected = (state: BoardCommitState) => state.connections.filter((connection) =>
    cardIds.has(connection.from.cardId) || cardIds.has(connection.to.cardId))
  const outputs = (state: BoardCommitState) => state.outputs.filter((output) =>
    cardIds.has(output.resultCardId))
  return stableStringify(connected(before)) !== stableStringify(connected(after))
    || stableStringify(outputs(before)) !== stableStringify(outputs(after))
}

function semanticHistoryOverlapsAuthority(
  entry: HistoryEntry,
  before: BoardCommitState,
  after: BoardCommitState,
): boolean {
  const action = entry.action
  if (action.type === 'cardsUpdated') {
    return action.patches.some((patch) => structuralPatchOverlapsAuthority(patch, before, after))
  }
  if (action.type === 'cardsAdded' || action.type === 'cardsRemoved') {
    const cardIds = new Set(action.cards.map(({ item }) => item.id))
    if (cardClosureChangedByAuthority(cardIds, before, after)) return true
    if (action.cardPatches?.some((patch) => structuralPatchOverlapsAuthority(patch, before, after))) {
      return true
    }
    return (action.connections ?? []).some(({ item }) =>
      recordChangedByAuthority(before.connections, after.connections, item.id))
      || (action.outputs ?? []).some(({ item }) =>
        recordChangedByAuthority(before.outputs, after.outputs, item.id))
  }
  if (action.type === 'connectionsAdded' || action.type === 'connectionsRemoved') {
    return action.connections.some(({ item }) =>
      recordChangedByAuthority(before.connections, after.connections, item.id))
  }
  if (action.type === 'connectionMeaningChanged') {
    const beforeConnection = recordById(before.connections, action.id)
    const afterConnection = recordById(after.connections, action.id)
    if (!beforeConnection || !afterConnection) return beforeConnection !== afterConnection
    const meaning = (connection: Connection) => ({
      strength: connection.strength,
      polarity: connection.polarity,
      groupMode: connection.meta?.groupMode,
    })
    return stableStringify(meaning(beforeConnection)) !== stableStringify(meaning(afterConnection))
  }
  const memberOrder = (state: BoardCommitState) => state.cards
    .filter((card) => card.groupId === action.groupId && card.kind !== 'group')
    .map((card) => card.id)
  return stableStringify(memberOrder(before)) !== stableStringify(memberOrder(after))
    || Boolean(recordById(before.cards, action.groupId)) !== Boolean(recordById(after.cards, action.groupId))
}

function rebaseUndoStackForAuthoritativeUpdate(
  stack: UndoEntry[],
  before: BoardCommitState,
  after: BoardCommitState,
  authoritativeBefore: BoardCommitState = before,
  authoritativeAfter: BoardCommitState = after,
  authoritativeBoardChanged = authorityChangedAnyBoardCollection(
    authoritativeBefore,
    authoritativeAfter,
  ),
): UndoEntry[] {
  let changed = false
  const rebased: UndoEntry[] = []
  for (const entry of stack) {
    if (!isPatchUndoEntry(entry)) {
      if (semanticHistoryOverlapsAuthority(entry, authoritativeBefore, authoritativeAfter)) {
        changed = true
        continue
      }
      rebased.push(entry)
      continue
    }
    const next = rebasePatchUndoEntry(
      entry,
      before,
      after,
      authoritativeBefore,
      authoritativeAfter,
      authoritativeBoardChanged,
    )
    if (next === entry) {
      rebased.push(entry)
      continue
    }
    changed = true
    if (next) rebased.push(next)
  }
  return changed ? rebased : stack
}

export type GraphState = {
  // --- the saved board ---
  cards: Card[]
  connections: Connection[]
  outputs: Output[]
  runs: RunRecord[]
  highlights: Highlight[]
  highlightTags: HighlightTag[]
  compactionSummaries: CompactionSummary[]
  intentLog: IntentLogEvent[]
  // The settings envelope's rule 1 at the runtime seam (ADR 0040): every
  // Board-level setting this build does not own, held verbatim from load to
  // save. Without these two the store would silently delete a newer build's
  // preferences the first time this build saved the Board, because the store
  // decomposes `aiSettings` into its own typed `Settings` shape and has no
  // field at all for the Board's own envelope. Neither is ever read as a
  // preference here; they exist to be handed back unchanged.
  boardSettings: SettingsEnvelope | undefined
  foreignAiSettings: SettingsEnvelope
  // Transient change stream for incremental indexes (not persisted).
  lastBoardChange: BoardChangeEmission | null
  boardChangeSeq: number

  // --- transient UI state ---
  ideas: IdeaSummary[]
  currentIdeaId: string | null
  selection: Selection
  selectedCardIds: string[]
  connectionEditorId: string | null
  // One-shot connection beats (#259 Phase 3). Transient like
  // connectionEditorId — the canvas remounts edge components on every graph
  // commit, so an in-flight beat must outlive them. The store retires each
  // beat after its animation window even when no edge ever mounts for it
  // (canvas-painted connections); `seq` keeps a stale retirement from
  // clobbering a newer beat.
  connectionPulse: { connectionId: string; seq: number } | null
  connectionFlip: { connectionId: string; fromPolarity: ConnectionPolarity; seq: number } | null
  activeTool: CanvasTool
  activeHighlightTagId: string | null
  highlightsPanelOpen: boolean
  cardFocusRequest: CardFocusRequest | null
  // Session undo ring (ADR 0016): capped at UNDO_RING_LIMIT, never persisted,
  // cleared on board switch. Legacy semantic entries and funnel patch entries
  // share one stack until #190 finishes the call-site migration.
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  saveState: SaveState
  storageStatus: StorageStatus | null
  hydrated: boolean
  persistenceKind: ProfileRendererPersistenceSelection['kind']
  profileStartupState: ProfileStartupState
  profileStartupError: string | null
  /** Which repair action failed last, so the surface can pick calm copy. */
  profileStartupErrorKind: 'restore' | 'start-fresh' | null
  recoveryCandidates: readonly ProfileRecoveryPointSummary[]
  restoringRecoveryCandidateId: string | null
  startingFreshProfile: boolean
  settings: Settings
  keyPromptOpen: boolean
  // Whether a Linkup key exists, without ever holding its value. Derived from
  // settings by `hasLinkupKey` and written through on every path that changes
  // the key, rather than mirrored into a boolean a later edit could forget to
  // set: a stale `true` offers a menu that binds nothing, and a stale `false`
  // hides a control the user has already paid for. The reach cycle keys off
  // presence alone: with no key there is nothing for Research mode to run, so
  // the cycle skips it rather than offering a state that does not work.
  linkupKeyPresent: boolean
  // Whether a provider key exists on this computer that the operating system's
  // protected store would not open on this launch, typically a locked or
  // refused Keychain.
  //
  // It is deliberately separate from `linkupKeyPresent`, and both can be false
  // at once. Presence answers "can this run"; the answer is no either way, and
  // the reach cycle is right to skip Research. This answers "why", and without
  // it the app can only say the thing that is not true: that no key was set
  // (#1359, #1360). The value of the key is never held here, only the fact.
  //
  // One flag per credential slot, the same way `settings.apiKey` and
  // `settings.linkupKey` are separate values. The first fix carried a single
  // ORed boolean, which is a fact about neither field: with OpenRouter working
  // and Linkup locked it put the OpenRouter notice under a filled OpenRouter
  // field and left the locked field silent, which is the downgrade #1360 was
  // opened about, said in a new place.
  apiKeyLocked: boolean
  linkupKeyLocked: boolean
  ideaManagerOpen: boolean
  // A shelf Board deleted moments ago, still restorable until the window
  // closes (timer, modal close, or the next staged delete).
  pendingIdeaDelete: Readonly<{ id: string; name: string }> | null
  cardClipboard: CardClipboard | null

  // --- lifecycle ---
  hydrate: () => Promise<void>
  loadIdea: (id: string) => Promise<void>
  createIdea: (name: string) => Promise<void>
  renameCurrentIdea: (name: string) => Promise<void>
  duplicateCurrentIdea: (name: string) => Promise<void>
  deleteIdea: (id: string) => Promise<void>
  stageIdeaDelete: (id: string) => Promise<void>
  undoStagedIdeaDelete: () => void
  commitStagedIdeaDelete: () => Promise<void>
  importIdea: (name: string, board: SavedBoard) => Promise<void>
  exportCurrentIdeaToNative: () => Promise<boolean>
  importIdeaFromNative: () => Promise<boolean>
  restoreProfileRecovery: (candidateId: string) => Promise<void>
  startFreshProfile: () => Promise<void>

  // --- cards ---
  addCard: (kind: CardKind, position: { x: number; y: number }) => string
  addNoteWithLinkPreview: (
    input: Readonly<{ url: string; text: string }>,
    position: { x: number; y: number },
  ) => string
  addNoteWithLocalHtmlPreview: (
    source: LocalHtmlPreviewSource,
    position: { x: number; y: number },
  ) => string
  // A web page Eido read, landing as an ordinary Note that remembers where it
  // came from. One commit, so a page arrives as a single undoable act.
  addWebNote: (page: WebNotePage, position: { x: number; y: number }) => string
  // Turn a Note that currently holds only a pasted address into the page at
  // that address. Refuses if the Note has changed since, so a user who started
  // typing keeps what they typed. Answers whether it applied.
  applyWebPage: (id: string, page: WebNotePage, expectedText: string) => boolean
  // askAi only: request an Agentic Run, in which the model may call tools.
  setCardAgentic: (id: string, agentic: boolean) => void
  // askAi only: the whole reach decision in one commit. 'off' and 'web' and
  // 'research' each land as a single Card write, so one press of the cycle is
  // one undo step rather than a flag change and a mode change stacked. The
  // mode itself lives in card.meta so an older build carries it without
  // reading it.
  setCardReach: (id: string, reach: 'off' | ReachMode) => void
  // askAi only: the research depth the person paying pressed (#971). Per
  // Card, persisted in card.meta so it survives a reload and an older build
  // carries it unread. S, the default, deletes the key rather than storing a
  // value, so a Card that has never been asked past the cheapest depth stays
  // byte-identical to one written before the choice existed.
  setCardResearchDepth: (id: string, depth: ResearchReasoningDepth) => void
  // The research-job stash (#963). A submitted research job cannot be
  // cancelled and bills whatever Eido does next, so its id is held in
  // card.meta from the vendor's acknowledgement until a run consumed a
  // terminal state. System writes rather than user edits: no undo entry,
  // because undoing a fact about money already spent would only forget it.
  recordCardResearchJob: (cardId: string, jobId: string) => void
  clearCardResearchJob: (cardId: string) => void
  duplicateCard: (id: string, options?: DuplicateCardsOptions) => string[]
  duplicateCards: (ids: string[], options?: DuplicateCardsOptions) => string[]
  copyCards: (ids: string[]) => void
  pasteCards: (position?: { x: number; y: number }) => string[]
  deleteCard: (id: string) => void
  setCardTitle: (id: string, title: string) => void
  setCardHeaderColor: (id: string, color?: string, fill?: Card['headerFill']) => void
  recordCardContentEdited: (
    id: string,
    field?: 'body' | 'title' | 'groupPrompt' | 'modControl' | 'conversationSettings',
  ) => void
  setCardText: (id: string, text: string) => void
  setLinkPreview: (id: string, preview: LinkPreview) => void
  ensureNoteLinkPreview: (id: string, url: string) => void
  settleLocalHtmlPreview: (id: string, capture: LocalHtmlPreviewCapture) => void
  failLocalHtmlPreview: (id: string, sourceId: string) => void
  // Without a url, every preview the Note shows. With one, only the tile that
  // carries it, so one closed tile never takes its neighbours with it.
  removeNotePreview: (id: string, url?: string) => void
  setCardFontSize: (id: string, fontSize: NoteFontSize) => void
  addCardAssets: (id: string, assets: CardAsset[]) => void
  removeCardAsset: (cardId: string, assetId: string) => void
  setCardModel: (id: string, model: string) => void
  moveCard: (id: string, position: { x: number; y: number }, options?: StructuralMutationOptions) => void
  // One commit for a whole frame of drag movement (#143): k selected cards
  // move as one store commit, one membership reconcile, one persist schedule.
  moveCards: (moves: { id: string; position: { x: number; y: number } }[], options?: StructuralMutationOptions) => void
  setCardSize: (id: string, size: { width: number; height: number }, options?: StructuralMutationOptions) => void
  // Pays a Card for the attachment panels it has started showing, once per
  // panel, for the life of the Card (`attachmentPanelGrowth.ts`).
  growCardForAttachmentPanels: (
    id: string,
    present: readonly AttachmentPanelKind[],
    how?: 'arrived' | 'already-there',
  ) => void
  adoptRenderedCardSizes: (sizes: readonly { id: string; size: { width: number; height: number } }[]) => void
  bringCardsToFront: (ids: string[]) => void
  sendCardsToBack: (ids: string[]) => void
  createGroupFromSelection: (cardIds: string[]) => string | undefined
  addCardToGroup: (cardId: string, groupId: string) => void
  removeCardFromGroup: (cardId: string) => void
  reorderGroupMembers: (groupId: string, memberIds: string[]) => void
  setGroupCompressionPrompt: (id: string, prompt: string) => void
  setConversationStyle: (id: string, style: ConversationStyle) => void
  setConversationTurns: (id: string, turns: number) => void
  addMod: (toAskAiCardId: string) => void
  addModFromLibrary: (libraryId: string, position: { x: number; y: number }) => string | null

  // --- connections ---
  addConnection: (fromCardId: string, toCardId: string) => boolean
  setConnectionStrength: (id: string, strength: ConnectionStrength) => void
  setConnectionPolarity: (id: string, polarity: ConnectionPolarity) => void
  setConnectionGroupMode: (id: string, mode: ConnectionGroupMode) => void
  // The one-line "why this path died" on a connection. Empty text clears it.
  setConnectionReason: (id: string, reason: string | undefined) => void
  reorderContextItems: (connectionIds: string[]) => CommitResult
  deleteConnection: (id: string) => void
  // Batch delete as ONE commit / undo entry (#212 multi-connection delete).
  deleteConnections: (ids: string[]) => void

  // --- the semantic commit funnel (ADR 0016) ---
  // The only Intent Log append point. State-only progress writes stay internal
  // to store.ts and intentionally do not mint undo entries.
  // `events` is REQUIRED: pass [] explicitly when nothing narrative happened.
  commit: (
    label: string,
    updater: (draft: BoardCommitState) => void,
    events: IntentLogEventDraft[],
  ) => CommitResult
  applyAuthoritativeProfileUpdate: (
    update: ProfileRendererAuthoritativeUpdate,
  ) => ProfileRendererAuthoritativeApplyResult

  // --- undo/redo ---
  undo: () => void
  redo: () => void
  recordCardStructuralChange: (
    label: CardHistoryKind,
    beforeCards: Card[],
    afterCards: Card[],
  ) => void

  // --- selection ---
  select: (selection: Selection) => void
  setSelectedCardIds: (ids: string[]) => void
  setActiveTool: (tool: CanvasTool) => void
  openConnectionEditor: (id: string) => void
  closeConnectionEditor: () => void
  clearConnectionPulse: (seq: number) => void
  clearConnectionFlip: (seq: number) => void

  // --- highlights ---
  createHighlightTag: (name: string) => string
  setActiveHighlightTag: (id: string) => void
  renameHighlightTag: (id: string, name: string) => void
  setHighlightTagColor: (id: string, color: string) => void
  addHighlight: (input: { cardId: string; text: string; occurrence: number }) => string | null
  removeHighlight: (id: string) => void
  deleteHighlightTag: (id: string) => void
  setHighlightsPanelOpen: (open: boolean) => void
  requestCardFocus: (cardId: string) => void
  createNoteFromHighlight: (highlightId: string) => string | null

  // --- settings ---
  setApiKey: (key: string) => Promise<void>
  setLinkupKey: (key: string) => Promise<void>
  setProvider: (provider: AiProvider, providerModels?: ProviderModelSettingsMap) => void
  /** Persist the selected OpenRouter identity without changing its funding route. */
  setOpenRouterModel: (model: string) => void
  /** Edit the device-local OpenRouter recommendations without Profile I/O. */
  setRecommendedModelCatalog: (models: readonly string[]) => void
  replaceRecommendedModel: (previous: string, replacement: string) => boolean
  setHarnessCommand: (provider: LocalHarnessId, command: string) => void
  setSystemPrompt: (prompt: string) => void
  setReasoningEffort: (effort: ReasoningEffort) => void
  setChainConfirmThreshold: (threshold: number) => void
  setCompactionMode: (mode: CompactionMode) => void
  // Cache a compaction summary (ADR 0015); replaces any older one for the card.
  recordCompactionSummary: (summary: CompactionSummary) => void
  setKeyPromptOpen: (open: boolean) => void
  setIdeaManagerOpen: (open: boolean) => void

  // --- run engine writes (Concept 5) ---
  beginRun: (askAiCardId: string, compiled: {
    text: string
    model: string
    usedCardIds: string[]
    usedConnectionIds: string[]
    modIds: string[]
    appliedMods: RunRecord['appliedMods']
    usedGroupDigests?: RunRecord['usedGroupDigests']
    sourceContext?: SourceContextSnapshot
    contextBudget?: RunRecord['contextBudget']
    plan?: RunRecord['plan']
    triggeredBy?: RunRecord['triggeredBy']
    aiAccessPhases?: RunRecord['aiAccessPhases']
    resultPlacementContext?: ResultPlacementContext
    agentic?: true
  }) => { runId: string; versionId: string; outputId: string; resultCardId: string }
  beginGroupDigestRun: (groupCardId: string, compiled: {
    text: string
    model: string
    usedCardIds: string[]
    usedConnectionIds: string[]
    digestKey: string
    triggeredBy?: RunRecord['triggeredBy']
    sourceContext?: SourceContextSnapshot
  }) => { runId: string; versionId: string; outputId: string; resultCardId: string }
  appendVersionText: (versionId: string, chunk: string) => void
  // The tool loop restarts the streamed answer when prose already streamed
  // turns out to be the model talking between tool calls (#961): the saved
  // answer keeps only the final turn, and the trail narrates the rest.
  resetVersionText: (versionId: string) => void
  recordRunToolStep: (runId: string, step: RunToolStep) => void
  finishRun: (runId: string) => void
  failRun: (runId: string, message: string) => void
  cancelRun: (runId: string) => void
  chooseVersion: (outputId: string, versionId: string) => CommitResult
  setVersionAccepted: (outputId: string, versionId: string, accepted?: boolean) => CommitResult
  appendFollowUpMessage: (versionId: string, message: FollowUpMessage) => void
  appendFollowUpChunk: (versionId: string, messageId: string, chunk: string) => void
  // The follow-up twin of resetVersionText, for the same reason (#961).
  resetFollowUpMessageText: (versionId: string, messageId: string) => void
  recordFollowUpToolStep: (versionId: string, messageId: string, step: RunToolStep) => void
  finishFollowUpMessage: (versionId: string, messageId: string, status: FollowUpStatus) => CommitResult
  setFollowUpCollapsed: (versionId: string, collapsed: boolean) => void
  clearFollowUpThread: (versionId: string) => CommitResult
  createVersionNote: (
    versionId: string,
    text: string,
    position: { x: number; y: number },
    source: 'version' | 'followup' | 'conversation',
    sourceMessageId?: string,
  ) => string | null

  // --- conversation run writes ---
  beginConversationRun: (
    conversationCardId: string,
    init: {
      model: string
      usedCardIds: string[]
      usedConnectionIds: string[]
      modIds?: string[]
      appliedMods?: RunRecord['appliedMods']
      conversation: ConversationProvenance
      seedTranscript?: TranscriptMessage[]
      sourceContext?: SourceContextSnapshot
      contextBudget?: RunContextBudget
      triggeredBy?: RunRecord['triggeredBy']
      aiAccessPhases?: RunRecord['aiAccessPhases']
    },
  ) => { runId: string; versionId: string; outputId: string; resultCardId: string }
  // Continue an existing conversation IN PLACE: one whole conversation (initial run
  // plus any interjections/continuations) is one version. Reuses the run that
  // produced the version, flips it back to running, clears any Provisional marker,
  // and refreshes its provenance while keeping the turns recorded so far.
  continueConversationRun: (
    conversationCardId: string,
    versionId: string,
    provenance: ConversationProvenance,
    sourceContext?: SourceContextSnapshot,
    mods?: Pick<RunRecord, 'modIds' | 'appliedMods'>,
    aiAccessPhase?: NonNullable<RunRecord['aiAccessPhases']>[number],
  ) => { runId: string; versionId: string }
  updateConversationProvenance: (runId: string, partial: Partial<ConversationProvenance>) => void
  appendTranscriptMessage: (versionId: string, message: TranscriptMessage) => void
  appendTranscriptChunk: (versionId: string, messageId: string, chunk: string) => void
  finishTranscriptMessage: (versionId: string, messageId: string) => void
  recordConversationTurn: (runId: string, turn: ConversationTurnRecord) => void
  finishConversationRun: (runId: string) => void
  failConversationRun: (runId: string, message: string) => void
  cancelConversationRun: (runId: string) => void
  dismissSourceChanges: (versionId: string, signature: string) => void

  // --- export ---
  snapshot: () => SavedBoard

  // --- derived lookups ---
  graph: () => BoardGraphIndex
}

type BrowserDevelopmentSaveRequest = Readonly<{
  ideaId: string
  board: SavedBoard
}>

let debouncedSave: DebouncedSaver<BrowserDevelopmentSaveRequest> | null = null
let browserDeletingIdeaId: string | null = null
const PACKAGED_PROFILE_CAPTURE_QUIET_MS = 3_000
let deferredPackagedProfileCaptureTimer: ReturnType<typeof setTimeout> | null = null
let deferredPackagedProfileCaptureFrame: number | null = null
let deferredPackagedProfileCapturePending = false
let hydrationPromise: Promise<void> | null = null
let configuredPersistenceSelection: ProfileRendererPersistenceSelection | undefined
let configuredApiCredentialBridge: InstalledKeychainBridge | undefined
let apiCredentialLoad: Promise<void> | undefined
const sessionModOrigins = new Map<string, GuiNewModOrigin>()
const stagedModOrigins = new Map<string, GuiNewModOrigin>()
let pendingNativeExportOperationId: string | undefined
let pendingNativeImportRequest: Readonly<{ operationId: string; idempotencyKey: string }> | undefined
// Staged Board deletion waits out an undo window before the file is touched.
// The window matches the toast rhythm (DESIGN_TIMING_MS.toastDismiss).
const IDEA_DELETE_UNDO_MS = 4_200
let ideaDeleteUndoTimer: ReturnType<typeof setTimeout> | null = null
let packagedIntentActorId: string | undefined
let graphProfileHydrationApplier: ((hydration: ProfileRendererHydration) => undefined) | undefined
let graphProfileAuthoritativeApplier: ((
  update: ProfileRendererAuthoritativeUpdate,
) => ProfileRendererAuthoritativeApplyResult) | undefined
let graphProfileHydrationAdmitter: (() => undefined) | undefined
let graphProfileTerminalApplier: ((failure: ProfileRendererTerminalFailure) => void) | undefined

function rendererRequestsPackagedProfile(): boolean {
  return typeof window !== 'undefined' && window.eidoDesktop === true
}

function currentPersistenceKind(): ProfileRendererPersistenceSelection['kind'] {
  return configuredPersistenceSelection?.kind
    ?? (rendererRequestsPackagedProfile() ? 'packaged-profile' : 'browser-development')
}

function packagedProfilePersistence(): ProfileRendererPersistence | undefined {
  return configuredPersistenceSelection?.kind === 'packaged-profile'
    ? configuredPersistenceSelection.persistence
    : undefined
}

function requirePackagedProfilePersistence(): ProfileRendererPersistence {
  const persistence = packagedProfilePersistence()
  if (!persistence) throw new Error('Packaged Profile persistence is not configured')
  return persistence
}

function installPackagedIntentActorId(candidate: string): void {
  if (!isProfileIntentActorId(candidate)) {
    throw new Error('Packaged Profile Intent actor identity is invalid')
  }
  if (packagedIntentActorId !== undefined && packagedIntentActorId !== candidate) {
    throw new Error('Packaged Profile Intent actor identity changed')
  }
  packagedIntentActorId ??= candidate
}

function requirePackagedIntentActorId(): string {
  if (!packagedIntentActorId) {
    throw new Error('Packaged Profile Intent actor identity is unavailable')
  }
  return packagedIntentActorId
}

function rendererUserCardAuthorship(): CardAuthorship {
  return {
    kind: 'user',
    client: currentPersistenceKind() === 'packaged-profile'
      ? 'eido-desktop'
      : 'eido-browser-development',
    sessionId: packagedProfilePersistence() ? requirePackagedIntentActorId() : getActorId(),
  }
}

function stageProfileModOrigin(cardId: string, companion: ProfileModOriginCompanion): void {
  sessionModOrigins.set(cardId, companion.origin)
  stagedModOrigins.set(cardId, companion.origin)
}

function stageKnownOriginsIntroducedBetween(before: readonly Card[], after: readonly Card[]): void {
  if (!packagedProfilePersistence()) return
  const beforeIds = new Set(before.flatMap((card) => card.modV2 ? [card.id] : []))
  for (const card of after) {
    if (!card.modV2 || beforeIds.has(card.id)) continue
    const origin = sessionModOrigins.get(card.id)
    if (origin) stagedModOrigins.set(card.id, origin)
  }
}

export function captureCurrentProfileRendererCommitState(): ProfileRendererCommitState {
  const state = useGraph.getState()
  if (!state.currentIdeaId || !state.ideas.some((idea) => idea.id === state.currentIdeaId)) {
    throw new Error('Profile renderer state has no active Idea')
  }
  return Object.freeze({
    activeIdeaId: state.currentIdeaId,
    ideas: state.ideas,
    board: state.snapshot(),
    userModTemplates: state.settings.profileModLibrary ?? [],
    newModOrigins: Object.freeze(Object.fromEntries(stagedModOrigins)),
  })
}

function acknowledgeScheduledOrigins(origins: Readonly<Record<string, GuiNewModOrigin>>): void {
  for (const [cardId, origin] of Object.entries(origins)) {
    if (stagedModOrigins.get(cardId) === origin) stagedModOrigins.delete(cardId)
  }
}

function schedulePackagedProfileState(
  persistence: ProfileRendererPersistence = requirePackagedProfilePersistence(),
  state: ProfileRendererCommitState = captureCurrentProfileRendererCommitState(),
): number {
  cancelDeferredPackagedProfileCapture()
  const generation = persistence.schedule(state)
  acknowledgeScheduledOrigins(state.newModOrigins)
  return generation
}

function cancelDeferredPackagedProfileCapture(): void {
  if (deferredPackagedProfileCaptureTimer !== null) {
    clearTimeout(deferredPackagedProfileCaptureTimer)
    deferredPackagedProfileCaptureTimer = null
  }
  if (deferredPackagedProfileCaptureFrame !== null) {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(deferredPackagedProfileCaptureFrame)
    }
    deferredPackagedProfileCaptureFrame = null
  }
  deferredPackagedProfileCapturePending = false
}

function deferPackagedProfileState(
  persistence: ProfileRendererPersistence,
  onFailure: () => void,
): void {
  cancelDeferredPackagedProfileCapture()
  deferredPackagedProfileCapturePending = true

  const capture = () => {
    if (!deferredPackagedProfileCapturePending) return
    deferredPackagedProfileCaptureTimer = null
    deferredPackagedProfileCaptureFrame = null
    deferredPackagedProfileCapturePending = false
    try {
      schedulePackagedProfileState(persistence)
    } catch {
      onFailure()
    }
  }

  const beginQuietPeriod = () => {
    deferredPackagedProfileCaptureFrame = null
    if (!deferredPackagedProfileCapturePending) return
    if (deferredPackagedProfileCaptureTimer !== null) {
      clearTimeout(deferredPackagedProfileCaptureTimer)
    }
    deferredPackagedProfileCaptureTimer = setTimeout(
      capture,
      PACKAGED_PROFILE_CAPTURE_QUIET_MS,
    )
  }

  // Text and completed geometry share one global quiet window. Every routine
  // edit resets it, so an older gesture capture can never fire while typing is
  // still active. The bounded fallback protects background/headless renderers;
  // a real paint opportunity restarts the same quiet period after that frame.
  deferredPackagedProfileCaptureTimer = setTimeout(
    capture,
    PACKAGED_PROFILE_CAPTURE_QUIET_MS,
  )
  if (typeof requestAnimationFrame === 'function') {
    deferredPackagedProfileCaptureFrame = requestAnimationFrame(beginQuietPeriod)
  }
}

function flushDeferredPackagedProfileState(
  persistence: ProfileRendererPersistence,
): void {
  if (!deferredPackagedProfileCapturePending) return
  cancelDeferredPackagedProfileCapture()
  schedulePackagedProfileState(persistence)
}

export function profileRendererCheckpointPersistence(): Pick<
  ProfileRendererPersistence,
  'schedule' | 'flush'
> {
  const persistence = requirePackagedProfilePersistence()
  return Object.freeze({
    schedule: (state) => schedulePackagedProfileState(persistence, state),
    flush: () => {
      flushDeferredPackagedProfileState(persistence)
      return persistence.flush()
    },
  })
}

export function applyProfileRendererSaveStatus(status: ProfileRendererSaveStatus): void {
  // Report exactly what the writer reports. A pending quiet-window capture is
  // queued work, not a write, and must not hold the top bar in "Saving".
  //
  // Known and accepted: with only three states, an edit still inside the quiet
  // window reads as "Saved" until the write starts. That claim is false for up
  // to the quiet window's length. The founder chose it over a fourth state, on
  // the grounds that a permanent "Saving" was the worse lie. Revisit this with
  // a distinct pending state, not by restoring the old override.
  useGraph.setState({ saveState: status })
}

export function configureGraphPersistence(selection: ProfileRendererPersistenceSelection): void {
  if (configuredPersistenceSelection) {
    throw new Error('Graph persistence has already been configured')
  }
  configuredPersistenceSelection = selection
  if (selection.kind === 'packaged-profile') {
    if (!graphProfileHydrationApplier
      || !graphProfileAuthoritativeApplier
      || !graphProfileHydrationAdmitter
      || !graphProfileTerminalApplier) {
      throw new Error('Graph Profile state sink is unavailable')
    }
    selection.persistence.connectStateSink(Object.freeze({
      applyHydration: graphProfileHydrationApplier,
      applyAuthoritativeUpdate: graphProfileAuthoritativeApplier,
      admitHydration: graphProfileHydrationAdmitter,
      applySaveStatus: applyProfileRendererSaveStatus,
      applyTerminalFailure: graphProfileTerminalApplier,
    }))
    // The native Profile snapshot is the only packaged Mod-catalog authority.
    useGraph.setState((state) => ({
      persistenceKind: selection.kind,
      storageStatus: null,
      settings: { ...state.settings, profileModLibrary: [] },
    }))
    return
  }
  useGraph.setState({ persistenceKind: selection.kind })
}

// Whether reach can run through Linkup, asked without handling the secret.
// Everything that decides how a run reaches the web goes through here, so the
// question has one answer and no caller ever compares a key to an empty string
// by hand.
export function linkupKeyOf(settings: Readonly<{ linkupKey?: string }>): string {
  return settings.linkupKey?.trim() ?? ''
}

export function hasLinkupKey(settings: Readonly<{ linkupKey?: string }>): boolean {
  return linkupKeyOf(settings).length > 0
}

export function configureGraphApiCredential(
  persistenceKind: ProfileRendererPersistenceSelection['kind'],
  candidateBridge: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): Promise<void> {
  if (apiCredentialLoad) throw new Error('Graph API credential has already been configured')
  const bridge = persistenceKind === 'packaged-profile'
    ? requireInstalledKeychainBridge(candidateBridge)
    : undefined
  configuredApiCredentialBridge = bridge
  // Until the OS answers, provider access remains locked. In particular, a
  // pending Linkup credential must not silently downgrade a Research run.
  if (bridge) useGraph.setState({ apiKeyLocked: true, linkupKeyLocked: true })
  apiCredentialLoad = (async () => {
    const openrouter = await loadApiCredential({ bridge, storage })
    const linkup = await loadLinkupCredential({ bridge })
    const apiKey = openrouter.apiKey
    const linkupKey = linkup.apiKey
    useGraph.setState((state) => ({
      settings: { ...state.settings, apiKey, linkupKey },
      linkupKeyPresent: hasLinkupKey({ linkupKey }),
      apiKeyLocked: openrouter.locked && !apiKey,
      linkupKeyLocked: linkup.locked && !linkupKey,
    }))
  })()
  return apiCredentialLoad
}

function requireInstalledKeychainBridge(candidate: unknown): InstalledKeychainBridge {
  if (!isInstalledKeychainBridge(candidate)) {
    throw new Error('Installed Keychain bridge is unavailable')
  }
  return candidate
}

export function resetGraphPersistenceForTests(): void {
  cancelDeferredPackagedProfileCapture()
  configuredPersistenceSelection = undefined
  configuredApiCredentialBridge = undefined
  apiCredentialLoad = undefined
  sessionModOrigins.clear()
  stagedModOrigins.clear()
  packagedIntentActorId = undefined
  pendingNativeExportOperationId = undefined
  pendingNativeImportRequest = undefined
  debouncedSave = null
  browserDeletingIdeaId = null
  hydrationPromise = null
  profileRendererMutationAdmissionFrozen = false
}

let profileRendererMutationAdmissionFrozen = false

export function freezeProfileRendererMutationAdmissionForUpdate(): void {
  profileRendererMutationAdmissionFrozen = true
}

export const useGraph = create<GraphState>((set, get) => {
  const initialSettings = loadSettings(!rendererRequestsPackagedProfile())

  const profileMutationAdmitted = () => !profileRendererMutationAdmissionFrozen
    && (!packagedProfilePersistence()
      || (get().hydrated && get().profileStartupState === 'ready'))

  type PackagedProfileCaptureTiming = 'immediate' | 'routine-quiet'

  const captureBrowserDevelopmentSave = () => {
    const state = get()
    const ideaId = state.currentIdeaId
    if (!ideaId || ideaId === browserDeletingIdeaId) return null
    const {
      cards,
      connections,
      outputs,
      runs,
      highlights,
      highlightTags,
      intentLog,
      compactionSummaries,
      settings,
      boardSettings,
      foreignAiSettings,
    } = state
    const aiSettings = boardAiSettingsFrom(settings, foreignAiSettings)
    const updatedAt = new Date().toISOString()

    // Bind the target and immutable Graph collection identities now, while
    // leaving the content-proportional SavedBoard projection until the quiet
    // window actually drains. A later Idea switch can therefore neither make
    // this request capture the new Board nor save it under the wrong id.
    return () => Object.freeze({
      ideaId,
      board: makeSavedBoard({
        cards,
        connections,
        outputs,
        runs,
        highlights,
        highlightTags,
        intentLog,
        compactionSummaries,
        aiSettings,
        settings: boardSettings,
        updatedAt,
      }),
    })
  }

  // Persist every committed change. Routine text and completed geometry share
  // one post-paint quiet window; ordinary semantic mutations retain the
  // immediate durability path.
  const persist = (captureTiming: PackagedProfileCaptureTiming = 'immediate') => {
    if (!get().hydrated || !get().currentIdeaId) return true
    const profilePersistence = packagedProfilePersistence()
    if (!profilePersistence) {
      const source = captureBrowserDevelopmentSave()
      if (!source) return true
      // Do not claim "saving" for the quiet window. The debounced saver reports
      // 'saving' when the write actually starts, so the top bar shows a short,
      // truthful write instead of a permanent three-second pending state.
      debouncedSave?.(source)
      return true
    }
    try {
      // The save scheduler emits 'saving' when a write is submitted. Queue time
      // is not write time, so the indicator stays on its last real status here.
      if (captureTiming === 'routine-quiet') {
        deferPackagedProfileState(profilePersistence, () => set({ saveState: 'failed' }))
      } else {
        schedulePackagedProfileState(profilePersistence)
      }
      return true
    } catch {
      set({ saveState: 'failed' })
      return false
    }
  }

  const updateRecommendedModelCatalog = (
    models: readonly string[],
    selectedOverride?: string,
  ): void => {
    if (isProfileReviewExecution()) return
    const current = get().settings
    const normalizedCatalog = normalizeRecommendedModelCatalog(models)
    const currentProviderModels = normalizeProviderModelSettingsMap(current.providerModels)
    const selected = selectedOverride
      ?? (current.provider === 'openrouter'
        ? current.model
        : currentProviderModels.openrouter.model)
    const openrouterModels = normalizeRecommendedModelCatalog([
      ...normalizedCatalog,
      selected,
    ])
    const currentCatalog = current.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS
    if (sameModelList(currentCatalog, normalizedCatalog)
      && currentProviderModels.openrouter.model === selected
      && sameModelList(currentProviderModels.openrouter.models, openrouterModels)
      && (current.provider !== 'openrouter' || (
        current.model === selected && sameModelList(current.models, openrouterModels)
      ))) return
    const nextProviderModels = {
      ...currentProviderModels,
      openrouter: { model: selected, models: [...openrouterModels] },
    }
    set({
      settings: {
        ...current,
        providerModels: nextProviderModels,
        recommendedModelCatalog: [...normalizedCatalog],
        recommendedModelCatalogExplicit: true,
        ...(current.provider === 'openrouter'
          ? { model: selected, models: [...openrouterModels] }
          : {}),
      },
    })
    saveRecommendedModelCatalog(normalizedCatalog)
  }

  const stopCurrentBoardFollowUps = () => {
    stopLiveFollowUpStreams(
      get().outputs.flatMap((output) => output.versions.map((version) => version.id)),
    )
  }

  const followUpsLosingAuthoritativeDestination = (
    nextBoard: SavedBoard,
    nextIdeaId: string,
  ): string[] => {
    const currentOutputs = get().outputs
    if (get().currentIdeaId !== nextIdeaId) {
      return currentOutputs.flatMap((output) => output.versions.map((version) => version.id))
    }

    const nextResultCardIds = new Set(
      graphIndexForBoard(nextBoard).cardsByKind('result').map((card) => card.id),
    )
    const nextLocations = new Map<string, { output: Output; version: OutputVersion }>()
    for (const output of nextBoard.outputs) {
      for (const version of output.versions) {
        nextLocations.set(version.id, { output, version })
      }
    }

    return currentOutputs.flatMap((output) => output.versions.flatMap((version) => {
      const next = nextLocations.get(version.id)
      const destinationPreserved = next
        && nextResultCardIds.has(next.output.resultCardId)
        && next.output.id === output.id
        && next.output.resultCardId === output.resultCardId
        && next.version.number === version.number
        && next.version.fromRunId === version.fromRunId
        && next.version.createdAt === version.createdAt
      return destinationPreserved ? [] : [version.id]
    }))
  }

  const replaceBoard = (board: SavedBoard) => {
    stopCurrentBoardFollowUps()
    const normalized = normalizeBoardForRuntime(board)
    const highlightTags = normalized.highlightTags ?? []
    return {
      cards: normalized.cards,
      connections: normalized.connections,
      outputs: normalized.outputs,
      runs: normalized.runs,
      highlights: normalized.highlights ?? [],
      highlightTags,
      intentLog: normalized.intentLog ?? [],
      compactionSummaries: normalized.compactionSummaries ?? [],
      // Held, never read. See the GraphState declaration.
      boardSettings: normalized.settings,
      foreignAiSettings: foreignBoardAiSettings(normalized.aiSettings),
      lastBoardChange: null,
      boardChangeSeq: 0,
      selection: null,
      selectedCardIds: [],
      connectionEditorId: null,
      connectionPulse: null,
      connectionFlip: null,
      activeTool: DEFAULT_CANVAS_TOOL,
      activeHighlightTagId: highlightTags[0]?.id ?? null,
      highlightsPanelOpen: false,
      cardFocusRequest: null,
      undoStack: [],
      redoStack: [],
      cardClipboard: null,
    }
  }

  const replaceBoardWithSettings = (board: SavedBoard) => ({
    ...replaceBoard(board),
    settings: settingsWithResolvedBoardAiSettings(get().settings, board.aiSettings),
  })

  const savedBoardWithoutTimestamp = (board: SavedBoard) => {
    const { updatedAt: _updatedAt, ...saved } = boardWithResolvedAiSettings(
      board,
      boardAiSettingsFallback(get().settings),
    )
    return saved
  }

  const rendererStateMatchesHydration = (hydration: ProfileRendererHydration): boolean => {
    const state = get()
    if (state.currentIdeaId !== hydration.idea.id) return false
    if (JSON.stringify(state.ideas) !== JSON.stringify(hydration.ideas)) return false
    if (JSON.stringify(state.settings.profileModLibrary ?? [])
      !== JSON.stringify(hydration.userModTemplates)) {
      return false
    }
    return JSON.stringify(savedBoardWithoutTimestamp(state.snapshot()))
      === JSON.stringify(savedBoardWithoutTimestamp(hydration.board))
  }

  const profileHydrationState = (
    hydration: ProfileRendererHydration,
    resetOrigins = false,
    admitMutation = true,
  ): Partial<GraphState> => {
    if (resetOrigins) {
      sessionModOrigins.clear()
      stagedModOrigins.clear()
    }
    for (const card of hydration.board.cards) {
      if (card.modV2 && !hydration.modOrigins[card.id]) {
        throw new Error(`Profile hydration Mod Card ${card.id} has no exact native origin`)
      }
    }
    for (const [cardId, origin] of Object.entries(hydration.modOrigins)) {
      sessionModOrigins.set(cardId, origin)
    }
    return {
      ...replaceBoard(hydration.board),
      settings: settingsWithResolvedBoardAiSettings(
        get().settings,
        hydration.board.aiSettings,
        hydration.userModTemplates,
      ),
      ideas: [...hydration.ideas],
      currentIdeaId: hydration.idea.id,
      storageStatus: null,
      hydrated: admitMutation ? true : get().hydrated,
      saveState: 'saved',
      profileStartupState: admitMutation ? 'ready' : get().profileStartupState,
      profileStartupError: null,
      profileStartupErrorKind: null,
      recoveryCandidates: admitMutation ? [] : get().recoveryCandidates,
      restoringRecoveryCandidateId: admitMutation ? null : get().restoringRecoveryCandidateId,
      startingFreshProfile: admitMutation ? false : get().startingFreshProfile,
      ideaManagerOpen: false,
    }
  }

  const applyProfileHydration = (
    hydration: ProfileRendererHydration,
    resetOrigins = false,
  ) => {
    installPackagedIntentActorId(hydration.intentActorId)
    set(profileHydrationState(hydration, resetOrigins))
  }

  graphProfileHydrationApplier = (hydration) => {
    installPackagedIntentActorId(hydration.intentActorId)
    set(profileHydrationState(hydration, false, false))
    return undefined
  }

  graphProfileHydrationAdmitter = () => {
    requirePackagedIntentActorId()
    set({
      hydrated: true,
      saveState: 'saved',
      profileStartupState: 'ready',
      profileStartupError: null,
      profileStartupErrorKind: null,
      recoveryCandidates: [],
      restoringRecoveryCandidateId: null,
      startingFreshProfile: false,
    })
    return undefined
  }

  graphProfileTerminalApplier = (failure) => {
    if (failure.kind !== 'terminal') return
    set({
      hydrated: false,
      saveState: 'failed',
      profileStartupState: 'failed',
      profileStartupError: failure.error.message,
      profileStartupErrorKind: null,
      recoveryCandidates: [],
      restoringRecoveryCandidateId: null,
      startingFreshProfile: false,
      ideaManagerOpen: false,
    })
  }

  const markProfileFailure = (error: unknown) => {
    set({
      saveState: 'failed',
      profileStartupState: get().hydrated ? get().profileStartupState : 'failed',
      profileStartupError: error instanceof Error ? error.message : 'Profile persistence failed',
      restoringRecoveryCandidateId: null,
      startingFreshProfile: false,
    })
  }

  const boardCommitState = (): BoardCommitState => {
    const s = get()
    return {
      cards: s.cards,
      connections: s.connections,
      outputs: s.outputs,
      runs: s.runs,
      highlights: s.highlights,
      highlightTags: s.highlightTags,
      compactionSummaries: s.compactionSummaries,
    }
  }

  const boardCommitStateFromHydration = (
    hydration: ProfileRendererHydration,
  ): BoardCommitState => {
    const board = normalizeBoardForRuntime(hydration.board)
    return {
      cards: board.cards,
      connections: board.connections,
      outputs: board.outputs,
      runs: board.runs,
      highlights: board.highlights ?? [],
      highlightTags: board.highlightTags ?? [],
      compactionSummaries: board.compactionSummaries ?? [],
    }
  }

  const boardChangePatch = (
    s: GraphState,
    input: Omit<BoardChangeEmission, 'seq'> | null,
  ): Pick<GraphState, 'lastBoardChange' | 'boardChangeSeq'> | null => {
    if (!input) return null
    const seq = s.boardChangeSeq + 1
    return {
      boardChangeSeq: seq,
      lastBoardChange: { ...input, seq },
    }
  }

  const boardChangeFor = (
    source: BoardChangeSource,
    before: BoardCommitState,
    after: BoardCommitState,
    forwardPatches: Parameters<typeof deriveBoardChange>[2],
    metadata: Omit<BoardChangeEmission, 'seq' | 'source' | 'change'> = {},
  ): Omit<BoardChangeEmission, 'seq'> | null => {
    const change = deriveBoardChange(before, after, forwardPatches)
    return change ? { source, change, ...metadata } : null
  }

  const applyAuthoritativeProfileUpdate = (
    update: ProfileRendererAuthoritativeUpdate,
  ): ProfileRendererAuthoritativeApplyResult => {
    if (!Number.isSafeInteger(update.previousRevision)
      || update.previousRevision < 0
      || !Number.isSafeInteger(update.revision)
      || update.revision <= update.previousRevision) {
      return Object.freeze({ status: 'stale' as const, revision: update.previousRevision })
    }
    if (!rendererStateMatchesHydration(update.previous)) {
      return Object.freeze({ status: 'blocked' as const, revision: update.previousRevision })
    }

    const normalized = normalizeBoardForRuntime(update.next.board)
    for (const card of normalized.cards) {
      if (card.modV2 && !update.next.modOrigins[card.id]) {
        return Object.freeze({ status: 'blocked' as const, revision: update.previousRevision })
      }
    }
    const base = boardCommitState()
    const { next, forwardPatches } = captureCommitPatches(base, (draft) => {
      draft.cards = normalized.cards
      draft.connections = normalized.connections
      draft.outputs = normalized.outputs
      draft.runs = normalized.runs
      draft.highlights = normalized.highlights ?? []
      draft.highlightTags = normalized.highlightTags ?? []
      draft.compactionSummaries = normalized.compactionSummaries ?? []
    })
    const emission = boardChangeFor('external-authority', base, next, forwardPatches, {
      label: 'Apply authoritative Profile revision',
    })
    const authoritativeBefore = boardCommitStateFromHydration(
      update.authoritativeTransition.previous,
    )
    const authoritativeAfter = boardCommitStateFromHydration(
      update.authoritativeTransition.next,
    )
    const authoritativeBoardChanged = authorityChangedAnyBoardCollection(
      authoritativeBefore,
      authoritativeAfter,
    )
    const undoStack = rebaseUndoStackForAuthoritativeUpdate(
      get().undoStack,
      base,
      next,
      authoritativeBefore,
      authoritativeAfter,
      authoritativeBoardChanged,
    )
    const redoStack = rebaseUndoStackForAuthoritativeUpdate(
      get().redoStack,
      base,
      next,
      authoritativeBefore,
      authoritativeAfter,
      authoritativeBoardChanged,
    )

    const followUpsLosingAuthority = followUpsLosingAuthoritativeDestination(
      normalized,
      update.next.idea.id,
    )
    if (followUpsLosingAuthority.length > 0) {
      stopLiveFollowUpStreams(followUpsLosingAuthority)
    }
    sessionModOrigins.clear()
    stagedModOrigins.clear()
    for (const [modId, origin] of Object.entries(update.next.modOrigins)) {
      sessionModOrigins.set(modId, origin)
    }
    set((state) => ({
      ...next,
      intentLog: normalized.intentLog ?? [],
      // Held, never read. See the GraphState declaration.
      boardSettings: normalized.settings,
      foreignAiSettings: foreignBoardAiSettings(normalized.aiSettings),
      settings: settingsWithResolvedBoardAiSettings(
        state.settings,
        normalized.aiSettings,
        update.next.userModTemplates,
      ),
      ideas: [...update.next.ideas],
      currentIdeaId: update.next.idea.id,
      saveState: 'saved',
      undoStack,
      redoStack,
      ...boardChangePatch(state, emission),
    }))
    return Object.freeze({ status: 'applied' as const, revision: update.revision })
  }

  graphProfileAuthoritativeApplier = applyAuthoritativeProfileUpdate

  // The commit funnel (ADR 0016) — the only writer to board state, the undo
  // ring, and the Intent Log. Exactly one of three shapes happens:
  //   MUTATING  (patches non-empty): state + the events under one commitId.
  //             User work adds one undo entry; trusted external work rebases
  //             the existing undo/redo rings without entering either one.
  //   NARRATIVE (patches empty, events non-empty): events append under their
  //             own commitId; nothing to undo.
  //   EMPTY     (patches empty, events empty): nothing is written at all —
  //             the length-guarded "emit only if changed" idiom, enforced
  //             here instead of at call sites.
  // The mechanical Immer patches feed the undo ring ONLY; change-describing
  // event payloads must be built from the shared card-diff (history.ts)
  // BEFORE calling commit.
  const stampForCommit = (events: IntentLogEventDraft[], commitId: string, at: string) =>
    stampIntentEvents(events, {
      commitId,
      actorId: packagedProfilePersistence() ? requirePackagedIntentActorId() : getActorId(),
      clientTxnId: newId('txn'),
      at,
      ideaId: get().currentIdeaId ?? undefined,
      retainedEvents: get().intentLog,
    })

  // The ONE Intent Log append expression the funnel owns (the bypass guard in
  // intentLogGuard.test.ts pins this). Spread the result into a set() updater.
  const appendStampedEvents = (s: GraphState, stamped: IntentLogEvent[]) =>
    stamped.length ? { intentLog: [...s.intentLog, ...stamped] } : null

  // Board-state writes whose semantics deliberately stay out of undo and the
  // Intent Log: streaming chunks, editor-local text state, visual preferences,
  // and other interaction-local progress. Semantic events for those actions
  // are recorded separately through commit() when the user action completes.
  const writeBoardState = (
    updater: (draft: BoardCommitState) => void,
    options: {
      persist?: boolean
      deferPackagedCapture?: boolean
      // Browser streaming progress must replace the lazy bound source with
      // the newest immutable collection identities. Gesture progress leaves
      // this false and persists exactly once through its release summary.
      refreshBrowserPendingSave?: boolean
      // Semantic-history undo/redo replays apply through this writer too; they
      // must not masquerade as live 'progress' edits in the change stream.
      boardChange?: { source: BoardChangeSource; targetCommitId?: string; label?: string }
    } = {},
  ) => {
    if (!profileMutationAdmitted()) return false
    const base = boardCommitState()
    const { next, forwardPatches } = captureCommitPatches(base, updater)
    if (!forwardPatches.length) return false
    const { source = 'progress', ...metadata } = options.boardChange ?? {}
    const emission = boardChangeFor(source, base, next, forwardPatches, metadata)
    set((s) => ({
      ...next,
      ...boardChangePatch(s, emission),
    }))
    if (options.persist !== false) {
      persist(options.deferPackagedCapture ? 'routine-quiet' : 'immediate')
    } else {
      const profilePersistence = packagedProfilePersistence()
      if (profilePersistence) {
        try {
          const state = captureCurrentProfileRendererCommitState()
          if (profilePersistence.captureAuthoritativeMutationProgress(state)) {
            // The native barrier accepted this exact state as its new
            // renderer-progress base. Cancel the older deferred task only
            // after that authoritative schedule succeeds; ordinary
            // renderer-local progress must leave pending work untouched.
            cancelDeferredPackagedProfileCapture()
            acknowledgeScheduledOrigins(state.newModOrigins)
          }
        } catch {
          set({ saveState: 'failed' })
        }
      } else if (options.refreshBrowserPendingSave) {
        persist('routine-quiet')
      }
    }
    return true
  }

  // Adoption is a durable writer transition, not part of the reversible edit.
  // Commit-backed callers stamp before capturing their undo base; immediate
  // editors use writeUserCardEdit so the edit and writer move atomically.
  const adoptAgentCards = (cardIds: readonly string[]) => {
    const requestedIds = new Set(cardIds)
    if (!requestedIds.size) return false
    const graph = get().graph()
    const targets = [...requestedIds].flatMap((id) => {
      const order = graph.cardOrder(id)
      const candidate = graph.cardById(id)
      return order !== undefined && candidate && isAgentUnadoptedCard(candidate)
        ? [{ id, order }]
        : []
    })
    if (!targets.length) return false
    const lastModifiedBy = rendererUserCardAuthorship()
    return writeBoardState((draft) => {
      for (const { id, order } of targets) {
        const candidate = draft.cards[order]
        if (candidate?.id === id && isAgentUnadoptedCard(candidate)) {
          draft.cards[order] = { ...candidate, lastModifiedBy }
        }
      }
    }, { persist: false })
  }

  const adoptAgentCard = (cardId: string) => adoptAgentCards([cardId])

  const adoptStructurallyChangedAgentCards = (action: HistoryAction | undefined) => {
    if (action?.type !== 'cardsUpdated') return false
    return adoptAgentCards(action.patches.flatMap((patch) => [
      patch.id,
      ...(patch.before.groupId !== patch.after.groupId && patch.before.groupId
        ? [patch.before.groupId]
        : []),
      ...(patch.before.groupId !== patch.after.groupId && patch.after.groupId
        ? [patch.after.groupId]
        : []),
    ]))
  }

  const adoptAgentGroupsWithMembershipChanges = (
    beforeCards: readonly Card[],
    afterCards: readonly Card[],
  ) => {
    const changes = groupMembershipChanges([...beforeCards], [...afterCards])
    if (!changes) return false
    return adoptAgentCards(Object.values(changes).flatMap((change) => [
      ...(change.from ? [change.from] : []),
      ...(change.to ? [change.to] : []),
    ]))
  }

  const writeUserCardEdit = (
    cardId: string,
    updater: (card: Card) => Card,
    options: { deferPackagedCapture?: boolean } = {},
  ) => {
    const graph = get().graph()
    const order = graph.cardOrder(cardId)
    const card = graph.cardById(cardId)
    if (order === undefined || !card) return false
    const updated = updater(card)
    if (updated === card) return false
    const nextCard = isAgentUnadoptedCard(card)
      ? { ...updated, lastModifiedBy: rendererUserCardAuthorship() }
      : updated
    return writeBoardState((draft) => {
      if (draft.cards[order]?.id === cardId) draft.cards[order] = nextCard
    }, options)
  }
  const commit = (
    label: string,
    updater: (draft: BoardCommitState) => void,
    events: IntentLogEventDraft[],
    history: 'user' | 'external' = 'user',
  ): CommitResult => {
    if (!profileMutationAdmitted()) return { commitId: null, changed: false }
    const base = boardCommitState()
    const { next, forwardPatches, inversePatches } = captureCommitPatches(base, updater)
    const changed = forwardPatches.length > 0
    // EMPTY commit: nothing is written, so no commit identity is allocated.
    if (!changed && events.length === 0) return { commitId: null, changed: false }
    const commitId = newId('commit')
    const at = new Date().toISOString()
    const stamped = stampForCommit(events, commitId, at)
    const emission = changed
      ? boardChangeFor(
        history === 'external' ? 'external-authority' : 'commit',
        base,
        next,
        forwardPatches,
        { commitId, label },
      )
      : null
    set((s) => ({
      ...(changed ? next : null),
      ...appendStampedEvents(s, stamped),
      ...boardChangePatch(s, emission),
      ...(changed
        ? history === 'user'
          ? {
            undoStack: [
              ...s.undoStack,
              {
                kind: 'patches' as const,
                id: newId('hist'),
                commitId,
                label,
                createdAt: at,
                inversePatches,
                forwardPatches,
              },
            ].slice(-UNDO_RING_LIMIT),
            redoStack: [],
          }
          : {
              undoStack: rebaseUndoStackForAuthoritativeUpdate(s.undoStack, base, next),
              redoStack: rebaseUndoStackForAuthoritativeUpdate(s.redoStack, base, next),
            }
        : null),
    }))
    persist()
    return { commitId, changed }
  }

  // Public domain modules such as the single-class Mod host commit through
  // this seam rather than the card-specific store actions above. Preview only
  // to identify surviving Agent Cards whose meaning actually changes, then
  // adopt them before the real commit captures its undo base. Undo therefore
  // reverses the edit without reviving the Agent accent.
  const commitPublic = (
    label: string,
    updater: (draft: BoardCommitState) => void,
    events: IntentLogEventDraft[],
  ): CommitResult => {
    const base = boardCommitState()
    const preview = captureCommitPatches(base, updater).next
    const previewCards = new Map(preview.cards.map((card) => [card.id, card]))
    adoptAgentCards(base.cards.flatMap((card) => {
      const next = previewCards.get(card.id)
      return next
        && isAgentUnadoptedCard(card)
        && stableStringify(card) !== stableStringify(next)
        ? [card.id]
        : []
    }))
    return commit(label, updater, events)
  }

  const commitConnectionReplacement = (label: string, before: Connection, after: Connection) =>
    commit(
      label,
      (draft) => {
        draft.connections = draft.connections.map((connection) =>
          connection.id === before.id ? after : connection,
        )
      },
      [
        {
          type: 'connection.changed',
          connectionId: before.id,
          data: { before: cloneForLog(before), after: cloneForLog(after) },
        },
      ],
    )

  const insertClonedCards = (cloned: ReturnType<typeof cloneCardsFrom>, label: string) => {
    if (cloned.cards.length === 0) return []
    const beforeCards = get().cards
    const plannedCards = reconcileGroupMembership([...beforeCards, ...cloned.cards])
    adoptAgentGroupsWithMembershipChanges(beforeCards, plannedCards)
    if (packagedProfilePersistence()) {
      for (const card of cloned.cards) {
        if (card.modV2) {
          stageProfileModOrigin(
            card.id,
            captureDirectProfileModOrigin(card.modV2, newId('mod-instance')),
          )
        }
      }
    }
    const events: IntentLogEventDraft[] = [
      ...cloned.cards.map((card) =>
        ({ type: 'card.created' as const, cardId: card.id, data: { card: cloneForLog(card) } }),
      ),
      ...cloned.connections.map((connection) => ({
        type: 'connection.created' as const,
        connectionId: connection.id,
        data: { connection: cloneForLog(connection) },
      })),
    ]
    commit(
      label,
      (draft) => {
        draft.cards = reconcileGroupMembership([...draft.cards, ...cloned.cards])
        draft.connections.push(...cloned.connections)
      },
      events,
    )
    return cloned.ids
  }

  // The one-shot connection beats. A component lifecycle cannot own their
  // retirement — edges remount on every commit and canvas-painted connections
  // never mount an edge at all — so the store schedules it here. Edges that do
  // mount retire the beat early on animation end; the seq guard makes the
  // late timer a no-op then.
  const beginConnectionPulse = (connectionId: string) => {
    const seq = ++connectionFeelSeq
    set({ connectionPulse: { connectionId, seq } })
    setTimeout(() => get().clearConnectionPulse(seq), CONNECT_PULSE_RETIRE_MS)
  }

  const beginConnectionFlip = (connectionId: string, fromPolarity: ConnectionPolarity) => {
    const seq = ++connectionFeelSeq
    set({ connectionFlip: { connectionId, fromPolarity, seq } })
    setTimeout(() => get().clearConnectionFlip(seq), POLARITY_FLIP_RETIRE_MS)
  }

  // Funnel-owned replay path for undo/redo (ADR 0016: undo/redo route THROUGH
  // the funnel). It owns the board-state write, the ring bookkeeping, and —
  // once scenario 5 of the characterization test is signed off — the
  // compensating events (undo.applied / redo.applied), which callers pass as
  // [] until then. No new ring entry is captured: the entry itself moves
  // between the stacks.
  const replayRingEntry = (
    entry: PatchUndoEntry,
    direction: 'undo' | 'redo',
    events: IntentLogEventDraft[],
  ) => {
    if (!profileMutationAdmitted()) return
    const patches = direction === 'undo' ? entry.inversePatches : entry.forwardPatches
    const base = boardCommitState()
    const next = applyRingPatches(base, patches)
    stageKnownOriginsIntroducedBetween(base.cards, next.cards)
    const stamped = events.length
      ? stampForCommit(events, newId('commit'), new Date().toISOString())
      : []
    const emission = boardChangeFor(direction, base, next, patches, {
      targetCommitId: entry.commitId,
      label: entry.label,
    })
    set((s) => ({
      ...next,
      ...appendStampedEvents(s, stamped),
      ...boardChangePatch(s, emission),
      ...(direction === 'undo'
        ? {
            undoStack: s.undoStack.slice(0, -1),
            redoStack: [...s.redoStack, entry].slice(-UNDO_RING_LIMIT),
          }
        : {
            undoStack: [...s.undoStack, entry].slice(-UNDO_RING_LIMIT),
            redoStack: s.redoStack.slice(0, -1),
          }),
      selection: null,
      selectedCardIds: [],
      connectionEditorId: null,
    }))
    persist()
  }

  const currentHistoryBoard = (): HistoryBoardState => {
    const { cards, connections, outputs } = get()
    return { cards, connections, outputs }
  }

  const makeHistoryEntry = (action: HistoryAction, commitId?: string): HistoryEntry => ({
    id: newId('hist'),
    ...(commitId ? { commitId } : {}),
    createdAt: new Date().toISOString(),
    scope: 'structural',
    action,
  })

  // Drag/resize end events summarize state already applied by no-undo progress
  // frames, so they need an interaction-summary commit with one semantic
  // session-undo entry rather than one patch entry per frame.
  const commitInteractionSummary = (
    action: HistoryAction | undefined,
    events: IntentLogEventDraft[],
    captureTiming: PackagedProfileCaptureTiming = 'immediate',
  ) => {
    if (!profileMutationAdmitted()) return
    if (!action && events.length === 0) return
    const commitId = newId('commit')
    const at = new Date().toISOString()
    const stamped = stampForCommit(events, commitId, at)
    set((s) => ({
      ...appendStampedEvents(s, stamped),
      ...(action
        ? {
            undoStack: [...s.undoStack, makeHistoryEntry(action, commitId)].slice(-UNDO_RING_LIMIT),
            redoStack: [],
          }
        : null),
    }))
    persist(captureTiming)
  }

  const locateVersion = (versionId: string, outputs = get().outputs) => {
    for (const output of outputs) {
      const version = output.versions.find((candidate) => candidate.id === versionId)
      if (version) return { output, version }
    }
    return undefined
  }

  const visitOutputVersions = (
    draft: BoardCommitState,
    versionId: string | undefined,
    visit: (version: OutputVersion) => void,
  ) => {
    for (const output of draft.outputs) {
      const version = output.versions.find((candidate) => candidate.id === versionId)
      if (version) visit(version)
    }
  }

  const followUpEventData = (versionId: string, message: FollowUpMessage, outputs = get().outputs) => {
    const located = locateVersion(versionId, outputs)
    return {
      outputId: located?.output.id,
      resultCardId: located?.output.resultCardId,
      message: cloneForLog(message),
    }
  }

  // ---- the run spine (issue #189) ----
  // One internal start/settle pair behind every public run action. Both go
  // through the commit funnel, so run state, the undo ring, and the Intent
  // Log always move together under one commitId.

  const startRun = (
    sourceCardId: string,
    kind: RunRecord['kind'],
    fields: StartRunFields,
  ): { runId: string; versionId: string; outputId: string; resultCardId: string } => {
    const runId = newId('run')
    const versionId = newId('ver')
    const now = new Date().toISOString()
    const index = get().graph()
    const aiAccessPhases = cloneAiAccessPhases(fields.aiAccessPhases)

    // Find (or create) the result Card the run writes to, through the Graph
    // Index's lookup. A group digest writes back onto the group card itself,
    // so there is nothing to find or create.
    let createdResultCard: Card | undefined
    let createdResultConnection: Connection | undefined
    let resultCardId = sourceCardId
    if (kind !== 'groupDigest') {
      let resultCard = index.resultCardFor(sourceCardId)
      if (!resultCard) {
        const ensured = ensureResultCardFor(
          get().cards,
          get().connections,
          sourceCardId,
          fields.resultPlacementContext,
        )
        resultCard = ensured.resultCard
        createdResultCard = ensured.createdCard
        createdResultConnection = ensured.createdConnection
      }
      resultCardId = resultCard.id
    }

    // Append the Output Version (creating the Output on the first run).
    const existingOutput = index.outputForResultCard(resultCardId)
    const outputId = existingOutput?.id ?? newId('out')
    const version: OutputVersion = {
      id: versionId,
      number: (existingOutput?.versions.length ?? 0) + 1,
      text: fields.seedTranscript ? flattenTranscript(fields.seedTranscript) : '',
      createdAt: now,
      fromRunId: runId,
      ...(fields.digestKey !== undefined ? { digestKey: fields.digestKey } : {}),
      ...(fields.seedTranscript
        ? { transcript: fields.seedTranscript.map((m) => ({ ...m, streaming: false })) }
        : {}),
      ...(fields.sourceContext === undefined ? {} : { sourceContext: fields.sourceContext }),
    }

    const run: RunRecord = {
      id: runId,
      startedAt: now,
      askAiCardId: sourceCardId,
      model: fields.model,
      provider: get().settings.provider,
      usedCardIds: fields.usedCardIds,
      usedConnectionIds: fields.usedConnectionIds,
      ...(fields.usedGroupDigests !== undefined ? { usedGroupDigests: fields.usedGroupDigests } : {}),
      modIds: fields.modIds,
      appliedMods: fields.appliedMods,
      compiledInstruction: fields.compiledInstruction,
      status: 'running',
      ...(fields.triggeredBy !== undefined ? { triggeredBy: fields.triggeredBy } : {}),
      ...(aiAccessPhases === undefined ? {} : { aiAccessPhases }),
      producedVersionId: versionId,
      kind,
      ...(fields.conversation ? { conversation: fields.conversation } : {}),
      ...(fields.contextBudget !== undefined ? { contextBudget: fields.contextBudget } : {}),
      ...(fields.plan !== undefined ? { plan: fields.plan } : {}),
      ...(fields.agentic ? { agentic: true } : {}),
    }

    // The event triad: what the run created, then that it started. Group
    // digests additionally narrate compression on the group card.
    const events: IntentLogEventDraft[] = []
    if (createdResultCard) {
      events.push({
        type: 'card.created',
        cardId: createdResultCard.id,
        data: { card: cloneForLog(createdResultCard) },
      })
    }
    if (createdResultConnection) {
      events.push({
        type: 'connection.created',
        connectionId: createdResultConnection.id,
        data: { connection: cloneForLog(createdResultConnection) },
      })
    }
    events.push({ type: 'run.started', runId, data: { run: cloneForLog(run) } })
    if (kind === 'groupDigest') {
      events.push({
        type: 'group.compression.started',
        cardId: sourceCardId,
        runId,
        versionId,
        data: { run: cloneForLog(run) },
      })
    }

    commit(
      'Start run',
      (draft) => {
        if (createdResultCard) draft.cards.push(createdResultCard)
        if (createdResultConnection) draft.connections.push(createdResultConnection)
        const output = draft.outputs.find((o) => o.id === outputId)
        if (output) {
          output.versions.push(version)
          output.chosenVersionId = versionId
        } else {
          draft.outputs.push({ id: outputId, resultCardId, versions: [version], chosenVersionId: versionId })
        }
        draft.runs.push(run)
      },
      events,
      run.triggeredBy?.kind === 'agent' ? 'external' : 'user',
    )

    return { runId, versionId, outputId, resultCardId }
  }

  // The ONE implementation of the six legacy terminal blocks (finish/fail/
  // cancel × plain/conversation). "A Run settles exactly once" is a store
  // invariant: settling a missing or already-terminal run is a no-op. The one
  // legal way back to running is continueConversationRun's explicit
  // run.continued transition, which arms exactly one more settle.
  const settleRun = (runId: string, status: RunTerminalStatus, message?: string) => {
    const run = get().graph().runById(runId)
    if (!run || run.status !== 'running') return
    const finishedAt = new Date().toISOString()
    const settled: RunRecord = {
      ...run,
      status,
      finishedAt,
      ...(status === 'failed' ? { errorMessage: message } : {}),
    }

    const events: IntentLogEventDraft[] = []
    if (status === 'done') events.push({ type: 'run.completed', runId, data: { run: cloneForLog(settled) } })
    if (status === 'failed') events.push({ type: 'run.failed', runId, data: { run: cloneForLog(settled), message } })
    if (status === 'canceled') events.push({ type: 'run.canceled', runId, data: { run: cloneForLog(settled) } })
    if (run.kind === 'groupDigest') {
      const at = { cardId: run.askAiCardId, runId, versionId: run.producedVersionId }
      if (status === 'done') {
        events.push({ type: 'group.compression.completed', ...at, data: { run: cloneForLog(settled) } })
      }
      if (status === 'failed') {
        events.push({ type: 'group.compression.failed', ...at, data: { run: cloneForLog(settled), message } })
      }
      if (status === 'canceled') {
        events.push({ type: 'group.compression.canceled', ...at, data: { run: cloneForLog(settled) } })
      }
    }

    const label = status === 'done' ? 'Finish run' : status === 'failed' ? 'Fail run' : 'Cancel run'
    commit(
      label,
      (draft) => {
        // What happens to the produced version is the per-status divergence:
        //   done                  — keep it as-is.
        //   failed (plain)        — drop the empty placeholder the run created.
        //   failed (conversation) — keep the transcript as a Provisional Version.
        //   canceled              — keep whatever already streamed, marked Provisional.
        if (status === 'failed' && run.kind !== 'conversation') {
          for (const output of draft.outputs) {
            if (!output.versions.some((v) => v.id === run.producedVersionId)) continue
            output.versions = output.versions.filter((v) => v.id !== run.producedVersionId)
            if (output.chosenVersionId === run.producedVersionId) {
              const fallbackVersionId = output.versions[output.versions.length - 1]?.id
              if (fallbackVersionId === undefined) delete output.chosenVersionId
              else output.chosenVersionId = fallbackVersionId
            }
          }
        } else if (status === 'canceled' || status === 'failed') {
          visitOutputVersions(draft, run.producedVersionId, (version) => {
            version.provisional = true
            version.provisionalReason = status === 'failed' ? 'failed' : 'canceled'
            if (run.kind === 'conversation') {
              if (status === 'failed') version.provisionalMessage = message
              version.transcript = (version.transcript ?? []).map((m) => ({ ...m, streaming: false }))
            } else {
              delete version.provisionalMessage
            }
          })
        }
        const target = draft.runs.find((r) => r.id === runId)
        if (!target) return
        target.status = status
        target.finishedAt = finishedAt
        if (status === 'failed') target.errorMessage = message
      },
      events,
      run.triggeredBy?.kind === 'agent' ? 'external' : 'user',
    )
  }

  return {
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    highlights: [],
    highlightTags: [],
    compactionSummaries: [],
    intentLog: [],
    boardSettings: undefined,
    foreignAiSettings: {},
    lastBoardChange: null,
    boardChangeSeq: 0,

    ideas: [],
    currentIdeaId: null,
    selection: null,
    selectedCardIds: [],
    connectionEditorId: null,
    connectionPulse: null,
    connectionFlip: null,
    activeTool: DEFAULT_CANVAS_TOOL,
    activeHighlightTagId: null,
    highlightsPanelOpen: false,
    cardFocusRequest: null,
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    storageStatus: null,
    hydrated: false,
    persistenceKind: currentPersistenceKind(),
    profileStartupState: 'idle',
    profileStartupError: null,
    profileStartupErrorKind: null,
    recoveryCandidates: [],
    restoringRecoveryCandidateId: null,
    startingFreshProfile: false,
    settings: initialSettings,
    keyPromptOpen: false,
    linkupKeyPresent: hasLinkupKey(initialSettings),
    // Nothing has been read from the protected store yet, so nothing is known
    // to be locked. `configureGraphApiCredential` is the one writer.
    apiKeyLocked: false,
    linkupKeyLocked: false,
    ideaManagerOpen: false,
    pendingIdeaDelete: null,
    cardClipboard: null,

    commit: commitPublic,
    applyAuthoritativeProfileUpdate,

    hydrate: async () => {
      if (get().hydrated) return
      if (hydrationPromise) return hydrationPromise
      set({ profileStartupState: 'loading', profileStartupError: null })
      const profilePersistence = packagedProfilePersistence()
      if (profilePersistence) {
        hydrationPromise = profilePersistence.hydrate()
          .then(() => undefined)
          .catch(async (error: unknown) => {
            if (
              error instanceof ProfileRendererPersistenceError
              && error.failure?.code === 'corrupt-or-recovery-required'
            ) {
              try {
                const inspection = await profilePersistence.inspectRecovery()
                set({
                  hydrated: false,
                  saveState: 'failed',
                  profileStartupState: 'recovery-required',
                  profileStartupError: null,
                  profileStartupErrorKind: null,
                  recoveryCandidates: [...inspection.candidates],
                  restoringRecoveryCandidateId: null,
                  startingFreshProfile: false,
                })
                return
              } catch (inspectionError) {
                markProfileFailure(inspectionError)
                return
              }
            }
            markProfileFailure(error)
          })
          .finally(() => {
            hydrationPromise = null
          })
        return hydrationPromise
      }
      debouncedSave = makeDebouncedSaver<BrowserDevelopmentSaveRequest>(
        3_000,
        (s) => set({ saveState: s }),
        async ({ ideaId, board }) => {
          const idea = await saveIdeaBoard(ideaId, board)
          set((s) => ({
            ideas: s.ideas.map((item) => (item.id === idea.id ? idea : item)),
            storageStatus: currentStorageStatus(),
          }))
        },
      )
      hydrationPromise = loadInitialIdea()
        .then(({ idea, board, ideas }) => {
          set({
            ...replaceBoardWithSettings(board),
            ideas,
            currentIdeaId: idea.id,
            storageStatus: currentStorageStatus(),
            hydrated: true,
            saveState: 'saved',
            profileStartupState: 'ready',
            profileStartupError: null,
          })
        })
        .catch((error: unknown) => {
          markProfileFailure(error)
        })
        .finally(() => {
          hydrationPromise = null
        })
      return hydrationPromise
    },

    loadIdea: async (id) => {
      if (id === get().currentIdeaId) return
      // The user's Board switch revokes execution authority immediately, not
      // after persistence finishes loading the replacement Board.
      stopCurrentBoardFollowUps()
      const profilePersistence = packagedProfilePersistence()
      if (profilePersistence) {
        set({ saveState: 'saving' })
        try {
          flushDeferredPackagedProfileState(profilePersistence)
          const loaded = await profilePersistence.loadIdea(id)
          if (!loaded) {
            set({ saveState: 'failed' })
            return
          }
          applyProfileHydration(loaded)
        } catch (error) {
          markProfileFailure(error)
        }
        return
      }
      set({ saveState: 'saving' })
      await debouncedSave?.flush()
      const loaded = await loadSavedIdea(id)
      if (!loaded) {
        set({ saveState: 'failed' })
        return
      }
      const ideas = await listIdeas()
      await debouncedSave?.flush()
      set({
        ...replaceBoardWithSettings(loaded.board),
        currentIdeaId: loaded.idea.id,
        ideas,
        storageStatus: currentStorageStatus(),
        saveState: 'saved',
        ideaManagerOpen: false,
      })
    },

    createIdea: async (name) => {
      const profilePersistence = packagedProfilePersistence()
      if (profilePersistence) {
        set({ saveState: 'saving' })
        try {
          flushDeferredPackagedProfileState(profilePersistence)
          applyProfileHydration(await profilePersistence.createOrdinaryIdea(name))
        } catch (error) {
          markProfileFailure(error)
        }
        return
      }
      set({ saveState: 'saving' })
      await debouncedSave?.flush()
      const created = await createSavedIdea(name, boardWithResolvedAiSettings(emptyBoard(), get().settings))
      const ideas = await listIdeas()
      await debouncedSave?.flush()
      set({
        ...replaceBoardWithSettings(created.board),
        currentIdeaId: created.idea.id,
        ideas,
        storageStatus: currentStorageStatus(),
        saveState: 'saved',
        ideaManagerOpen: false,
      })
    },

    renameCurrentIdea: async (name) => {
      const profilePersistence = packagedProfilePersistence()
      if (profilePersistence) {
        set({ saveState: 'saving' })
        try {
          flushDeferredPackagedProfileState(profilePersistence)
          const hydration = await profilePersistence.renameCurrentIdea(name)
          set({
            ideas: [...hydration.ideas],
            currentIdeaId: hydration.idea.id,
            saveState: 'saved',
          })
        } catch (error) {
          markProfileFailure(error)
        }
        return
      }
      const ideaId = get().currentIdeaId
      if (!ideaId) return
      set({ saveState: 'saving' })
      await debouncedSave?.flush()
      const idea = await renameSavedIdea(ideaId, name)
      if (!idea) {
        set({ saveState: 'failed' })
        return
      }
      const ideas = await listIdeas()
      await debouncedSave?.flush()
      set({ ideas, saveState: 'saved', storageStatus: currentStorageStatus() })
    },

    duplicateCurrentIdea: async (name) => {
      // Stop any live follow-up stream first (issue #286). The copy keeps the
      // same message ids and becomes the current board, so a stream left
      // running would keep appending to the copy's 'stopped' reply — leaking
      // half-written text downstream on every chunk — and finally flip it to
      // 'complete'. Aborting here makes 'stopped' truthful and final; the
      // snapshot settle below stays as the backstop.
      stopLiveFollowUpStreams(get().outputs.flatMap((output) => output.versions.map((v) => v.id)))
      const profilePersistence = packagedProfilePersistence()
      if (profilePersistence) {
        const settledSource = settleBoardSnapshotForDuplicate(get().snapshot())
        if (settledSource.outputs !== get().outputs) {
          set({ outputs: settledSource.outputs })
        }
        set({ saveState: 'saving' })
        try {
          // Duplicate's adapter opens its lifecycle gate by flushing. Schedule
          // the settled source synchronously first so that preflush certifies
          // source truth rather than the old copy-only snapshot.
          schedulePackagedProfileState(profilePersistence)
          await profilePersistence.duplicateCurrentIdea(name)
        } catch (error) {
          markProfileFailure(error)
        }
        return
      }
      set({ saveState: 'saving' })
      await debouncedSave?.flush()
      const source = get().ideas.find((idea) => idea.id === get().currentIdeaId)
      const created = await createSavedIdea(
        name || `${source?.name ?? 'Untitled idea'} copy`,
        settleBoardSnapshotForDuplicate(get().snapshot()),
      )
      const ideas = await listIdeas()
      await debouncedSave?.flush()
      set({
        ...replaceBoardWithSettings(created.board),
        currentIdeaId: created.idea.id,
        ideas,
        storageStatus: currentStorageStatus(),
        saveState: 'saved',
        ideaManagerOpen: false,
      })
    },

    deleteIdea: async (id) => {
      const profilePersistence = packagedProfilePersistence()
      if (profilePersistence) {
        set({ saveState: 'saving' })
        try {
          flushDeferredPackagedProfileState(profilePersistence)
          applyProfileHydration(await profilePersistence.deleteIdea(id))
        } catch (error) {
          markProfileFailure(error)
        }
        return
      }
      const wasCurrent = id === get().currentIdeaId
      if (wasCurrent) browserDeletingIdeaId = id
      set({ saveState: 'saving' })
      try {
        await debouncedSave?.flush()
        const nextId = await deleteSavedIdea(id)
        if (wasCurrent && nextId) {
          const loaded = await loadSavedIdea(nextId)
          if (loaded) {
            const ideas = await listIdeas()
            await debouncedSave?.flush()
            set({
              ...replaceBoardWithSettings(loaded.board),
              currentIdeaId: loaded.idea.id,
              ideas,
              storageStatus: currentStorageStatus(),
              saveState: 'saved',
            })
            return
          }
        }
        const ideas = await listIdeas()
        await debouncedSave?.flush()
        set({ ideas, saveState: 'saved', storageStatus: currentStorageStatus() })
      } catch (error) {
        if (wasCurrent) {
          browserDeletingIdeaId = null
          const retrySource = captureBrowserDevelopmentSave()
          if (retrySource) debouncedSave?.(retrySource)
        }
        set({ saveState: 'failed' })
        throw error
      } finally {
        if (browserDeletingIdeaId === id) browserDeletingIdeaId = null
      }
    },

    // Deleting a shelf Board stages it behind an undo window instead of
    // touching storage right away. One staged delete at a time: staging a
    // second commits the first. The current Board never stages — deleting it
    // switches boards, which an undo window can't cleanly reverse, so its
    // callers confirm and call deleteIdea directly.
    stageIdeaDelete: async (id) => {
      await get().commitStagedIdeaDelete()
      const idea = get().ideas.find((candidate) => candidate.id === id)
      if (!idea) return
      if (id === get().currentIdeaId) {
        await get().deleteIdea(id)
        return
      }
      set({ pendingIdeaDelete: { id: idea.id, name: idea.name } })
      ideaDeleteUndoTimer = setTimeout(() => {
        ideaDeleteUndoTimer = null
        void get().commitStagedIdeaDelete()
      }, IDEA_DELETE_UNDO_MS)
    },

    undoStagedIdeaDelete: () => {
      if (ideaDeleteUndoTimer !== null) {
        clearTimeout(ideaDeleteUndoTimer)
        ideaDeleteUndoTimer = null
      }
      set({ pendingIdeaDelete: null })
    },

    commitStagedIdeaDelete: async () => {
      if (ideaDeleteUndoTimer !== null) {
        clearTimeout(ideaDeleteUndoTimer)
        ideaDeleteUndoTimer = null
      }
      const pending = get().pendingIdeaDelete
      if (!pending) return
      set({ pendingIdeaDelete: null })
      await get().deleteIdea(pending.id)
    },

    importIdea: async (name, board) => {
      if (packagedProfilePersistence()) {
        markProfileFailure(new Error('Packaged Ideas must use the native import picker'))
        return
      }
      set({ saveState: 'saving' })
      await debouncedSave?.flush()
      const created = await createSavedIdea(name, boardWithResolvedAiSettings(board, get().settings))
      const ideas = await listIdeas()
      await debouncedSave?.flush()
      set({
        ...replaceBoardWithSettings(created.board),
        currentIdeaId: created.idea.id,
        ideas,
        storageStatus: currentStorageStatus(),
        saveState: 'saved',
        ideaManagerOpen: false,
      })
    },

    exportCurrentIdeaToNative: async () => {
      const profilePersistence = packagedProfilePersistence()
      if (!profilePersistence) return false
      const operationId = pendingNativeExportOperationId ?? newId('profile-export')
      pendingNativeExportOperationId = operationId
      set({ saveState: 'saving' })
      try {
        flushDeferredPackagedProfileState(profilePersistence)
        await profilePersistence.exportPortable({ operationId })
        pendingNativeExportOperationId = undefined
        set({ saveState: 'saved' })
        return true
      } catch (error) {
        markProfileFailure(error)
        return false
      }
    },

    importIdeaFromNative: async () => {
      const profilePersistence = packagedProfilePersistence()
      if (!profilePersistence) return false
      const request = pendingNativeImportRequest ?? Object.freeze({
        operationId: newId('profile-import'),
        idempotencyKey: newId('profile-import-idempotency'),
      })
      pendingNativeImportRequest = request
      set({ saveState: 'saving' })
      try {
        flushDeferredPackagedProfileState(profilePersistence)
        const result = await profilePersistence.importIdeaClosure(request)
        pendingNativeImportRequest = undefined
        if ('cancelled' in result) {
          set({ saveState: 'saved' })
          return false
        }
        return true
      } catch (error) {
        markProfileFailure(error)
        return false
      }
    },

    restoreProfileRecovery: async (candidateId) => {
      const profilePersistence = packagedProfilePersistence()
      if (!profilePersistence || get().profileStartupState !== 'recovery-required') return
      if (get().startingFreshProfile) return
      if (!get().recoveryCandidates.some((candidate) => candidate.id === candidateId && candidate.verified)) return
      set({
        restoringRecoveryCandidateId: candidateId,
        profileStartupError: null,
        profileStartupErrorKind: null,
      })
      try {
        sessionModOrigins.clear()
        stagedModOrigins.clear()
        await profilePersistence.restoreRecovery(candidateId)
      } catch (error) {
        if (get().profileStartupState === 'failed') return
        set({
          hydrated: false,
          saveState: 'failed',
          profileStartupState: 'recovery-required',
          profileStartupError: error instanceof Error ? error.message : 'Profile recovery failed',
          profileStartupErrorKind: 'restore',
          restoringRecoveryCandidateId: null,
        })
      }
    },

    startFreshProfile: async () => {
      const profilePersistence = packagedProfilePersistence()
      if (!profilePersistence || get().profileStartupState !== 'recovery-required') return
      if (get().startingFreshProfile || get().restoringRecoveryCandidateId !== null) return
      set({
        startingFreshProfile: true,
        profileStartupError: null,
        profileStartupErrorKind: null,
      })
      try {
        sessionModOrigins.clear()
        stagedModOrigins.clear()
        await profilePersistence.startFreshProfile()
      } catch (error) {
        if (get().profileStartupState === 'failed') return
        set({
          hydrated: false,
          saveState: 'failed',
          profileStartupState: 'recovery-required',
          profileStartupError: error instanceof Error ? error.message : 'Profile start-fresh failed',
          profileStartupErrorKind: 'start-fresh',
          startingFreshProfile: false,
        })
      }
    },

    snapshot: () => {
      const {
        cards,
        connections,
        outputs,
        runs,
        highlights,
        highlightTags,
        intentLog,
        compactionSummaries,
        settings,
        boardSettings,
        foreignAiSettings,
      } = get()
      const updatedAt = new Date().toISOString()
      return makeSavedBoard({
        cards,
        connections,
        outputs,
        runs,
        highlights,
        highlightTags,
        intentLog,
        compactionSummaries,
        aiSettings: boardAiSettingsFrom(settings, foreignAiSettings),
        settings: boardSettings,
        updatedAt,
      })
    },

    // The shared identity-keyed cache means repeated calls between commits
    // return the same index object; only mutated collections re-index.
    graph: () => graphIndexForBoard(get()),

    // ---- cards ----
    addCard: (kind, position) => {
      const beforeCards = get().cards
      const id = newId(kind)
      const card = placeCreatedCard(beforeCards, {
        id,
        kind,
        blocks: [{ id: newId('blk'), text: kind === 'title' ? 'Untitled label' : '' }],
        position,
        ...(kind === 'title' ? { size: { width: 320, height: 82 } } : {}),
        ...(kind === 'group' ? { title: 'New group', compressionPrompt: DEFAULT_COMPRESSION_PROMPT } : {}),
        ...(kind === 'mod'
          ? { modV2: createSeedMod('slider', { createId: (role) => newId(`mod-${role}`) }) }
          : {}),
        ...(kind === 'conversation'
          ? { conversationStyle: DEFAULT_CONVERSATION_STYLE, conversationTurns: DEFAULT_CONVERSATION_TURNS }
          : {}),
      })
      const plannedCards = reconcileGroupMembership([...beforeCards, card])
      adoptAgentGroupsWithMembershipChanges(beforeCards, plannedCards)
      if (card.modV2 && packagedProfilePersistence()) {
        stageProfileModOrigin(
          card.id,
          captureDirectProfileModOrigin(card.modV2, newId('mod-instance')),
        )
      }
      commit(
        'Create card',
        (draft) => {
          draft.cards = reconcileGroupMembership([...draft.cards, card])
        },
        [{ type: 'card.created', cardId: id, data: { card: cloneForLog(card) } }],
      )
      return id
    },

    addNoteWithLinkPreview: ({ url, text }, position) => {
      const beforeCards = get().cards
      const id = newId('note')
      const card = placeCreatedCard(beforeCards, {
        id,
        kind: 'note',
        blocks: [{ id: newId('blk'), text: noteBodyForPastedLink(url, text) }],
        linkPreview: { url, status: 'loading' },
        position,
      })
      const plannedCards = reconcileGroupMembership([...beforeCards, card])
      adoptAgentGroupsWithMembershipChanges(beforeCards, plannedCards)
      commit(
        'Create note with link preview',
        (draft) => {
          draft.cards = reconcileGroupMembership([...draft.cards, card])
        },
        [{ type: 'card.created', cardId: id, data: { card: cloneForLog(card) } }],
      )
      return id
    },

    addWebNote: (page, position) => {
      const beforeCards = get().cards
      const id = newId('note')
      const card = placeCreatedCard(beforeCards, {
        id,
        kind: 'note',
        title: page.title,
        blocks: [{ id: newId('blk'), text: page.markdown }],
        source: {
          url: page.url,
          retrievedAt: page.retrievedAt,
          ...(page.title ? { title: page.title } : {}),
        },
        position,
      })
      const plannedCards = reconcileGroupMembership([...beforeCards, card])
      adoptAgentGroupsWithMembershipChanges(beforeCards, plannedCards)
      commit(
        'Read web page',
        (draft) => {
          draft.cards = reconcileGroupMembership([...draft.cards, card])
        },
        [{ type: 'card.created', cardId: id, data: { card: cloneForLog(card) } }],
      )
      return id
    },

    addNoteWithLocalHtmlPreview: (source, position) => {
      const beforeCards = get().cards
      const id = newId('note')
      const card = placeCreatedCard(beforeCards, {
        id,
        kind: 'note',
        blocks: [{ id: newId('blk'), text: source.name }],
        localHtmlPreview: {
          sourceId: source.id,
          name: source.name,
          status: 'loading',
        },
        position,
      })
      const plannedCards = reconcileGroupMembership([...beforeCards, card])
      adoptAgentGroupsWithMembershipChanges(beforeCards, plannedCards)
      commit(
        'Create note with local HTML preview',
        (draft) => {
          draft.cards = reconcileGroupMembership([...draft.cards, card])
        },
        [{ type: 'card.created', cardId: id, data: { card: cloneForLog(card) } }],
      )
      return id
    },

    // Paste an address and a Note appears at once holding it; the page replaces
    // the address when the reader answers.
    //
    // Its own undoable step, deliberately. Treating the reply as authoritative
    // history instead rebases the paste out of the undo stack, leaving a Card
    // the user cannot take back. One extra press is a small price for undo that
    // always works, and "undo the page, get the link back" is a step worth
    // having on its own.
    applyWebPage: (id, page, expectedText) => {
      const card = get().cards.find((candidate) => candidate.id === id)
      if (!card || card.kind !== 'note') return false
      // Anything the user typed in the meantime outranks the page. A read that
      // lands late must never overwrite a thought.
      if (card.blocks.map((block) => block.text).join('\n') !== expectedText) return false

      const next: Card = {
        ...card,
        title: page.title,
        blocks: [{ id: newId('blk'), text: page.markdown }],
        source: {
          url: page.url,
          retrievedAt: page.retrievedAt,
          ...(page.title ? { title: page.title } : {}),
        },
      }
      const { changed } = commit(
        'Read web page',
        (draft) => {
          const order = draft.cards.findIndex((candidate) => candidate.id === id)
          if (order >= 0) draft.cards[order] = next
        },
        [
          {
            type: 'card.content.edited',
            cardId: id,
            data: { field: 'body', textLength: page.markdown.length },
          },
        ],
      )
      return changed
    },

    duplicateCard: (id, options) => get().duplicateCards([id], options),

    duplicateCards: (ids, options = {}) => {
      const selectedIds = new Set(ids)
      const state = get()
      const sourceCards = state.cards.filter((card) => selectedIds.has(card.id))
      const sourceConnections = state.connections.filter(
        (connection) => selectedIds.has(connection.from.cardId) || selectedIds.has(connection.to.cardId),
      )
      const cloned = cloneCardsFrom(sourceCards, sourceConnections, state, options)
      return insertClonedCards(cloned, 'Duplicate cards')
    },

    copyCards: (ids) => {
      const selectedIds = new Set(ids)
      const cards = get().cards.filter((card) => selectedIds.has(card.id))
      if (!cards.length) return
      const connections = get().connections.filter(
        (connection) => selectedIds.has(connection.from.cardId) || selectedIds.has(connection.to.cardId),
      )
      set({
        cardClipboard: {
          cards: cards.map((card) => ({ ...card, blocks: card.blocks.map((block) => ({ ...block })) })),
          connections: connections.map((connection) => ({
            ...connection,
            from: { ...connection.from },
            to: { ...connection.to },
            ...(connection.meta ? { meta: { ...connection.meta } } : {}),
          })),
        },
      })
    },

    pasteCards: (position) => {
      const clipboard = get().cardClipboard
      if (!clipboard?.cards.length) return []
      const cloned = cloneCardsFrom(clipboard.cards, clipboard.connections, get(), { position })
      return insertClonedCards(cloned, 'Paste cards')
    },

    deleteCard: (id) => {
      const graph = get().graph()
      const candidate = graph.cardById(id)
      if (!candidate) return
      const output = graph.outputForResultCard(id)
      if (output) {
        stopLiveFollowUpStreams(output.versions.map((version) => version.id))
      }
      const affectedIds = [
        id,
        ...(candidate.kind === 'group'
          ? get().cards.filter((card) => card.groupId === id && canJoinGroup(card)).map((card) => card.id)
          : candidate.groupId ? [candidate.groupId] : []),
      ]
      adoptAgentCards(affectedIds)
      const beforeBoard = currentHistoryBoard()
      const deleted = beforeBoard.cards.find((c) => c.id === id)
      if (!deleted) return
      const deletedConnections = beforeBoard.connections.filter((c) => c.from.cardId === id || c.to.cardId === id)
      const deletedOutputs = beforeBoard.outputs.filter((o) => o.resultCardId === id)
      const memberIds =
        deleted.kind === 'group'
          ? beforeBoard.cards.filter((c) => c.groupId === id && canJoinGroup(c)).map((c) => c.id)
          : undefined
      commit(
        deleted.kind === 'group' ? 'Delete group' : 'Delete card',
        (draft) => {
          draft.cards = draft.cards
            .filter((c) => c.id !== id)
            .map((c) => {
              if (deleted.kind !== 'group' || c.groupId !== id) return c
              const { groupId: _groupId, ...ungrouped } = c
              return ungrouped
            })
          draft.connections = draft.connections.filter((c) => c.from.cardId !== id && c.to.cardId !== id)
          draft.outputs = draft.outputs.filter((o) => o.resultCardId !== id)
          draft.highlights = draft.highlights.filter((h) => h.cardId !== id)
        },
        [
          {
            type: 'card.deleted',
            cardId: id,
            data: {
              card: cloneForLog(deleted),
              connections: cloneForLog(deletedConnections),
              ...(memberIds === undefined ? {} : { memberIds }),
              outputs: cloneForLog(deletedOutputs),
            },
          },
        ],
      )
      set((s) => ({
        selection: null,
        selectedCardIds: s.selectedCardIds.filter((cardId) => cardId !== id),
        connectionEditorId: null,
      }))
    },

    setCardTitle: (id, title) => {
      writeUserCardEdit(
        id,
        (card) => card.title === title ? card : { ...card, title },
        { deferPackagedCapture: true },
      )
    },

    setCardHeaderColor: (id, headerColor, headerFill) => {
      writeUserCardEdit(id, (card) => {
        if (headerColor) {
          const nextFill = headerFill ?? card.headerFill ?? 'half'
          return card.headerColor === headerColor && card.headerFill === nextFill
            ? card
            : { ...card, headerColor, headerFill: nextFill }
        }
        if (card.headerColor === undefined && card.headerFill === undefined) return card
        const { headerColor: _headerColor, headerFill: _headerFill, ...withoutHeader } = card
        return withoutHeader
      })
    },

    recordCardContentEdited: (id, field = 'body') => {
      const card = get().cards.find((candidate) => candidate.id === id)
      if (!card) return
      const textLength = card.blocks.reduce((sum, block) => sum + block.text.length, 0)
      // The exact text is already current in the renderer. This narrative
      // completion event joins the same quiet durability lane instead of
      // forcing a whole-Profile capture during blur or deselection.
      commitInteractionSummary(undefined, [
        {
          type: 'card.content.edited',
          cardId: id,
          data: { field, textLength },
        },
      ], 'routine-quiet')
    },

    setCardText: (id, text) => {
      // First editor is plain text; store it as a single block. Line identity is
      // best-effort until a richer editor earns it.
      writeUserCardEdit(
        id,
        (card) => {
          if (card.blocks.length === 1 && card.blocks[0]?.text === text) return card
          return {
            ...card,
            blocks: [{ id: card.blocks[0]?.id ?? newId('blk'), text }],
          }
        },
        { deferPackagedCapture: true },
      )
    },

    // Settles whichever of the Note's previews carries this url. A Note can
    // hold several, and each tile resolves on its own schedule, so the url is
    // the address of the write, not the position.
    setLinkPreview: (id, preview) => {
      writeBoardState((draft) => {
        const card = draft.cards.find((candidate) => candidate.id === id)
        const previews = noteLinkPreviews(card)
        const index = previews.findIndex((existing) => existing.url === preview.url)
        if (index < 0) return
        const existing = previews[index]!
        if (existing.status === 'ready' && preview.status === 'fallback') return
        if (sameLinkPreview(existing, preview)) return
        setNoteLinkPreviews(card!, previews.map((candidate, candidateIndex) => (
          candidateIndex === index ? preview : candidate
        )))
      })
    },

    // Lets a Note's own body drive preview generation (paste-with-prose,
    // typing a URL, pasting into a Note that already has content) rather than
    // only the bare-URL clipboard path. Silent like setLinkPreview: it is a
    // derived fetch kickoff, not a user-authored edit, so it stays out of
    // undo/the Intent Log. A Note grows one preview per distinct url its body
    // carries, in body order, up to LINK_PREVIEW_MAX_PER_NOTE; a Note showing
    // a local HTML preview keeps that instead.
    //
    // An attempt is spent once per URL per Note and then remembered, so
    // reopening an old Board does not re-fetch every link it has ever held.
    // The URL is re-derived from the Card's own text here rather than trusted
    // from the caller, so a debounced kickoff that lands after the founder
    // kept typing cannot fetch a URL the body no longer has.
    ensureNoteLinkPreview: (id, url) => {
      writeBoardState((draft) => {
        const card = draft.cards.find((candidate) => candidate.id === id)
        if (!card || card.kind !== 'note') return
        if (card.localHtmlPreview) return
        if (linkPreviewDismissed(card, url)) return
        if (linkPreviewAttempted(card, url)) return
        const previews = noteLinkPreviews(card)
        if (previews.length >= LINK_PREVIEW_MAX_PER_NOTE) return
        if (previews.some((existing) => existing.url === url)) return
        if (!webUrlsInText(cardTextFromBlocks(card.blocks)).includes(url)) return
        setCardEnvelope(card, withLinkPreviewAttempt(card, url))
        setNoteLinkPreviews(card, [...previews, { url, status: 'loading' }])
      })
    },

    settleLocalHtmlPreview: (id, capture) => {
      writeBoardState((draft) => {
        const card = draft.cards.find((candidate) => candidate.id === id)
        if (!card?.localHtmlPreview || card.localHtmlPreview.sourceId !== capture.sourceId) return
        const assetId = newId('asset')
        const previousAssetId = card.localHtmlPreview.assetId
        card.assets = [
          ...(card.assets ?? []).filter((asset) => asset.id !== previousAssetId),
          {
            id: assetId,
            kind: 'image',
            name: `${card.localHtmlPreview.name} preview.jpg`,
            mimeType: capture.mimeType,
            dataUrl: capture.imageDataUrl,
            size: capture.size,
            createdAt: capture.capturedAt,
            width: capture.width,
            height: capture.height,
          },
        ]
        card.localHtmlPreview = {
          sourceId: capture.sourceId,
          name: card.localHtmlPreview.name,
          status: 'ready',
          ...(capture.title ? { title: capture.title } : {}),
          assetId,
        }
      })
    },

    failLocalHtmlPreview: (id, sourceId) => {
      writeBoardState((draft) => {
        const card = draft.cards.find((candidate) => candidate.id === id)
        if (!card?.localHtmlPreview
          || card.localHtmlPreview.sourceId !== sourceId) return
        card.localHtmlPreview = {
          sourceId,
          name: card.localHtmlPreview.name,
          status: 'unavailable',
          ...(card.localHtmlPreview.title ? { title: card.localHtmlPreview.title } : {}),
          ...(card.localHtmlPreview.assetId ? { assetId: card.localHtmlPreview.assetId } : {}),
        }
      })
    },

    // The X on a preview tile. Naming a url removes only that tile, which is
    // what a Note carrying several links needs; naming none removes every
    // preview the Note shows, the behaviour a single-preview Note has always
    // had. Either way each removed address is remembered, so the body-driven
    // generator never grows it back.
    removeNotePreview: (id, url) => {
      const card = get().cards.find((candidate) => candidate.id === id)
      const previews = noteLinkPreviews(card)
      const removedPreviews = url === undefined
        ? previews
        : previews.filter((preview) => preview.url === url)
      // Naming a url that a link preview carries leaves the local HTML preview
      // alone; the unnamed X still takes whatever the Note shows.
      const removesLocalHtml = url === undefined || removedPreviews.length === 0
      if (!card || (!removedPreviews.length && !(removesLocalHtml && card.localHtmlPreview))) return
      adoptAgentCard(id)
      commit(
        'Remove note preview',
        (draft) => {
          const candidate = draft.cards.find((draftCard) => draftCard.id === id)
          if (!candidate) return
          const previewAssetId = removesLocalHtml ? candidate.localHtmlPreview?.assetId : undefined
          if (previewAssetId) {
            candidate.assets = candidate.assets?.filter((asset) => asset.id !== previewAssetId)
            if (!candidate.assets?.length) delete candidate.assets
          }
          // The X must stick whichever preview kind it removed. Removing a
          // local HTML preview from a Note whose body also holds a web link
          // used to let the body-driven generator grow a Link Preview in its
          // place, so the founder watched the thing they just closed come
          // straight back wearing a different hat.
          const dismissedUrls = removedPreviews.length
            ? removedPreviews.map((preview) => preview.url)
            : [firstWebUrlInText(cardTextFromBlocks(candidate.blocks))]
              .filter((candidateUrl): candidateUrl is string => Boolean(candidateUrl))
          for (const dismissedUrl of dismissedUrls) {
            setCardEnvelope(candidate, withLinkPreviewDismissal(candidate, dismissedUrl))
          }
          if (removesLocalHtml) delete candidate.localHtmlPreview
          setNoteLinkPreviews(
            candidate,
            noteLinkPreviews(candidate).filter((preview) => (
              !removedPreviews.some((removed) => removed.url === preview.url)
            )),
          )
        },
        [{
          type: 'card.content.edited',
          cardId: id,
          data: { field: 'body', textLength: card.blocks[0]?.text.length ?? 0 },
        }],
      )
    },

    setCardFontSize: (id, fontSize) => {
      if (!isNoteFontSize(fontSize)) return
      writeUserCardEdit(id, (card) => {
        if (card.kind !== 'note') return card
        const legacy = hasLegacyNoteFontSize(card)
        if (!legacy && noteFontSizeOf(card) === fontSize) return card
        // The scale goes to the settings envelope and the retired top-level
        // field goes away in the same update, so a Card never holds two
        // answers. `writeSetting` stores the default step as an absent key and
        // collapses an emptied envelope, which keeps a Card that never left
        // the default byte-identical to one written before the setting moved.
        const next = withCardEnvelope(card, writeSetting(card, NOTE_FONT_SIZE_SETTING, fontSize))
        delete (next as { fontSize?: unknown }).fontSize
        return next
      })
    },

    setCardAgentic: (id, agentic) => {
      writeUserCardEdit(id, (card) => {
        if (card.kind !== 'askAi') return card
        if (agentic) return card.agentic === true ? card : { ...card, agentic: true }
        if (card.agentic === undefined) return card
        // Off deletes the key rather than storing false, so a Board written by
        // this build still opens in one that has never heard of Agentic Runs.
        const { agentic: _off, ...withoutAgentic } = card
        return withoutAgentic
      })
    },

    setCardReach: (id, reach) => {
      writeUserCardEdit(id, (card) => {
        if (card.kind !== 'askAi') return card
        const wantsOn = reach !== 'off'
        const hasSomeKey = hasSetting(card, REACH_MODE_SETTING)
        const hasResearchKey = hasSomeKey && reachModeOf(card) === 'research'
        const wantsKey = reach === 'research'
        const alreadyOn = card.agentic === true
        if (alreadyOn === wantsOn && hasResearchKey === wantsKey && hasSomeKey === wantsKey) {
          return card
        }
        // 'web' and 'off' both delete the mode key rather than storing a
        // value, so a Board that never armed Research is byte-identical to
        // one written before modes existed, and turning reach off does not
        // leave a stale 'research' behind to surprise the next press of the
        // cycle: Off always steps to Web, as the control promises. Writing
        // the default IS that deletion, so the envelope gives both cases one
        // call. An empty meta goes with it, and Off deletes `agentic` rather
        // than storing false, both so older builds carry nothing they cannot
        // read.
        const next = withCardEnvelope(
          card,
          writeSetting(card, REACH_MODE_SETTING, wantsKey ? 'research' : DEFAULT_REACH_MODE),
        )
        if (wantsOn) next.agentic = true
        else delete next.agentic
        return next
      })
    },

    setCardResearchDepth: (id, depth) => {
      writeUserCardEdit(id, (card) => {
        if (card.kind !== 'askAi') return card
        const hasKey = hasSetting(card, RESEARCH_DEPTH_SETTING)
        const wantsKey = depth !== DEFAULT_RESEARCH_DEPTH
        if (hasKey === wantsKey && researchDepthOf(card) === depth) return card
        // S deletes the key rather than storing it, the same shape
        // setCardReach gives its default: absent and default are one state,
        // so a Board that never went past the cheapest depth is
        // byte-identical to one written before the choice existed. An
        // emptied meta goes with it.
        return withCardEnvelope(card, writeSetting(card, RESEARCH_DEPTH_SETTING, depth))
      })
    },

    recordCardResearchJob: (cardId, jobId) => {
      // The default immediate persist is the point: this write exists so the
      // id survives a quit that could come at any moment of a minutes-long
      // poll. A resubmission on the same Card overwrites, because the newer
      // job is the one a recovery would want.
      writeBoardState((draft) => {
        const card = draft.cards.find((candidate) => candidate.id === cardId)
        if (!card || card.kind !== 'askAi') return
        setCardEnvelope(card, writeSetting(card, RESEARCH_JOB_SETTING, {
          id: jobId,
          submittedAt: new Date().toISOString(),
        }))
      })
    },

    clearCardResearchJob: (cardId) => {
      writeBoardState((draft) => {
        const card = draft.cards.find((candidate) => candidate.id === cardId)
        if (!card || !hasSetting(card, RESEARCH_JOB_SETTING)) return
        // An emptied meta goes entirely, like setCardReach's, so a Card that
        // only ever briefly held a job stays byte-identical to one that never
        // did.
        setCardEnvelope(card, clearSetting(card, RESEARCH_JOB_SETTING))
      })
    },

    addCardAssets: (id, assets) => {
      if (!assets.length) return
      writeUserCardEdit(id, (card) => ({
          ...card,
          assets: [...(card.assets ?? []), ...assets],
      }))
    },

    removeCardAsset: (cardId, assetId) => {
      writeUserCardEdit(cardId, (card) => {
        const assets = (card.assets ?? []).filter((asset) => asset.id !== assetId)
        if (assets.length === (card.assets?.length ?? 0)) return card
        if (card.localHtmlPreview?.assetId !== assetId) return { ...card, assets }
        const { localHtmlPreview: _localHtmlPreview, ...withoutPreview } = card
        return { ...withoutPreview, assets }
      })
    },

    setCardModel: (id, model) => {
      if (isProfileReviewExecution()) return
      writeUserCardEdit(id, (card) => card.model === model ? card : { ...card, model })
    },

    moveCard: (id, position, options) => {
      const beforeCards = get().cards
      const card = get().cards.find((c) => c.id === id)
      let nextCards: Card[]
      if (card?.kind === 'group') {
        const dx = position.x - card.position.x
        const dy = position.y - card.position.y
        nextCards = reconcileGroupMembership(
          beforeCards.map((c) => {
            if (c.id === id) return { ...c, position }
            if (c.groupId === id) return { ...c, position: { x: c.position.x + dx, y: c.position.y + dy } }
            return c
          }),
        )
      } else {
        nextCards = reconcileGroupMembership(beforeCards.map((c) => (c.id === id ? { ...c, position } : c)))
      }
      if (options?.recordHistory === false) {
        // Intra-gesture frames skip snapshot construction and persist entirely
        // (#213): the gesture-end interaction summary persists the final state
        // once, so nothing intermediate ever needs to reach the saver.
        writeBoardState((draft) => {
          assignStructuralCardChanges(draft.cards, nextCards)
        }, { persist: false })
        return
      }
      const action = cardUpdateAction('moveCard', beforeCards, nextCards)
      adoptStructurallyChangedAgentCards(action)
      commit(
        'Move card',
        (draft) => assignStructuralCardChanges(draft.cards, nextCards),
        action?.type === 'cardsUpdated' ? structuralEventDrafts(action.patches) : [],
      )
    },

    moveCards: (moves, options) => {
      if (!moves.length) return
      if (moves.length === 1) {
        get().moveCard(moves[0].id, moves[0].position, options)
        return
      }
      const beforeCards = get().cards
      const movesById = new Map(moves.map((move) => [move.id, move.position]))
      // Group cards drag their members along, exactly like moveCard; a member
      // with its own explicit move keeps that (React Flow reports each
      // selected node), so the group delta only applies to unlisted members.
      const groupDeltas = new Map<string, { dx: number; dy: number }>()
      for (const move of moves) {
        const card = beforeCards.find((c) => c.id === move.id)
        if (card?.kind === 'group') {
          groupDeltas.set(card.id, { dx: move.position.x - card.position.x, dy: move.position.y - card.position.y })
        }
      }
      const nextCards = reconcileGroupMembership(
        beforeCards.map((c) => {
          const explicit = movesById.get(c.id)
          if (explicit) return { ...c, position: explicit }
          const delta = c.groupId ? groupDeltas.get(c.groupId) : undefined
          if (delta) return { ...c, position: { x: c.position.x + delta.dx, y: c.position.y + delta.dy } }
          return c
        }),
      )
      if (options?.recordHistory === false) {
        // Same deferred-persist rule as moveCard (#213).
        writeBoardState((draft) => {
          assignStructuralCardChanges(draft.cards, nextCards)
        }, { persist: false })
        return
      }
      const action = cardUpdateAction('moveCard', beforeCards, nextCards)
      adoptStructurallyChangedAgentCards(action)
      commit(
        'Move cards',
        (draft) => assignStructuralCardChanges(draft.cards, nextCards),
        action?.type === 'cardsUpdated' ? structuralEventDrafts(action.patches) : [],
      )
    },

    // Migrated to the commit funnel (#188) — the length-guarded variant: the
    // events come from the shared card-diff, so a no-op resize passes [] and
    // the funnel's empty-commit rule writes nothing at all.
    setCardSize: (id, size, options) => {
      const beforeCards = get().cards
      const nextCards = reconcileGroupMembership(
        beforeCards.map((c) => (c.id === id ? { ...c, size } : c)),
      )
      if (options?.recordHistory === false) {
        // Live-resize frames are interaction-local updates (ADR 0016): state
        // moves without history or events; the drag-end call commits. They
        // also skip snapshot construction and persist (#213) — the gesture-end
        // interaction summary persists the final size once.
        writeBoardState((draft) => {
          assignStructuralCardChanges(draft.cards, nextCards)
        }, { persist: false })
        return
      }
      const action = cardUpdateAction('resizeCard', beforeCards, nextCards)
      adoptStructurallyChangedAgentCards(action)
      commit(
        'Resize card',
        (draft) => assignStructuralCardChanges(draft.cards, nextCards),
        action?.type === 'cardsUpdated' ? structuralEventDrafts(action.patches) : [],
      )
    },

    // A Card grows once for each attachment panel that appears on it, so a new
    // link preview or a first image never takes its room out of the Note body.
    // The rule itself, and the reason it has to be a persisted marker rather
    // than something derived from the height, live in attachmentPanelGrowth.ts.
    //
    // This writes the Board directly rather than going through setCardSize or
    // writeUserCardEdit, and it is the same shape adoptRenderedCardSizes just
    // above has, for the same two reasons. It is not a resize the founder
    // performed, so it emits no Intent event and leaves no undo entry: an undo
    // right after pasting a link undoes the paste, not the growth that answered
    // it. And it is not authorship either, so it must not stamp an
    // Agent-created Card as user-modified for a height the founder never
    // touched. It does persist, because the marker is the only thing standing
    // between this rule and a Card that grows again on every reload.
    growCardForAttachmentPanels: (id, present, how = 'arrived') => {
      if (!present.length) return
      writeBoardState((draft) => {
        const index = draft.cards.findIndex((candidate) => candidate.id === id)
        const card = draft.cards[index]
        if (!card || card.kind !== 'note') return
        const growth = attachmentPanelGrowth(card, present, how)
        if (!growth) return
        const next = withCardEnvelope(card, growth.meta)
        if (growth.size) next.size = growth.size
        draft.cards[index] = next
      })
    },

    // The first complete native render establishes a Card's durable visual
    // footprint. This is projection adoption rather than a user resize: it
    // persists once, emits no undo entry or Intent event, and never overwrites
    // an already-authored size. Batching keeps a resident-window mount to one
    // graph commit and one persistence schedule instead of one per Card.
    adoptRenderedCardSizes: (sizes) => {
      if (!sizes.length) return
      const validById = new Map<string, { width: number; height: number }>()
      for (const { id, size } of sizes) {
        if (
          Number.isFinite(size.width) &&
          Number.isFinite(size.height) &&
          size.width > 0 &&
          size.height > 0
        ) {
          validById.set(id, size)
        }
      }
      if (!validById.size) return
      writeBoardState((draft) => {
        for (let index = 0; index < draft.cards.length; index += 1) {
          const card = draft.cards[index]
          if (card.size) continue
          const size = validById.get(card.id)
          if (!size) continue
          draft.cards[index] = { ...card, size: { ...size } }
        }
      })
    },

    bringCardsToFront: (ids) => {
      if (!ids.length) return
      const beforeCards = get().cards
      const nextCards = moveCardsInLayer(beforeCards, ids, 'front')
      const beforeById = new Map(beforeCards.map((card) => [card.id, card]))
      const changedIds = nextCards
        .filter((card) => beforeById.get(card.id)?.zIndex !== card.zIndex)
        .map((card) => card.id)
      if (!changedIds.length) return
      adoptAgentCards(changedIds)
      writeBoardState((draft) => {
        draft.cards = moveCardsInLayer(draft.cards, ids, 'front')
      })
    },

    sendCardsToBack: (ids) => {
      if (!ids.length) return
      const beforeCards = get().cards
      const nextCards = moveCardsInLayer(beforeCards, ids, 'back')
      const beforeById = new Map(beforeCards.map((card) => [card.id, card]))
      const changedIds = nextCards
        .filter((card) => beforeById.get(card.id)?.zIndex !== card.zIndex)
        .map((card) => card.id)
      if (!changedIds.length) return
      adoptAgentCards(changedIds)
      writeBoardState((draft) => {
        draft.cards = moveCardsInLayer(draft.cards, ids, 'back')
      })
    },

    createGroupFromSelection: (cardIds) => {
      const beforeCards = get().cards
      const selected = beforeCards.filter((c) => cardIds.includes(c.id) && canJoinGroup(c))
      if (selected.length < 2) return undefined
      const frame = enclosingGroupFrame(selected)
      const groupId = newId('group')
      const group: Card = {
        id: groupId,
        kind: 'group',
        title: 'New group',
        blocks: [{ id: newId('blk'), text: '' }],
        compressionPrompt: DEFAULT_COMPRESSION_PROMPT,
        position: frame.position,
        size: frame.size,
      }
      const nextCards = reconcileGroupMembership([...beforeCards, group].map((c) =>
        selected.some((member) => member.id === c.id) ? { ...c, groupId } : c,
      ))
      const memberChanges = groupMembershipChanges(beforeCards, nextCards)
      const existingNextCards = nextCards.filter((card) => card.id !== groupId)
      adoptStructurallyChangedAgentCards(cardUpdateAction('moveCard', beforeCards, existingNextCards))
      commit(
        'Create group',
        (draft) => {
          draft.cards = reconcileGroupMembership([...draft.cards, group].map((card) =>
            selected.some((member) => member.id === card.id) ? { ...card, groupId } : card,
          ))
        },
        [
          {
            type: 'group.created',
            cardId: groupId,
            data: { card: cloneForLog(group), memberChanges },
          },
        ],
      )
      set({ selection: { kind: 'card', id: groupId }, selectedCardIds: [groupId] })
      return groupId
    },

    // Migrated to the commit funnel (#188) — the event-guarded variant: the
    // caller passes `memberChanges ? [event] : []` instead of guarding an
    // append inline.
    addCardToGroup: (cardId, groupId) => {
      const state = get()
      const beforeCards = state.cards
      const group = state.cards.find((c) => c.id === groupId && c.kind === 'group')
      const card = state.cards.find((c) => c.id === cardId && canJoinGroup(c))
      if (!group || !card) return
      const members = state.cards.filter((c) => c.groupId === groupId && canJoinGroup(c) && c.id !== cardId)
      const frame = enclosingGroupFrame([...members, card])
      const nextCards = reconcileGroupMembership(state.cards.map((c) => {
        if (c.id === cardId && canJoinGroup(c)) return { ...c, groupId }
        if (c.id === groupId) return { ...c, position: frame.position, size: frame.size }
        return c
      }))
      const memberChanges = groupMembershipChanges(beforeCards, nextCards)
      adoptStructurallyChangedAgentCards(cardUpdateAction('moveCard', beforeCards, nextCards))
      if (memberChanges) adoptAgentCards([cardId, groupId])
      commit(
        'Add card to group',
        (draft) => assignStructuralCardChanges(draft.cards, nextCards),
        memberChanges
          ? [{ type: 'group.members.changed', cardId: groupId, data: { memberChanges } }]
          : [],
      )
    },

    removeCardFromGroup: (cardId) => {
      const beforeCards = get().cards
      const groupId = beforeCards.find((c) => c.id === cardId)?.groupId
      const nextCards = beforeCards.map((c) => {
        if (c.id !== cardId) return c
        const { groupId: _groupId, ...ungrouped } = c
        return ungrouped
      })
      const memberChanges = groupMembershipChanges(beforeCards, nextCards)
      adoptStructurallyChangedAgentCards(cardUpdateAction('moveCard', beforeCards, nextCards))
      if (groupId && memberChanges) adoptAgentCards([cardId, groupId])
      commit(
        'Remove card from group',
        (draft) => assignStructuralCardChanges(draft.cards, nextCards),
        groupId && memberChanges
          ? [{ type: 'group.members.changed', cardId: groupId, data: { memberChanges } }]
          : [],
      )
    },

    reorderGroupMembers: (groupId, memberIds) => {
      const beforeOrder = get().cards
        .filter((c) => c.groupId === groupId && canJoinGroup(c))
        .map((c) => c.id)
      const requestedOrder = new Map(memberIds.map((memberId, index) => [memberId, index]))
      const nextCards = (() => {
        const currentMembers = beforeOrder.length
          ? get().cards.filter((c) => c.groupId === groupId && canJoinGroup(c))
          : []
        const orderedMembers = [
          ...currentMembers
            .filter((member) => requestedOrder.has(member.id))
            .sort((a, b) => requestedOrder.get(a.id)! - requestedOrder.get(b.id)!),
          ...currentMembers.filter((member) => !requestedOrder.has(member.id)),
        ]
        let memberIndex = 0
        return get().cards.map((c) => {
          if (c.groupId !== groupId || !canJoinGroup(c)) return c
          return orderedMembers[memberIndex++] ?? c
        })
      })()
      const afterOrder = nextCards
        .filter((c) => c.groupId === groupId && canJoinGroup(c))
        .map((c) => c.id)
      const action = groupMembersReorderedAction(groupId, beforeOrder, afterOrder)
      if (action) {
        adoptAgentCard(groupId)
        writeBoardState(
          (draft) => {
            const group = draft.cards.find((card) => card.id === groupId)
            draft.cards = nextCards.map((card) => card.id === groupId && group ? group : card)
          },
          { persist: false },
        )
      }
      commitInteractionSummary(action, [])
    },

    setGroupCompressionPrompt: (id, prompt) => {
      writeUserCardEdit(
        id,
        (card) => card.kind === 'group' && card.compressionPrompt !== prompt
          ? { ...card, compressionPrompt: prompt }
          : card,
        { deferPackagedCapture: true },
      )
    },

    setConversationStyle: (id, style) => {
      writeUserCardEdit(id, (card) =>
        card.kind === 'conversation' && card.conversationStyle !== style
          ? { ...card, conversationStyle: style }
          : card,
      )
    },

    setConversationTurns: (id, turns) => {
      const clamped = Math.max(1, Math.min(20, Math.round(turns) || 1))
      writeUserCardEdit(id, (card) =>
        card.kind === 'conversation' && card.conversationTurns !== clamped
          ? { ...card, conversationTurns: clamped }
          : card,
      )
    },

    addMod: (toAskAiCardId) => {
      const ask = get().cards.find((c) => c.id === toAskAiCardId)
      const pos = ask
        ? { x: ask.position.x - 30, y: ask.position.y + (ask.size?.height ?? 240) + 70 }
        : { x: 0, y: 0 }
      const modId = get().addCard('mod', pos)
      get().addConnection(modId, toAskAiCardId)
    },

    addModFromLibrary: (libraryId, position) => {
      const id = newId('mod')
      let modV2: Card['modV2']
      const profilePersistence = packagedProfilePersistence()
      if (profilePersistence) {
        try {
          const companion = profilePersistence.stampModTemplate(libraryId)
          modV2 = companion.mod
          stageProfileModOrigin(id, companion)
        } catch {
          set({ saveState: 'failed' })
          return null
        }
      } else {
        const source = availableProfileModTemplates(get().settings.profileModLibrary)
          .find((template) => template.templateId === libraryId)
        if (!source) return null
        modV2 = remapModPartIdentities(
          source.mod,
          ({ role }) => newId(`mod-${role}`),
        ).value
      }
      const beforeCards = get().cards
      // Planar wells need real area to read; row instruments hug their content.
      const card = placeCreatedCard(beforeCards, {
        id,
        kind: 'mod',
        blocks: [{ id: newId('blk'), text: '' }],
        position,
        modV2,
        ...(modV2 && (modV2.kind === 'radar' || modV2.kind === 'pad')
          ? { size: { width: 400, height: 350 } }
          : {}),
      })
      const plannedCards = reconcileGroupMembership([...beforeCards, card])
      adoptAgentGroupsWithMembershipChanges(beforeCards, plannedCards)
      commit(
        'Add Mod from library',
        (draft) => {
          draft.cards = reconcileGroupMembership([...draft.cards, card])
        },
        [{ type: 'card.created', cardId: id, data: { card: cloneForLog(card) } }],
      )
      return id
    },

    // ---- connections ----
    addConnection: (fromCardId, toCardId) => {
      const state = get()
      const plan = planConnectionAddition(state.graph(), fromCardId, toCardId)
      if (!plan) return false

      if (plan.kind === 'throughResult') {
        const ensured =
          plan.resultCardId === null
            ? ensureResultCardFor(state.cards, state.connections, plan.sourceCardId)
            : null
        const routed = feedsConnection(
          plan.resultCardId ?? ensured!.resultCard.id,
          plan.targetCardId,
        )
        const addedConnections = [
          ...(ensured?.createdConnection ? [ensured.createdConnection] : []),
          routed,
        ]
        commit(
          'Route question through Result',
          (draft) => {
            if (ensured?.createdCard) draft.cards.push(ensured.createdCard)
            draft.connections.push(...addedConnections)
          },
          [
            ...(ensured?.createdCard
              ? [
                  {
                    type: 'card.created' as const,
                    cardId: ensured.createdCard.id,
                    data: { card: cloneForLog(ensured.createdCard) },
                  },
                ]
              : []),
            ...addedConnections.map((connection) => ({
              type: 'connection.created' as const,
              connectionId: connection.id,
              data: { connection: cloneForLog(connection) },
            })),
          ],
        )
        // The beat rides the wire that reaches the consumer: the routed leg.
        beginConnectionPulse(routed.id)
        return true
      }
      const conn: Connection = {
        id: newId('conn'),
        from: { cardId: plan.sourceCardId },
        to: { cardId: plan.targetCardId },
        strength: 'strong', // default: strong · helps
        polarity: 'helps',
        role: plan.role,
      }
      // Migrated to the commit funnel (#188) — the unconditional variant: a
      // connection is always created here, so the event always rides along.
      commit(
        'Connect cards',
        (draft) => {
          draft.connections.push(conn)
        },
        [
          {
            type: 'connection.created',
            connectionId: conn.id,
            data: { connection: cloneForLog(conn) },
          },
        ],
      )
      beginConnectionPulse(conn.id)
      return true
    },

    setConnectionStrength: (id, strength) => {
      const before = get().connections.find((c) => c.id === id)
      if (!before || before.strength === strength) return
      const after = { ...before, strength }
      commitConnectionReplacement('Change connection strength', before, after)
    },

    setConnectionPolarity: (id, polarity) => {
      const before = get().connections.find((c) => c.id === id)
      if (!before || before.polarity === polarity) return
      const after = { ...before, polarity }
      commitConnectionReplacement('Change connection polarity', before, after)
      beginConnectionFlip(id, before.polarity)
    },

    setConnectionGroupMode: (id, groupMode) => {
      const before = get().connections.find((c) => c.id === id)
      if (!before || before.meta?.groupMode === groupMode) return
      const after = { ...before, meta: { ...before.meta, groupMode } }
      commitConnectionReplacement('Change connection group mode', before, after)
    },

    setConnectionReason: (id, reason) => {
      const before = get().connections.find((c) => c.id === id)
      if (!before) return
      const next = reason?.trim() ? reason.trim() : undefined
      if (before.reason === next) return
      const after = next === undefined
        ? (({ reason: _reason, ...withoutReason }) => withoutReason)(before)
        : { ...before, reason: next }
      commitConnectionReplacement('Change connection reason', before, after)
    },

    reorderContextItems: (connectionIds) => {
      const order = new Map(connectionIds.map((id, index) => [id, index]))
      const beforeConnections = get().connections
      const nextConnections = beforeConnections.map((c) =>
        order.has(c.id)
          ? { ...c, meta: { ...c.meta, contextOrder: order.get(c.id) } }
          : c,
      )
      const events = nextConnections
        .map((after) => {
          const before = beforeConnections.find((c) => c.id === after.id)
          if (!before || before.meta?.contextOrder === after.meta?.contextOrder) return null
          return {
            type: 'connection.changed',
            connectionId: after.id,
            data: { before: cloneForLog(before), after: cloneForLog(after) },
          } satisfies Extract<IntentLogEventDraft, { type: 'connection.changed' }>
        })
        .filter((event): event is Extract<IntentLogEventDraft, { type: 'connection.changed' }> => Boolean(event))
      if (events.length === 0) return commit('Reorder context items', () => {}, [])
      return commit(
        'Reorder context items',
        (draft) => {
          draft.connections = draft.connections.map((connection) => {
            const next = nextConnections.find((candidate) => candidate.id === connection.id)
            return next && next.meta?.contextOrder !== connection.meta?.contextOrder ? next : connection
          })
        },
        events,
      )
    },

    deleteConnection: (id) => {
      get().deleteConnections([id])
    },

    // Deleting a multi-selection (#212) is one commit: one undo entry restores
    // the whole batch, with one connection.deleted event per connection.
    deleteConnections: (ids) => {
      const idSet = new Set(ids)
      const doomed = get().connections.filter((c) => idSet.has(c.id))
      if (!doomed.length) return
      commit(
        doomed.length === 1 ? 'Delete connection' : 'Delete connections',
        (draft) => {
          draft.connections = draft.connections.filter((c) => !idSet.has(c.id))
        },
        doomed.map((connection) => ({
          type: 'connection.deleted' as const,
          connectionId: connection.id,
          data: { connection: cloneForLog(connection) },
        })),
      )
      set({ selection: null, connectionEditorId: null })
    },

    // ---- undo/redo ----
    // Undo/redo replay ring entries against the board and never touch the
    // Intent Log — it is append-only. ADR 0016 additionally wants undo/redo to
    // append compensating events (undo.applied / redo.applied); that is
    // deliberately NOT implemented yet because the #187 characterization test
    // pins "undo adds no log entries" (scenario 5) and updating it requires
    // maintainer sign-off. Enable by passing the compensating event where the
    // empty arrays are noted below, once signed off.
    undo: () => {
      const entry = get().undoStack[get().undoStack.length - 1]
      if (!entry) return
      if (isPatchUndoEntry(entry)) {
        // Once signed off, pass: [{ type: 'undo.applied', data: { targetCommitId: entry.commitId } }]
        replayRingEntry(entry, 'undo', [])
        return
      }
      const prepared = prepareActionForApply(currentHistoryBoard(), entry.action, 'backward')
      const preparedEntry = { ...entry, action: prepared }
      const nextBoard = applyHistoryAction(currentHistoryBoard(), prepared, 'backward')
      stageKnownOriginsIntroducedBetween(get().cards, nextBoard.cards)
      writeBoardState(
        (draft) => {
          draft.cards = nextBoard.cards
          draft.connections = nextBoard.connections
          draft.outputs = nextBoard.outputs
        },
        {
          boardChange: {
            source: 'undo',
            targetCommitId: entry.commitId,
            label: 'label' in entry.action ? entry.action.label : undefined,
          },
        },
      )
      set((s) => ({
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, preparedEntry].slice(-UNDO_RING_LIMIT),
        selection: null,
        selectedCardIds: [],
      }))
    },

    redo: () => {
      const entry = get().redoStack[get().redoStack.length - 1]
      if (!entry) return
      if (isPatchUndoEntry(entry)) {
        // Once signed off, pass: [{ type: 'redo.applied', data: { targetCommitId: entry.commitId } }]
        replayRingEntry(entry, 'redo', [])
        return
      }
      const prepared = prepareActionForApply(currentHistoryBoard(), entry.action, 'forward')
      const preparedEntry = { ...entry, action: prepared }
      const nextBoard = applyHistoryAction(currentHistoryBoard(), prepared, 'forward')
      stageKnownOriginsIntroducedBetween(get().cards, nextBoard.cards)
      writeBoardState(
        (draft) => {
          draft.cards = nextBoard.cards
          draft.connections = nextBoard.connections
          draft.outputs = nextBoard.outputs
        },
        {
          boardChange: {
            source: 'redo',
            targetCommitId: entry.commitId,
            label: 'label' in entry.action ? entry.action.label : undefined,
          },
        },
      )
      set((s) => ({
        undoStack: [...s.undoStack, preparedEntry].slice(-UNDO_RING_LIMIT),
        redoStack: s.redoStack.slice(0, -1),
        selection: null,
        selectedCardIds: [],
      }))
    },

    recordCardStructuralChange: (label, beforeCards, afterCards) => {
      // One card-diff rule (issue #184): the Intent Log Events are derived from
      // the same patches the undo entry replays, so history and the log can
      // never disagree about whether a change happened.
      const action = cardUpdateAction(label, beforeCards, afterCards)
      if (!action || action.type !== 'cardsUpdated') return
      adoptStructurallyChangedAgentCards(action)
      commitInteractionSummary(action, structuralEventDrafts(action.patches), 'routine-quiet')
    },

    // ---- selection ----
    select: (selection) => set({ selection }),
    setSelectedCardIds: (selectedCardIds) => set({ selectedCardIds }),
    setActiveTool: (activeTool) => set({ activeTool }),
    // The connection whose pill popover is open. Transient UI state (like
    // selection) rather than component state: the canvas remounts edge
    // components on every graph commit, so an open editor must outlive them.
    openConnectionEditor: (connectionEditorId) => set({ connectionEditorId }),
    closeConnectionEditor: () => set({ connectionEditorId: null }),
    // Retire a finished beat. Guarded by seq: an edge's animation-end and the
    // store's own backstop timer both call this, and a newer beat must win.
    clearConnectionPulse: (seq) =>
      set((s) => (s.connectionPulse?.seq === seq ? { connectionPulse: null } : {})),
    clearConnectionFlip: (seq) =>
      set((s) => (s.connectionFlip?.seq === seq ? { connectionFlip: null } : {})),

    // ---- highlights ----
    createHighlightTag: (name) => {
      const existing = findTagByName(get().highlightTags, name)
      if (existing) {
        set({ activeHighlightTagId: existing.id })
        return existing.id
      }
      const tag = makeHighlightTag(name, get().highlightTags)
      writeBoardState((draft) => {
        draft.highlightTags.push(tag)
      })
      set({ activeHighlightTagId: tag.id })
      return tag.id
    },

    setActiveHighlightTag: (id) => {
      if (!get().highlightTags.some((tag) => tag.id === id)) return
      set({ activeHighlightTagId: id })
    },

    renameHighlightTag: (id, name) => {
      const trimmed = name.trim()
      if (!trimmed || !get().highlightTags.some((tag) => tag.id === id)) return
      // Names stay unique: renaming onto an existing tag is a no-op, not a merge.
      const clash = findTagByName(get().highlightTags, trimmed)
      if (clash && clash.id !== id) return
      writeBoardState((draft) => {
        draft.highlightTags = draft.highlightTags.map((tag) => (tag.id === id ? { ...tag, name: trimmed } : tag))
      })
    },

    setHighlightTagColor: (id, color) => {
      if (!HIGHLIGHT_PALETTE.some((candidate) => candidate.id === color)) return
      if (!get().highlightTags.some((tag) => tag.id === id)) return
      writeBoardState((draft) => {
        draft.highlightTags = draft.highlightTags.map((tag) => (tag.id === id ? { ...tag, color } : tag))
      })
    },

    addHighlight: ({ cardId, text, occurrence }) => {
      if (!text.trim()) return null
      if (!get().cards.some((card) => card.id === cardId)) return null

      // The highlighter always paints with a tag; make the starter tag on first use.
      let tagId = get().activeHighlightTagId
      if (!tagId || !get().highlightTags.some((tag) => tag.id === tagId)) {
        tagId = get().highlightTags[0]?.id ?? get().createHighlightTag(DEFAULT_HIGHLIGHT_TAG_NAME)
        set({ activeHighlightTagId: tagId })
      }

      // Painting over the same span again re-tags it instead of stacking a twin.
      const twin = get().highlights.find(
        (h) => h.cardId === cardId && h.text === text && h.occurrence === occurrence,
      )
      if (twin) {
        if (twin.tagId !== tagId) {
          writeBoardState((draft) => {
            draft.highlights = draft.highlights.map((h) => (h.id === twin.id ? { ...h, tagId: tagId! } : h))
          })
        }
        return twin.id
      }

      const highlight: Highlight = {
        id: newId('hl'),
        cardId,
        tagId,
        text,
        occurrence,
        createdAt: new Date().toISOString(),
      }
      writeBoardState((draft) => {
        draft.highlights.push(highlight)
      })
      return highlight.id
    },

    removeHighlight: (id) => {
      if (!get().highlights.some((h) => h.id === id)) return
      writeBoardState((draft) => {
        draft.highlights = draft.highlights.filter((h) => h.id !== id)
      })
    },

    deleteHighlightTag: (id) => {
      if (!get().highlightTags.some((tag) => tag.id === id)) return
      writeBoardState((draft) => {
        draft.highlightTags = draft.highlightTags.filter((tag) => tag.id !== id)
        draft.highlights = draft.highlights.filter((h) => h.tagId !== id)
      })
      if (get().activeHighlightTagId === id) {
        set({ activeHighlightTagId: get().highlightTags[0]?.id ?? null })
      }
    },

    setHighlightsPanelOpen: (highlightsPanelOpen) => set({ highlightsPanelOpen }),

    requestCardFocus: (cardId) => {
      set((s) => ({
        cardFocusRequest: { cardId, requestId: (s.cardFocusRequest?.requestId ?? 0) + 1 },
      }))
    },

    createNoteFromHighlight: (highlightId) => {
      const highlight = get().highlights.find((h) => h.id === highlightId)
      const source = highlight && get().cards.find((c) => c.id === highlight.cardId)
      if (!highlight || !source) return null

      const noteId = get().addCard('note', {
        x: source.position.x + cardSize(source).width + 60,
        y: source.position.y,
      })
      get().setCardText(noteId, highlight.text)
      get().addConnection(source.id, noteId)
      return noteId
    },

    // ---- settings ----
    setApiKey: async (apiKey) => {
      if (isProfileReviewExecution()) {
        throw new Error('Development Profile review credential is read-only')
      }
      if (currentPersistenceKind() === 'packaged-profile') {
        const bridge = configuredApiCredentialBridge
        if (!bridge) throw new Error('Installed Keychain bridge is unavailable')
        await apiCredentialLoad
        const result = apiKey ? await bridge.set(apiKey) : await bridge.clear()
        if (!result.ok) throw new Error('Local credential storage is unavailable')
      }
      // A write that returned means this slot opened, so whatever was locked
      // about it at launch is not locked now. Only this slot: the other key's
      // value was never re-read, so clearing its flag too would leave an empty
      // field with no explanation, which is the silent loss the notice exists
      // to prevent (#1360).
      set({ settings: { ...get().settings, apiKey }, apiKeyLocked: false })
    },
    // Written through to the store the moment it is saved, not at the next
    // launch. A Card already on screen has to change what it says about its
    // reach without a restart, and nothing else would make that true.
    setLinkupKey: async (linkupKey) => {
      if (isProfileReviewExecution()) {
        throw new Error('Development Profile review credential is read-only')
      }
      if (currentPersistenceKind() === 'packaged-profile') {
        const bridge = configuredApiCredentialBridge
        if (!bridge) throw new Error('Installed Keychain bridge is unavailable')
        await apiCredentialLoad
        const result = linkupKey
          ? await bridge.set(linkupKey, 'linkup')
          : await bridge.clear('linkup')
        if (!result.ok) throw new Error('Local credential storage is unavailable')
      }
      set({
        settings: { ...get().settings, linkupKey },
        linkupKeyPresent: hasLinkupKey({ linkupKey }),
        // A write that returned means this slot opened. Same reasoning as
        // `setApiKey`: this slot only.
        linkupKeyLocked: false,
      })
    },
    setProvider: (provider, providerModelsDraft) => {
      if (isProfileReviewExecution() || !isAiProvider(provider)) return
      const current = get().settings
      const currentProvider = current.provider ?? 'openrouter'
      const currentProviderModels = normalizeProviderModelSettingsMap(current.providerModels)
      const providerModels = normalizeProviderModelSettingsMap(
        providerModelsDraft ?? {
          ...currentProviderModels,
          [currentProvider]: { model: current.model, models: current.models },
        },
        currentProviderModels,
      )
      const selection = providerModels[provider]
      const providerChanged = currentProvider !== provider
      // The moment the provider changes is the moment a rung it does not show
      // stops being a real choice. Settings only displayed the stepped value,
      // so the screen said Low while the run still sent None. Commit the
      // stepped value here, at the one place a provider change lands, so what
      // is read, what is stored and what is sent are the same value.
      const reasoningEffort = nearestReasoningEffort(provider, current.reasoningEffort, selection.model)
      const settingsChanged = providerChanged
        || current.reasoningEffort !== reasoningEffort
        || current.model !== selection.model
        || JSON.stringify(current.models) !== JSON.stringify(selection.models)
        || JSON.stringify(currentProviderModels) !== JSON.stringify(providerModels)
      if (!settingsChanged) return
      const settings = {
        ...current,
        provider,
        providerModels,
        reasoningEffort,
        model: selection.model,
        models: [...selection.models],
      }
      set({ settings })
      if (!providerChanged) {
        persist()
        return
      }
      const committed = commit(
        'Switch AI provider models',
        (draft) => {
          draft.cards = draft.cards.map((card) => (
            (card.kind === 'askAi' || card.kind === 'group') && card.model !== settings.model
              ? { ...card, model: settings.model }
              : card
          ))
        },
        [],
      )
      if (!committed.changed) persist()
    },
    setOpenRouterModel: (model) => {
      if (isProfileReviewExecution()) return
      const selectedModel = model.trim()
      if (!isOpenRouterSlug(selectedModel)) return
      const current = get().settings
      const currentProviderModels = normalizeProviderModelSettingsMap(current.providerModels)
      const currentOpenRouterModel = current.provider === 'openrouter'
        ? current.model
        : currentProviderModels.openrouter.model
      const nestedSelectionMatches = currentProviderModels.openrouter.model === selectedModel
      const activeSelectionMatches = current.provider !== 'openrouter'
        || currentOpenRouterModel === selectedModel
      if (nestedSelectionMatches && activeSelectionMatches) return
      const catalog = normalizeRecommendedModelCatalog([
        ...(current.recommendedModelCatalog
          ?? currentProviderModels.openrouter.models
          ?? DEFAULT_MODEL_SLUGS),
        selectedModel,
      ])
      const openrouter = {
        model: selectedModel,
        models: catalog,
      }
      const settings = {
        ...current,
        providerModels: {
          ...currentProviderModels,
          openrouter,
        },
        ...(current.provider === 'openrouter'
          ? { model: selectedModel, models: [...catalog] }
          : {}),
      }
      set({ settings })
      persist()
    },
    setRecommendedModelCatalog: (models) => {
      updateRecommendedModelCatalog(models)
    },
    replaceRecommendedModel: (previous, replacement) => {
      if (isProfileReviewExecution()) return false
      const currentCatalog = get().settings.recommendedModelCatalog ?? DEFAULT_MODEL_SLUGS
      const nextCatalog = replaceRecommendedModel(currentCatalog, previous, replacement)
      if (!nextCatalog) return false
      const current = get().settings
      const currentProviderModels = normalizeProviderModelSettingsMap(current.providerModels)
      const selected = current.provider === 'openrouter'
        ? current.model
        : currentProviderModels.openrouter.model
      const selectedIdentityEdited = selected === previous && replacement !== previous
      updateRecommendedModelCatalog(
        nextCatalog,
        selectedIdentityEdited ? replacement : selected,
      )
      if (selectedIdentityEdited) persist()
      return true
    },
    setHarnessCommand: (provider, command) => {
      if (isProfileReviewExecution() || !isLocalHarness(provider)) return
      const current = get().settings
      const harnesses = normalizeHarnesses({
        ...(current.harnesses ?? DEFAULT_LOCAL_HARNESS_SETTINGS),
        [provider]: { command },
      })
      set({ settings: { ...current, harnesses } })
      saveLocalHarnessSettings(harnesses)
    },
    setSystemPrompt: (systemPrompt) => {
      const settings = { ...get().settings, systemPrompt }
      set({ settings })
      persist()
    },
    setReasoningEffort: (reasoningEffort) => {
      const settings = { ...get().settings, reasoningEffort }
      set({ settings })
      persist()
    },
    setChainConfirmThreshold: (threshold) => {
      const chainConfirmThreshold = normalizeChainConfirmThreshold(threshold, DEFAULT_CHAIN_CONFIRM_THRESHOLD)
      const settings = { ...get().settings, chainConfirmThreshold }
      set({ settings })
      persist()
    },
    setCompactionMode: (mode) => {
      const compactionMode = normalizeCompactionMode(mode, DEFAULT_COMPACTION_MODE)
      const settings = { ...get().settings, compactionMode }
      set({ settings })
      persist()
    },
    recordCompactionSummary: (summary) => {
      writeBoardState((draft) => {
        draft.compactionSummaries = [
          ...draft.compactionSummaries.filter((candidate) => candidate.cardId !== summary.cardId),
          summary,
        ]
      })
    },
    setKeyPromptOpen: (keyPromptOpen) => set({ keyPromptOpen }),
    setIdeaManagerOpen: (ideaManagerOpen) => set({ ideaManagerOpen }),

    // ---- run engine writes ----
    // Thin wrappers over the internal run spine (startRun/settleRun above).
    beginRun: (askAiCardId, compiled) =>
      startRun(askAiCardId, 'ask', {
        model: compiled.model,
        usedCardIds: compiled.usedCardIds,
        usedConnectionIds: compiled.usedConnectionIds,
        usedGroupDigests: compiled.usedGroupDigests,
        modIds: compiled.modIds,
        appliedMods: compiled.appliedMods,
        compiledInstruction: compiled.text,
        contextBudget: compiled.contextBudget,
        plan: compiled.plan,
        triggeredBy: compiled.triggeredBy,
        aiAccessPhases: compiled.aiAccessPhases,
        sourceContext: compiled.sourceContext,
        resultPlacementContext: compiled.resultPlacementContext,
        agentic: compiled.agentic,
      }),

    beginGroupDigestRun: (groupCardId, compiled) =>
      startRun(groupCardId, 'groupDigest', {
        model: compiled.model,
        usedCardIds: compiled.usedCardIds,
        usedConnectionIds: compiled.usedConnectionIds,
        modIds: [],
        appliedMods: [],
        compiledInstruction: compiled.text,
        digestKey: compiled.digestKey,
        triggeredBy: compiled.triggeredBy,
        sourceContext: compiled.sourceContext,
      }),

    recordRunToolStep: (runId, step) => {
      // Arrives while the run streams, like text does, so it uses the same
      // no-immediate-save writer: the debounced saver picks up the latest
      // snapshot anyway.
      writeBoardState(
        (draft) => {
          const run = draft.runs.find((candidate) => candidate.id === runId)
          if (!run) return
          run.toolSteps = [...(run.toolSteps ?? []), step]
        },
        { persist: false, refreshBrowserPendingSave: true },
      )
    },

    appendVersionText: (versionId, chunk) => {
      // High-frequency during streaming; set without forcing an immediate save —
      // the debounced saver picks up the latest snapshot anyway.
      writeBoardState(
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            version.text += chunk
          })
        },
        { persist: false, refreshBrowserPendingSave: true },
      )
    },

    resetVersionText: (versionId) => {
      // Mid-stream, like the appends around it, so the same no-immediate-save
      // writer: the debounced saver picks up the latest snapshot anyway.
      writeBoardState(
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            version.text = ''
          })
        },
        { persist: false, refreshBrowserPendingSave: true },
      )
    },

    finishRun: (runId) => settleRun(runId, 'done'),

    failRun: (runId, message) => settleRun(runId, 'failed', message),

    // A canceled plain Ask AI or Group compression run keeps whatever text has
    // already streamed, marked as a Provisional Version.
    cancelRun: (runId) => settleRun(runId, 'canceled'),

    chooseVersion: (outputId, versionId) => {
      const output = get().outputs.find((o) => o.id === outputId)
      if (!output || output.chosenVersionId === versionId) return commit('Choose version', () => {}, [])
      return commit(
        'Choose version',
        (draft) => {
          const target = draft.outputs.find((o) => o.id === outputId)
          if (!target) return
          target.chosenVersionId = versionId
        },
        [
          {
            type: 'version.chosen',
            versionId,
            data: {
              outputId,
              ...(output?.chosenVersionId === undefined
                ? {}
                : { previousVersionId: output.chosenVersionId }),
              nextVersionId: versionId,
            },
          },
        ],
      )
    },

    setVersionAccepted: (outputId, versionId, accepted) => {
      const version = get().outputs
        .find((output) => output.id === outputId)
        ?.versions.find((candidate) => candidate.id === versionId)
      const nextAccepted = accepted ?? !version?.accepted
      if (!version || Boolean(version.accepted) === nextAccepted) {
        return commit(nextAccepted ? 'Keep version' : 'Unkeep version', () => {}, [])
      }
      return commit(
        nextAccepted ? 'Keep version' : 'Unkeep version',
        (draft) => {
          const target = draft.outputs
            .find((output) => output.id === outputId)
            ?.versions.find((candidate) => candidate.id === versionId)
          if (target) target.accepted = nextAccepted
        },
        [],
      )
    },

    appendFollowUpMessage: (versionId, message) => {
      commit(
        'Append follow-up message',
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            version.followUpThread = {
              collapsed: false,
              ...version.followUpThread,
              messages: [...(version.followUpThread?.messages ?? []), message],
            }
          })
        },
        [{ type: 'followup.message.added', versionId, data: followUpEventData(versionId, message) }],
      )
    },

    appendFollowUpChunk: (versionId, messageId, chunk) => {
      // High-frequency during streaming; set without forcing an immediate save.
      writeBoardState(
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            if (!version.followUpThread) return
            version.followUpThread.messages = version.followUpThread.messages.map((m) =>
              m.id === messageId ? { ...m, text: m.text + chunk } : m,
            )
          })
        },
        { persist: false, refreshBrowserPendingSave: true },
      )
    },

    resetFollowUpMessageText: (versionId, messageId) => {
      // Mid-stream, like the chunk appends, so no immediate save either.
      writeBoardState(
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            if (!version.followUpThread) return
            version.followUpThread.messages = version.followUpThread.messages.map((m) =>
              m.id === messageId ? { ...m, text: '' } : m,
            )
          })
        },
        { persist: false, refreshBrowserPendingSave: true },
      )
    },

    recordFollowUpToolStep: (versionId, messageId, step) => {
      // Arrives while the reply streams, like its text does, so it uses the
      // same no-immediate-save writer.
      writeBoardState(
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            if (!version.followUpThread) return
            version.followUpThread.messages = version.followUpThread.messages.map((m) =>
              m.id === messageId ? { ...m, toolSteps: [...(m.toolSteps ?? []), step] } : m,
            )
          })
        },
        { persist: false, refreshBrowserPendingSave: true },
      )
    },

    finishFollowUpMessage: (versionId, messageId, status) => {
      const located = locateVersion(versionId)
      const existing = located?.version.followUpThread?.messages.find((message) => message.id === messageId)
      if (!existing || existing.status === status) return commit('Finish follow-up message', () => {}, [])
      const finishedMessage = { ...existing, status }
      return commit(
        'Finish follow-up message',
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            if (!version.followUpThread) return
            version.followUpThread.messages = version.followUpThread.messages.map((m) =>
              m.id === messageId ? { ...m, status } : m,
            )
          })
        },
        [{ type: 'followup.message.finished', versionId, data: followUpEventData(versionId, finishedMessage) }],
      )
    },

    setFollowUpCollapsed: (versionId, collapsed) => {
      writeBoardState((draft) => {
        draft.outputs = draft.outputs.map((o) => ({
          ...o,
          versions: o.versions.map((v) =>
            v.id === versionId
              ? {
                  ...v,
                  followUpThread: {
                    messages: v.followUpThread?.messages ?? [],
                    ...v.followUpThread,
                    collapsed,
                  },
                }
              : v,
          ),
        }))
      })
    },

    clearFollowUpThread: (versionId) => {
      const located = locateVersion(versionId)
      const previousMessages = located?.version.followUpThread?.messages ?? []
      if (previousMessages.length === 0) return commit('Clear follow-up thread', () => {}, [])
      return commit(
        'Clear follow-up thread',
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            version.followUpThread = { messages: [], collapsed: version.followUpThread?.collapsed ?? false }
          })
        },
        [
          {
            type: 'followup.thread.cleared',
            versionId,
            data: {
              outputId: located?.output.id,
              resultCardId: located?.output.resultCardId,
              previousMessages: cloneForLog(previousMessages),
            },
          },
        ],
      )
    },

    createVersionNote: (versionId, text, position, source, sourceMessageId) => {
      if (!text.trim()) return null
      const located = locateVersion(versionId)
      const beforeCards = get().cards
      const note = placeCreatedCard(beforeCards, {
        id: newId('note'),
        kind: 'note',
        blocks: [{ id: newId('blk'), text }],
        position,
      })
      const plannedCards = reconcileGroupMembership([...beforeCards, note])
      adoptAgentGroupsWithMembershipChanges(beforeCards, plannedCards)
      const textLength = text.length
      commit(
        'Create version note',
        (draft) => {
          draft.cards = reconcileGroupMembership([...draft.cards, note])
        },
        [
          { type: 'card.created', cardId: note.id, data: { card: cloneForLog(note) } },
          {
            type: 'version.note.created',
            versionId,
            cardId: note.id,
            data: {
              ...(located === undefined
                ? {}
                : { outputId: located.output.id, resultCardId: located.output.resultCardId }),
              noteCardId: note.id,
              source,
              ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
              textLength,
            },
          },
        ],
      )
      return note.id
    },

    // ---- conversation run writes ----
    beginConversationRun: (conversationCardId, init) =>
      startRun(conversationCardId, 'conversation', {
        model: init.model,
        usedCardIds: init.usedCardIds,
        usedConnectionIds: init.usedConnectionIds,
        modIds: init.modIds ?? init.conversation.topLevelMods.map((mod) => mod.cardId),
        appliedMods: init.appliedMods ?? [],
        compiledInstruction: '',
        conversation: init.conversation,
        contextBudget: init.contextBudget,
        triggeredBy: init.triggeredBy,
        aiAccessPhases: init.aiAccessPhases,
        // A continuation seeds the new version with the prior transcript, so
        // the exchange continues as a living surface rather than restarting.
        seedTranscript: init.seedTranscript ?? [],
        sourceContext: init.sourceContext,
      }),

    continueConversationRun: (
      conversationCardId,
      versionId,
      provenance,
      sourceContext,
      mods,
      aiAccessPhase,
    ) => {
      // Reuse the run that produced this version so the whole exchange stays one
      // conversation = one version. Reopening is the ONE legal transition out of
      // a terminal status — it commits a run.continued event through the funnel,
      // and the reopened run then settles exactly once more (settleRun guards
      // each running phase, not the record's whole life).
      const index = get().graph()
      const producing = index.runForVersion(versionId)
      const existing = producing?.kind === 'conversation' ? producing : undefined
      const now = new Date().toISOString()
      const provider = get().settings.provider ?? 'openrouter'
      const model = resolveProfileReviewModel(get().settings.model)
      if (existing && (
        (existing.provider ?? 'openrouter') !== provider
        || resolveProfileReviewModel(existing.model) !== model
      )) {
        throw new Error('Conversation provider or model changed')
      }
      const modIds = mods?.modIds ?? existing?.modIds ?? provenance.topLevelMods.map((mod) => mod.cardId)
      const appliedMods = mods?.appliedMods ?? existing?.appliedMods ?? []
      const aiAccessPhases = aiAccessPhase === undefined
        ? cloneAiAccessPhases(existing?.aiAccessPhases)
        : cloneAiAccessPhases([...(existing?.aiAccessPhases ?? []), aiAccessPhase])

      // A version whose producing run is gone (older save) gets a fresh run
      // attached to it instead — a start, not a continuation, in the log.
      const continued: RunRecord = existing
        ? (({ errorMessage: _errorMessage, finishedAt: _finishedAt, ...activeRun }) => ({
            ...activeRun,
            model,
            provider,
            status: 'running' as const,
            modIds,
            appliedMods,
            ...(aiAccessPhases === undefined ? {} : { aiAccessPhases }),
            conversation: { ...provenance, turns: existing.conversation?.turns ?? [] },
          }))(existing)
        : {
            id: newId('run'),
            startedAt: now,
            askAiCardId: conversationCardId,
            model,
            provider,
            usedCardIds: [],
            usedConnectionIds: [],
            modIds,
            appliedMods,
            compiledInstruction: '',
            status: 'running',
            producedVersionId: versionId,
            kind: 'conversation',
            conversation: provenance,
            ...(aiAccessPhases === undefined ? {} : { aiAccessPhases }),
          }
      const runId = continued.id

      commit(
        'Continue conversation',
        (draft) => {
          for (const output of draft.outputs) {
            const version = output.versions.find((v) => v.id === versionId)
            if (!version) continue
            // Continuing a canceled/failed conversation clears the Provisional marker.
            version.provisional = false
            delete version.provisionalReason
            delete version.provisionalMessage
            if (sourceContext !== undefined) version.sourceContext = sourceContext
            delete version.sourceChangeDismissedSignature
            output.chosenVersionId = versionId
          }
          const target = draft.runs.find((r) => r.id === runId)
          if (target) {
            target.status = 'running'
            delete target.finishedAt
            delete target.errorMessage
            target.model = continued.model
            target.provider = continued.provider
            target.modIds = continued.modIds
            target.appliedMods = continued.appliedMods
            if (continued.aiAccessPhases !== undefined) {
              target.aiAccessPhases = continued.aiAccessPhases
            }
            target.conversation = continued.conversation
          } else {
            draft.runs.push(continued)
          }
        },
        [
          existing
            ? { type: 'run.continued', runId, data: { run: cloneForLog(continued) } }
            : { type: 'run.started', runId, data: { run: cloneForLog(continued) } },
        ],
      )

      return { runId, versionId }
    },

    updateConversationProvenance: (runId, partial) => {
      writeBoardState((draft) => {
        const run = draft.runs.find((r) => r.id === runId && r.conversation)
        if (run?.conversation) run.conversation = { ...run.conversation, ...partial }
      })
    },

    appendTranscriptMessage: (versionId, message) => {
      writeBoardState((draft) => {
        visitOutputVersions(draft, versionId, (version) => {
          version.transcript = [...(version.transcript ?? []), message]
        })
      })
    },

    appendTranscriptChunk: (versionId, messageId, chunk) => {
      // High-frequency during streaming; set without forcing an immediate save —
      // the debounced saver picks up the latest snapshot anyway.
      writeBoardState(
        (draft) => {
          visitOutputVersions(draft, versionId, (version) => {
            version.transcript = (version.transcript ?? []).map((m) =>
              m.id === messageId ? { ...m, text: m.text + chunk } : m,
            )
          })
        },
        { persist: false, refreshBrowserPendingSave: true },
      )
    },

    finishTranscriptMessage: (versionId, messageId) => {
      writeBoardState((draft) => {
        visitOutputVersions(draft, versionId, (version) => {
          const transcript = (version.transcript ?? []).map((m) =>
            m.id === messageId ? { ...m, streaming: false } : m,
          )
          version.transcript = transcript
          version.text = flattenTranscript(transcript)
        })
      })
    },

    recordConversationTurn: (runId, turn) => {
      writeBoardState((draft) => {
        const run = draft.runs.find((r) => r.id === runId && r.conversation)
        if (run?.conversation) {
          run.conversation = { ...run.conversation, turns: [...run.conversation.turns, turn] }
        }
      })
    },

    finishConversationRun: (runId) => settleRun(runId, 'done'),

    // A failed or canceled Conversation KEEPS its transcript as a Provisional
    // Version (unlike a plain Ask AI failure, which drops its empty placeholder).
    failConversationRun: (runId, message) => settleRun(runId, 'failed', message),

    cancelConversationRun: (runId) => settleRun(runId, 'canceled'),

    dismissSourceChanges: (versionId, signature) => {
      writeBoardState((draft) => {
        visitOutputVersions(draft, versionId, (version) => {
          version.sourceChangeDismissedSignature = signature
        })
      })
    },
  }
})
