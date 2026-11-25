import type { InstalledProfileBridge } from '../../electron/profileBridgeContract'
import {
  registerProfileRendererCheckpointHandler,
  type ProfileRendererPersistence,
} from '../graph/profileRendererPersistence'
import * as store from '../graph/store'
import { registerProfileAgentMutationBarrierHandler } from './profileAgentMutationBarrier'
import { registerProfileAgentRunRendererRuntime } from './profileAgentRunRendererRuntime'

export type InstalledProfileRendererRuntimeOptions = Readonly<{
  target: EventTarget
  bridge: InstalledProfileBridge
  persistence: ProfileRendererPersistence
  onTerminalFailure: (error: Error) => void
}>

/** Owns packaged-only Agent execution, checkpoint, and mutation-barrier listeners. */
export function installPackagedProfileRendererRuntime({
  target,
  bridge,
  persistence,
  onTerminalFailure,
}: InstalledProfileRendererRuntimeOptions): () => void {
  const agentRunRuntime = registerProfileAgentRunRendererRuntime(target, {
    isAuthorityReady: () => {
      const graph = store.useGraph.getState()
      return graph.hydrated && graph.profileStartupState === 'ready'
    },
    subscribeAuthorityReadiness: (listener) => store.useGraph.subscribe(() => listener()),
    readLiveBoard: () => {
      const graph = store.useGraph.getState()
      return Object.freeze({
        ideaId: graph.currentIdeaId,
        board: graph.snapshot(),
      })
    },
    flush: () => persistence.flush(),
  })
  const unregisterCheckpoint = registerProfileRendererCheckpointHandler(
    target,
    store.profileRendererCheckpointPersistence(),
    () => store.captureCurrentProfileRendererCommitState(),
    { prepareForCheckpoint: agentRunRuntime.drain },
  )
  const unregisterMutationBarrier = registerProfileAgentMutationBarrierHandler(
    target,
    bridge,
    persistence,
    () => store.captureCurrentProfileRendererCommitState(),
    {
      acquireExecutionLease: agentRunRuntime.acquireAuthoritativeMutationLease,
      onTerminalFailure,
    },
  )
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    unregisterCheckpoint()
    unregisterMutationBarrier()
    agentRunRuntime.close()
  }
}
