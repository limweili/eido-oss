import type { Writable } from 'node:stream'

const FRAME_HEADER_BYTES = 4
const CONNECTION_OPEN_LENGTH = 0
const CONNECTION_CLOSE_LENGTH = 0xffff_ffff
const TERMINAL_FRAME_LENGTH = 0xffff_fffe

export const PROFILE_LIVE_GATEWAY_CONNECTION_CLOSE = Uint8Array.of(0, 0, 0, 0)
export const PROFILE_LIVE_GATEWAY_TERMINAL_FRAME = Uint8Array.of(0xff, 0xff, 0xff, 0xfe)

export type ProfileLiveGatewayStreamMessage =
  | Readonly<{ kind: 'connection-open' }>
  | Readonly<{ kind: 'connection-close' }>
  | Readonly<{ kind: 'frame'; frame: Uint8Array }>

export class ProfileLiveGatewayStreamReader {
  readonly #iterator: AsyncIterator<Uint8Array>
  readonly #maxPayloadBytes: number
  readonly #allowConnectionControls: boolean
  #buffer = new Uint8Array(0)
  #ended = false

  constructor(
    source: AsyncIterable<Uint8Array>,
    options: Readonly<{
      maxPayloadBytes: number
      allowConnectionControls?: boolean
    }>,
  ) {
    if (!Number.isSafeInteger(options.maxPayloadBytes)
      || options.maxPayloadBytes <= 0
      || options.maxPayloadBytes >= CONNECTION_CLOSE_LENGTH) {
      throw new Error('Profile Live Gateway stream frame limit is invalid')
    }
    this.#iterator = source[Symbol.asyncIterator]()
    this.#maxPayloadBytes = options.maxPayloadBytes
    this.#allowConnectionControls = options.allowConnectionControls === true
  }

  async read(): Promise<ProfileLiveGatewayStreamMessage | undefined> {
    if (!(await this.#fill(FRAME_HEADER_BYTES))) {
      if (this.#buffer.byteLength > 0) {
        throw new Error('Profile Live Gateway stream ended with a partial frame header')
      }
      return undefined
    }
    const payloadLength = new DataView(
      this.#buffer.buffer,
      this.#buffer.byteOffset,
      FRAME_HEADER_BYTES,
    ).getUint32(0, false)
    if (payloadLength === CONNECTION_OPEN_LENGTH || payloadLength === CONNECTION_CLOSE_LENGTH) {
      if (!this.#allowConnectionControls) {
        throw new Error('Profile Live Gateway stream contained an unexpected connection control')
      }
      this.#consume(FRAME_HEADER_BYTES)
      return Object.freeze({
        kind: payloadLength === CONNECTION_OPEN_LENGTH
          ? 'connection-open' as const
          : 'connection-close' as const,
      })
    }
    if (payloadLength > this.#maxPayloadBytes) {
      throw new Error('Profile Live Gateway stream frame exceeded its byte limit')
    }
    const frameLength = FRAME_HEADER_BYTES + payloadLength
    if (!(await this.#fill(frameLength))) {
      throw new Error('Profile Live Gateway stream ended with a partial frame payload')
    }
    const frame = this.#buffer.slice(0, frameLength)
    this.#consume(frameLength)
    return Object.freeze({ kind: 'frame' as const, frame })
  }

  async #fill(requiredBytes: number): Promise<boolean> {
    while (this.#buffer.byteLength < requiredBytes && !this.#ended) {
      const next = await this.#iterator.next()
      if (next.done) {
        this.#ended = true
        break
      }
      if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0) continue
      const combined = new Uint8Array(this.#buffer.byteLength + next.value.byteLength)
      combined.set(this.#buffer)
      combined.set(next.value, this.#buffer.byteLength)
      this.#buffer = combined
    }
    return this.#buffer.byteLength >= requiredBytes
  }

  #consume(byteLength: number): void {
    this.#buffer = this.#buffer.slice(byteLength)
  }
}

export function encodeProfileLiveGatewayConnectionClose(): Uint8Array {
  return Uint8Array.from(PROFILE_LIVE_GATEWAY_CONNECTION_CLOSE)
}

export function encodeProfileLiveGatewayTerminalFrame(frame: Uint8Array): Uint8Array {
  if (!(frame instanceof Uint8Array) || frame.byteLength <= FRAME_HEADER_BYTES) {
    throw new Error('Profile Live Gateway terminal frame is invalid')
  }
  const payloadLength = new DataView(
    frame.buffer,
    frame.byteOffset,
    FRAME_HEADER_BYTES,
  ).getUint32(0, false)
  if (payloadLength === 0
    || payloadLength >= TERMINAL_FRAME_LENGTH
    || frame.byteLength !== FRAME_HEADER_BYTES + payloadLength) {
    throw new Error('Profile Live Gateway terminal frame is invalid')
  }
  const terminal = new Uint8Array(
    PROFILE_LIVE_GATEWAY_TERMINAL_FRAME.byteLength + frame.byteLength,
  )
  terminal.set(PROFILE_LIVE_GATEWAY_TERMINAL_FRAME)
  terminal.set(frame, PROFILE_LIVE_GATEWAY_TERMINAL_FRAME.byteLength)
  return terminal
}

export function writeProfileLiveGatewayBytes(
  stream: Writable,
  bytes: Uint8Array,
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(bytes, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
