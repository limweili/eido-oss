import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  PROFILE_LIVE_GATEWAY_CONNECTION_CLOSE,
  PROFILE_LIVE_GATEWAY_TERMINAL_FRAME,
  ProfileLiveGatewayStreamReader,
  encodeProfileLiveGatewayConnectionClose,
  encodeProfileLiveGatewayTerminalFrame,
  writeProfileLiveGatewayBytes,
} from './profileLiveGatewayStream'

describe('Profile Live Gateway framed stream', () => {
  it('reassembles split frames without crossing message boundaries', async () => {
    const source = new PassThrough()
    const reader = new ProfileLiveGatewayStreamReader(source, {
      maxPayloadBytes: 8,
      allowConnectionControls: true,
    })
    source.write(Uint8Array.of(0, 0))
    source.write(Uint8Array.of(0, 0, 0, 0, 0, 3, 1))
    source.end(Uint8Array.of(2, 3, 0xff, 0xff, 0xff, 0xff))

    await expect(reader.read()).resolves.toEqual({ kind: 'connection-open' })
    await expect(reader.read()).resolves.toEqual({
      kind: 'frame',
      frame: Uint8Array.of(0, 0, 0, 3, 1, 2, 3),
    })
    await expect(reader.read()).resolves.toEqual({ kind: 'connection-close' })
    await expect(reader.read()).resolves.toBeUndefined()
  })

  it('rejects controls in a client response stream and partial EOF', async () => {
    const controlled = new ProfileLiveGatewayStreamReader(
      readable(Uint8Array.of(0, 0, 0, 0)),
      { maxPayloadBytes: 8 },
    )
    await expect(controlled.read()).rejects.toThrow('control')

    const partial = new ProfileLiveGatewayStreamReader(
      readable(Uint8Array.of(0, 0, 0, 2, 1)),
      { maxPayloadBytes: 8 },
    )
    await expect(partial.read()).rejects.toThrow('partial')
  })

  it('rejects oversized frames before reading their payload', async () => {
    const reader = new ProfileLiveGatewayStreamReader(
      readable(Uint8Array.of(0, 0, 0, 9)),
      { maxPayloadBytes: 8 },
    )
    await expect(reader.read()).rejects.toThrow('exceeded')
  })

  it('writes complete frames and exposes the helper close control', async () => {
    const sink = new PassThrough()
    const received: Uint8Array[] = []
    sink.on('data', (chunk: Uint8Array) => received.push(Uint8Array.from(chunk)))

    await writeProfileLiveGatewayBytes(sink, Uint8Array.of(1, 2, 3))
    expect(Uint8Array.from(Buffer.concat(received.map((chunk) => Buffer.from(chunk))))).toEqual(
      Uint8Array.of(1, 2, 3),
    )
    expect(encodeProfileLiveGatewayConnectionClose()).toEqual(
      PROFILE_LIVE_GATEWAY_CONNECTION_CLOSE,
    )
    expect(encodeProfileLiveGatewayConnectionClose()).not.toBe(
      PROFILE_LIVE_GATEWAY_CONNECTION_CLOSE,
    )
  })

  it('prefixes an explicit terminal response with the native close-after-frame control', () => {
    const frame = Uint8Array.of(0, 0, 0, 2, 1, 2)

    expect(encodeProfileLiveGatewayTerminalFrame(frame)).toEqual(Uint8Array.of(
      ...PROFILE_LIVE_GATEWAY_TERMINAL_FRAME,
      ...frame,
    ))
  })
})

async function* readable(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) yield chunk
}
