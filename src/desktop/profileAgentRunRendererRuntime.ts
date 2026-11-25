import { createAgentRunExecutor } from '../brain/agentRunExecutor'
import type { SavedBoard } from '../graph/types'
import { createAgentRunExecutionAdapter } from './agentRunExecutionAdapter'
import { registerProfileAgentRunBridgeHandler } from './profileAgentRunBridgeHandler'
import {
  createProfileAgentRunRendererService,
  type ProfileAgentRunRendererService,
} from './profileAgentRunRendererService'

export type ProfileAgentRunRendererRuntimeDependencies = Readonly<{
  isAuthorityReady(): boolean
  subscribeAuthorityReadiness(listener: () => void): () => void
  readLiveBoard(): Readonly<{ ideaId: string | null; board: SavedBoard }>
  flush(): Promise<unknown>
}>

export type ProfileAgentRunRendererRuntime = Readonly<{
  service: ProfileAgentRunRendererService
  acquireAuthoritativeMutationLease(): Promise<() => void>
  close(): void
  drain(): Promise<void>
}>

/**
 * Creates the one renderer-app-scoped run owner and attaches it to the
 * preload event bridge. The injected dependencies are deliberately only live
 * authority, the graph snapshot, and packaged persistence flush.
 */
export function registerProfileAgentRunRendererRuntime(
  target: EventTarget,
  dependencies: ProfileAgentRunRendererRuntimeDependencies,
): ProfileAgentRunRendererRuntime {
  let admitting = true
  let drainPromise: Promise<void> | undefined
  let unregisterAuthorityReadiness: () => void = () => undefined
  let hasObservedReadyAuthority = authorityIsReady()
  let authoritativeMutationLeaseHeld = false
  const runner = createAgentRunExecutor({
    readLiveBoard: dependencies.readLiveBoard,
    isLive: rendererIsLive,
  })
  const execute = createAgentRunExecutionAdapter({ runner, flush: dependencies.flush })
  const service = createProfileAgentRunRendererService({
    isLive: rendererIsLive,
    readBoard: (ideaId) => {
      const current = dependencies.readLiveBoard()
      return current.ideaId === ideaId ? current.board : undefined
    },
    execute,
  })
  const unregister = registerProfileAgentRunBridgeHandler(target, service)
  unregisterAuthorityReadiness = dependencies.subscribeAuthorityReadiness(() => {
    const ready = authorityIsReady()
    if (hasObservedReadyAuthority && !ready) void stopAndDrain()
    if (ready) hasObservedReadyAuthority = true
  })
  if (!admitting) unregisterAuthorityReadiness()

  return Object.freeze({
    service,
    async acquireAuthoritativeMutationLease(): Promise<() => void> {
      if (!admitting || authoritativeMutationLeaseHeld) {
        throw new Error('Profile Agent execution authority is unavailable')
      }
      authoritativeMutationLeaseHeld = true
      execute.cancelActive()
      try {
        await execute.drain()
        if (!admitting) throw new Error('Profile Agent execution authority closed')
      } catch (error) {
        if (admitting) authoritativeMutationLeaseHeld = false
        throw error
      }
      let released = false
      return () => {
        if (released) return
        released = true
        authoritativeMutationLeaseHeld = false
      }
    },
    close(): void {
      void stopAndDrain()
    },
    drain: stopAndDrain,
  })

  function stopAndDrain(): Promise<void> {
    if (drainPromise) return drainPromise
    admitting = false
    unregister()
    unregisterAuthorityReadiness()
    const serviceDrain = service.close()
    execute.cancelActive()
    drainPromise = Promise.all([serviceDrain, execute.drain()]).then(() => undefined)
    return drainPromise
  }

  function rendererIsLive(): boolean {
    return admitting && !authoritativeMutationLeaseHeld && authorityIsReady()
  }

  function authorityIsReady(): boolean {
    try {
      return dependencies.isAuthorityReady() === true
    } catch {
      return false
    }
  }
}
