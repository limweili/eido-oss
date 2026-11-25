export const KEYCHAIN_BRIDGE_VERSION = 1 as const
export const KEYCHAIN_BRIDGE_CHANNEL = 'eido:keychain:v1' as const
export const KEYCHAIN_API_KEY_MAX_BYTES = 16 * 1024

export const KEYCHAIN_BRIDGE_OPERATIONS = [
  'get',
  'set',
  'clear',
  'migrate-legacy',
] as const

export type KeychainBridgeOperation = (typeof KEYCHAIN_BRIDGE_OPERATIONS)[number]

// Which protected credential an operation addresses. The slot is named for what
// Eido uses it for, never for a provider. Callers may omit it and get the
// OpenRouter key; the wire never omits it, so the main process is never
// guessing which secret it was handed.
//
// 'linkup' is the credential ADR 0034 predicted in its own consequences: the
// routing here "was built to hold more than one credential and still can; it
// simply holds one today ... the next credential is a matter of when, not
// whether." It pays a provider Eido calls during a run, so that a Card can say
// what it read.
//
// The retired 'search' slot (ADR 0034) is gone from the wire entirely. Deleting
// a search key left over from an older build is a startup file removal in the
// main process now, not a name the renderer can still address.
export const KEYCHAIN_CREDENTIALS = ['openrouter', 'linkup'] as const
export type KeychainCredentialName = (typeof KEYCHAIN_CREDENTIALS)[number]
export const DEFAULT_KEYCHAIN_CREDENTIAL: KeychainCredentialName = 'openrouter'

export type KeychainBridgeOperationPayloads = Readonly<{
  get: Readonly<{ credential: KeychainCredentialName }>
  set: Readonly<{ credential: KeychainCredentialName; apiKey: string }>
  clear: Readonly<{ credential: KeychainCredentialName }>
  // Not addressable: there is no legacy search key to migrate, and pretending
  // otherwise would invite a call that means nothing.
  'migrate-legacy': Readonly<{ apiKey: string }>
}>

export type KeychainBridgeOperationResults = Readonly<{
  get: Readonly<{ apiKey: string }>
  set: Readonly<{ stored: true }>
  clear: Readonly<{ cleared: true }>
  'migrate-legacy': Readonly<{ migrated: boolean }>
}>

export type KeychainBridgeRequest<
  Operation extends KeychainBridgeOperation = KeychainBridgeOperation,
> = Operation extends KeychainBridgeOperation
  ? Readonly<{
      version: typeof KEYCHAIN_BRIDGE_VERSION
      requestId: string
      operation: Operation
      payload: KeychainBridgeOperationPayloads[Operation]
    }>
  : never

export type KeychainBridgeSuccess<
  Operation extends KeychainBridgeOperation = KeychainBridgeOperation,
> = Operation extends KeychainBridgeOperation
  ? Readonly<{
      version: typeof KEYCHAIN_BRIDGE_VERSION
      requestId: string
      operation: Operation
      ok: true
      value: KeychainBridgeOperationResults[Operation]
    }>
  : never

// Two refusals, and the difference between them is the point of #1359.
//
// `unavailable` is the old catch-all: the store could not be reached or the
// operation could not be completed, and nothing is known about what is on disk.
//
// `locked` is narrower and load-bearing. A credential IS on this computer and
// the operating system's protected store will not open it right now, typically
// a locked or refused Keychain. Collapsing it into `unavailable`, or worse into
// an empty key, is what made a missing Linkup key silently downgrade Research
// to a shallower mode with nobody told (#1360). A caller that cannot tell the
// two apart cannot say the true thing.
export const KEYCHAIN_BRIDGE_ERROR_CODES = ['unavailable', 'locked'] as const
export type KeychainBridgeErrorCode = (typeof KEYCHAIN_BRIDGE_ERROR_CODES)[number]

export type KeychainBridgeFailure = Readonly<{
  version: typeof KEYCHAIN_BRIDGE_VERSION
  requestId: string
  operation: KeychainBridgeOperation
  ok: false
  error: Readonly<{ code: KeychainBridgeErrorCode }>
}>

export type KeychainBridgeResponse = KeychainBridgeSuccess | KeychainBridgeFailure

export type KeychainBridgeResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; code: KeychainBridgeErrorCode }>

export type InstalledKeychainBridge = Readonly<{
  get(
    credential?: KeychainCredentialName,
  ): Promise<KeychainBridgeResult<KeychainBridgeOperationResults['get']>>
  set(
    apiKey: string,
    credential?: KeychainCredentialName,
  ): Promise<KeychainBridgeResult<KeychainBridgeOperationResults['set']>>
  clear(
    credential?: KeychainCredentialName,
  ): Promise<KeychainBridgeResult<KeychainBridgeOperationResults['clear']>>
  migrateLegacy(
    apiKey: string,
  ): Promise<KeychainBridgeResult<KeychainBridgeOperationResults['migrate-legacy']>>
}>

type KeychainBridgeInvoke = (
  channel: typeof KEYCHAIN_BRIDGE_CHANNEL,
  request: KeychainBridgeRequest,
) => Promise<unknown>

export function createInstalledKeychainBridge(
  invoke: KeychainBridgeInvoke,
  createRequestId: () => string = createSequentialRequestId(),
): InstalledKeychainBridge {
  const call = async <Operation extends KeychainBridgeOperation>(
    operation: Operation,
    payload: KeychainBridgeOperationPayloads[Operation],
  ): Promise<KeychainBridgeResult<KeychainBridgeOperationResults[Operation]>> => {
    const request = Object.freeze({
      version: KEYCHAIN_BRIDGE_VERSION,
      requestId: createRequestId(),
      operation,
      payload,
    }) as KeychainBridgeRequest<Operation>
    const response = assertCorrelatedKeychainBridgeResponse(
      await invoke(KEYCHAIN_BRIDGE_CHANNEL, request),
      request,
    )
    if (!response.ok) return Object.freeze({ ok: false, code: response.error.code })
    return Object.freeze({ ok: true, value: response.value }) as KeychainBridgeResult<
      KeychainBridgeOperationResults[Operation]
    >
  }

  return Object.freeze({
    get: (credential = DEFAULT_KEYCHAIN_CREDENTIAL) => call('get', Object.freeze({ credential })),
    set: (apiKey, credential = DEFAULT_KEYCHAIN_CREDENTIAL) =>
      call('set', Object.freeze({ credential, apiKey })),
    clear: (credential = DEFAULT_KEYCHAIN_CREDENTIAL) =>
      call('clear', Object.freeze({ credential })),
    migrateLegacy: (apiKey) => call('migrate-legacy', Object.freeze({ apiKey })),
  })
}

export function assertKeychainBridgeRequest(candidate: unknown): KeychainBridgeRequest {
  if (!isPlainRecord(candidate)
    || !hasExactKeys(candidate, ['operation', 'payload', 'requestId', 'version'])
    || candidate.version !== KEYCHAIN_BRIDGE_VERSION
    || !boundedString(candidate.requestId, 256)
    || !KEYCHAIN_BRIDGE_OPERATIONS.includes(candidate.operation as KeychainBridgeOperation)
    || !isPlainRecord(candidate.payload)) {
    return deniedRequest()
  }
  const operation = candidate.operation as KeychainBridgeOperation
  if (operation === 'get' || operation === 'clear') {
    if (!hasExactKeys(candidate.payload, ['credential'])
      || !isKeychainCredentialName(candidate.payload.credential)) {
      return deniedRequest()
    }
  } else if (operation === 'set') {
    if (!hasExactKeys(candidate.payload, ['apiKey', 'credential'])
      || !isKeychainCredentialName(candidate.payload.credential)
      || !boundedString(candidate.payload.apiKey, KEYCHAIN_API_KEY_MAX_BYTES)) {
      return deniedRequest()
    }
  } else if (!hasExactKeys(candidate.payload, ['apiKey'])
    || !boundedString(candidate.payload.apiKey, KEYCHAIN_API_KEY_MAX_BYTES)) {
    return deniedRequest()
  }
  return Object.freeze(candidate) as KeychainBridgeRequest
}

export function successKeychainBridgeResponse<Operation extends KeychainBridgeOperation>(
  request: KeychainBridgeRequest<Operation>,
  value: KeychainBridgeOperationResults[Operation],
): KeychainBridgeSuccess<Operation> {
  return Object.freeze({
    version: KEYCHAIN_BRIDGE_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    ok: true,
    value,
  }) as KeychainBridgeSuccess<Operation>
}

export function failedKeychainBridgeResponse(
  request: KeychainBridgeRequest,
  code: KeychainBridgeErrorCode = 'unavailable',
): KeychainBridgeFailure {
  return Object.freeze({
    version: KEYCHAIN_BRIDGE_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    ok: false,
    error: Object.freeze({ code }),
  })
}

export function isKeychainBridgeErrorCode(value: unknown): value is KeychainBridgeErrorCode {
  return KEYCHAIN_BRIDGE_ERROR_CODES.includes(value as KeychainBridgeErrorCode)
}

function assertCorrelatedKeychainBridgeResponse<Operation extends KeychainBridgeOperation>(
  candidate: unknown,
  request: KeychainBridgeRequest<Operation>,
): KeychainBridgeSuccess<Operation> | KeychainBridgeFailure {
  if (!isPlainRecord(candidate)
    || candidate.version !== KEYCHAIN_BRIDGE_VERSION
    || candidate.requestId !== request.requestId
    || candidate.operation !== request.operation
    || typeof candidate.ok !== 'boolean') {
    return deniedResponse()
  }
  if (!candidate.ok) {
    if (!hasExactKeys(candidate, ['error', 'ok', 'operation', 'requestId', 'version'])
      || !isPlainRecord(candidate.error)
      || !hasExactKeys(candidate.error, ['code'])
      || !isKeychainBridgeErrorCode(candidate.error.code)) {
      return deniedResponse()
    }
    return candidate as KeychainBridgeFailure
  }
  if (!hasExactKeys(candidate, ['ok', 'operation', 'requestId', 'value', 'version'])
    || !validOperationResult(request.operation, candidate.value)) {
    return deniedResponse()
  }
  return candidate as KeychainBridgeSuccess<Operation>
}

function validOperationResult(operation: KeychainBridgeOperation, value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  switch (operation) {
    case 'get':
      return hasExactKeys(value, ['apiKey'])
        && typeof value.apiKey === 'string'
        && utf8Bytes(value.apiKey) <= KEYCHAIN_API_KEY_MAX_BYTES
    case 'set':
      return hasExactKeys(value, ['stored']) && value.stored === true
    case 'clear':
      return hasExactKeys(value, ['cleared']) && value.cleared === true
    case 'migrate-legacy':
      return hasExactKeys(value, ['migrated']) && typeof value.migrated === 'boolean'
    default:
      return assertNever(operation)
  }
}

export function isKeychainCredentialName(value: unknown): value is KeychainCredentialName {
  return KEYCHAIN_CREDENTIALS.includes(value as KeychainCredentialName)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Bytes(value) <= maxBytes
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function createSequentialRequestId(): () => string {
  let sequence = 0
  return () => {
    sequence += 1
    return `keychain-renderer-${sequence}`
  }
}

function deniedRequest(): never {
  throw new Error('Keychain bridge request was denied')
}

function deniedResponse(): never {
  throw new Error('Keychain bridge response was denied')
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Keychain bridge operation: ${String(value)}`)
}
