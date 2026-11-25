import {
  PROFILE_RENDERER_CHECKPOINT_ACK_EVENT,
  PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT,
  type ProfileRendererCheckpointAck,
  type ProfileRendererCheckpointRequest,
  InstalledProfileBridge,
  type ProfileBridgeHydration,
  type ProfileBridgeImportIdeaClosureRequest,
  type ProfileBridgeImportIdeaClosureResult,
  type ProfileBridgePortableExportRequest,
  type ProfileBridgePortableExportResult,
  type ProfileBridgeRecoveryInspection,
  type ProfileBridgeRecoveryRestoreReceipt,
  type ProfileBridgeStartFreshReceipt,
  type RendererProfileProjection,
} from '../../electron/profileBridgeContract'
import {
  GUI_PROFILE_PROJECTION_VERSION,
  type GuiNewModOrigin,
  type GuiUserModTemplate,
} from '../persistence/profileGuiProjection'
import {
  validateProfileModDocumentTransport,
  type ProfileModDocument,
} from '../persistence/profileModRecords'
import {
  PROFILE_PORTABLE_LIFECYCLE_VERSION,
  type ProfileDuplicateIdeaRequest,
  type ProfileIdeaLifecycleReceipt,
  type ProfileServiceFailure,
  type ProfileSnapshot,
} from '../persistence/profileServiceContract'
import { captureProfileGuiInertJson } from '../persistence/profileGuiSaveScheduler'
import { isProfileIntentActorId } from '../persistence/profileIntentActor'
import { remapModPartIdentities } from '../mods'
import {
  captureStampedProfileModOrigin,
  type ProfileModOriginCompanion,
  type ProfileModTemplateRevision,
} from './profileModOrigins'
import type { IdeaSummary, SavedBoard } from './types'
import { newId } from '../shared/ids'
import { mergeLiveProfileAuthority } from './profileLiveAuthorityMerge'

export type ProfileRendererEnvironment = Readonly<Record<string, unknown>> & Readonly<{
  eidoDesktop?: unknown
  eidoProfile?: unknown
  location?: unknown
}>

export type ProfileRendererSelectionOptions = Readonly<{
  mode?: 'browser-development'
}>

export type BrowserDevelopmentPersistence = Readonly<{
  kind: 'browser-development'
}>

export type PackagedProfilePersistence = Readonly<{
  kind: 'packaged-profile'
  persistence: ProfileRendererPersistence
}>

export type ProfileRendererPersistenceSelection =
  | BrowserDevelopmentPersistence
  | PackagedProfilePersistence

const REQUIRED_PROFILE_BRIDGE_METHODS = [
  'runtimeProbe',
  'hydrate',
  'ackHydration',
  'createOrdinaryIdea',
  'commitGuiProjection',
  'flush',
  'status',
  'capabilities',
  'query',
  'exportPortable',
  'duplicateIdea',
  'importIdeaClosure',
  'inspectRecovery',
  'restoreRecovery',
  'startFresh',
] as const satisfies readonly (keyof InstalledProfileBridge)[]

export type ProfileRendererHydration = Readonly<{
  intentActorId: string
  idea: IdeaSummary
  board: SavedBoard
  ideas: readonly IdeaSummary[]
  userModTemplates: readonly GuiUserModTemplate[]
  modOrigins: Readonly<Record<string, GuiNewModOrigin>>
}>

export type ProfileRendererAuthoritativeUpdate = Readonly<{
  previousRevision: number
  revision: number
  previous: ProfileRendererHydration
  next: ProfileRendererHydration
  // Raw native authority before/after, prior to merging renderer work held by
  // the live barrier. The store needs this transition to retire user undo that
  // overlaps an Agent edit even when the held GUI value wins the visible merge.
  authoritativeTransition: Readonly<{
    previous: ProfileRendererHydration
    next: ProfileRendererHydration
  }>
}>

export type ProfileRendererAuthoritativeApplyResult = Readonly<{
  status: 'applied' | 'blocked' | 'stale'
  revision: number
}>

/**
 * The renderer-state seam. Hydration application is deliberately synchronous:
 * returning anything except undefined is terminal and the host epoch is never
 * acknowledged. Bridge acknowledgement stays private to the adapter.
 */
export type ProfileRendererStateSink = Readonly<{
  applyHydration(hydration: ProfileRendererHydration): undefined
  applyAuthoritativeUpdate(
    update: ProfileRendererAuthoritativeUpdate,
  ): ProfileRendererAuthoritativeApplyResult
  admitHydration(): undefined
  applySaveStatus(status: ProfileRendererSaveStatus): void
  applyTerminalFailure(failure: ProfileRendererTerminalFailure): void
}>

export type ProfileRendererTerminalFailure = Readonly<{
  kind: 'terminal'
  error: ProfileRendererPersistenceError
}>

export type ProfileRendererPersistence = Readonly<{
  connectStateSink(sink: ProfileRendererStateSink): void
  hydrate(): Promise<ProfileRendererHydration>
  applyAuthoritativeSnapshot(snapshot: ProfileSnapshot): ProfileRendererAuthoritativeApplyResult
  beginAuthoritativeMutation(state: ProfileRendererCommitState): Promise<ProfileRendererFlushReceipt>
  /** Captures transient renderer progress only while a live authority barrier can replace it. */
  captureAuthoritativeMutationProgress(state: ProfileRendererCommitState): boolean
  /** Flushes the held renderer state but retains exclusive ownership for terminal shutdown. */
  sealAuthoritativeMutation(state: ProfileRendererCommitState): Promise<ProfileRendererFlushReceipt>
  finishAuthoritativeMutation(): Promise<ProfileRendererFlushReceipt>
  stampModTemplate(templateId: string): ProfileModOriginCompanion
  schedule(state: ProfileRendererCommitState): number
  flush(): Promise<ProfileRendererFlushReceipt>
  loadIdea(id: string): Promise<ProfileRendererHydration | null>
  createOrdinaryIdea(name?: string): Promise<ProfileRendererHydration>
  renameCurrentIdea(name: string): Promise<ProfileRendererHydration>
  deleteIdea(id: string): Promise<ProfileRendererHydration>
  duplicateCurrentIdea(name?: string): Promise<ProfileRendererLifecycleResult>
  exportPortable(request: ProfileRendererPortableExportRequest): Promise<ProfileBridgePortableExportResult>
  importIdeaClosure(
    request: ProfileRendererImportIdeaClosureRequest,
  ): Promise<ProfileRendererImportIdeaClosureResult>
  inspectRecovery(): Promise<ProfileBridgeRecoveryInspection>
  restoreRecovery(candidateId: string): Promise<ProfileRendererRecoveryRestoreResult>
  startFreshProfile(): Promise<ProfileRendererStartFreshResult>
}>

export type ProfileRendererCommitState = Readonly<{
  activeIdeaId: string
  ideas: readonly IdeaSummary[]
  board: SavedBoard
  userModTemplates: readonly GuiUserModTemplate[]
  newModOrigins: Readonly<Record<string, GuiNewModOrigin>>
}>

export type ProfileRendererFlushReceipt = Readonly<{
  generation: number
  nativeGeneration: number
  revision: number
}>

export type ProfileRendererSaveStatus = 'saving' | 'saved' | 'failed'

export type ProfileRendererPersistenceOptions = Readonly<{
  now?: () => string
  createIdeaId?: () => string
  createOperationIdentity?: () => Readonly<{
    operationId: string
    idempotencyKey: string
  }>
}>

export type ProfileRendererCheckpointHandlerOptions = Readonly<{
  /** Stops and joins renderer work that can still mutate the captured graph. */
  prepareForCheckpoint?: () => Promise<void>
}>

export type ProfileRendererPortableExportRequest = Readonly<
  Omit<ProfileBridgePortableExportRequest, 'expectedRevision' | 'version'>
>

export type ProfileRendererImportIdeaClosureRequest = Readonly<
  Omit<ProfileBridgeImportIdeaClosureRequest, 'expectedRevision' | 'version'>
>

export type ProfileRendererLifecycleResult = Readonly<{
  receipt: ProfileIdeaLifecycleReceipt
  hydration: ProfileRendererHydration
}>

export type ProfileRendererImportIdeaClosureResult =
  | Readonly<{ cancelled: true }>
  | ProfileRendererLifecycleResult

export type ProfileRendererRecoveryRestoreResult = Readonly<{
  receipt: ProfileBridgeRecoveryRestoreReceipt
  hydration: ProfileRendererHydration
}>

export type ProfileRendererStartFreshResult = Readonly<{
  receipt: ProfileBridgeStartFreshReceipt
  hydration: ProfileRendererHydration
}>

export class ProfileRendererPersistenceError extends Error {
  constructor(
    message: string,
    public readonly failure?: ProfileServiceFailure,
  ) {
    super(message)
    this.name = 'ProfileRendererPersistenceError'
  }
}

export function registerProfileRendererCheckpointHandler(
  target: EventTarget,
  persistence: Pick<ProfileRendererPersistence, 'schedule' | 'flush'>,
  captureCurrentState: () => ProfileRendererCommitState,
  options: ProfileRendererCheckpointHandlerOptions = {},
): () => void {
  let inFlightToken: string | undefined
  let registered = true
  const dispatchAck = (ack: ProfileRendererCheckpointAck) => {
    if (!registered) return
    target.dispatchEvent(new CustomEvent(PROFILE_RENDERER_CHECKPOINT_ACK_EVENT, {
      detail: Object.freeze(ack),
    }))
  }
  const listener: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (!isProfileRendererCheckpointRequest(detail) || inFlightToken !== undefined) return
    inFlightToken = detail.token
    const checkpoint = async () => {
      if (options.prepareForCheckpoint) await options.prepareForCheckpoint()
      persistence.schedule(captureCurrentState())
      return persistence.flush()
    }
    void checkpoint()
      .then((receipt) => {
        dispatchAck(Object.freeze({
          token: detail.token,
          ok: true,
          generation: receipt.generation,
          nativeGeneration: receipt.nativeGeneration,
          revision: receipt.revision,
        }))
      })
      .catch(() => {
        dispatchAck(Object.freeze({ token: detail.token, ok: false }))
      })
      .finally(() => {
        inFlightToken = undefined
      })
  }
  target.addEventListener(PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT, listener)
  return () => {
    registered = false
    inFlightToken = undefined
    target.removeEventListener(PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT, listener)
  }
}

function isProfileRendererCheckpointRequest(
  candidate: unknown,
): candidate is ProfileRendererCheckpointRequest {
  if (!candidate || typeof candidate !== 'object') return false
  const record = candidate as Record<string, unknown>
  return Object.keys(record).length === 1
    && typeof record.token === 'string'
    && record.token.length > 0
    && record.token.length <= 256
}

function mergeLifecycleUserModTemplates(
  baseTemplates: readonly GuiUserModTemplate[] | undefined,
  heldTemplates: readonly GuiUserModTemplate[],
  authoritativeTemplates: readonly GuiUserModTemplate[],
): readonly GuiUserModTemplate[] {
  if (!baseTemplates) {
    throw new ProfileRendererPersistenceError('Profile Mod template merge base is unavailable')
  }
  const toUniqueMap = (templates: readonly GuiUserModTemplate[]) => {
    const mapped = new Map(templates.map((template) => [template.templateId, template]))
    if (mapped.size !== templates.length) {
      throw new ProfileRendererPersistenceError('Profile Mod template catalog is ambiguous')
    }
    return mapped
  }
  const base = toUniqueMap(baseTemplates)
  const held = toUniqueMap(heldTemplates)
  const authoritative = toUniqueMap(authoritativeTemplates)
  const orderedIds = [...new Set([
    ...authoritative.keys(),
    ...held.keys(),
    ...base.keys(),
  ])]
  const merged: GuiUserModTemplate[] = []
  for (const id of orderedIds) {
    const selected = selectLifecycleValue(
      `Mod template ${id}`,
      base.get(id),
      held.get(id),
      authoritative.get(id),
    )
    if (selected) merged.push(selected)
  }
  return Object.freeze(merged)
}

function mergeLifecycleIdeaSummaries(
  baseIdeas: readonly IdeaSummary[],
  heldIdeas: readonly IdeaSummary[],
  authoritativeIdeas: readonly IdeaSummary[],
): readonly IdeaSummary[] {
  const toUniqueMap = (ideas: readonly IdeaSummary[]) => {
    const mapped = new Map(ideas.map((idea) => [idea.id, idea]))
    if (mapped.size !== ideas.length) {
      throw new ProfileRendererPersistenceError('Profile Idea catalog is ambiguous')
    }
    return mapped
  }
  const base = toUniqueMap(baseIdeas)
  const held = toUniqueMap(heldIdeas)
  const authoritative = toUniqueMap(authoritativeIdeas)
  const orderedIds = [...new Set([
    ...authoritative.keys(),
    ...held.keys(),
    ...base.keys(),
  ])]
  const merged: IdeaSummary[] = []
  for (const id of orderedIds) {
    const selected = selectLifecycleValue(
      `Idea ${id}`,
      base.get(id),
      held.get(id),
      authoritative.get(id),
    )
    if (selected) merged.push(selected)
  }
  return Object.freeze(merged)
}

function mergeLifecycleBoards(
  ideas: readonly IdeaSummary[],
  baseBoards: Readonly<Record<string, SavedBoard>>,
  heldBoards: Readonly<Record<string, SavedBoard>>,
  authoritativeBoards: Readonly<Record<string, SavedBoard>>,
): Readonly<Record<string, SavedBoard>> {
  const merged: Record<string, SavedBoard> = {}
  for (const idea of ideas) {
    const board = selectLifecycleValue(
      `Idea ${idea.id} Board`,
      baseBoards[idea.id],
      heldBoards[idea.id],
      authoritativeBoards[idea.id],
    )
    if (!board) {
      throw new ProfileRendererPersistenceError(`Profile Idea ${idea.id} has no Board`)
    }
    merged[idea.id] = board
  }
  return Object.freeze(merged)
}

function selectLifecycleValue<Value>(
  label: string,
  base: Value | undefined,
  held: Value | undefined,
  authoritative: Value | undefined,
): Value | undefined {
  const heldChanged = !sameOptionalInertJson(held, base)
  const authoritativeChanged = !sameOptionalInertJson(authoritative, base)
  if (heldChanged && authoritativeChanged) {
    if (!sameOptionalInertJson(held, authoritative)) {
      throw new ProfileRendererPersistenceError(
        `Profile ${label} changed concurrently and cannot be reconciled`,
      )
    }
    return held
  }
  if (heldChanged) return held
  if (authoritativeChanged) return authoritative
  return base
}

function sameOptionalInertJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function outcomeIsUncertain(failure: ProfileServiceFailure): boolean {
  return failure.code === 'internal'
}

/**
 * The desktop sentinel is the mode boundary. Once preload identifies the
 * renderer as desktop, an incomplete bridge is terminal and can never select
 * browser persistence as a recovery path.
 */
export function selectProfileRendererPersistence(
  environment: ProfileRendererEnvironment,
  options: ProfileRendererSelectionOptions = {},
): ProfileRendererPersistenceSelection {
  const hasDesktopSentinel = Object.prototype.hasOwnProperty.call(environment, 'eidoDesktop')
  const hasProfileBridge = Object.prototype.hasOwnProperty.call(environment, 'eidoProfile')
  if (!hasDesktopSentinel && !hasProfileBridge) {
    if (options.mode === 'browser-development' || isLocalBrowserDevelopment(environment.location)) {
      return Object.freeze({ kind: 'browser-development' })
    }
    throw new Error('Packaged Profile bridge is unavailable')
  }
  const bridge = environment.eidoProfile
  if (environment.eidoDesktop !== true || !isInstalledProfileBridge(bridge)) {
    throw new Error('Packaged Profile bridge is unavailable')
  }
  return Object.freeze({
    kind: 'packaged-profile',
    persistence: createProfileRendererPersistence(bridge),
  })
}

function isLocalBrowserDevelopment(location: unknown): boolean {
  if (!location || typeof location !== 'object') return false
  const candidate = location as Record<string, unknown>
  if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') return false
  return candidate.hostname === 'localhost'
    || candidate.hostname === '127.0.0.1'
    || candidate.hostname === '[::1]'
}

export function createProfileRendererPersistence(
  bridge: InstalledProfileBridge,
  options: ProfileRendererPersistenceOptions = {},
): ProfileRendererPersistence {
  type PendingRendererCommit = Readonly<{
    generation: number
    projection: RendererProfileProjection
    boards: Readonly<Record<string, SavedBoard>>
    changesUserModTemplates: boolean
  }>

  const now = options.now ?? (() => new Date().toISOString())
  const createIdeaId = options.createIdeaId ?? (() => newId('idea'))
  const createOperationIdentity = options.createOperationIdentity ?? (() => Object.freeze({
    operationId: newId('profile-operation'),
    idempotencyKey: newId('profile-idempotency'),
  }))
  let projection: RendererProfileProjection | undefined
  let boardsCache: Readonly<Record<string, SavedBoard>> | undefined
  let templateSources: Readonly<Record<string, Readonly<{
    mod: ProfileModDocument
    revision: ProfileModTemplateRevision
  }>>> | undefined
  let nativeModOrigins: Readonly<Record<string, GuiNewModOrigin>> | undefined
  let stateSink: ProfileRendererStateSink | undefined
  let stateOperationStarted = false
  let revision: number | undefined
  let profileId: string | undefined
  let hydrationRevision: number | undefined
  let latestGeneration = 0
  let nextGeneration = 0
  let latestNativeGeneration = 0
  let latestReceipt: Readonly<{
    localGeneration: number
    nativeGeneration: number
    revision: number
  }> | undefined
  let latestNativeReceipt: Readonly<{ generation: number; revision: number }> | undefined
  const originLatestGeneration = new Map<string, number>()
  const originIntroducedGeneration = new Map<string, number>()
  let activeCommit: Readonly<{
    generation: number
    promise: Promise<void>
  }> | undefined
  let queuedCommit: Readonly<{
    generation: number
    projection: RendererProfileProjection
  }> | undefined
  let stateVersion = 0
  const stateWaiters = new Set<() => void>()
  let lifecycleExclusive = false
  let liveAuthoritativeMutation = false
  let liveAuthoritativeProgressCapture = false
  let lifecycleEpoch = 0
  let lifecycleAuthoritativeInstalled = false
  let lifecycleMutationCommitted = false
  let lifecycleHeldCommit: PendingRendererCommit | undefined
  let lifecycleMergeBase: Readonly<{
    projection: RendererProfileProjection
    boards: Readonly<Record<string, SavedBoard>>
  }> | undefined
  let lifecycleMergeAuthority: Readonly<{
    projection: RendererProfileProjection
    boards: Readonly<Record<string, SavedBoard>>
  }> | undefined
  let hydrationAckPending = false
  let recoveryRequired = false
  let recoveryOperationActive = false
  let templateSourcesStale = false
  let templateRefreshRequired = false
  const lifecycleWaiters = new Set<() => void>()
  const exportRequests = new Map<string, ProfileBridgePortableExportRequest>()
  const importRequests = new Map<string, ProfileBridgeImportIdeaClosureRequest>()
  let pendingDuplicate: Readonly<{
    sourceIdeaId: string
    name?: string
    request: ProfileDuplicateIdeaRequest
  }> | undefined
  let intentActorId: string | undefined
  let terminalError: ProfileRendererPersistenceError | undefined

  const emit = (status: ProfileRendererSaveStatus) => {
    try {
      stateSink?.applySaveStatus(status)
    } catch {
      // UI status is observational and cannot alter durability state.
    }
  }

  const requireStateSink = (): ProfileRendererStateSink => {
    stateOperationStarted = true
    if (!stateSink) {
      throw new ProfileRendererPersistenceError('Profile renderer state sink is not connected')
    }
    return stateSink
  }

  function enterTerminal(error: unknown, message: string): ProfileRendererPersistenceError {
    const firstTransition = terminalError === undefined
    terminalError ??= error instanceof ProfileRendererPersistenceError
      ? error
      : new ProfileRendererPersistenceError(message)
    emit('failed')
    if (firstTransition) {
      try {
        stateSink?.applyTerminalFailure(Object.freeze({
          kind: 'terminal',
          error: terminalError,
        }))
      } catch {
        // The adapter remains terminal even if the renderer cannot project it.
      }
    }
    return terminalError
  }

  const invokeBridge = async <Result>(
    invoke: () => Promise<Result>,
    terminalMessage: string,
  ): Promise<Result> => {
    try {
      return await invoke()
    } catch {
      throw enterTerminal(undefined, terminalMessage)
    }
  }

  const requireHydrated = () => {
    requireStateSink()
    if (terminalError) throw terminalError
    if (recoveryRequired) {
      throw new ProfileRendererPersistenceError('Profile recovery is required')
    }
    if (!projection || !boardsCache || !templateSources || !nativeModOrigins || revision === undefined) {
      throw new ProfileRendererPersistenceError('Profile renderer persistence is not hydrated')
    }
  }

  const retireOrigins = (
    generation: number,
    submittedProjection: RendererProfileProjection,
  ) => {
    if (!projection) return
    const nextOrigins = { ...projection.newModOrigins }
    let changed = false
    for (const originId of Object.keys(submittedProjection.newModOrigins)) {
      if (originLatestGeneration.get(originId) !== generation) continue
      delete nextOrigins[originId]
      originLatestGeneration.delete(originId)
      changed = true
    }
    if (changed) {
      projection = captureProfileGuiInertJson({
        ...projection,
        newModOrigins: nextOrigins,
      }, '$rendererProfileProjection')
    }
  }

  const settleCommit = async (
    generation: number,
    submittedProjection: RendererProfileProjection,
  ) => {
    try {
      const submitted = await bridge.commitGuiProjection(submittedProjection)
      if (!submitted.ok) {
        throw new ProfileRendererPersistenceError('Profile projection commit failed', submitted)
      }
      const receipt = submitted.value
      if (!positiveSafeInteger(receipt.generation)
        || !nonNegativeSafeInteger(receipt.revision)
        || receipt.durable !== true
        || receipt.dirty !== false
        || hydrationRevision === undefined
        || receipt.revision <= hydrationRevision) {
        throw new ProfileRendererPersistenceError('Profile projection commit was not exact')
      }
      if (latestNativeReceipt
        && receipt.generation === latestNativeReceipt.generation
        && receipt.revision !== latestNativeReceipt.revision) {
        throw new ProfileRendererPersistenceError('Profile native generation changed revision')
      }
      if (latestNativeReceipt && receipt.generation < latestNativeReceipt.generation) {
        throw new ProfileRendererPersistenceError('Profile native generation rewound')
      }
      latestNativeReceipt = Object.freeze({ generation: receipt.generation, revision: receipt.revision })
      latestReceipt = Object.freeze({
        localGeneration: generation,
        nativeGeneration: receipt.generation,
        revision: receipt.revision,
      })
      if (receipt.generation > latestNativeGeneration) {
        latestNativeGeneration = receipt.generation
        revision = receipt.revision
      } else if (receipt.generation === latestNativeGeneration) {
        revision = Math.max(revision ?? receipt.revision, receipt.revision)
      }
      nativeModOrigins = captureProfileGuiInertJson({
        ...nativeModOrigins,
        ...submittedProjection.newModOrigins,
      }, '$profileNativeModOrigins')
      retireOrigins(generation, submittedProjection)
      if (generation === latestGeneration) emit('saved')
    } catch (error) {
      enterTerminal(error, 'Profile projection outcome is uncertain')
    }
  }

  function stripConsumedOrigins(
    candidate: RendererProfileProjection,
  ): RendererProfileProjection {
    const stillPending = new Set(Object.keys(projection?.newModOrigins ?? {}))
    return captureProfileGuiInertJson({
      ...candidate,
      newModOrigins: Object.fromEntries(Object.entries(candidate.newModOrigins)
        .filter(([originId]) => (
          stillPending.has(originId) || originIntroducedGeneration.has(originId)
        ))),
    }, '$rendererProfileProjection')
  }

  function signalState(): void {
    stateVersion += 1
    const waiters = [...stateWaiters]
    stateWaiters.clear()
    waiters.forEach((resolve) => resolve())
  }

  function submitImmediately(
    generation: number,
    submittedProjection: RendererProfileProjection,
  ): void {
    const originIds = Object.keys(submittedProjection.newModOrigins)
    for (const originId of originIds) {
      originLatestGeneration.set(originId, generation)
      originIntroducedGeneration.delete(originId)
    }
    const task = settleCommit(generation, submittedProjection)
      .finally(() => {
        activeCommit = undefined
        if (!terminalError && queuedCommit) {
          const next = queuedCommit
          queuedCommit = undefined
          submitImmediately(next.generation, stripConsumedOrigins(next.projection))
        } else if (terminalError) {
          queuedCommit = undefined
        }
        signalState()
      })
    activeCommit = Object.freeze({ generation, promise: task })
    signalState()
  }

  function enqueueCommit(generation: number, submittedProjection: RendererProfileProjection): void {
    if (!activeCommit) {
      submitImmediately(generation, submittedProjection)
      return
    }
    queuedCommit = Object.freeze({ generation, projection: submittedProjection })
    signalState()
  }

  async function waitForRendererDrain(): Promise<void> {
    while (activeCommit || queuedCommit) {
      const observedVersion = stateVersion
      if (!activeCommit && !queuedCommit) return
      await new Promise<void>((resolve) => {
        if (stateVersion !== observedVersion) resolve()
        else stateWaiters.add(resolve)
      })
    }
  }

  async function waitForLifecycleRelease(): Promise<void> {
    while (lifecycleExclusive) {
      await new Promise<void>((resolve) => {
        if (!lifecycleExclusive) resolve()
        else lifecycleWaiters.add(resolve)
      })
    }
  }

  function prepareCommit(
    state: ProfileRendererCommitState,
    baseProjection: RendererProfileProjection,
    baseBoards: Readonly<Record<string, SavedBoard>>,
    retainBaseBoardReplacements: boolean,
  ): Readonly<{
      projection: RendererProfileProjection
      boards: Readonly<Record<string, SavedBoard>>
      introducedOriginIds: readonly string[]
      changesUserModTemplates: boolean
      changesRendererMeaning: boolean
    }> {
    const captured = captureProfileGuiInertJson(state, '$profileRendererState')
    if (!captured.ideas.some((idea) => idea.id === captured.activeIdeaId)) {
      throw new ProfileRendererPersistenceError('Renderer state has no active Idea')
    }
    const ideaIds = new Set(captured.ideas.map((idea) => idea.id))
    const boards = Object.fromEntries(Object.entries(baseBoards)
      .filter(([ideaId]) => ideaIds.has(ideaId))) as Record<string, SavedBoard>
    boards[captured.activeIdeaId] = captured.board
    const userModTemplates = captured.userModTemplates
    const boardReplacements = retainBaseBoardReplacements
      ? Object.fromEntries(Object.entries(baseProjection.boardReplacements)
          .filter(([ideaId]) => ideaIds.has(ideaId))) as Record<string, SavedBoard>
      : {}
    boardReplacements[captured.activeIdeaId] = captured.board
    const boardModCardIds = new Set(Object.values(boards)
      .flatMap((board) => board.cards.flatMap((card) => card.modV2 ? [card.id] : [])))
    const mergedOrigins = Object.fromEntries(Object.entries({
      ...baseProjection.newModOrigins,
      ...captured.newModOrigins,
    }).filter(([cardId]) => boardModCardIds.has(cardId)))
    const currentActiveBoard = baseBoards[captured.activeIdeaId]
    const comparableBoards = currentActiveBoard
      ? { ...boards, [captured.activeIdeaId]: {
          ...captured.board,
          updatedAt: currentActiveBoard.updatedAt,
        } }
      : boards
    const changesUserModTemplates = JSON.stringify(userModTemplates)
      !== JSON.stringify(baseProjection.userModTemplates)
    return Object.freeze({
      projection: captureProfileGuiInertJson({
        projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
        activeIdeaId: captured.activeIdeaId,
        ideas: captured.ideas,
        boardReplacements,
        userModTemplates,
        newModOrigins: mergedOrigins,
      } satisfies RendererProfileProjection, '$rendererProfileProjection'),
      boards: captureProfileGuiInertJson(boards, '$profileBoardsCache'),
      introducedOriginIds: Object.freeze(Object.keys(captured.newModOrigins)
        .filter((cardId) => boardModCardIds.has(cardId))),
      changesUserModTemplates,
      changesRendererMeaning: captured.activeIdeaId !== baseProjection.activeIdeaId
        || JSON.stringify(captured.ideas) !== JSON.stringify(baseProjection.ideas)
        || JSON.stringify(comparableBoards) !== JSON.stringify(baseBoards)
        || changesUserModTemplates
        || JSON.stringify(mergedOrigins) !== JSON.stringify(baseProjection.newModOrigins),
    })
  }

  const acceptInstalledSnapshot = (
    installed: ReturnType<typeof installSnapshot>,
  ): ProfileRendererHydration => {
    if (activeCommit || queuedCommit) {
      throw new ProfileRendererPersistenceError('Profile snapshot cannot replace pending renderer work')
    }
    if (profileId !== undefined && profileId !== installed.profileId) {
      throw new ProfileRendererPersistenceError('Profile snapshot identity changed')
    }
    const heldCommit = lifecycleExclusive ? lifecycleHeldCommit : undefined
    const heldIntroductions = lifecycleExclusive
      ? [...originIntroducedGeneration.entries()]
      : []
    profileId = installed.profileId
    projection = installed.projection
    boardsCache = installed.boards
    templateSources = installed.templateSources
    nativeModOrigins = installed.modOrigins
    revision = installed.revision
    hydrationRevision = installed.revision
    latestGeneration = 0
    nextGeneration = heldCommit?.generation ?? 0
    latestNativeGeneration = 0
    latestReceipt = undefined
    latestNativeReceipt = undefined
    originLatestGeneration.clear()
    originIntroducedGeneration.clear()
    for (const [originId, generation] of heldIntroductions) {
      originIntroducedGeneration.set(originId, generation)
    }
    lifecycleHeldCommit = heldCommit
    templateSourcesStale = Boolean(heldCommit?.changesUserModTemplates)
    templateRefreshRequired = false
    if (lifecycleExclusive) {
      lifecycleMergeAuthority = Object.freeze({
        projection: installed.projection,
        boards: installed.boards,
      })
    }
    return installed.hydration
  }

  const acceptSnapshot = (
    snapshot: ProfileSnapshot,
    candidateIntentActorId: string,
  ): ProfileRendererHydration => acceptInstalledSnapshot(
    installSnapshot(snapshot, candidateIntentActorId),
  )

  const reconcileHeldCommit = (
    held: PendingRendererCommit,
  ): PendingRendererCommit => {
    requireHydrated()
    const base = lifecycleMergeBase
    const authoritative = lifecycleMergeAuthority
    if (!base || !authoritative) {
      throw new ProfileRendererPersistenceError('Profile lifecycle merge base is unavailable')
    }
    const ideas = mergeLifecycleIdeaSummaries(
      base.projection.ideas,
      held.projection.ideas,
      authoritative.projection.ideas,
    )
    const activeIdeaId = selectLifecycleValue(
      'active Idea',
      base.projection.activeIdeaId,
      held.projection.activeIdeaId,
      authoritative.projection.activeIdeaId,
    )
    if (!activeIdeaId || !ideas.some((idea) => idea.id === activeIdeaId)) {
      throw new ProfileRendererPersistenceError('Reconciled Profile has no active Idea Board')
    }
    const mergedBoards = mergeLifecycleBoards(
      ideas,
      base.boards,
      held.boards,
      authoritative.boards,
    )
    const activeBoard = mergedBoards[activeIdeaId]
    if (!activeBoard) {
      throw new ProfileRendererPersistenceError('Reconciled Profile has no active Idea Board')
    }
    const userModTemplates = mergeLifecycleUserModTemplates(
      base.projection.userModTemplates,
      held.projection.userModTemplates,
      authoritative.projection.userModTemplates,
    )
    const boardReplacements = Object.fromEntries(Object.entries(mergedBoards)
      .filter(([ideaId, board]) => !sameOptionalInertJson(board, authoritative.boards[ideaId])))
    const replacementModCardIds = new Set(Object.values(boardReplacements)
      .flatMap((board) => board.cards.flatMap((card) => card.modV2 ? [card.id] : [])))
    const newModOrigins = Object.fromEntries(Object.entries(held.projection.newModOrigins)
      .filter(([cardId]) => replacementModCardIds.has(cardId)))
    return Object.freeze({
      generation: held.generation,
      changesUserModTemplates: JSON.stringify(userModTemplates)
        !== JSON.stringify(authoritative.projection.userModTemplates),
      projection: captureProfileGuiInertJson({
        projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
        activeIdeaId,
        ideas,
        boardReplacements,
        userModTemplates,
        newModOrigins,
      } satisfies RendererProfileProjection, '$rendererProfileRebasedProjection'),
      boards: captureProfileGuiInertJson(mergedBoards, '$profileRebasedBoardsCache'),
    })
  }

  const hydrationFromState = (
    candidateProjection: RendererProfileProjection,
    candidateBoards: Readonly<Record<string, SavedBoard>>,
    candidateNativeModOrigins: Readonly<Record<string, GuiNewModOrigin>> = nativeModOrigins!,
  ): ProfileRendererHydration => {
    requireHydrated()
    const userModTemplates = candidateProjection.userModTemplates
    if (!validGuiUserModTemplates(userModTemplates)) {
      throw new ProfileRendererPersistenceError('Current Profile user Mod library is invalid')
    }
    const idea = candidateProjection.ideas.find((candidate) => (
      candidate.id === candidateProjection.activeIdeaId
    ))
    const board = candidateBoards[candidateProjection.activeIdeaId]
    if (!idea || !board) {
      throw new ProfileRendererPersistenceError('Current Profile has no active Idea Board')
    }
    const candidateModCardIds = new Set<string>()
    for (const candidateBoard of Object.values(candidateBoards)) {
      for (const card of candidateBoard.cards) {
        if (!card.modV2) continue
        if (candidateModCardIds.has(card.id)) {
          throw new ProfileRendererPersistenceError(
            `Current Profile Mod Card ${card.id} has ambiguous Board ownership`,
          )
        }
        candidateModCardIds.add(card.id)
      }
    }
    const availableOrigins = {
      ...candidateNativeModOrigins,
      ...candidateProjection.newModOrigins,
    }
    const modOrigins = Object.fromEntries([...candidateModCardIds].map((cardId) => {
      const origin = availableOrigins[cardId]
      if (!origin) {
        throw new ProfileRendererPersistenceError(
          `Current Profile Mod Card ${cardId} has no exact native origin`,
        )
      }
      return [cardId, origin]
    }))
    return captureProfileGuiInertJson({
      intentActorId: intentActorId!,
      idea,
      board,
      ideas: candidateProjection.ideas,
      userModTemplates,
      modOrigins,
    }, '$profileHydration')
  }

  const currentUserModTemplates = (): readonly GuiUserModTemplate[] => {
    requireHydrated()
    return hydrationFromState(projection!, boardsCache!).userModTemplates
  }

  const currentHydration = (): ProfileRendererHydration => {
    requireHydrated()
    return hydrationFromState(projection!, boardsCache!)
  }

  const acceptAndAcknowledgeHydration = async (
    hydration: ProfileBridgeHydration,
    preserveRendererCheckpoint = false,
  ): Promise<ProfileRendererHydration> => {
    const { intentActorId: candidateIntentActorId, snapshot, acknowledgement } = hydration
    if (typeof acknowledgement.epoch !== 'string'
      || acknowledgement.epoch.length === 0
      || !nonNegativeSafeInteger(acknowledgement.revision)
      || acknowledgement.revision !== snapshot.revision) {
      throw enterTerminal(undefined, 'Profile hydration acknowledgement was not exact')
    }
    if (!isProfileIntentActorId(candidateIntentActorId)) {
      throw enterTerminal(undefined, 'Profile hydration Intent actor identity was invalid')
    }
    if (intentActorId !== undefined && intentActorId !== candidateIntentActorId) {
      throw enterTerminal(undefined, 'Profile hydration Intent actor identity changed')
    }
    intentActorId ??= candidateIntentActorId
    hydrationAckPending = true
    const rendererCheckpoint = preserveRendererCheckpoint
      ? Object.freeze({
          latestGeneration,
          nextGeneration,
          latestReceipt,
        })
      : undefined
    let installed: ProfileRendererHydration
    try {
      installed = acceptSnapshot(snapshot, candidateIntentActorId)
    } catch {
      throw enterTerminal(undefined, 'Profile hydration snapshot was invalid')
    }
    if (rendererCheckpoint) {
      latestGeneration = rendererCheckpoint.latestGeneration
      nextGeneration = Math.max(nextGeneration, rendererCheckpoint.nextGeneration)
      latestNativeGeneration = 0
      latestNativeReceipt = undefined
      latestReceipt = rendererCheckpoint.latestReceipt
        ? Object.freeze({
            localGeneration: rendererCheckpoint.latestReceipt.localGeneration,
            nativeGeneration: 0,
            revision: snapshot.revision,
          })
        : undefined
    }
    let rendererHydration = installed
    try {
      let rollingProjection = projection!
      let rollingBoards = boardsCache!
      if (lifecycleExclusive && lifecycleHeldCommit) {
        const rebased = reconcileHeldCommit(lifecycleHeldCommit)
        lifecycleHeldCommit = rebased
        rollingProjection = rebased.projection
        rollingBoards = rebased.boards
      }
      if (lifecycleExclusive) {
        projection = rollingProjection
        boardsCache = rollingBoards
        lifecycleMergeBase = Object.freeze({
          projection: rollingProjection,
          boards: rollingBoards,
        })
        lifecycleMergeAuthority = Object.freeze({
          projection: rollingProjection,
          boards: rollingBoards,
        })
        rendererHydration = hydrationFromState(rollingProjection, rollingBoards)
      }
      const applicationResult = requireStateSink().applyHydration(rendererHydration)
      if (applicationResult !== undefined) {
        throw new Error('Renderer hydration application must be synchronous')
      }
    } catch {
      throw enterTerminal(undefined, 'Profile renderer hydration application failed')
    }
    try {
      const acknowledged = await bridge.ackHydration(
        acknowledgement.epoch,
        acknowledgement.revision,
      )
      if (!acknowledged.ok
        || acknowledged.value.acknowledged !== true
        || acknowledged.value.epoch !== acknowledgement.epoch
        || acknowledged.value.revision !== acknowledgement.revision) {
        throw enterTerminal(
          acknowledged.ok ? undefined : acknowledged,
          'Profile hydration acknowledgement failed',
        )
      }
      hydrationAckPending = false
      recoveryRequired = false
      try {
        const admissionResult = requireStateSink().admitHydration()
        if (admissionResult !== undefined) {
          throw new Error('Renderer hydration admission must be synchronous')
        }
      } catch {
        throw enterTerminal(undefined, 'Profile renderer hydration admission failed')
      }
      return rendererHydration
    } catch (error) {
      if (error === terminalError) throw error
      throw enterTerminal(error, 'Profile hydration acknowledgement failed')
    }
  }

  const refreshAfterLifecycle = async (preserveRendererCheckpoint = false): Promise<void> => {
    const refreshed = await invokeBridge(
      () => bridge.hydrate(),
      'Profile lifecycle hydration route failed',
    )
    if (!refreshed.ok) {
      throw enterTerminal(
        new ProfileRendererPersistenceError('Profile lifecycle refresh failed', refreshed),
        'Profile lifecycle refresh failed',
      )
    }
    await acceptAndAcknowledgeHydration(refreshed.value, preserveRendererCheckpoint)
    lifecycleAuthoritativeInstalled = true
  }

  const failOperation = (message: string, failure?: ProfileServiceFailure): never => {
    emit('failed')
    throw new ProfileRendererPersistenceError(message, failure)
  }

  const rememberLifecycleRequest = <Request>(cache: Map<string, Request>, key: string, request: Request): Request => {
    cache.set(key, request)
    if (cache.size > 64) cache.delete(cache.keys().next().value!)
    return request
  }

  async function flushRenderer(waitForLifecycle: boolean): Promise<ProfileRendererFlushReceipt> {
    requireHydrated()
    while (true) {
      if (waitForLifecycle) await waitForLifecycleRelease()
      await waitForRendererDrain()
      if (waitForLifecycle && lifecycleExclusive) continue
      if (terminalError) throw terminalError
      const targetGeneration = latestGeneration
      const targetReceipt = targetGeneration === 0
        ? Object.freeze({ nativeGeneration: latestNativeGeneration, revision: revision! })
        : latestReceipt?.localGeneration === targetGeneration ? latestReceipt : undefined
      if (!targetReceipt || revision === undefined) {
        throw new ProfileRendererPersistenceError('Latest renderer generation is not confirmed')
      }
      const result = await invokeBridge(
        () => bridge.flush(),
        'Profile flush route failed',
      )
      if (!result.ok) throw new ProfileRendererPersistenceError('Profile flush failed', result)
      if (waitForLifecycle && lifecycleExclusive) continue
      if (activeCommit || queuedCommit || latestGeneration !== targetGeneration) continue
      if (result.value.generation < targetReceipt.nativeGeneration
        || result.value.revision < targetReceipt.revision) {
        throw new ProfileRendererPersistenceError('Profile flush did not confirm the latest generation')
      }
      latestNativeGeneration = Math.max(latestNativeGeneration, result.value.generation)
      revision = Math.max(revision, result.value.revision)
      return Object.freeze({
        generation: targetGeneration,
        nativeGeneration: result.value.generation,
        revision: result.value.revision,
      })
    }
  }

  async function drainLifecycleHeldCommits(): Promise<void> {
    while (lifecycleHeldCommit) {
      if (terminalError) throw terminalError
      const held = lifecycleHeldCommit
      lifecycleHeldCommit = undefined
      let candidate: PendingRendererCommit
      let rawBase: PendingRendererCommit
      try {
        const sanitized = Object.freeze({
          ...held,
          projection: stripConsumedOrigins(held.projection),
        })
        rawBase = sanitized
        candidate = sanitized
      } catch (error) {
        throw enterTerminal(error, 'Held renderer state could not be reconciled')
      }
      projection = candidate.projection
      boardsCache = candidate.boards
      latestGeneration = candidate.generation
      nextGeneration = Math.max(nextGeneration, candidate.generation)
      if (candidate.changesUserModTemplates) {
        templateSourcesStale = true
        templateRefreshRequired = true
      }
      enqueueCommit(candidate.generation, candidate.projection)
      await flushRenderer(false)
      lifecycleMergeBase = Object.freeze({
        projection: rawBase.projection,
        boards: rawBase.boards,
      })
      if (lifecycleAuthoritativeInstalled) {
        lifecycleMergeAuthority = Object.freeze({ projection: projection!, boards: boardsCache! })
      }
      if (!templateRefreshRequired && !heldCommitChangesUserModTemplates()) {
        templateSourcesStale = false
      }
    }
  }

  function heldCommitChangesUserModTemplates(): boolean {
    return lifecycleHeldCommit?.changesUserModTemplates ?? false
  }

  async function stabilizeLifecycleGate(): Promise<void> {
    while (templateRefreshRequired || lifecycleHeldCommit) {
      if (terminalError) throw terminalError
      if (templateRefreshRequired) {
        await refreshAfterLifecycle(true)
      } else {
        await drainLifecycleHeldCommits()
      }
    }
  }

  function releaseLifecycleGate(expectedGeneration: number): void {
    const releaseError = !terminalError
      && (lifecycleHeldCommit !== undefined
        || templateSourcesStale
        || templateRefreshRequired
        || nextGeneration !== expectedGeneration)
      ? enterTerminal(undefined, 'Profile lifecycle gate changed during release')
      : undefined
    lifecycleExclusive = false
    liveAuthoritativeMutation = false
    liveAuthoritativeProgressCapture = false
    lifecycleAuthoritativeInstalled = false
    lifecycleMutationCommitted = false
    lifecycleHeldCommit = undefined
    lifecycleMergeBase = undefined
    lifecycleMergeAuthority = undefined
    const waiters = [...lifecycleWaiters]
    lifecycleWaiters.clear()
    waiters.forEach((resolve) => resolve())
    if (releaseError) throw releaseError
  }

  async function beginLiveAuthoritativeMutation(
    state: ProfileRendererCommitState,
  ): Promise<ProfileRendererFlushReceipt> {
    requireHydrated()
    if (lifecycleExclusive) {
      throw new ProfileRendererPersistenceError('Another Profile authority operation is active')
    }
    lifecycleExclusive = true
    liveAuthoritativeMutation = true
    liveAuthoritativeProgressCapture = true
    lifecycleEpoch += 1
    lifecycleAuthoritativeInstalled = false
    lifecycleMutationCommitted = false
    lifecycleMergeBase = Object.freeze({ projection: projection!, boards: boardsCache! })
    try {
      const prepared = prepareCommit(state, projection!, boardsCache!, false)
      if (prepared.changesRendererMeaning) publicPersistence.schedule(state)
      return await flushRenderer(false)
    } catch (error) {
      try {
        releaseLifecycleGate(nextGeneration)
      } catch {
        // Preserve the first barrier failure; the adapter is already terminal
        // if held renderer state could not be released exactly.
      }
      throw error
    }
  }

  async function finishLiveAuthoritativeMutation(): Promise<ProfileRendererFlushReceipt> {
    requireHydrated()
    if (!lifecycleExclusive || !liveAuthoritativeMutation) {
      throw new ProfileRendererPersistenceError('No live Profile authority operation is active')
    }
    // Authoritative application is synchronous and has already replaced the
    // renderer by the time finish starts. Later transient chunks build on that
    // new base, so only progress observed before this point belongs in the
    // held rebase. Durable commits still schedule normally through the gate.
    liveAuthoritativeProgressCapture = false
    let expectedReleaseGeneration = nextGeneration
    try {
      await stabilizeLifecycleGate()
      const receipt = await flushRenderer(false)
      expectedReleaseGeneration = nextGeneration
      return receipt
    } finally {
      releaseLifecycleGate(expectedReleaseGeneration)
    }
  }

  async function sealLiveAuthoritativeMutation(
    state: ProfileRendererCommitState,
  ): Promise<ProfileRendererFlushReceipt> {
    requireHydrated()
    if (!lifecycleExclusive || !liveAuthoritativeMutation) {
      throw new ProfileRendererPersistenceError('No live Profile authority operation is active')
    }
    // Capture the exact state visible at the terminal boundary, including
    // edits made while Squirrel prepared. Flush it without releasing the gate:
    // no renderer commit may enter the gap between this receipt and utility
    // close/join.
    liveAuthoritativeProgressCapture = false
    publicPersistence.schedule(state)
    await stabilizeLifecycleGate()
    return flushRenderer(false)
  }

  async function refreshTemplateSourcesAfterFlush(): Promise<ProfileRendererFlushReceipt> {
    while (true) {
      if (!templateRefreshRequired) {
        const receipt = await flushRenderer(true)
        if (!templateRefreshRequired) return receipt
        continue
      }
      if (lifecycleExclusive) {
        await waitForLifecycleRelease()
        continue
      }
      lifecycleExclusive = true
      lifecycleEpoch += 1
      lifecycleAuthoritativeInstalled = false
      lifecycleMutationCommitted = false
      lifecycleMergeBase = Object.freeze({ projection: projection!, boards: boardsCache! })
      let expectedReleaseGeneration = nextGeneration
      try {
        while (templateRefreshRequired || lifecycleHeldCommit) {
          await stabilizeLifecycleGate()
        }
        expectedReleaseGeneration = nextGeneration
      } finally {
        releaseLifecycleGate(expectedReleaseGeneration)
      }
    }
  }

  const withLifecycleCheckpoint = async <Value, Result>(
    operation: (revision: number) => Promise<Value>,
    complete: (value: Value) => Result,
  ): Promise<Result> => {
    requireHydrated()
    if (lifecycleExclusive) {
      throw new ProfileRendererPersistenceError('Another Profile lifecycle operation is active')
    }
    lifecycleExclusive = true
    lifecycleEpoch += 1
    lifecycleAuthoritativeInstalled = false
    lifecycleMutationCommitted = false
    lifecycleMergeBase = Object.freeze({ projection: projection!, boards: boardsCache! })
    let expectedReleaseGeneration = nextGeneration
    try {
      let value: Value | undefined
      let operationError: unknown
      try {
        let checkpoint = await flushRenderer(false)
        while (templateRefreshRequired) {
          await refreshAfterLifecycle(true)
          checkpoint = await flushRenderer(false)
        }
        value = await operation(checkpoint.revision)
      } catch (error) {
        operationError = error
      }
      try {
        if (lifecycleMutationCommitted && !lifecycleAuthoritativeInstalled) {
          lifecycleHeldCommit = undefined
          if (!terminalError) {
            operationError = enterTerminal(
              operationError,
              'Profile lifecycle mutation could not be authoritatively rehydrated',
            )
          }
        } else if (!terminalError) {
          while (templateRefreshRequired || lifecycleHeldCommit) {
            await stabilizeLifecycleGate()
          }
        }
      } catch (error) {
        operationError = error
      }
      expectedReleaseGeneration = nextGeneration
      if (operationError) throw operationError
      return complete(value!)
    } finally {
      releaseLifecycleGate(expectedReleaseGeneration)
    }
  }

  let publicPersistence: ProfileRendererPersistence

  publicPersistence = Object.freeze({
    connectStateSink(sink) {
      if (stateSink || stateOperationStarted) {
        throw new ProfileRendererPersistenceError('Profile renderer state sink is already fixed')
      }
      if (!sink || typeof sink !== 'object'
        || typeof sink.applyHydration !== 'function'
        || typeof sink.applyAuthoritativeUpdate !== 'function'
        || typeof sink.admitHydration !== 'function'
        || typeof sink.applySaveStatus !== 'function'
        || typeof sink.applyTerminalFailure !== 'function') {
        throw new ProfileRendererPersistenceError('Profile renderer state sink is invalid')
      }
      stateSink = Object.freeze(sink)
    },
    async hydrate() {
      requireStateSink()
      if (terminalError) throw terminalError
      if (recoveryRequired || recoveryOperationActive) {
        throw new ProfileRendererPersistenceError('Profile recovery is required')
      }
      if (lifecycleExclusive) {
        throw new ProfileRendererPersistenceError('Profile hydration cannot overlap lifecycle work')
      }
      if (activeCommit || queuedCommit) {
        throw new ProfileRendererPersistenceError('Profile hydration cannot replace pending renderer work')
      }
      const startedLifecycleEpoch = lifecycleEpoch
      const result = await invokeBridge(
        () => bridge.hydrate(),
        'Profile hydration route failed',
      )
      if (!result.ok) {
        if (result.code === 'corrupt-or-recovery-required') {
          recoveryRequired = true
          throw new ProfileRendererPersistenceError('Profile hydration failed', result)
        }
        throw enterTerminal(
          new ProfileRendererPersistenceError('Profile hydration failed', result),
          'Profile hydration failed',
        )
      }
      if (lifecycleExclusive || lifecycleEpoch !== startedLifecycleEpoch) {
        throw new ProfileRendererPersistenceError('Profile hydration was superseded by lifecycle work')
      }
      return acceptAndAcknowledgeHydration(result.value)
    },
    applyAuthoritativeSnapshot(snapshot) {
      requireHydrated()
      if (terminalError) throw terminalError
      const currentRevision = revision!
      if (recoveryRequired
        || recoveryOperationActive
        || (lifecycleExclusive && !liveAuthoritativeMutation)
        || hydrationAckPending
        || activeCommit
        || queuedCommit) {
        return Object.freeze({ status: 'blocked' as const, revision: currentRevision })
      }

      let candidate: ReturnType<typeof installSnapshot>
      try {
        candidate = installSnapshot(snapshot, intentActorId!)
        if (candidate.profileId !== profileId) {
          throw new ProfileRendererPersistenceError('Profile snapshot identity changed')
        }
      } catch (error) {
        throw enterTerminal(error, 'Authoritative Profile snapshot was invalid')
      }
      if (candidate.revision <= currentRevision) {
        return Object.freeze({ status: 'stale' as const, revision: currentRevision })
      }

      const held = liveAuthoritativeMutation ? lifecycleHeldCommit : undefined
      const previousHydration = held
        ? hydrationFromState(held.projection, held.boards)
        : currentHydration()
      let authoritativePreviousHydration = previousHydration
      let mergedLiveState: ReturnType<typeof mergeLiveProfileAuthority> | undefined
      let nextHydration = candidate.hydration
      if (liveAuthoritativeMutation) {
        const base = lifecycleMergeBase
        if (!base) {
          throw enterTerminal(undefined, 'Live Profile authority merge base was unavailable')
        }
        try {
          const previousAuthority = lifecycleMergeAuthority ?? base
          authoritativePreviousHydration = hydrationFromState(
            previousAuthority.projection,
            previousAuthority.boards,
          )
          mergedLiveState = mergeLiveProfileAuthority(
            base,
            held ?? base,
            Object.freeze({ projection: candidate.projection, boards: candidate.boards }),
          )
          nextHydration = hydrationFromState(
            mergedLiveState.projection,
            mergedLiveState.boards,
            candidate.modOrigins,
          )
        } catch (error) {
          throw enterTerminal(error, 'Live Profile authority state could not be reconciled')
        }
      }
      const update = Object.freeze({
        previousRevision: currentRevision,
        revision: candidate.revision,
        previous: previousHydration,
        next: nextHydration,
        authoritativeTransition: Object.freeze({
          previous: authoritativePreviousHydration,
          next: candidate.hydration,
        }),
      })
      let applied: ProfileRendererAuthoritativeApplyResult
      try {
        applied = requireStateSink().applyAuthoritativeUpdate(update)
      } catch (error) {
        throw enterTerminal(error, 'Authoritative Profile renderer application failed')
      }
      if (applied.status === 'blocked') {
        return Object.freeze({ status: 'blocked' as const, revision: currentRevision })
      }
      if (applied.status !== 'applied' || applied.revision !== candidate.revision) {
        throw enterTerminal(undefined, 'Authoritative Profile renderer application was inexact')
      }
      acceptInstalledSnapshot(candidate)
      if (mergedLiveState) {
        const authoritativeState = Object.freeze({
          projection: candidate.projection,
          boards: candidate.boards,
        })
        const hasHeldDelta = !sameOptionalInertJson(
          mergedLiveState,
          authoritativeState,
        )
        lifecycleHeldCommit = hasHeldDelta
          ? Object.freeze({
              generation: held?.generation ?? nextGeneration,
              projection: mergedLiveState.projection,
              boards: mergedLiveState.boards,
              changesUserModTemplates: JSON.stringify(mergedLiveState.projection.userModTemplates)
                !== JSON.stringify(candidate.projection.userModTemplates),
            })
          : undefined
        projection = mergedLiveState.projection
        boardsCache = mergedLiveState.boards
        lifecycleMergeBase = mergedLiveState
        lifecycleMergeAuthority = authoritativeState
        lifecycleAuthoritativeInstalled = true
      }
      return Object.freeze({ status: 'applied' as const, revision: candidate.revision })
    },
    beginAuthoritativeMutation: beginLiveAuthoritativeMutation,
    captureAuthoritativeMutationProgress(state) {
      if (!lifecycleExclusive
        || !liveAuthoritativeMutation
        || !liveAuthoritativeProgressCapture) {
        return false
      }
      publicPersistence.schedule(state)
      return true
    },
    sealAuthoritativeMutation: sealLiveAuthoritativeMutation,
    finishAuthoritativeMutation: finishLiveAuthoritativeMutation,
    stampModTemplate(templateId) {
      requireHydrated()
      if (templateSourcesStale || hydrationAckPending) {
        throw new ProfileRendererPersistenceError('Profile Mod template revisions are refreshing')
      }
      const source = templateSources![templateId]
      if (!source) {
        throw new ProfileRendererPersistenceError('Profile Mod template revision is unavailable')
      }
      const remapped = remapModPartIdentities(
        source.mod,
        ({ role }) => newId(`mod-${role}`),
      )
      return captureStampedProfileModOrigin(
        source.mod,
        remapped.value,
        source.revision,
        newId('mod-instance'),
      )
    },
    schedule(state) {
      requireHydrated()
      if (terminalError) throw terminalError
      if (hydrationAckPending && !lifecycleExclusive) {
        throw new ProfileRendererPersistenceError('Profile hydration acknowledgement is pending')
      }
      const baseProjection = lifecycleHeldCommit?.projection ?? projection!
      const baseBoards = lifecycleHeldCommit?.boards ?? boardsCache!
      const prepared = prepareCommit(state, baseProjection, baseBoards, lifecycleExclusive)
      nextGeneration += 1
      const generation = nextGeneration
      for (const originId of prepared.introducedOriginIds) {
        if (!originLatestGeneration.has(originId) && !originIntroducedGeneration.has(originId)) {
          originIntroducedGeneration.set(originId, generation)
        }
      }
      const candidateOriginIds = new Set(Object.keys(prepared.projection.newModOrigins))
      for (const originId of originIntroducedGeneration.keys()) {
        if (!candidateOriginIds.has(originId)) originIntroducedGeneration.delete(originId)
      }
      emit('saving')
      if (lifecycleExclusive) {
        if (prepared.changesUserModTemplates) templateSourcesStale = true
        lifecycleHeldCommit = Object.freeze({
          generation,
          projection: prepared.projection,
          boards: prepared.boards,
          changesUserModTemplates: Boolean(
            lifecycleHeldCommit?.changesUserModTemplates || prepared.changesUserModTemplates,
          ),
        })
        return generation
      }
      projection = prepared.projection
      boardsCache = prepared.boards
      latestGeneration = generation
      if (prepared.changesUserModTemplates) {
        templateSourcesStale = true
        templateRefreshRequired = true
      }
      enqueueCommit(generation, prepared.projection)
      return generation
    },
    async flush() {
      const receipt = await flushRenderer(true)
      return templateRefreshRequired ? refreshTemplateSourcesAfterFlush() : receipt
    },
    async loadIdea(id) {
      await publicPersistence.flush()
      requireHydrated()
      const board = boardsCache![id]
      const selected = projection!.ideas.find((idea) => idea.id === id)
      if (!board || !selected) return null
      const openedAt = now()
      const ideas = projection!.ideas.map((idea) => idea.id === id
        ? { ...idea, lastOpenedAt: openedAt }
        : idea)
      publicPersistence.schedule({
        activeIdeaId: id,
        ideas,
        board,
        userModTemplates: currentUserModTemplates(),
        newModOrigins: {},
      })
      await publicPersistence.flush()
      return currentHydration()
    },
    async createOrdinaryIdea(name = 'Untitled idea') {
      await publicPersistence.flush()
      requireHydrated()
      const ideaId = createIdeaId()
      const authorization = await invokeBridge(
        () => bridge.createOrdinaryIdea(ideaId),
        'Ordinary Idea authorization route failed',
      )
      if (!authorization.ok) {
        return failOperation('Ordinary Idea authorization failed', authorization)
      }
      if (authorization.value.ideaId !== ideaId
        || authorization.value.authorized !== true
        || !canonicalTimestamp(authorization.value.createdAt)) {
        return failOperation('Ordinary Idea authorization was not exact')
      }
      const createdAt = authorization.value.createdAt
      const idea: IdeaSummary = {
        id: ideaId,
        name: name.trim() || 'Untitled idea',
        createdAt,
        updatedAt: createdAt,
        lastOpenedAt: createdAt,
      }
      const board: SavedBoard = {
        version: 1,
        cards: [],
        connections: [],
        outputs: [],
        runs: [],
        updatedAt: createdAt,
      }
      publicPersistence.schedule({
        activeIdeaId: ideaId,
        ideas: [...projection!.ideas, idea],
        board,
        userModTemplates: currentUserModTemplates(),
        newModOrigins: {},
      })
      await publicPersistence.flush()
      return currentHydration()
    },
    async renameCurrentIdea(name) {
      await publicPersistence.flush()
      const current = currentHydration()
      const renamed = name.trim() || current.idea.name
      const ideas = projection!.ideas.map((idea) => idea.id === current.idea.id
        ? { ...idea, name: renamed, updatedAt: now() }
        : idea)
      publicPersistence.schedule({
        activeIdeaId: current.idea.id,
        ideas,
        board: current.board,
        userModTemplates: current.userModTemplates,
        newModOrigins: {},
      })
      await publicPersistence.flush()
      return currentHydration()
    },
    async deleteIdea(id) {
      await publicPersistence.flush()
      requireHydrated()
      if (!projection!.ideas.some((idea) => idea.id === id)) return currentHydration()
      if (projection!.ideas.length === 1) {
        await publicPersistence.createOrdinaryIdea('Untitled idea')
      }
      const remaining = projection!.ideas.filter((idea) => idea.id !== id)
      const activeIdeaId = projection!.activeIdeaId === id
        ? remaining[0]!.id
        : projection!.activeIdeaId
      const board = boardsCache![activeIdeaId]
      if (!board) return failOperation('Deleted Idea has no safe successor')
      publicPersistence.schedule({
        activeIdeaId,
        ideas: remaining,
        board,
        userModTemplates: currentUserModTemplates(),
        newModOrigins: {},
      })
      await publicPersistence.flush()
      return currentHydration()
    },
    async duplicateCurrentIdea(name) {
      return withLifecycleCheckpoint(
        async (checkpointRevision) => {
          requireHydrated()
          const sourceIdeaId = projection!.activeIdeaId
          const reusable = pendingDuplicate
            && pendingDuplicate.sourceIdeaId === sourceIdeaId
            && pendingDuplicate.name === name
            ? pendingDuplicate.request
            : undefined
          const identity = reusable ? undefined : createOperationIdentity()
          const request = reusable ?? Object.freeze({
            version: PROFILE_PORTABLE_LIFECYCLE_VERSION,
            operationId: identity!.operationId,
            idempotencyKey: identity!.idempotencyKey,
            expectedRevision: checkpointRevision,
            sourceIdeaId,
            ...(name === undefined ? {} : { name }),
          } satisfies ProfileDuplicateIdeaRequest)
          pendingDuplicate = Object.freeze({ sourceIdeaId, ...(name === undefined ? {} : { name }), request })
          const result = await invokeBridge(
            () => bridge.duplicateIdea(request),
            'Idea duplication route failed',
          )
          if (!result.ok) {
            if (!outcomeIsUncertain(result)) pendingDuplicate = undefined
            return failOperation('Idea duplication failed', result)
          }
          pendingDuplicate = undefined
          lifecycleMutationCommitted = true
          await refreshAfterLifecycle()
          return result.value
        },
        (receipt) => Object.freeze({ receipt, hydration: currentHydration() }),
      )
    },
    async exportPortable(request) {
      return withLifecycleCheckpoint(
        async (checkpointRevision) => {
          const existing = exportRequests.get(request.operationId)
          const effective = existing ?? rememberLifecycleRequest(
            exportRequests,
            request.operationId,
            Object.freeze({
              version: PROFILE_PORTABLE_LIFECYCLE_VERSION,
              operationId: request.operationId,
              expectedRevision: checkpointRevision,
            }),
          )
          const result = await invokeBridge(
            () => bridge.exportPortable(effective),
            'Portable Export route failed',
          )
          if (!result.ok) {
            if (!outcomeIsUncertain(result)) exportRequests.delete(request.operationId)
            return failOperation('Portable Export failed', result)
          }
          exportRequests.delete(request.operationId)
          return result.value
        },
        (result) => result,
      )
    },
    async importIdeaClosure(request) {
      return withLifecycleCheckpoint(
        async (checkpointRevision) => {
          const existing = importRequests.get(request.operationId)
          if (existing && (existing.idempotencyKey !== request.idempotencyKey || existing.name !== request.name)) {
            return failOperation('Idea closure import retry changed its exact request')
          }
          const effective = existing ?? rememberLifecycleRequest(
            importRequests,
            request.operationId,
            Object.freeze({
              version: PROFILE_PORTABLE_LIFECYCLE_VERSION,
              operationId: request.operationId,
              idempotencyKey: request.idempotencyKey,
              expectedRevision: checkpointRevision,
              ...(request.name === undefined ? {} : { name: request.name }),
            }),
          )
          const result = await invokeBridge(
            () => bridge.importIdeaClosure(effective),
            'Idea closure import route failed',
          )
          if (!result.ok) {
            if (!outcomeIsUncertain(result)) importRequests.delete(request.operationId)
            return failOperation('Idea closure import failed', result)
          }
          const value: ProfileBridgeImportIdeaClosureResult = result.value
          importRequests.delete(request.operationId)
          if ('cancelled' in value) return Object.freeze({ cancelled: true as const })
          lifecycleMutationCommitted = true
          await refreshAfterLifecycle()
          return value
        },
        (value): ProfileRendererImportIdeaClosureResult => (
          'cancelled' in value
            ? Object.freeze({ cancelled: true as const })
            : Object.freeze({ receipt: value, hydration: currentHydration() })
        ),
      )
    },
    async inspectRecovery() {
      requireStateSink()
      if (terminalError) throw terminalError
      const result = await invokeBridge(
        () => bridge.inspectRecovery(),
        'Profile recovery inspection route failed',
      )
      if (!result.ok) {
        throw new ProfileRendererPersistenceError('Profile recovery inspection failed', result)
      }
      return result.value
    },
    async restoreRecovery(candidateId) {
      requireStateSink()
      if (terminalError) throw terminalError
      if (!recoveryRequired) {
        throw new ProfileRendererPersistenceError('Profile recovery is not required')
      }
      if (recoveryOperationActive || lifecycleExclusive || activeCommit || queuedCommit) {
        throw new ProfileRendererPersistenceError('Another Profile recovery operation is active')
      }
      if (typeof candidateId !== 'string' || candidateId.length === 0 || candidateId.length > 256) {
        throw new ProfileRendererPersistenceError('Profile recovery candidate is invalid')
      }
      recoveryOperationActive = true
      try {
        const restored = await invokeBridge(
          () => bridge.restoreRecovery(candidateId),
          'Profile recovery restore route failed',
        )
        if (!restored.ok) {
          throw new ProfileRendererPersistenceError('Profile recovery restore failed', restored)
        }
        if (restored.value.selectedCandidateId !== candidateId
          || restored.value.revision <= restored.value.previousRevision) {
          throw new ProfileRendererPersistenceError('Profile recovery restore was not exact')
        }
        const refreshed = await invokeBridge(
          () => bridge.hydrate(),
          'Profile recovery hydration route failed',
        )
        if (!refreshed.ok) {
          throw enterTerminal(
            new ProfileRendererPersistenceError('Profile recovery hydration failed', refreshed),
            'Profile recovery hydration failed',
          )
        }
        const hydration = await acceptAndAcknowledgeHydration(refreshed.value)
        return Object.freeze({ receipt: restored.value, hydration })
      } finally {
        recoveryOperationActive = false
      }
    },
    async startFreshProfile() {
      requireStateSink()
      if (terminalError) throw terminalError
      if (!recoveryRequired) {
        throw new ProfileRendererPersistenceError('Profile recovery is not required')
      }
      if (recoveryOperationActive || lifecycleExclusive || activeCommit || queuedCommit) {
        throw new ProfileRendererPersistenceError('Another Profile recovery operation is active')
      }
      recoveryOperationActive = true
      try {
        const fresh = await invokeBridge(
          () => bridge.startFresh(),
          'Profile start-fresh route failed',
        )
        if (!fresh.ok) {
          throw new ProfileRendererPersistenceError('Profile start-fresh failed', fresh)
        }
        if (fresh.value.mode !== 'start-fresh') {
          throw new ProfileRendererPersistenceError('Profile start-fresh receipt was not exact')
        }
        const refreshed = await invokeBridge(
          () => bridge.hydrate(),
          'Profile start-fresh hydration route failed',
        )
        if (!refreshed.ok) {
          throw enterTerminal(
            new ProfileRendererPersistenceError('Profile start-fresh hydration failed', refreshed),
            'Profile start-fresh hydration failed',
          )
        }
        const hydration = await acceptAndAcknowledgeHydration(refreshed.value)
        return Object.freeze({ receipt: fresh.value, hydration })
      } finally {
        recoveryOperationActive = false
      }
    },
  })
  return publicPersistence
}

function installSnapshot(
  value: ProfileSnapshot,
  intentActorId: string,
): Readonly<{
  profileId: string
  hydration: ProfileRendererHydration
  projection: RendererProfileProjection
  revision: number
  boards: Readonly<Record<string, SavedBoard>>
  modOrigins: Readonly<Record<string, GuiNewModOrigin>>
  templateSources: Readonly<Record<string, Readonly<{
    mod: ProfileModDocument
    revision: ProfileModTemplateRevision
  }>>>
}> {
  const snapshot = captureProfileGuiInertJson(value, '$profileSnapshot')
  const idea = snapshot.ideas.find((candidate) => candidate.id === snapshot.activeIdeaId)
  const board = Object.prototype.hasOwnProperty.call(snapshot.boards, snapshot.activeIdeaId)
    ? snapshot.boards[snapshot.activeIdeaId]
    : undefined
  if (!idea || !board) {
    throw new ProfileRendererPersistenceError('Profile snapshot has no active Idea Board')
  }
  const userRecords = snapshot.modTemplates.filter((template) => (
    template.payload.provenance.kind === 'user'
  ))
  const userModTemplates = userRecords.map((template) => ({
    templateId: template.recordId,
    mod: template.payload.mod,
  }))
  if (!validGuiUserModTemplates(userModTemplates)) {
    throw new ProfileRendererPersistenceError('Profile snapshot has an invalid user Mod library')
  }
  const modOrigins = profileModOriginsFromSnapshot(snapshot)
  const hydration = captureProfileGuiInertJson({
    intentActorId,
    idea,
    board,
    ideas: snapshot.ideas,
    userModTemplates,
    modOrigins,
  }, '$profileHydration')
  const rendererProjection = captureProfileGuiInertJson({
    projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
    activeIdeaId: snapshot.activeIdeaId,
    ideas: snapshot.ideas,
    boardReplacements: {},
    userModTemplates,
    newModOrigins: {},
  } satisfies RendererProfileProjection, '$rendererProfileProjection')
  const sources: Record<string, Readonly<{
    mod: ProfileModDocument
    revision: ProfileModTemplateRevision
  }>> = {}
  for (const template of snapshot.modTemplates) {
    if (!validateProfileModDocumentTransport(template.payload.mod).ok
      || Object.prototype.hasOwnProperty.call(sources, template.recordId)) {
      throw new ProfileRendererPersistenceError('Profile snapshot has an ambiguous Mod template revision')
    }
    sources[template.recordId] = Object.freeze({
      mod: template.payload.mod,
      revision: Object.freeze({
        sourceTemplateId: template.recordId,
        sourceTemplateVersion: template.payload.templateVersion,
      }),
    })
  }
  return Object.freeze({
    profileId: snapshot.profileId,
    hydration,
    projection: rendererProjection,
    revision: snapshot.revision,
    boards: captureProfileGuiInertJson(snapshot.boards, '$profileBoardsCache'),
    modOrigins,
    templateSources: Object.freeze(sources),
  })
}

function profileModOriginsFromSnapshot(
  snapshot: ProfileSnapshot,
): Readonly<Record<string, GuiNewModOrigin>> {
  const expected = new Map<string, Readonly<{
    ownerId: string
    parentId: string
    mod: ProfileModDocument
  }>>()
  for (const [ideaId, board] of Object.entries(snapshot.boards)) {
    for (const card of board.cards) {
      if (!card.modV2) continue
      if (expected.has(card.id)) {
        throw new ProfileRendererPersistenceError(
          `Profile snapshot Mod Card ${card.id} has ambiguous Board ownership`,
        )
      }
      expected.set(card.id, Object.freeze({
        ownerId: `board:${ideaId}`,
        parentId: card.id,
        mod: card.modV2,
      }))
    }
  }

  const origins: Record<string, GuiNewModOrigin> = {}
  for (const instance of snapshot.modInstances) {
    const match = expected.get(instance.parentId)
    if (!match || Object.prototype.hasOwnProperty.call(origins, instance.parentId)
      || instance.ownerId !== match.ownerId
      || instance.parentId !== match.parentId
      || instance.recordId === instance.parentId
      || !sameOptionalInertJson(instance.payload.mod, match.mod)) {
      throw new ProfileRendererPersistenceError(
        `Profile snapshot Mod ${instance.recordId} has ambiguous native provenance`,
      )
    }
    if (!('idMap' in instance.payload)) {
      origins[instance.parentId] = Object.freeze({
        kind: 'direct',
        instanceId: instance.recordId,
      })
    } else {
      const payload = instance.payload
      origins[instance.parentId] = captureProfileGuiInertJson({
        kind: 'stamped',
        instanceId: instance.recordId,
        sourceTemplateId: payload.source.templateId,
        sourceTemplateVersion: payload.source.templateVersion,
        sourceToInstanceIdMap: payload.idMap,
      } satisfies GuiNewModOrigin, '$profileModOrigin')
    }
  }
  if (Object.keys(origins).length !== expected.size
    || [...expected.keys()].some((cardId) => !Object.prototype.hasOwnProperty.call(origins, cardId))) {
    throw new ProfileRendererPersistenceError('Profile snapshot Mod provenance is incomplete')
  }
  return captureProfileGuiInertJson(origins, '$profileModOrigins')
}

function isInstalledProfileBridge(candidate: unknown): candidate is InstalledProfileBridge {
  return Boolean(candidate)
    && typeof candidate === 'object'
    && REQUIRED_PROFILE_BRIDGE_METHODS.every((method) => (
      typeof (candidate as Record<string, unknown>)[method] === 'function'
    ))
}

function validGuiUserModTemplates(value: unknown): value is readonly GuiUserModTemplate[] {
  if (!Array.isArray(value)) return false
  const templateIds = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false
    const record = candidate as Record<string, unknown>
    if (Object.getPrototypeOf(record) !== Object.prototype
      || Object.keys(record).length !== 2
      || !Object.prototype.hasOwnProperty.call(record, 'templateId')
      || !Object.prototype.hasOwnProperty.call(record, 'mod')
      || typeof record.templateId !== 'string'
      || !record.templateId.trim()
      || templateIds.has(record.templateId)
      || !validateProfileModDocumentTransport(record.mod).ok) {
      return false
    }
    templateIds.add(record.templateId)
  }
  return true
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}
