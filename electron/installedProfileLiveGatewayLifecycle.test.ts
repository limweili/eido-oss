import { describe, expect, it, vi } from 'vitest'
import { createInstalledProfileLiveGatewayLifecycle } from './installedProfileLiveGatewayLifecycle'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

describe('installed Profile live Gateway lifecycle', () => {
  it('gives a pending startup to exactly one joined shutdown owner', async () => {
    const startup = deferred<Readonly<{
      close(): Promise<void>
      terminate(): Promise<void>
    }>>()
    const events: string[] = []
    const server = Object.freeze({
      close: vi.fn(async () => { events.push('close') }),
      terminate: vi.fn(async () => { events.push('terminate') }),
    })
    const onFailure = vi.fn()
    const lifecycle = createInstalledProfileLiveGatewayLifecycle(onFailure)

    lifecycle.start(() => startup.promise)
    const stopping = lifecycle.stop(false)
    startup.resolve(server)
    await stopping
    await Promise.resolve()

    expect(events).toEqual(['close'])
    expect(server.close).toHaveBeenCalledOnce()
    expect(server.terminate).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('shares concurrent stop ownership and permits a force retry after close fails', async () => {
    const events: string[] = []
    const releaseClose = deferred<void>()
    const server = Object.freeze({
      close: vi.fn(async () => {
        events.push('close')
        await releaseClose.promise
        throw new Error('graceful Gateway close failed')
      }),
      terminate: vi.fn(async () => { events.push('terminate') }),
    })
    const lifecycle = createInstalledProfileLiveGatewayLifecycle(vi.fn())
    lifecycle.start(async () => server)
    await Promise.resolve()

    const first = lifecycle.stop(false)
    const concurrent = lifecycle.stop(true)
    expect(events).toEqual(['close'])
    releaseClose.resolve(undefined)
    await expect(first).rejects.toThrow('graceful Gateway close failed')
    await expect(concurrent).rejects.toThrow('graceful Gateway close failed')

    await lifecycle.stop(true)
    expect(events).toEqual(['close', 'terminate'])
    expect(server.close).toHaveBeenCalledOnce()
    expect(server.terminate).toHaveBeenCalledOnce()
  })
})
