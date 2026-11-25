import {
  PROFILE_ADAPTER_KINDS,
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_GATEWAY_PROTOCOL_VERSION,
  PROFILE_GATEWAY_VERSIONS,
  PROFILE_INSPECTION_QUERY_NAMES,
  PROFILE_QUERYABLE_RECORD_KINDS,
  PROFILE_QUERY_LIMITS,
  PROFILE_SERVICE_ERROR_CODES,
  PROFILE_SERVICE_FAILURE_CONTRACTS,
  type ProfileCapabilities,
  type ProfileIdeaLifecycleReceipt,
  type ProfilePortableExportReceipt,
  type ProfileQueryPage,
  type ProfileServiceFailure,
  type ProfileSnapshot,
  type ProfileStatus,
} from './profileServiceContract'
import {
  validateProfileSnapshotTransport,
} from './profileLogicalProjection'
import {
  INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
} from './profileAgentCommandManifest'

export function isProfileTransportSnapshot(candidate: unknown): candidate is ProfileSnapshot {
  try {
    validateProfileSnapshotTransport(candidate)
    return true
  } catch {
    return false
  }
}

export function isProfileTransportStatus(candidate: unknown): candidate is ProfileStatus {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, ['compatibility', 'dirty', 'owner', 'profileId', 'revision', 'state', 'versions'])
    && nonEmptyString(candidate.profileId)
    && nonNegativeSafeInteger(candidate.revision)
    && isProfileContractVersions(candidate.versions)
    && isProfileCompatibility(candidate.compatibility)
    && ['ready', 'busy', 'unsupported-future', 'recovery-required', 'unrecoverable'].includes(String(candidate.state))
    && ['clean', 'pending', 'committing', 'uncertain'].includes(String(candidate.dirty))
    && isPlainRecord(candidate.owner)
    && hasExactKeys(candidate.owner, ['mode', 'route'])
    && ['mutable', 'read-only', 'none'].includes(String(candidate.owner.mode))
    && ['active-owner', 'exclusive-headless-owner', 'none'].includes(String(candidate.owner.route))
}

export function isProfileTransportCapabilities(candidate: unknown): candidate is ProfileCapabilities {
  if (!isPlainRecord(candidate)
    || !hasOptionalExactKeys(
      candidate,
      ['adapter', 'commands', 'queries', 'queryLimits', 'versions'],
      ['commandBatch'],
    )
  ) return false
  if (!PROFILE_ADAPTER_KINDS.includes(candidate.adapter as (typeof PROFILE_ADAPTER_KINDS)[number])
    || !exactConstantObject(candidate.versions, PROFILE_GATEWAY_VERSIONS)
    || !exactConstantObject(candidate.queryLimits, PROFILE_QUERY_LIMITS)
    || !Array.isArray(candidate.queries)
    || candidate.queries.length !== PROFILE_INSPECTION_QUERY_NAMES.length
    || !candidate.queries.every((query, index) => query === PROFILE_INSPECTION_QUERY_NAMES[index])
    || !Array.isArray(candidate.commands)) return false
  if (candidate.commandBatch === undefined) return candidate.commands.length === 0
  return candidate.commands.length === INSTALLED_PROFILE_AGENT_COMMAND_NAMES.length
    && candidate.commands.every((name, index) => name === INSTALLED_PROFILE_AGENT_COMMAND_NAMES[index])
    && exactJsonValue(candidate.commandBatch, INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY)
}

export function isProfileTransportQueryPage(candidate: unknown): candidate is ProfileQueryPage {
  if (!isPlainRecord(candidate)
    || !hasOptionalExactKeys(candidate, ['items', 'profileId', 'revision', 'truncated'], ['nextCursor'])
    || !nonEmptyString(candidate.profileId)
    || !nonNegativeSafeInteger(candidate.revision)
    || !Array.isArray(candidate.items)
    || typeof candidate.truncated !== 'boolean'
    || (candidate.nextCursor !== undefined && !boundedString(candidate.nextCursor, PROFILE_QUERY_LIMITS.maxCursorBytes))) {
    return false
  }
  return candidate.items.every((item) => isPlainRecord(item)
    && hasExactKeys(item, ['kind', 'ordinal', 'ownerId', 'parentId', 'payload', 'recordId', 'recordVersion'])
    && nonEmptyString(item.recordId)
    && PROFILE_QUERYABLE_RECORD_KINDS.includes(item.kind as (typeof PROFILE_QUERYABLE_RECORD_KINDS)[number])
    && nonEmptyString(item.ownerId)
    && (item.parentId === null || nonEmptyString(item.parentId))
    && nonNegativeSafeInteger(item.ordinal)
    && item.recordVersion === PROFILE_CONTRACT_VERSIONS.record
    && isProfileJsonValue(item.payload))
}

export function isProfileTransportPortableExportReceipt(
  candidate: unknown,
): candidate is ProfilePortableExportReceipt {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, ['entryCount', 'integrityRoot', 'operationId', 'profileId', 'revision', 'verified'])
    && nonEmptyString(candidate.operationId)
    && nonEmptyString(candidate.profileId)
    && nonNegativeSafeInteger(candidate.revision)
    && nonEmptyString(candidate.integrityRoot)
    && nonNegativeSafeInteger(candidate.entryCount)
    && candidate.verified === true
}

export function isProfileTransportIdeaLifecycleReceipt(
  candidate: unknown,
): candidate is ProfileIdeaLifecycleReceipt {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, [
      'importedAssetIds',
      'insertedRecordIds',
      'kind',
      'operationId',
      'previousRevision',
      'replayed',
      'revision',
      'targetIdeaId',
    ])
    && (candidate.kind === 'duplicate-idea' || candidate.kind === 'import-idea')
    && nonEmptyString(candidate.operationId)
    && nonNegativeSafeInteger(candidate.previousRevision)
    && nonNegativeSafeInteger(candidate.revision)
    && nonEmptyString(candidate.targetIdeaId)
    && stringArray(candidate.insertedRecordIds)
    && stringArray(candidate.importedAssetIds)
    && typeof candidate.replayed === 'boolean'
}

export function isProfileTransportServiceFailure(candidate: unknown): candidate is ProfileServiceFailure {
  return isPlainRecord(candidate)
    && candidate.ok === false
    && hasValidFailureFields(candidate, true)
}

export function isProfileTransportServiceFailureBody(
  candidate: unknown,
): candidate is Omit<ProfileServiceFailure, 'ok'> {
  return isPlainRecord(candidate) && hasValidFailureFields(candidate, false)
}

export function isProfileContractVersions(candidate: unknown): boolean {
  return exactConstantObject(candidate, PROFILE_CONTRACT_VERSIONS)
}

function hasValidFailureFields(candidate: Record<string, unknown>, includeOk: boolean): boolean {
  const allowed = new Set([
    'code',
    'currentRevision',
    'message',
    ...(includeOk ? ['ok'] : []),
    'retryable',
    'supportedGatewayProtocolVersion',
    'supportedVersions',
  ])
  if (Object.keys(candidate).some((key) => !allowed.has(key))
    || !PROFILE_SERVICE_ERROR_CODES.includes(candidate.code as ProfileServiceFailure['code'])) {
    return false
  }
  const contract = PROFILE_SERVICE_FAILURE_CONTRACTS[candidate.code as ProfileServiceFailure['code']]
  if (candidate.retryable !== contract.retryable || candidate.message !== contract.message) return false
  if (candidate.currentRevision !== undefined && !nonNegativeSafeInteger(candidate.currentRevision)) return false
  if (candidate.supportedGatewayProtocolVersion !== undefined
    && candidate.supportedGatewayProtocolVersion !== PROFILE_GATEWAY_PROTOCOL_VERSION) {
    return false
  }
  return candidate.supportedVersions === undefined || isProfileContractVersions(candidate.supportedVersions)
}

function isProfileCompatibility(candidate: unknown): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, ['read', 'source', 'write'])
    && candidate.read === 'supported'
    && candidate.write === 'supported'
    && candidate.source === 'friends-alpha'
}

function isProfileJsonValue(candidate: unknown): boolean {
  const stack = [candidate]
  while (stack.length > 0) {
    const value = stack.pop()
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) return false
      continue
    }
    if (Array.isArray(value)) {
      stack.push(...value)
      continue
    }
    if (!isPlainRecord(value)) return false
    stack.push(...Object.values(value))
  }
  return true
}

function exactConstantObject(
  candidate: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, Object.keys(expected))
    && Object.entries(expected).every(([key, value]) => candidate[key] === value)
}

function exactJsonValue(candidate: unknown, expected: unknown): boolean {
  if (candidate === null || expected === null
    || typeof candidate !== 'object' || typeof expected !== 'object') {
    return Object.is(candidate, expected)
  }
  if (Array.isArray(candidate) || Array.isArray(expected)) {
    return Array.isArray(candidate)
      && Array.isArray(expected)
      && candidate.length === expected.length
      && candidate.every((value, index) => exactJsonValue(value, expected[index]))
  }
  if (!isPlainRecord(candidate) || !isPlainRecord(expected)) return false
  return hasExactKeys(candidate, Object.keys(expected))
    && Object.keys(expected).every((key) => exactJsonValue(candidate[key], expected[key]))
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function hasOptionalExactKeys(
  candidate: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  return required.every((key) => Object.prototype.hasOwnProperty.call(candidate, key))
    && Object.keys(candidate).every((key) => required.includes(key) || optional.includes(key))
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
  const prototype = Object.getPrototypeOf(candidate)
  return prototype === Object.prototype || prototype === null
}

function nonEmptyString(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0
}

function boundedString(candidate: unknown, maxBytes: number): candidate is string {
  return nonEmptyString(candidate) && new TextEncoder().encode(candidate).byteLength <= maxBytes
}

function stringArray(candidate: unknown): candidate is readonly string[] {
  return Array.isArray(candidate) && candidate.every(nonEmptyString)
}

function nonNegativeSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && Number(candidate) >= 0 && !Object.is(candidate, -0)
}
