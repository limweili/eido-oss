import { contextBridge, ipcRenderer } from 'electron'
import { hasProfileReviewPolicyMarker } from '../src/shared/profileReviewPolicy'
import {
  AI_HARNESS_BRIDGE_CHANNEL,
  AI_HARNESS_EVENT_CHANNEL,
  createInstalledAiHarnessBridge,
} from './aiHarnessBridgeContract'
import { createInstalledKeychainBridge } from './keychainBridgeContract'
import {
  assertProfileAgentBarrierWireAck,
  assertProfileAgentBarrierWireRequest,
  assertProfileCheckpointWireAck,
  assertProfileCheckpointWireRequest,
  createInstalledProfileBridge,
  PROFILE_BRIDGE_CHANNEL,
  PROFILE_BRIDGE_VERSION,
  PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT,
  PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT,
  PROFILE_RENDERER_CHECKPOINT_ACK_EVENT,
  PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT,
} from './profileBridgeContract'
import {
  assertProfileAgentRunWireRequest,
  assertProfileAgentRunWireResponse,
  PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
  PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT,
  PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT,
} from './profileAgentRunBridgeContract'
import {
  createInstalledLinkPreviewBridge,
} from './linkPreviewContract'

contextBridge.exposeInMainWorld('eidoDesktop', true)
if (hasProfileReviewPolicyMarker(window.location?.href ?? '')) {
  contextBridge.exposeInMainWorld('eidoProfileReview', true)
}
contextBridge.exposeInMainWorld(
  'eidoProfile',
  createInstalledProfileBridge((channel, request) => ipcRenderer.invoke(channel, request)),
)
contextBridge.exposeInMainWorld(
  'eidoKeychain',
  createInstalledKeychainBridge((channel, request) => ipcRenderer.invoke(channel, request)),
)
contextBridge.exposeInMainWorld(
  'eidoAiHarness',
  createInstalledAiHarnessBridge(
    (request) => ipcRenderer.invoke(AI_HARNESS_BRIDGE_CHANNEL, request),
    (listener) => {
      ipcRenderer.on(AI_HARNESS_EVENT_CHANNEL, (_event, candidate: unknown) => listener(candidate))
    },
  ),
)
contextBridge.exposeInMainWorld(
  'eidoLinkPreviews',
  createInstalledLinkPreviewBridge((channel, request) => ipcRenderer.invoke(channel, request)),
)

ipcRenderer.on(PROFILE_BRIDGE_CHANNEL, (_event, candidate: unknown) => {
  try {
    const request = assertProfileCheckpointWireRequest(candidate)
    window.dispatchEvent(new CustomEvent(PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT, {
      detail: Object.freeze({ token: request.token }),
    }))
    return
  } catch {
    // The channel also carries the bounded Agent barrier control below.
  }
  try {
    const request = assertProfileAgentBarrierWireRequest(candidate)
    const detail = request.phase === 'complete'
      ? Object.freeze({ token: request.token, phase: request.phase, revision: request.revision })
      : Object.freeze({ token: request.token, phase: request.phase })
    window.dispatchEvent(new CustomEvent(PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT, {
      detail,
    }))
    return
  } catch {
    // Invalid main-to-preload messages cannot reach renderer authority hooks.
  }
})

ipcRenderer.on(PROFILE_AGENT_RUN_BRIDGE_CHANNEL, (_event, candidate: unknown) => {
  try {
    const request = assertProfileAgentRunWireRequest(candidate)
    window.dispatchEvent(new CustomEvent(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT, {
      detail: request,
    }))
  } catch {
    // Invalid main-to-preload run messages cannot reach renderer execution.
  }
})

window.addEventListener(PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT, (event) => {
  try {
    const response = assertProfileAgentRunWireResponse(
      (event as CustomEvent<unknown>).detail,
    )
    ipcRenderer.send(PROFILE_AGENT_RUN_BRIDGE_CHANNEL, response)
  } catch {
    // Invalid renderer responses are contained inside preload.
  }
})

window.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, (event) => {
  try {
    const detail = (event as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object') return
    const acknowledgement = assertProfileAgentBarrierWireAck({
      version: PROFILE_BRIDGE_VERSION,
      kind: 'agent-barrier-ack',
      ...detail,
    })
    ipcRenderer.send(PROFILE_BRIDGE_CHANNEL, acknowledgement)
  } catch {
    // Invalid renderer acknowledgements are contained inside preload.
  }
})

window.addEventListener(PROFILE_RENDERER_CHECKPOINT_ACK_EVENT, (event) => {
  try {
    const detail = (event as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object') return
    const acknowledgement = assertProfileCheckpointWireAck({
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      ...detail,
    })
    ipcRenderer.send(PROFILE_BRIDGE_CHANNEL, acknowledgement)
  } catch {
    // Invalid renderer acknowledgements are contained inside preload.
  }
})
