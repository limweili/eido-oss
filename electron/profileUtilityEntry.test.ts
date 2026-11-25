import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profileServiceFailure } from '../src/persistence/profileServiceContract'
import {
  createProfileUtilityFatal,
  createProfileUtilityCloseAcknowledgement,
  createProfileUtilityInitialize,
  createProfileUtilityReady,
  createProfileUtilityRequest,
  createProfileUtilityResponse,
} from './profileUtilityProtocol'

const fakes = vi.hoisted(() => {
  const state: {
    listener?: (event: Readonly<{ data: unknown }>) => void
  } = {}
  return {
    state,
    postMessage: vi.fn(),
    parentPort: {
      on: vi.fn((event: string, listener: (message: Readonly<{ data: unknown }>) => void) => {
        if (event === 'message') state.listener = listener
      }),
      postMessage: undefined as unknown,
    },
    initialize: vi.fn(),
    handle: vi.fn(),
  }
})

vi.mock('electron', () => ({
  parentPort: undefined,
}))

vi.mock('./profileUtilityHost', () => ({
  createProfileUtilityHost: () => ({
    initialize: fakes.initialize,
    handle: fakes.handle,
  }),
}))

beforeEach(() => {
  vi.resetModules()
  fakes.state.listener = undefined
  fakes.postMessage.mockReset()
  fakes.parentPort.postMessage = fakes.postMessage
  Object.defineProperty(process, 'parentPort', {
    configurable: true,
    value: fakes.parentPort,
  })
  fakes.initialize.mockReset()
  fakes.handle.mockReset()
})

afterEach(() => {
  Reflect.deleteProperty(process, 'parentPort')
  vi.restoreAllMocks()
})

describe('Profile utility entry termination', () => {
  it('waits for the parent to acknowledge a successful close response before exiting', async () => {
    fakes.initialize.mockResolvedValue(createProfileUtilityReady('active-owner', 'ready', 0))
    fakes.handle.mockResolvedValue(createProfileUtilityResponse(
      'close-1',
      'close',
      { ok: true, value: { closed: true } },
    ))
    const exit = vi.spyOn(process, 'exit')
      .mockImplementation((() => undefined) as typeof process.exit)
    await import('./profileUtilityEntry')

    emit(createProfileUtilityInitialize({
      route: 'active-owner',
      databasePath: path.resolve('synthetic-profile.sqlite'),
      portableTempRoot: path.resolve('synthetic-portable'),
    }))
    await vi.waitFor(() => expect(fakes.postMessage).toHaveBeenCalledTimes(1))
    emit(createProfileUtilityRequest('close-1', 'close', {}))
    emit(createProfileUtilityRequest('queued-after-close', 'status', {}))

    await vi.waitFor(() => expect(fakes.postMessage).toHaveBeenCalledTimes(2))
    expect(fakes.handle).toHaveBeenCalledTimes(1)
    expect(fakes.postMessage).toHaveBeenLastCalledWith(createProfileUtilityResponse(
      'close-1',
      'close',
      { ok: true, value: { closed: true } },
    ))
    expect(exit).not.toHaveBeenCalled()

    emit(createProfileUtilityCloseAcknowledgement('close-1'))

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
  })

  it('posts startup fatal before exiting unsuccessfully', async () => {
    const fatal = createProfileUtilityFatal(profileServiceFailure('busy'))
    fakes.initialize.mockResolvedValue(fatal)
    const exit = vi.spyOn(process, 'exit')
      .mockImplementation((() => undefined) as typeof process.exit)
    await import('./profileUtilityEntry')

    emit(createProfileUtilityInitialize({
      route: 'active-owner',
      databasePath: path.resolve('synthetic-profile.sqlite'),
      portableTempRoot: path.resolve('synthetic-portable'),
    }))
    emit(createProfileUtilityRequest('queued-after-fatal', 'status', {}))

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(fakes.handle).not.toHaveBeenCalled()
    expect(fakes.postMessage).toHaveBeenCalledWith(fatal)
    expect(fakes.postMessage.mock.invocationCallOrder[0])
      .toBeLessThan(exit.mock.invocationCallOrder[0]!)
  })

  it('terminalizes an embedded runtime-probe throw and suppresses queued work', async () => {
    fakes.initialize.mockResolvedValue(createProfileUtilityReady('active-owner', 'ready', 0))
    fakes.handle.mockRejectedValue(new Error('Impossible utility invariant'))
    const exit = vi.spyOn(process, 'exit')
      .mockImplementation((() => undefined) as typeof process.exit)
    await import('./profileUtilityEntry')

    emit(createProfileUtilityInitialize({
      route: 'active-owner',
      databasePath: path.resolve('synthetic-profile.sqlite'),
      portableTempRoot: path.resolve('synthetic-portable'),
    }))
    await vi.waitFor(() => expect(fakes.postMessage).toHaveBeenCalledTimes(1))
    emit(createProfileUtilityRequest('impossible-runtime-probe', 'runtime-probe', {}))
    emit(createProfileUtilityRequest('queued-after-impossible-state', 'status', {}))

    const fatal = createProfileUtilityFatal(profileServiceFailure('internal'))
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(fakes.handle).toHaveBeenCalledTimes(1)
    expect(fakes.postMessage).toHaveBeenCalledTimes(2)
    expect(fakes.postMessage).toHaveBeenLastCalledWith(fatal)
    expect(fakes.postMessage.mock.invocationCallOrder[1])
      .toBeLessThan(exit.mock.invocationCallOrder[0]!)
  })
})

function emit(data: unknown): void {
  if (!fakes.state.listener) throw new Error('Profile utility entry did not install its parent listener')
  fakes.state.listener({ data })
}
