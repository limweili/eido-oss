import { listModPartIdentities, type Mod } from '../mods'
import { PROFILE_BUILT_IN_MOD_TEMPLATES } from '../persistence/profileBuiltInMods'
import {
  PROFILE_MOD_RECORD_VERSION,
  validateProfileModDocumentTransport,
} from '../persistence/profileModRecords'

const PROFILE_PROOF_TEMPLATE = PROFILE_BUILT_IN_MOD_TEMPLATES[0]!
const PROFILE_PROOF_ASK_RESULT = 'Synthetic packaged Ask result'
const PROFILE_PROOF_API_KEY = 'sk-eido-packaged-proof-only'
const PROFILE_PROOF_LINKUP_KEY = 'lk-eido-packaged-proof-only'

type GraphStoreModule = typeof import('../graph/store')
type ProfileProofPhase = 'stamp' | 'verify'

type CredentialMigrationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// A legacy renderer value is migration input, not a new plaintext disk write.
// Chromium can retain removed values in its LevelDB journal, so planting the
// synthetic key in real localStorage would make the proof create its own leak.
// The real migration still scrubs through this adapter and reaches main's
// protected credential store; only its synthetic source starts in memory.
export function createPackagedCredentialMigrationFixture(
  storage: CredentialMigrationStorage,
): CredentialMigrationStorage {
  if (readProfileProofPhase() !== 'stamp') return storage
  const key = 'eido-v3-settings'
  const raw = storage.getItem(key)
  const saved = raw ? JSON.parse(raw) as Record<string, unknown> : {}
  if (Object.prototype.hasOwnProperty.call(saved, 'apiKey')) {
    throw new Error('Packaged credential proof root was not fresh')
  }
  let fixture: string | undefined = JSON.stringify({ ...saved, apiKey: PROFILE_PROOF_API_KEY })
  return Object.freeze({
    getItem(name: string): string | null {
      return name === key && fixture !== undefined ? fixture : storage.getItem(name)
    },
    setItem(name: string, value: string): void {
      if (name === key) fixture = undefined
      storage.setItem(name, value)
    },
    removeItem(name: string): void {
      if (name === key) fixture = undefined
      storage.removeItem(name)
    },
  })
}

export function installPackagedProfileProof(store: GraphStoreModule): void {
  const phase = readProfileProofPhase()
  if (!phase) return
  let started = false
  let unsubscribe: () => void = () => {}
  const runWhenReady = () => {
    const state = store.useGraph.getState()
    if (started) return
    if (state.profileStartupState === 'failed' || state.profileStartupState === 'recovery-required') {
      started = true
      unsubscribe()
      reportProfileProofFailure()
      return
    }
    if (!state.hydrated || state.profileStartupState !== 'ready') return
    started = true
    unsubscribe()
    const run = phase === 'stamp'
      ? runProfileStampProof(store)
      : runProfileVerifyProof(store)
    void run.catch(() => reportProfileProofFailure())
  }
  unsubscribe = store.useGraph.subscribe(runWhenReady)
  runWhenReady()
}

function readProfileProofPhase(): ProfileProofPhase | undefined {
  const value = new URL(window.location.href).searchParams.get('profile-proof-phase')
  if (value === null) return undefined
  if (value !== 'stamp' && value !== 'verify') throw new Error('Packaged Profile proof phase is invalid')
  return value
}

async function runProfileStampProof(store: GraphStoreModule): Promise<void> {
  const [security, credential] = await Promise.all([
    capturePackagedSecurityBoundary(),
    capturePackagedCredentialBoundary(store),
  ])
  const before = store.useGraph.getState()
  if (before.cards.some((card) => card.modV2 !== undefined)) {
    throw new Error('Packaged Profile stamp proof root was not fresh')
  }
  const cardId = before.addModFromLibrary(PROFILE_PROOF_TEMPLATE.templateId, { x: 40, y: 60 })
  if (!cardId) throw new Error('Packaged Profile proof Mod could not be stamped')
  const card = store.useGraph.getState().cards.find((candidate) => candidate.id === cardId)
  if (!card?.modV2) throw new Error('Packaged Profile proof Mod was not applied to the store')

  const askCardId = store.useGraph.getState().addCard('askAi', { x: 560, y: 60 })
  store.useGraph.getState().setCardText(askCardId, 'Generate the packaged Profile proof result')
  const askRun = store.useGraph.getState().beginRun(askCardId, {
    text: 'Generate the packaged Profile proof result',
    model: 'synthetic/profile-proof',
    usedCardIds: [askCardId],
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
  })
  store.useGraph.getState().appendVersionText(askRun.versionId, PROFILE_PROOF_ASK_RESULT)
  store.useGraph.getState().finishRun(askRun.runId)
  assertPackagedAskResult(store, askRun.versionId)
  const flushed = await store.profileRendererCheckpointPersistence().flush()
  const stamped = await queryStampedBuiltInProof(store, cardId, flushed.revision)

  reportProfileProofSuccess({
    phase: 'stamp',
    cardId,
    modId: stamped.modId,
    security,
    credential,
  })
}

async function runProfileVerifyProof(store: GraphStoreModule): Promise<void> {
  const url = new URL(window.location.href)
  const cardId = requireProfileProofId(url.searchParams.get('profile-proof-card-id'))
  const modId = requireProfileProofId(url.searchParams.get('profile-proof-mod-id'))
  const expectedRevision = Number(url.searchParams.get('profile-proof-revision'))
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
    throw new Error('Packaged Profile proof expected revision is invalid')
  }

  assertPackagedAskResult(store)
  const bridge = window.eidoProfile
  if (!bridge) throw new Error('Installed Profile bridge is unavailable')
  const capabilities = await bridge.capabilities()
  if (!capabilities.ok || capabilities.value.adapter !== 'sqlite') {
    throw new Error('Installed Profile SQLite capability is unavailable')
  }
  const stamped = await queryStampedBuiltInProof(store, cardId, expectedRevision, modId)
  const credential = await capturePackagedCredentialBoundary(store)

  reportProfileProofSuccess({
    phase: 'verify',
    cardId,
    modId,
    adapter: capabilities.value.adapter,
    queryRevision: stamped.queryRevision,
    credential,
  })
}

async function queryStampedBuiltInProof(
  store: GraphStoreModule,
  cardId: string,
  expectedRevision: number,
  expectedModId?: string,
): Promise<Readonly<{ modId: string; queryRevision: number }>> {
  const card = store.useGraph.getState().cards.find((candidate) => candidate.id === cardId)
  if (!card?.modV2) throw new Error('Offline hydration did not apply the stamped Mod')
  const bridge = window.eidoProfile
  if (!bridge) throw new Error('Installed Profile bridge is unavailable')
  const query = await bridge.query({
    recordKinds: ['mod-instance'],
    ...(expectedModId === undefined
      ? { parentIds: [cardId] }
      : { recordIds: [expectedModId] }),
    limit: 1,
    byteLimit: 16 * 1024,
  })
  if (!query.ok
    || query.value.revision !== expectedRevision
    || query.value.truncated
    || query.value.nextCursor !== undefined
    || query.value.items.length !== 1) {
    throw new Error('Installed Profile bounded query did not observe the stamped revision')
  }
  const item = query.value.items[0]!
  if (item.kind !== 'mod-instance'
    || item.recordVersion !== PROFILE_MOD_RECORD_VERSION
    || item.parentId !== cardId
    || item.recordId === cardId
    || (expectedModId !== undefined && item.recordId !== expectedModId)
    || !isStampedBuiltInProofPayload(item.payload, item.recordId, card.modV2)) {
    throw new Error('Installed Profile bounded query did not return the stamped built-in Mod')
  }
  return Object.freeze({ modId: item.recordId, queryRevision: query.value.revision })
}

function assertPackagedAskResult(store: GraphStoreModule, expectedVersionId?: string): void {
  const state = store.useGraph.getState()
  const output = state.outputs.find((candidate) => candidate.versions.some((version) => (
    version.text === PROFILE_PROOF_ASK_RESULT
    && (expectedVersionId === undefined || version.id === expectedVersionId)
  )))
  const version = output?.versions.find((candidate) => candidate.text === PROFILE_PROOF_ASK_RESULT)
  const resultCard = output
    ? state.cards.find((candidate) => candidate.id === output.resultCardId)
    : undefined
  const run = version
    ? state.runs.find((candidate) => candidate.producedVersionId === version.id)
    : undefined
  if (!output || !version || resultCard?.kind !== 'result' || run?.status !== 'done') {
    throw new Error('Packaged Profile Ask result did not survive its native save boundary')
  }
}

async function capturePackagedSecurityBoundary(): Promise<Readonly<{
  origin: string
  nodeGlobal: string
  requireGlobal: string
  permissionState: PermissionState
  popupDenied: boolean
  webviewCapability: string
  connectSrc: string
}>> {
  const permission = await navigator.permissions.query({ name: 'notifications' })
  const popup = window.open('about:blank')
  if (popup) popup.close()
  const response = await fetch(window.location.href, { cache: 'no-store' })
  const contentSecurityPolicy = response.headers.get('content-security-policy') ?? ''
  const connectSrc = contentSecurityPolicy
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('connect-src '))
    ?.slice('connect-src '.length) ?? ''
  return Object.freeze({
    origin: window.location.origin,
    nodeGlobal: typeof (globalThis as unknown as { process?: unknown }).process,
    requireGlobal: typeof (globalThis as unknown as { require?: unknown }).require,
    permissionState: permission.state,
    popupDenied: popup === null,
    webviewCapability: typeof Reflect.get(document.createElement('webview'), 'getWebContentsId'),
    connectSrc,
  })
}

async function capturePackagedCredentialBoundary(store: GraphStoreModule): Promise<Readonly<{
  localRoundTrip: true
  legacyPlaintextRemoved: true
  linkupRoundTrip: true
}>> {
  if (store.useGraph.getState().settings.apiKey !== PROFILE_PROOF_API_KEY) {
    throw new Error('Packaged credential was not hydrated into the AI settings seam')
  }
  const bridge = window.eidoKeychain
  if (!bridge) throw new Error('Installed Keychain bridge is unavailable')
  const result = await bridge.get()
  if (!result.ok || result.value.apiKey !== PROFILE_PROOF_API_KEY) {
    throw new Error('Packaged credential did not round-trip through account-private local storage')
  }
  const raw = localStorage.getItem('eido-v3-settings')
  if (raw) {
    const saved = JSON.parse(raw) as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(saved, 'apiKey')) {
      throw new Error('Legacy plaintext credential remained in renderer storage')
    }
  }
  return Object.freeze({
    localRoundTrip: true,
    legacyPlaintextRemoved: true,
    linkupRoundTrip: await capturePackagedLinkupRoundTrip(store, bridge),
  })
}

// The OpenRouter proof above reads a key the fixture planted. This one writes:
// it saves a Linkup key exactly as Settings does, reads it back out of the
// account-private store, then empties the field and confirms it is gone. That
// full path is what a planted fixture cannot prove, and it is where the Linkup
// key silently refused to save because its store was never wired up in main.
async function capturePackagedLinkupRoundTrip(
  store: GraphStoreModule,
  bridge: NonNullable<typeof window.eidoKeychain>,
): Promise<true> {
  await store.useGraph.getState().setLinkupKey(PROFILE_PROOF_LINKUP_KEY)
  const saved = await bridge.get('linkup')
  if (!saved.ok || saved.value.apiKey !== PROFILE_PROOF_LINKUP_KEY) {
    throw new Error('Linkup key did not round-trip through account-private local storage')
  }
  if (store.useGraph.getState().settings.linkupKey !== PROFILE_PROOF_LINKUP_KEY) {
    throw new Error('Linkup key was not hydrated into the AI settings seam')
  }
  await store.useGraph.getState().setLinkupKey('')
  const cleared = await bridge.get('linkup')
  if (!cleared.ok || cleared.value.apiKey !== '') {
    throw new Error('Emptying the Linkup field did not clear the stored key')
  }
  return true
}

function isStampedBuiltInProofPayload(payload: unknown, modId: string, mod: Mod): boolean {
  if (!isPlainRecord(payload)
    || !isPlainRecord(payload.source)
    || !isPlainRecord(payload.idMap)
    || !isPlainRecord(payload.idMap.mod)
    || !Array.isArray(payload.idMap.controls)
    || !isPlainRecord(payload.mod)) return false
  const persistedMod = validateProfileModDocumentTransport(payload.mod)
  if (!persistedMod.ok) return false
  const sourceParts = listModPartIdentities(PROFILE_PROOF_TEMPLATE.mod)
  const instanceParts = listModPartIdentities(mod)
  return payload.source.kind === 'template'
    && payload.source.templateId === PROFILE_PROOF_TEMPLATE.templateId
    && payload.source.templateVersion === 1
    && payload.idMap.mod.sourceId === PROFILE_PROOF_TEMPLATE.templateId
    && payload.idMap.mod.instanceId === modId
    && payload.idMap.controls.length === sourceParts.length
    && sourceParts.length === instanceParts.length
    && payload.idMap.controls.every((pair, index) => (
      isPlainRecord(pair)
      && pair.sourceId === sourceParts[index]!.sourceId
      && pair.instanceId === instanceParts[index]!.sourceId
    ))
    && samePlainJson(persistedMod.value, mod)
}

function samePlainJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => samePlainJson(value, right[index]))
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && samePlainJson(left[key], right[key])
    ))
}

function reportProfileProofSuccess(result: Readonly<Record<string, unknown>>): void {
  const url = new URL(window.location.href)
  url.searchParams.set('profile-proof-result', 'passed')
  url.searchParams.set('profile-proof-result-card-id', String(result.cardId))
  url.searchParams.set('profile-proof-result-mod-id', String(result.modId))
  if (isPlainRecord(result.credential)) {
    url.searchParams.set(
      'profile-proof-credential-round-trip',
      String(result.credential.localRoundTrip),
    )
    url.searchParams.set(
      'profile-proof-legacy-plaintext-removed',
      String(result.credential.legacyPlaintextRemoved),
    )
    url.searchParams.set(
      'profile-proof-linkup-round-trip',
      String(result.credential.linkupRoundTrip),
    )
  }
  if (result.phase === 'stamp' && isPlainRecord(result.security)) {
    url.searchParams.set('profile-proof-origin', String(result.security.origin))
    url.searchParams.set('profile-proof-node-global', String(result.security.nodeGlobal))
    url.searchParams.set('profile-proof-require-global', String(result.security.requireGlobal))
    url.searchParams.set('profile-proof-permission-state', String(result.security.permissionState))
    url.searchParams.set('profile-proof-popup-denied', String(result.security.popupDenied))
    url.searchParams.set('profile-proof-webview-capability', String(result.security.webviewCapability))
    url.searchParams.set('profile-proof-connect-src', String(result.security.connectSrc))
  } else if (result.phase === 'verify') {
    url.searchParams.set('profile-proof-adapter', String(result.adapter))
    url.searchParams.set('profile-proof-query-revision', String(result.queryRevision))
  }
  window.history.replaceState(null, '', url)
}

function reportProfileProofFailure(): void {
  const url = new URL(window.location.href)
  url.searchParams.set('profile-proof-result', 'failed')
  window.history.replaceState(null, '', url)
}

function requireProfileProofId(value: string | null): string {
  if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Packaged Profile proof identity is invalid')
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
