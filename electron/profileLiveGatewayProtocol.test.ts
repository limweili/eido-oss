import { describe, expect, it } from 'vitest'
import {
  PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
  createProfileLiveGatewayDenied,
  createProfileLiveGatewayHello,
  createProfileLiveGatewayReady,
  decodeProfileLiveGatewayFrame,
  encodeProfileLiveGatewayFrame,
  parseProfileLiveGatewayDenied,
  parseProfileLiveGatewayHello,
  parseProfileLiveGatewayReady,
} from './profileLiveGatewayProtocol'

const generation = '0123456789abcdef0123456789abcdef'
const token = 'ab'.repeat(32)

describe('live Profile Gateway framing contract', () => {
  it('round-trips one exact length-prefixed JSON value', () => {
    const value = {
      version: 1,
      requestId: 'live-request',
      operation: 'profile.status',
      params: {},
    }

    const encoded = encodeProfileLiveGatewayFrame(value, 512 * 1024)

    expect(encoded.ok).toBe(true)
    if (!encoded.ok) throw new Error('Expected encoded frame')
    const payloadLength = new DataView(
      encoded.value.buffer,
      encoded.value.byteOffset,
      4,
    ).getUint32(0, false)
    expect(payloadLength).toBe(encoded.value.byteLength - 4)
    expect(decodeProfileLiveGatewayFrame(encoded.value, 512 * 1024)).toEqual({
      ok: true,
      value,
    })
  })

  it('rejects oversized, empty, truncated, trailing, non-UTF-8, and non-JSON frames', () => {
    const oversized = new Uint8Array(4)
    new DataView(oversized.buffer).setUint32(0, 65, false)
    expect(decodeProfileLiveGatewayFrame(oversized, 64)).toEqual({
      ok: false,
      code: 'frame-too-large',
    })

    const empty = new Uint8Array(4)
    expect(decodeProfileLiveGatewayFrame(empty, 64)).toEqual({
      ok: false,
      code: 'invalid-frame',
    })

    const valid = encodeProfileLiveGatewayFrame({ ok: true }, 64)
    if (!valid.ok) throw new Error('Expected valid frame')
    expect(decodeProfileLiveGatewayFrame(valid.value.subarray(0, -1), 64)).toEqual({
      ok: false,
      code: 'invalid-frame',
    })
    expect(decodeProfileLiveGatewayFrame(
      Uint8Array.from([...valid.value, 0]),
      64,
    )).toEqual({ ok: false, code: 'invalid-frame' })

    expect(decodeProfileLiveGatewayFrame(frameFor(Uint8Array.of(0xff)), 64)).toEqual({
      ok: false,
      code: 'invalid-utf8',
    })
    expect(decodeProfileLiveGatewayFrame(
      frameFor(new TextEncoder().encode('{')),
      64,
    )).toEqual({ ok: false, code: 'invalid-json' })

    expect(encodeProfileLiveGatewayFrame('x'.repeat(65), 64)).toEqual({
      ok: false,
      code: 'frame-too-large',
    })
    expect(encodeProfileLiveGatewayFrame(undefined, 64)).toEqual({
      ok: false,
      code: 'invalid-json',
    })
  })
})

describe('live Profile Gateway handshake contract', () => {
  it('binds launch generation, token, client label, and session outside Gateway JSON', () => {
    const hello = createProfileLiveGatewayHello({
      generation,
      token,
      client: 'claude-code',
      sessionId: 'session-01234567-89ab-cdef',
    })
    const ready = createProfileLiveGatewayReady(generation)

    expect(hello).toEqual({
      version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
      kind: 'hello',
      generation,
      token,
      client: 'claude-code',
      sessionId: 'session-01234567-89ab-cdef',
    })
    expect(parseProfileLiveGatewayHello(hello)).toEqual(hello)
    expect(ready).toEqual({
      version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
      kind: 'ready',
      generation,
    })
    expect(parseProfileLiveGatewayReady(ready, generation)).toEqual(ready)
  })

  it('makes a pre-admission token denial explicit and generation-bound', () => {
    const denied = createProfileLiveGatewayDenied(generation)

    expect(denied).toEqual({
      version: PROFILE_LIVE_GATEWAY_PROTOCOL_VERSION,
      kind: 'denied',
      generation,
      reason: 'token-rejected',
    })
    expect(parseProfileLiveGatewayDenied(denied, generation)).toEqual(denied)
    expect(parseProfileLiveGatewayDenied(
      denied,
      'fedcba9876543210fedcba9876543210',
    )).toBeUndefined()
    expect(parseProfileLiveGatewayDenied({ ...denied, reason: 'peer-rejected' }, generation))
      .toBeUndefined()
  })

  it('rejects attribution injection, stale generation, malformed secrets, and unsafe labels', () => {
    const hello = createProfileLiveGatewayHello({
      generation,
      token,
      client: 'codex',
      sessionId: 'session-1',
    })

    for (const candidate of [
      { ...hello, actor: { kind: 'user' } },
      { ...hello, generation: 'stale' },
      { ...hello, token: 'short' },
      { ...hello, client: '' },
      { ...hello, client: 'unsafe\nlabel' },
      { ...hello, sessionId: 'x'.repeat(129) },
      { ...hello, version: 2 },
    ]) {
      expect(parseProfileLiveGatewayHello(candidate)).toBeUndefined()
    }

    expect(parseProfileLiveGatewayReady(
      createProfileLiveGatewayReady(generation),
      'fedcba9876543210fedcba9876543210',
    )).toBeUndefined()
  })
})

function frameFor(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + payload.byteLength)
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false)
  frame.set(payload, 4)
  return frame
}
