import {
  PROFILE_SERVICE_ERROR_CODES,
  profileServiceFailure,
  type ProfileServiceErrorCode,
  type ProfileServiceFailure,
} from './profileServiceContract'

export type ProfileGuiSaveIdentity = Readonly<{
  clientTxnId: string
  idempotencyKey: string
  committedAt: string
}>

export type ProfileGuiSaveRequest<Projection, Context = undefined> = Readonly<{
  generation: number
  expectedRevision: number
  clientTxnId: string
  idempotencyKey: string
  committedAt: string
  context: Context
  projection: Projection
}>

export type ProfileGuiSaveSubmitResult =
  | Readonly<{ ok: true; revision: number }>
  | ProfileServiceFailure

declare const profileGuiConflictTokenBrand: unique symbol

export type ProfileGuiSaveConflictToken = Readonly<{
  generation: number
  currentRevision: number
  [profileGuiConflictTokenBrand]: never
}>

export type ProfileGuiRevisionConfirmation = Readonly<{
  revision: number
  durable: boolean
  dirty: boolean
}>

export type ProfileGuiSaveFlushResult =
  | Readonly<{ ok: true; generation: number; revision: number }>
  | Readonly<{
      ok: false
      kind: 'uncertain'
      generation: number
      acknowledgedRevision: number
    }>
  | Readonly<{
      ok: false
      kind: 'conflict'
      generation: number
      acknowledgedRevision: number
      currentRevision: number
      token: ProfileGuiSaveConflictToken
    }>
  | Readonly<{
      ok: false
      kind: 'rejected'
      generation: number
      acknowledgedRevision: number
      failure: ProfileServiceFailure
    }>

export type ProfileGuiSaveStatus =
  | Readonly<{ kind: 'saving'; generation: number }>
  | Readonly<{ kind: 'saved'; generation: number; revision: number }>
  | Readonly<{ kind: 'uncertain'; generation: number; acknowledgedRevision: number }>
  | Readonly<{
      kind: 'conflict'
      generation: number
      acknowledgedRevision: number
      currentRevision: number
      token: ProfileGuiSaveConflictToken
    }>
  | Readonly<{
      kind: 'rejected'
      generation: number
      acknowledgedRevision: number
      failure: ProfileServiceFailure
    }>

export type ProfileGuiSaveSchedulerSnapshot<Projection, Context> = Readonly<{
  phase: 'idle' | 'submitting' | 'confirming' | 'uncertain' | 'conflict'
  acknowledgedRevision: number
  latestGeneration: number
  latestAcknowledgedGeneration: number
  confirmedGeneration?: number
  queuedGeneration?: number
  confirmingRevision?: number
  conflict?: Readonly<{
    generation: number
    currentRevision: number
    token: ProfileGuiSaveConflictToken
  }>
  rejected?: Readonly<{ generation: number; failure: ProfileServiceFailure }>
  inFlight?: Readonly<{ generation: number; request: ProfileGuiSaveRequest<Projection, Context> }>
}>

export type ProfileGuiSaveScheduler<Projection, Context> = Readonly<{
  schedule(projection: Projection, context: Context): number
  retryUncertain(): boolean
  resumeAfterConflict(
    token: ProfileGuiSaveConflictToken,
    reconciledGeneration: number,
    currentRevision: number,
    reconciledProjection: Projection,
    reconciledContext: Context,
  ): number
  flush(): Promise<ProfileGuiSaveFlushResult>
  inspect(): ProfileGuiSaveSchedulerSnapshot<Projection, Context>
}>

export type ProfileGuiSaveSchedulerOptions<Projection, Context> = Readonly<{
  initialRevision: number
  /**
   * Continues an earlier scheduler's generation count. Generations are the
   * session identity a renderer correlates its saves against, so a scheduler
   * that replaces another must resume the count instead of restarting it.
   */
  initialGeneration?: number
  createIdentity(): ProfileGuiSaveIdentity
  submit(request: ProfileGuiSaveRequest<Projection, Context>): Promise<ProfileGuiSaveSubmitResult>
  classifySubmitError?(error: unknown): ProfileServiceFailure | undefined
  confirmRevision(expectedRevision: number): Promise<ProfileGuiRevisionConfirmation>
  onStatus?(status: ProfileGuiSaveStatus): void
}>

type QueuedProjection<Projection, Context> = Readonly<{
  generation: number
  projection: Projection
  context: Context
}>

type InFlight<Projection, Context> = Readonly<{
  generation: number
  request: ProfileGuiSaveRequest<Projection, Context>
}>

/**
 * Serializes GUI generations without knowing their transport. The module owns
 * revision/identity timing and retry semantics. It captures renderer content and
 * owner context at enqueue; callers own native submission and confirmation.
 */
export function createProfileGuiSaveScheduler<Projection, Context>(
  options: ProfileGuiSaveSchedulerOptions<Projection, Context>,
): ProfileGuiSaveScheduler<Projection, Context> {
  if (!nonNegativeSafeInteger(options.initialRevision)) {
    throw new Error('Profile GUI save scheduler initial revision is invalid')
  }
  const initialGeneration = options.initialGeneration ?? 0
  if (!nonNegativeSafeInteger(initialGeneration)) {
    throw new Error('Profile GUI save scheduler initial generation is invalid')
  }

  let phase: ProfileGuiSaveSchedulerSnapshot<Projection, Context>['phase'] = 'idle'
  let acknowledgedRevision = options.initialRevision
  let latestGeneration = initialGeneration
  let latestAcknowledgedGeneration = initialGeneration
  let confirmedGeneration: number | undefined
  let confirmedRevision: number | undefined
  let queued: QueuedProjection<Projection, Context> | undefined
  let inFlight: InFlight<Projection, Context> | undefined
  let confirming: Readonly<{ generation: number; revision: number }> | undefined
  let uncertainConfirmation: Readonly<{ generation: number; revision: number }> | undefined
  let conflict: Readonly<{
    generation: number
    currentRevision: number
    token: ProfileGuiSaveConflictToken
  }> | undefined
  let rejected: Readonly<{ generation: number; failure: ProfileServiceFailure }> | undefined
  let stateVersion = 0
  const listeners = new Set<() => void>()

  const signal = () => {
    stateVersion += 1
    const pending = [...listeners]
    listeners.clear()
    pending.forEach((resolve) => resolve())
  }

  const emit = (status: ProfileGuiSaveStatus) => {
    try {
      options.onStatus?.(Object.freeze(status))
    } catch {
      // Status is observational. A renderer callback cannot break durability state.
    }
  }

  const markUncertain = (work?: InFlight<Projection, Context>, pendingGeneration?: number) => {
    phase = 'uncertain'
    if (work) inFlight = work
    const generation = work?.generation
      ?? pendingGeneration
      ?? uncertainConfirmation?.generation
      ?? latestAcknowledgedGeneration
    emit({ kind: 'uncertain', generation, acknowledgedRevision })
    signal()
  }

  const markConflict = (generation: number, currentRevision: number) => {
    phase = 'conflict'
    const token = Object.freeze({ generation, currentRevision }) as ProfileGuiSaveConflictToken
    conflict = Object.freeze({ generation, currentRevision, token })
    emit({ kind: 'conflict', generation, acknowledgedRevision, currentRevision, token })
    signal()
  }

  const markRejected = (
    work: InFlight<Projection, Context>,
    failure: ProfileServiceFailure,
  ) => {
    inFlight = undefined
    phase = 'idle'
    rejected = Object.freeze({ generation: work.generation, failure })
    emit({ kind: 'rejected', generation: work.generation, acknowledgedRevision, failure })
    signal()
    if (queued) pump()
  }

  const startConfirmation = (generation: number, revision: number) => {
    if (phase !== 'idle') return
    phase = 'confirming'
    confirming = Object.freeze({ generation, revision })
    uncertainConfirmation = undefined
    signal()
    void (async () => {
      let observed: ProfileGuiRevisionConfirmation
      try {
        observed = await options.confirmRevision(revision)
      } catch {
        if (phase !== 'confirming' || confirming?.revision !== revision) return
        uncertainConfirmation = confirming
        confirming = undefined
        markUncertain()
        return
      }
      if (phase !== 'confirming' || confirming?.revision !== revision) return
      confirming = undefined
      if (!exactConfirmation(observed)) {
        uncertainConfirmation = Object.freeze({ generation, revision })
        markUncertain()
        return
      }
      if (observed.revision !== revision) {
        markConflict(generation, observed.revision)
        return
      }
      confirmedGeneration = generation
      confirmedRevision = revision
      phase = 'idle'
      signal()
      if (!queued && !inFlight
        && latestGeneration === generation
        && latestAcknowledgedGeneration === generation) {
        emit({ kind: 'saved', generation, revision })
      }
      pump()
    })()
  }

  const completeSubmission = async (work: InFlight<Projection, Context>): Promise<void> => {
    let result: ProfileGuiSaveSubmitResult
    try {
      result = await options.submit(work.request)
    } catch (error) {
      if (phase !== 'submitting' || inFlight !== work) return
      let classified: ProfileServiceFailure | undefined
      try {
        classified = normalizeProfileServiceFailure(options.classifySubmitError?.(error))
      } catch {
        // A classifier is observational. If it fails, the submit outcome remains unknown.
      }
      if (classified) settleFailure(work, classified)
      else markUncertain(work)
      return
    }
    if (phase !== 'submitting' || inFlight !== work) return
    if (!isPlainRecord(result)) {
      markUncertain(work)
      return
    }
    const resultOk = ownEnumerableDataValue(Object.getOwnPropertyDescriptor(result, 'ok'))
    if (resultOk !== true && resultOk !== false) {
      markUncertain(work)
      return
    }
    if (!resultOk) {
      const failure = normalizeProfileServiceFailure(result)
      if (failure) settleFailure(work, failure)
      else markUncertain(work)
      return
    }
    const revision = ownEnumerableDataValue(Object.getOwnPropertyDescriptor(result, 'revision'))
    if (work.request.expectedRevision >= Number.MAX_SAFE_INTEGER
      || !nonNegativeSafeInteger(revision)
      || revision !== work.request.expectedRevision + 1) {
      markUncertain(work)
      return
    }

    acknowledgedRevision = revision
    latestAcknowledgedGeneration = work.generation
    inFlight = undefined
    rejected = undefined
    phase = 'idle'
    signal()
    if (queued) pump()
    else startConfirmation(work.generation, revision)
  }

  const settleFailure = (
    work: InFlight<Projection, Context>,
    failure: ProfileServiceFailure,
  ): void => {
    switch (failure.code) {
      case 'conflict':
        if (!nonNegativeSafeInteger(failure.currentRevision)
          || failure.currentRevision <= work.request.expectedRevision) {
          markUncertain(work)
          return
        }
        markConflict(work.generation, failure.currentRevision)
        return
      case 'internal':
        // Internal failures can straddle the commit boundary. Preserve the exact
        // identity until native confirmation can establish the outcome.
        markUncertain(work)
        return
      case 'busy':
      case 'unsupported-future-version':
      case 'invalid':
      case 'not-found':
      case 'corrupt-or-recovery-required':
      case 'capability-denied':
      case 'idea-remap-too-large':
        markRejected(work, failure)
        return
      default:
        assertNever(failure.code)
    }
  }

  const pump = () => {
    if (phase !== 'idle' || inFlight || !queued) return
    const next = queued
    let identity: ProfileGuiSaveIdentity
    try {
      identity = options.createIdentity()
      if (!nonEmptyString(identity.clientTxnId)
        || !nonEmptyString(identity.idempotencyKey)
        || !canonicalTimestamp(identity.committedAt)) {
        throw new Error('invalid identity')
      }
    } catch {
      markUncertain(undefined, next.generation)
      return
    }
    queued = undefined
    const request = Object.freeze({
      generation: next.generation,
      expectedRevision: acknowledgedRevision,
      clientTxnId: identity.clientTxnId,
      idempotencyKey: identity.idempotencyKey,
      committedAt: identity.committedAt,
      context: next.context,
      projection: next.projection,
    })
    const work = Object.freeze({ generation: next.generation, request })
    inFlight = work
    phase = 'submitting'
    emit({ kind: 'saving', generation: work.generation })
    signal()
    void completeSubmission(work)
  }

  const waitForChange = (observedVersion: number): Promise<void> => {
    if (stateVersion !== observedVersion) return Promise.resolve()
    return new Promise((resolve) => listeners.add(resolve))
  }

  const inspect = (): ProfileGuiSaveSchedulerSnapshot<Projection, Context> => Object.freeze({
    phase,
    acknowledgedRevision,
    latestGeneration,
    latestAcknowledgedGeneration,
    ...(confirmedGeneration === undefined ? {} : { confirmedGeneration }),
    ...(queued ? { queuedGeneration: queued.generation } : {}),
    ...(confirming ? { confirmingRevision: confirming.revision } : {}),
    ...(conflict ? { conflict } : {}),
    ...(rejected ? { rejected } : {}),
    ...(inFlight ? { inFlight: Object.freeze({ generation: inFlight.generation, request: inFlight.request }) } : {}),
  })

  const flush = async (): Promise<ProfileGuiSaveFlushResult> => {
    while (true) {
      if (phase === 'uncertain') {
        return Object.freeze({
          ok: false,
          kind: 'uncertain',
          generation: inFlight?.generation
            ?? queued?.generation
            ?? uncertainConfirmation?.generation
            ?? latestAcknowledgedGeneration,
          acknowledgedRevision,
        })
      }
      if (phase === 'conflict') {
        if (!conflict) {
          markUncertain(inFlight, latestGeneration)
          continue
        }
        return Object.freeze({
          ok: false,
          kind: 'conflict',
          generation: conflict.generation,
          acknowledgedRevision,
          currentRevision: conflict.currentRevision,
          token: conflict.token,
        })
      }
      if (phase === 'idle' && !queued && !inFlight) {
        if (rejected?.generation === latestGeneration) {
          return Object.freeze({
            ok: false,
            kind: 'rejected',
            generation: rejected.generation,
            acknowledgedRevision,
            failure: rejected.failure,
          })
        }
        if (latestAcknowledgedGeneration === latestGeneration
          && confirmedGeneration === latestGeneration
          && confirmedRevision === acknowledgedRevision) {
          return Object.freeze({
            ok: true,
            generation: latestGeneration,
            revision: acknowledgedRevision,
          })
        }
        startConfirmation(latestAcknowledgedGeneration, acknowledgedRevision)
        continue
      }
      const observedVersion = stateVersion
      await waitForChange(observedVersion)
    }
  }

  return Object.freeze({
    schedule(projection: Projection, context: Context) {
      const captured = captureProfileGuiInertJson(projection, '$projection')
      const capturedContext = captureProfileGuiInertJson(context, '$context')
      latestGeneration += 1
      rejected = undefined
      queued = Object.freeze({
        generation: latestGeneration,
        projection: captured,
        context: capturedContext,
      })
      signal()
      pump()
      return latestGeneration
    },
    retryUncertain() {
      if (phase !== 'uncertain') return false
      if (inFlight) {
        phase = 'submitting'
        emit({ kind: 'saving', generation: inFlight.generation })
        signal()
        void completeSubmission(inFlight)
        return true
      }
      if (uncertainConfirmation) {
        const pending = uncertainConfirmation
        phase = 'idle'
        signal()
        startConfirmation(pending.generation, pending.revision)
        return true
      }
      if (queued) {
        phase = 'idle'
        signal()
        pump()
        return true
      }
      return false
    },
    resumeAfterConflict(
      token: ProfileGuiSaveConflictToken,
      reconciledGeneration: number,
      currentRevision: number,
      reconciledProjection: Projection,
      reconciledContext: Context,
    ) {
      if (phase !== 'conflict'
        || !conflict
        || token !== conflict.token
        || reconciledGeneration !== latestGeneration
        || !nonNegativeSafeInteger(currentRevision)
        || currentRevision < Math.max(conflict.currentRevision, acknowledgedRevision)) {
        throw new Error('Profile GUI save conflict requires the active token, latest generation, and current revision')
      }
      const captured = captureProfileGuiInertJson(reconciledProjection, '$projection')
      const capturedContext = captureProfileGuiInertJson(reconciledContext, '$context')
      acknowledgedRevision = currentRevision
      inFlight = undefined
      queued = undefined
      confirming = undefined
      uncertainConfirmation = undefined
      conflict = undefined
      rejected = undefined
      confirmedGeneration = undefined
      confirmedRevision = undefined
      phase = 'idle'
      latestGeneration += 1
      queued = Object.freeze({
        generation: latestGeneration,
        projection: captured,
        context: capturedContext,
      })
      signal()
      pump()
      return latestGeneration
    },
    flush,
    inspect,
  })
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0)
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function exactConfirmation(value: unknown): value is ProfileGuiRevisionConfirmation {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Object.keys(descriptors)
  if (keys.length !== 3 || !['revision', 'durable', 'dirty'].every((key) => key in descriptors)) {
    return false
  }
  if (keys.some((key) => !descriptors[key]?.enumerable || !('value' in descriptors[key]!))) {
    return false
  }
  return nonNegativeSafeInteger(descriptors.revision!.value)
    && descriptors.durable!.value === true
    && descriptors.dirty!.value === false
}

const PROFILE_GUI_CAPTURE_MAX_DEPTH = 64
/**
 * Runaway guard, not a Profile size budget. A Board's node count grows with the
 * work in it, so a limit tuned to "a big Board today" becomes a Board that
 * cannot save at all a few weeks later. The real ceiling on one capture is
 * `PROFILE_GUI_CAPTURE_MAX_BYTES`; this bound only exists so a cyclic or
 * generated structure cannot schedule unbounded traversal work before the byte
 * accounting notices. It sits well under the ~32M nodes the byte cap could
 * admit at the 4-byte minimum node cost.
 */
const PROFILE_GUI_CAPTURE_MAX_NODES = 10_000_000
export const PROFILE_GUI_CAPTURE_MAX_BYTES = 128 * 1024 * 1024

export class ProfileGuiJsonCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileGuiJsonCaptureError'
  }
}

type ProfileGuiJsonVisit = Readonly<{
  kind: 'visit'
  value: unknown
  path: string
  depth: number
}>

type ProfileGuiJsonLeave = Readonly<{
  kind: 'leave'
  value: object
}>

/**
 * Captures one renderer/native seam value without invoking candidate code.
 * Traversal and freezing are iterative, and the admitted JSON graph is bounded
 * before stringify/parse allocates its detached copy.
 */
export function captureProfileGuiInertJson<Value>(
  value: Value,
  path: string,
  maxBytes: number = PROFILE_GUI_CAPTURE_MAX_BYTES,
): Value {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new ProfileGuiJsonCaptureError('Profile GUI save byte limit is invalid')
  }
  const stack: Array<ProfileGuiJsonVisit | ProfileGuiJsonLeave> = [{
    kind: 'visit',
    value,
    path,
    depth: 0,
  }]
  const ancestors = new WeakSet<object>()
  let scheduledNodes = 1
  let bytes = 0

  const addBytes = (additional: number, candidatePath: string) => {
    bytes += additional
    if (bytes > maxBytes) {
      throw new ProfileGuiJsonCaptureError(
        `Profile GUI save ${candidatePath} exceeds the ${maxBytes}-byte capture limit`,
      )
    }
  }

  const admitChildren = (count: number, candidatePath: string) => {
    if (scheduledNodes + count > PROFILE_GUI_CAPTURE_MAX_NODES) {
      throw new ProfileGuiJsonCaptureError(
        `Profile GUI save ${candidatePath} exceeds the ${PROFILE_GUI_CAPTURE_MAX_NODES}-node capture limit`,
      )
    }
    scheduledNodes += count
  }

  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.kind === 'leave') {
      ancestors.delete(frame.value)
      continue
    }
    if (frame.depth > PROFILE_GUI_CAPTURE_MAX_DEPTH) {
      throw new ProfileGuiJsonCaptureError(
        `Profile GUI save ${frame.path} exceeds the ${PROFILE_GUI_CAPTURE_MAX_DEPTH}-level capture depth`,
      )
    }

    const candidate = frame.value
    if (candidate === null) {
      addBytes(4, frame.path)
      continue
    }
    if (typeof candidate === 'boolean') {
      addBytes(candidate ? 4 : 5, frame.path)
      continue
    }
    if (typeof candidate === 'string') {
      addBytes(jsonStringUtf8Bytes(candidate), frame.path)
      continue
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) {
        throw new ProfileGuiJsonCaptureError(`Profile GUI save ${frame.path} contains a lossy JSON number`)
      }
      addBytes(String(candidate).length, frame.path)
      continue
    }
    if (typeof candidate !== 'object') {
      throw new ProfileGuiJsonCaptureError(`Profile GUI save ${frame.path} contains a non-JSON value`)
    }
    if (ancestors.has(candidate)) {
      throw new ProfileGuiJsonCaptureError(`Profile GUI save ${frame.path} contains a cycle`)
    }
    ancestors.add(candidate)
    stack.push({ kind: 'leave', value: candidate })

    if (Array.isArray(candidate)) {
      if (Object.getPrototypeOf(candidate) !== Array.prototype) {
        throw new ProfileGuiJsonCaptureError(
          `Profile GUI save ${frame.path} has a non-standard array prototype`,
        )
      }
      if (Object.getOwnPropertySymbols(candidate).length > 0) {
        throw new ProfileGuiJsonCaptureError(`Profile GUI save ${frame.path} contains a symbol key`)
      }
      admitChildren(candidate.length, frame.path)
      const names = Object.getOwnPropertyNames(candidate)
      if (names.length !== candidate.length + 1
        || names.some((name) => name !== 'length'
          && (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= candidate.length))) {
        throw new ProfileGuiJsonCaptureError(
          `Profile GUI save ${frame.path} contains a sparse or extended array`,
        )
      }
      addBytes(2 + Math.max(0, candidate.length - 1), frame.path)
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index))
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new ProfileGuiJsonCaptureError(
            `Profile GUI save ${frame.path}[${index}] is not inert JSON data`,
          )
        }
        stack.push({
          kind: 'visit',
          value: descriptor.value,
          path: `${frame.path}[${index}]`,
          depth: frame.depth + 1,
        })
      }
      continue
    }

    if (!isPlainRecord(candidate)) {
      throw new ProfileGuiJsonCaptureError(`Profile GUI save ${frame.path} contains a non-plain object`)
    }
    if (Object.getOwnPropertySymbols(candidate).length > 0) {
      throw new ProfileGuiJsonCaptureError(`Profile GUI save ${frame.path} contains a symbol key`)
    }
    const keys = Object.getOwnPropertyNames(candidate)
    admitChildren(keys.length, frame.path)
    addBytes(2 + Math.max(0, keys.length - 1), frame.path)
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new ProfileGuiJsonCaptureError(
          `Profile GUI save ${frame.path}.${key} is not inert JSON data`,
        )
      }
      addBytes(jsonStringUtf8Bytes(key) + 1, frame.path)
      const childPath = appendProfileGuiCapturePath(frame.path, key)
      stack.push({
        kind: 'visit',
        value: descriptor.value,
        path: childPath,
        depth: frame.depth + 1,
      })
    }
  }

  const captured = JSON.parse(JSON.stringify(value)) as Value
  return freezeJsonIteratively(captured)
}

function appendProfileGuiCapturePath(path: string, key: string): string {
  const segment = key.length <= 80 ? key : `${key.slice(0, 77)}...`
  return `${path}.${segment}`
}

function jsonStringUtf8Bytes(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      bytes += 2
    } else if (codeUnit <= 0x1f) {
      bytes += codeUnit === 0x08
        || codeUnit === 0x09
        || codeUnit === 0x0a
        || codeUnit === 0x0c
        || codeUnit === 0x0d
        ? 2
        : 6
    } else if (codeUnit <= 0x7f) {
      bytes += 1
    } else if (codeUnit <= 0x7ff) {
      bytes += 2
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 6
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

function freezeJsonIteratively<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null) return value
  const stack: object[] = [value]
  while (stack.length > 0) {
    const candidate = stack.pop()!
    for (const child of Object.values(candidate)) {
      if (typeof child === 'object' && child !== null && !Object.isFrozen(child)) stack.push(child)
    }
    Object.freeze(candidate)
  }
  return value
}

function normalizeProfileServiceFailure(value: unknown): ProfileServiceFailure | undefined {
  if (!isPlainRecord(value)) return undefined
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const ok = ownEnumerableDataValue(descriptors.ok)
  const rawCode = ownEnumerableDataValue(descriptors.code)
  const currentRevision = ownEnumerableDataValue(descriptors.currentRevision)
  if (ok !== false || typeof rawCode !== 'string') return undefined
  if (!(PROFILE_SERVICE_ERROR_CODES as readonly string[]).includes(rawCode)) return undefined
  const code = rawCode as ProfileServiceErrorCode
  if (currentRevision !== undefined && !nonNegativeSafeInteger(currentRevision)) return undefined
  return Object.freeze(profileServiceFailure(code, {
    ...(currentRevision === undefined ? {} : { currentRevision }),
  }))
}

function ownEnumerableDataValue(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : undefined
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Profile service failure code: ${String(value)}`)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
