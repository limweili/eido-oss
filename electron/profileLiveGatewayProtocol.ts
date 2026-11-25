export const PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION = 1 as const

export const PROFILE_LIVE_GATEWAY_LIMITS = Object.freeze({
  maxHandshakePayloadBytes: 4 * 1024,
  maxGatewayPayloadBytes: 512 * 1024,
  maxClientBytes: 128,
  maxSessionIdBytes: 128,
})

const PROFILE_LIVE_GATEWAY_GENERATION = /^[a-f0-9]{32}$/
const PROFILE_LIVE_GATEWAY_TOKEN = /^[a-f0-9]{64}$/
const UNSAFE_HANDSHAKE_TEXT = /[\u0000-\u001f\u007f]/
const FRAME_HEADER_BYTES = 4
const UINT32_MAX = 0xffff_ffff

export type ProfileLiveGatewayFrameFailureCode =
  | 'invalid-frame'
  | 'frame-too-large'
  | 'invalid-utf8'
  | 'invalid-json'

export type ProfileLiveGatewayFrameResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; code: ProfileLiveGatewayFrameFailureCode }>

export type ProfileLiveGatewayHello = Readonly<{
  version: typeof PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION
  kind: 'hello'
  generation: string
  token: string
  client: string
  sessionId: string
}>

export type ProfileLiveGatewayReady = Readonly<{
  version: typeof PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION
  kind: 'ready'
  generation: string
}>

export type ProfileLiveGatewayDenied = Readonly<{
  version: typeof PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION
  kind: 'denied'
  generation: string
  reason: 'token-rejected'
}>

export function encodeProfileLiveGatewayFrame(
  candidate: unknown,
  maxPayloadBytes: number,
): ProfileLiveGatewayFrameResult<Uint8Array> {
  requireFrameLimit(maxPayloadBytes)
  let json: string | undefined
  try {
    json = JSON.stringify(candidate)
  } catch {
    return failure('invalid-json')
  }
  if (json === undefined) return failure('invalid-json')
  const payload = new TextEncoder().encode(json)
  if (payload.byteLength === 0) return failure('invalid-json')
  if (payload.byteLength > maxPayloadBytes) return failure('frame-too-large')
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength)
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false)
  frame.set(payload, FRAME_HEADER_BYTES)
  return Object.freeze({ ok: true as const, value: frame })
}

export function decodeProfileLiveGatewayFrame(
  frame: Uint8Array,
  maxPayloadBytes: number,
): ProfileLiveGatewayFrameResult<unknown> {
  requireFrameLimit(maxPayloadBytes)
  if (!(frame instanceof Uint8Array) || frame.byteLength < FRAME_HEADER_BYTES) {
    return failure('invalid-frame')
  }
  const payloadLength = new DataView(
    frame.buffer,
    frame.byteOffset,
    FRAME_HEADER_BYTES,
  ).getUint32(0, false)
  if (payloadLength === 0) return failure('invalid-frame')
  if (payloadLength > maxPayloadBytes) return failure('frame-too-large')
  if (frame.byteLength !== FRAME_HEADER_BYTES + payloadLength) {
    return failure('invalid-frame')
  }
  let json: string
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(frame.subarray(FRAME_HEADER_BYTES))
  } catch {
    return failure('invalid-utf8')
  }
  try {
    return Object.freeze({ ok: true as const, value: JSON.parse(json) as unknown })
  } catch {
    return failure('invalid-json')
  }
}

export function createProfileLiveGatewayHello(input: Readonly<{
  generation: string
  token: string
  client: string
  sessionId: string
}>): ProfileLiveGatewayHello {
  const hello = Object.freeze({
    version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
    kind: 'hello' as const,
    generation: input.generation,
    token: input.token,
    client: input.client,
    sessionId: input.sessionId,
  })
  const parsed = parseProfileLiveGatewayHello(hello)
  if (!parsed) throw new Error('Live Gateway handshake identity is invalid')
  return parsed
}

export function parseProfileLiveGatewayHello(
  candidate: unknown,
): ProfileLiveGatewayHello | undefined {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, [
      'version',
      'kind',
      'generation',
      'token',
      'client',
      'sessionId',
    ])
    || candidate.version !== PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION
    || candidate.kind !== 'hello'
    || typeof candidate.generation !== 'string'
    || !PROFILE_LIVE_GATEWAY_GENERATION.test(candidate.generation)
    || typeof candidate.token !== 'string'
    || !PROFILE_LIVE_GATEWAY_TOKEN.test(candidate.token)
    || !boundedHandshakeText(candidate.client, PROFILE_LIVE_GATEWAY_LIMITS.maxClientBytes)
    || !boundedHandshakeText(
      candidate.sessionId,
      PROFILE_LIVE_GATEWAY_LIMITS.maxSessionIdBytes,
    )) {
    return undefined
  }
  return Object.freeze({
    version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
    kind: 'hello',
    generation: candidate.generation,
    token: candidate.token,
    client: candidate.client,
    sessionId: candidate.sessionId,
  })
}

export function createProfileLiveGatewayReady(generation: string): ProfileLiveGatewayReady {
  if (!PROFILE_LIVE_GATEWAY_GENERATION.test(generation)) {
    throw new Error('Live Gateway generation is invalid')
  }
  return Object.freeze({
    version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
    kind: 'ready',
    generation,
  })
}

export function parseProfileLiveGatewayReady(
  candidate: unknown,
  expectedGeneration: string,
): ProfileLiveGatewayReady | undefined {
  if (!PROFILE_LIVE_GATEWAY_GENERATION.test(expectedGeneration)
    || !isRecord(candidate)
    || !hasExactKeys(candidate, ['version', 'kind', 'generation'])
    || candidate.version !== PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION
    || candidate.kind !== 'ready'
    || candidate.generation !== expectedGeneration) {
    return undefined
  }
  return Object.freeze({
    version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
    kind: 'ready',
    generation: expectedGeneration,
  })
}

export function createProfileLiveGatewayDenied(
  generation: string,
): ProfileLiveGatewayDenied {
  if (!PROFILE_LIVE_GATEWAY_GENERATION.test(generation)) {
    throw new Error('Live Gateway generation is invalid')
  }
  return Object.freeze({
    version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
    kind: 'denied',
    generation,
    reason: 'token-rejected',
  })
}

export function parseProfileLiveGatewayDenied(
  candidate: unknown,
  expectedGeneration: string,
): ProfileLiveGatewayDenied | undefined {
  if (!PROFILE_LIVE_GATEWAY_GENERATION.test(expectedGeneration)
    || !isRecord(candidate)
    || !hasExactKeys(candidate, ['version', 'kind', 'generation', 'reason'])
    || candidate.version !== PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION
    || candidate.kind !== 'denied'
    || candidate.generation !== expectedGeneration
    || candidate.reason !== 'token-rejected') {
    return undefined
  }
  return Object.freeze({
    version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
    kind: 'denied',
    generation: expectedGeneration,
    reason: 'token-rejected',
  })
}

function boundedHandshakeText(candidate: unknown, maxBytes: number): candidate is string {
  return typeof candidate === 'string'
    && candidate.length > 0
    && !UNSAFE_HANDSHAKE_TEXT.test(candidate)
    && new TextEncoder().encode(candidate).byteLength <= maxBytes
}

function requireFrameLimit(maxPayloadBytes: number): void {
  if (!Number.isSafeInteger(maxPayloadBytes)
    || maxPayloadBytes <= 0
    || maxPayloadBytes > UINT32_MAX) {
    throw new Error('Live Gateway frame limit is invalid')
  }
}

function failure(code: ProfileLiveGatewayFrameFailureCode) {
  return Object.freeze({ ok: false as const, code })
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate)
  return keys.length === expected.length && expected.every((key) => (
    Object.prototype.hasOwnProperty.call(candidate, key)
  ))
}
