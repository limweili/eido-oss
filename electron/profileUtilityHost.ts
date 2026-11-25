import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs'
import path from 'node:path'
import { PROFILE_BUILT_IN_MOD_TEMPLATES } from '../src/persistence/profileBuiltInMods'
import {
  decodeProfileModRecord,
  PROFILE_MOD_RECORD_VERSION,
  type ProfileModTemplateRecord,
} from '../src/persistence/profileModRecords'
import {
  PROFILE_CONTRACT_VERSIONS,
  profileServiceFailure,
  type ProfileServiceResult,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import {
  createInstalledProfileAgentCapabilities,
  type ProfileAgentInstalledTransport,
} from '../src/persistence/profileAgentCommandInstallation'
import { PROFILE_LOCALE_SETTING_ID } from '../src/persistence/profileGuiProjection'
import type {
  GuiPortableProfileSetting,
  GuiProfileProjectionRequest,
} from '../src/persistence/profileGuiProjection'
import {
  acquireSqliteProfileOwner,
  type SqliteProfileOwnerCoordinator,
} from './sqliteProfileOwnerCoordinator'
import {
  createProfileLegacyIdeaSource,
} from './profilePortableSource'
import {
  createProfilePortableZipDestination,
} from './profilePortableZip'
import { probeEmbeddedRuntime } from './runtimeProbe'
import {
  assertProfileUtilityParentMessage,
  createProfileUtilityFatal,
  createProfileUtilityInitialize,
  createProfileUtilityReady,
  createProfileUtilityResponse,
  type ProfileUtilityFatalMessage,
  type ProfileUtilityInitializePayload,
  type ProfileUtilityGuiCommitPayload,
  type ProfileUtilityOperation,
  type ProfileUtilityOperationResults,
  type ProfileUtilityReadyMessage,
  type ProfileUtilityRequestMessage,
  type ProfileUtilityResponseMessage,
} from './profileUtilityProtocol'

const LEGACY_IDEA_SOURCE_MAX_BYTES = 64 * 1024 * 1024
const HEADLESS_UTILITY_OPERATIONS = new Set<ProfileUtilityOperation>([
  'status',
  'capabilities',
  'query',
  'inspect-result',
  'changes',
  'agent-card-neighbors',
  'agent-card-set-bounds',
  'apply-agent-command-batch',
  'close',
])

export type ProfileUtilityHost = Readonly<{
  initialize(
    payload: ProfileUtilityInitializePayload,
  ): Promise<ProfileUtilityReadyMessage | ProfileUtilityFatalMessage>
  handle(candidate: unknown): Promise<ProfileUtilityResponseMessage>
}>

export type ProfileUtilityHostOptions = Readonly<{
  createInitialProfile?: () => ProfileSnapshot
  acquireProfileOwner?: typeof acquireSqliteProfileOwner
  probeRuntime?: typeof probeEmbeddedRuntime
}>

export function createProfileUtilityHost(
  options: ProfileUtilityHostOptions = {},
): ProfileUtilityHost {
  const probeRuntime = options.probeRuntime ?? probeEmbeddedRuntime
  let coordinator: SqliteProfileOwnerCoordinator | undefined
  let ownerRoute: ProfileUtilityInitializePayload['route'] | undefined
  let agentTransport: ProfileAgentInstalledTransport | undefined
  let agentActor: Readonly<{ client: string; sessionId: string }> | undefined
  let portableTempRoot: string | undefined
  let initialized = false
  let closed = false
  let closePromise: Promise<void> | undefined

  const closeCoordinator = (): Promise<void> => {
    if (closePromise) return closePromise
    closed = true
    closePromise = coordinator?.close() ?? Promise.resolve()
    return closePromise
  }

  const host: ProfileUtilityHost = Object.freeze({
    async initialize(payload) {
      let captured: ProfileUtilityInitializePayload
      try {
        const message = assertProfileUtilityParentMessage(
          createProfileUtilityInitialize(payload),
        )
        if (message.kind !== 'initialize') return createProfileUtilityFatal(profileServiceFailure('invalid'))
        captured = message.payload
      } catch {
        return createProfileUtilityFatal(profileServiceFailure('invalid'))
      }
      if (initialized || closed) return createProfileUtilityFatal(profileServiceFailure('busy'))
      initialized = true
      if (captured.route === 'exclusive-headless-owner'
        && profileAuthorityAbsent(captured.databasePath)) {
        return createProfileUtilityFatal(profileServiceFailure('not-found'))
      }
      let seed: ProfileSnapshot | undefined
      if (captured.route === 'active-owner') {
        try {
          mkdirSync(path.dirname(captured.databasePath), { recursive: true, mode: 0o700 })
          mkdirSync(captured.portableTempRoot, { recursive: true, mode: 0o700 })
          seed = (options.createInitialProfile ?? createProductionProfileSeed)()
        } catch {
          return createProfileUtilityFatal(profileServiceFailure('internal'))
        }
      }
      const acquired = (options.acquireProfileOwner ?? acquireSqliteProfileOwner)({
        databasePath: captured.databasePath,
        route: captured.route,
        automaticRecoveryPoints: true,
        ...(seed === undefined ? {} : { seed }),
        ...(captured.route === 'exclusive-headless-owner'
          ? { agentActor: captured.actor }
          : {}),
      })
      if (!acquired.ok) {
        const failure = captured.route === 'exclusive-headless-owner'
          && acquired.code === 'invalid'
          && profileAuthorityAbsent(captured.databasePath)
          ? profileServiceFailure('not-found')
          : acquired
        return createProfileUtilityFatal(failure)
      }
      coordinator = acquired.value
      ownerRoute = captured.route
      agentTransport = captured.route === 'exclusive-headless-owner'
        ? captured.transport
        : undefined
      agentActor = captured.route === 'exclusive-headless-owner'
        ? captured.actor
        : undefined
      if (coordinator.owner.route !== captured.route) {
        await closeCoordinator()
        return createProfileUtilityFatal(profileServiceFailure('internal'))
      }
      portableTempRoot = captured.route === 'active-owner'
        ? captured.portableTempRoot
        : undefined

      const status = await coordinator.status()
      if (status.ok) return createProfileUtilityReady(
        captured.route,
        'ready',
        status.value.revision,
      )
      if (status.code === 'corrupt-or-recovery-required') {
        return createProfileUtilityReady(
          captured.route,
          'recovery-required',
          coordinator.recoveryHighWaterRevision(),
        )
      }
      await closeCoordinator()
      return createProfileUtilityFatal(status)
    },

    async handle(candidate) {
      const message = assertProfileUtilityParentMessage(candidate)
      if (message.kind !== 'request') {
        throw new Error('Profile utility host accepts request messages after initialization')
      }
      if (!initialized || !coordinator) {
        throw new Error('Profile utility request arrived before native initialization')
      }
      if (message.operation === 'close') {
        try {
          await closeCoordinator()
          return respond(message, { ok: true, value: Object.freeze({ closed: true }) })
        } catch {
          return respond(message, profileServiceFailure('internal'))
        }
      }
      if (closed) return respond(message, profileServiceFailure('busy'))
      if (ownerRoute === 'exclusive-headless-owner'
        && !HEADLESS_UTILITY_OPERATIONS.has(message.operation)) {
        return respond(message, profileServiceFailure('capability-denied'))
      }

      switch (message.operation) {
        case 'runtime-probe':
          return respond(message, { ok: true, value: probeRuntime() })
        case 'hydrate':
          return respond(message, await coordinator.snapshot())
        case 'authorize-ordinary-idea-create':
          return respond(
            message,
            await coordinator.authorizeOrdinaryIdeaCreate(message.payload.ideaId),
          )
        case 'commit-gui-projection':
          return respond(
            message,
            await commitRendererProjection(coordinator, message.payload),
          )
        case 'confirm-revision':
          return respond(
            message,
            await confirmRevision(coordinator, message.payload.expectedRevision),
          )
        case 'status':
          return respond(message, await coordinator.status())
        case 'capabilities':
          return respond(
            message,
            await agentCapabilities(coordinator, ownerRoute),
          )
        case 'query':
          return respond(message, await coordinator.query(message.payload.request))
        case 'inspect-result':
          return respond(message, await coordinator.inspectResult(message.payload.request))
        case 'changes':
          return respond(message, await coordinator.changes(message.payload.request))
        case 'agent-card-neighbors':
          return respond(message, await coordinator.agentCardNeighbors(message.payload.request))
        case 'agent-card-set-bounds':
          return respond(message, await coordinator.agentCardSetBounds(message.payload.request))
        case 'apply-agent-command-batch':
          if (ownerRoute === 'exclusive-headless-owner') {
            if (!agentTransport || 'transport' in message.payload) {
              return respond(message, profileServiceFailure('capability-denied'))
            }
            return respond(
              message,
              await coordinator.applyAgentCommandBatch(
                message.payload.request,
                agentTransport,
                agentActor,
              ),
            )
          }
          if (ownerRoute !== 'active-owner' || !('transport' in message.payload)) {
            return respond(message, profileServiceFailure('capability-denied'))
          }
          return respond(
            message,
            await coordinator.applyAgentCommandBatch(
              message.payload.request,
              message.payload.transport,
              message.payload.actor,
            ),
          )
        case 'export-portable':
          if (!portableTempRoot) return respond(message, profileServiceFailure('capability-denied'))
          return respond(message, await coordinator.exportPortable({
            ...message.payload.request,
            destination: createProfilePortableZipDestination({
              archivePath: message.payload.destinationPath,
              operationTempRoot: portableTempRoot,
            }),
          }))
        case 'duplicate-idea':
          return respond(message, await coordinator.duplicateIdea(message.payload.request))
        case 'import-idea-closure': {
          if (!portableTempRoot) return respond(message, profileServiceFailure('capability-denied'))
          let source: ReturnType<typeof createProfileLegacyIdeaSource>
          try {
            source = createLegacyIdeaSourceFromPath(message.payload.sourcePath)
          } catch {
            return respond(message, profileServiceFailure('invalid'))
          }
          return respond(message, await coordinator.importIdeaClosure({
            ...message.payload.request,
            source,
          }))
        }
        case 'inspect-recovery':
          return respond(
            message,
            await inspectRecovery(coordinator),
          )
        case 'restore-recovery': {
          return respond(
            message,
            await restoreRecovery(
              coordinator,
              message.payload.candidateId,
            ),
          )
        }
        case 'start-fresh':
          return respond(message, await startFreshProfile(coordinator))
        default:
          return assertNever(message)
      }
    },
  })

  return host
}

async function agentCapabilities(
  coordinator: SqliteProfileOwnerCoordinator,
  ownerRoute: ProfileUtilityInitializePayload['route'] | undefined,
): Promise<ProfileServiceResult<ProfileUtilityOperationResults['capabilities']>> {
  const result = await coordinator.capabilities()
  if (!result.ok || ownerRoute === undefined) return result
  return {
    ok: true,
    value: createInstalledProfileAgentCapabilities(result.value.adapter),
  }
}

function profileAuthorityAbsent(databasePath: string): boolean {
  return !existsSync(databasePath) && !existsSync(`${databasePath}.owner.sqlite`)
}

export function createProductionProfileSeed(): ProfileSnapshot {
  const now = new Date().toISOString()
  const profileId = `profile:${randomUUID()}`
  const ideaId = `idea:${randomUUID()}`
  const locale = defaultProfileLocale()
  const seed: ProfileSnapshot = {
    profileId,
    revision: 0,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: ideaId,
    ideas: [{
      id: ideaId,
      name: 'Main Idea',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    }],
    boards: {
      [ideaId]: {
        version: 1 as const,
        cards: [],
        connections: [],
        outputs: [],
        runs: [],
        updatedAt: now,
      },
    },
    modTemplates: createBuiltInProfileModTemplateRecords(profileId, now),
    modInstances: [],
    profileSettings: [{
      id: PROFILE_LOCALE_SETTING_ID,
      recordVersion: 1,
      classification: 'portable-profile',
      value: { locale },
    }],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: {
      read: 'supported',
      write: 'supported',
      source: 'friends-alpha',
    },
  }
  return Object.freeze(seed)
}

function createBuiltInProfileModTemplateRecords(
  profileId: string,
  createdAt: string,
): ProfileModTemplateRecord[] {
  return PROFILE_BUILT_IN_MOD_TEMPLATES.map(({ templateId, mod }) => {
    const decoded = decodeProfileModRecord({
      kind: 'mod-template',
      recordId: templateId,
      ownerId: profileId,
      parentId: profileId,
      recordVersion: PROFILE_MOD_RECORD_VERSION,
      payload: {
        templateVersion: 1,
        provenance: { kind: 'built-in' },
        createdAt,
        updatedAt: createdAt,
        mod,
      },
    })
    if (!decoded.ok || decoded.value.kind !== 'mod-template') {
      throw new Error(`Built-in Mod template ${templateId} violates the native Profile contract`)
    }
    return decoded.value
  })
}

function respond<Operation extends ProfileUtilityOperation>(
  request: ProfileUtilityRequestMessage<Operation>,
  result: ProfileServiceResult<NoInfer<ProfileUtilityOperationResults[Operation]>>,
): ProfileUtilityResponseMessage<Operation> {
  return createProfileUtilityResponse<Operation>(
    request.requestId,
    request.operation as Operation,
    result,
  )
}

async function confirmRevision(
  coordinator: SqliteProfileOwnerCoordinator,
  expectedRevision: number,
): Promise<ProfileServiceResult<ProfileUtilityOperationResults['confirm-revision']>> {
  const status = await coordinator.status()
  if (!status.ok) return status
  const exactCleanRevision = status.value.revision === expectedRevision
    && status.value.state === 'ready'
    && status.value.dirty === 'clean'
  return {
    ok: true,
    value: Object.freeze({
      revision: status.value.revision,
      durable: exactCleanRevision,
      dirty: status.value.dirty !== 'clean',
    }),
  }
}

async function commitRendererProjection(
  coordinator: SqliteProfileOwnerCoordinator,
  payload: ProfileUtilityGuiCommitPayload,
): ReturnType<SqliteProfileOwnerCoordinator['commitGuiProjection']> {
  const current = await coordinator.snapshot()
  if (!current.ok) return current
  const localeSettings = readAuthoritativeLocaleSettings(current.value)
  if (!localeSettings) {
    throw new Error('Profile utility received impossible authoritative locale state')
  }
  const request: GuiProfileProjectionRequest = Object.freeze({
    generation: payload.generation,
    expectedRevision: payload.expectedRevision,
    clientTxnId: payload.clientTxnId,
    idempotencyKey: payload.idempotencyKey,
    committedAt: payload.committedAt,
    context: payload.context,
    projection: Object.freeze({
      ...payload.rendererProjection,
      profileId: current.value.profileId,
      profileSettings: localeSettings,
    }),
  })
  return coordinator.commitGuiProjection(request)
}

// The authoritative Profile settings this build hands back to the GUI
// projection on every save.
//
// It used to be pinned to exactly zero or one rows, all of them the locale.
// Any second row, and any id this build had never heard of, made this return
// undefined and made the caller THROW on EVERY GUI SAVE, which is precisely the
// failure class ADR 0040 exists to kill: a setting nothing reads taking a
// person's whole Profile offline. A row whose id this build does not recognise
// is now carried through verbatim, in the order it was stored, and never
// inspected. The recognised locale row behaves exactly as before, normalised
// down to the four keys and the canonical locale.
//
// Undefined is still returned for a state that cannot exist on disk: a
// structurally broken row, or a second row carrying the locale id. The record
// store's own validators fail closed on both, so reaching either here means
// the snapshot was already corrupt, and that is not a settings problem.
export function readAuthoritativeLocaleSettings(
  snapshot: Pick<ProfileSnapshot, 'profileSettings'>,
): readonly GuiPortableProfileSetting[] | undefined {
  const authoritative: GuiPortableProfileSetting[] = []
  let localeSeen = false
  for (const setting of snapshot.profileSettings) {
    if (!isPlainRecord(setting)
      || !hasExactKeys(setting, ['classification', 'id', 'recordVersion', 'value'])
      || typeof setting.id !== 'string' || setting.id.trim().length === 0
      || setting.recordVersion !== 1
      || setting.classification !== 'portable-profile') {
      return undefined
    }
    if (setting.id !== PROFILE_LOCALE_SETTING_ID) {
      authoritative.push(Object.freeze({
        id: setting.id,
        recordVersion: 1,
        classification: 'portable-profile',
        value: setting.value,
      }))
      continue
    }
    if (localeSeen
      || !isPlainRecord(setting.value)
      || !hasExactKeys(setting.value, ['locale'])
      || !canonicalLocale(setting.value.locale)) {
      return undefined
    }
    localeSeen = true
    authoritative.push(Object.freeze({
      id: PROFILE_LOCALE_SETTING_ID,
      recordVersion: 1,
      classification: 'portable-profile',
      value: Object.freeze({ locale: setting.value.locale }),
    }))
  }
  return Object.freeze(authoritative)
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
  const prototype = Object.getPrototypeOf(candidate)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function defaultProfileLocale(): string {
  const candidate = Intl.DateTimeFormat().resolvedOptions().locale
  if (canonicalLocale(candidate)) return candidate
  return 'en'
}

function canonicalLocale(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false
  try {
    return Intl.getCanonicalLocales(value)[0] === value
  } catch {
    return false
  }
}

async function inspectRecovery(
  coordinator: SqliteProfileOwnerCoordinator,
): Promise<ProfileServiceResult<ProfileUtilityOperationResults['inspect-recovery']>> {
  const result = await coordinator.recover({ mode: 'inspect' })
  if (!result.ok) return result
  if (result.value.mode !== 'inspect') {
    throw new Error('Profile utility provider returned the wrong recovery inspection mode')
  }
  return {
    ok: true,
    value: Object.freeze({
      ...result.value,
      currentRevision: coordinator.recoveryHighWaterRevision(),
    }),
  }
}

async function restoreRecovery(
  coordinator: SqliteProfileOwnerCoordinator,
  candidateId: string,
): Promise<ProfileServiceResult<ProfileUtilityOperationResults['restore-recovery']>> {
  const expectedRevision = coordinator.recoveryHighWaterRevision()
  const result = await coordinator.recover({
    mode: 'restore',
    candidateId,
    expectedRevision,
  })
  if (!result.ok) return result
  if (result.value.mode !== 'restore') {
    throw new Error('Profile utility provider returned the wrong recovery restore mode')
  }
  return { ok: true, value: result.value }
}

async function startFreshProfile(
  coordinator: SqliteProfileOwnerCoordinator,
): Promise<ProfileServiceResult<ProfileUtilityOperationResults['start-fresh']>> {
  const previousRevision = coordinator.recoveryHighWaterRevision()
  const result = await coordinator.startFresh()
  if (!result.ok) return result
  if (result.value.mode !== 'start-fresh'
    || result.value.previousRevision !== previousRevision) {
    throw new Error('Profile utility provider returned an uncorrelated start-fresh receipt')
  }
  return { ok: true, value: result.value }
}

function createLegacyIdeaSourceFromPath(
  sourcePath: string,
): ReturnType<typeof createProfileLegacyIdeaSource> {
  const descriptor = openSync(sourcePath, 'r')
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || stat.size < 1 || stat.size > LEGACY_IDEA_SOURCE_MAX_BYTES) {
      throw new Error('Legacy Idea source is outside its admission bound')
    }
    const text = readFileSync(descriptor, { encoding: 'utf8' })
    return createProfileLegacyIdeaSource(JSON.parse(text) as unknown)
  } finally {
    closeSync(descriptor)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Profile utility request: ${String(value)}`)
}
