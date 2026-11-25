import { describe, expect, it, vi } from 'vitest'
import { createConnectionEdgeMountRegistry } from './connectionEdgeMountRegistry'

describe('connection edge mount registry', () => {
  it('coalesces a commit of mount changes into one published membership snapshot', async () => {
    const registry = createConnectionEdgeMountRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)

    registry.mount('a')
    registry.mount('b')
    registry.mount('a')
    expect(listener).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(1)
    expect([...registry.getSnapshot()]).toEqual(['a', 'b'])

    registry.unmount('a')
    registry.unmount('b')
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(2)
    expect([...registry.getSnapshot()]).toEqual([])
  })
})
