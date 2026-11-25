import { describe, expect, it, vi } from 'vitest'
import {
  KEYCHAIN_BRIDGE_CHANNEL,
  KEYCHAIN_BRIDGE_VERSION,
  type InstalledKeychainBridge,
  type KeychainBridgeRequest,
} from './keychainBridgeContract'
import {
  PROFILE_BRIDGE_CHANNEL,
  PROFILE_BRIDGE_VERSION,
  PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT,
  PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT,
  PROFILE_RENDERER_CHECKPOINT_ACK_EVENT,
  PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT,
  type InstalledProfileBridge,
  type ProfileBridgeRequest,
} from './profileBridgeContract'
import {
  createProfileAgentRunWireRequest,
  createProfileAgentRunWireResponse,
  PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
  PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT,
  PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT,
  type ProfileAgentRunWireRequest,
} from './profileAgentRunBridgeContract'
import type { InstalledLinkPreviewBridge } from './linkPreviewContract'

const electronBoundary = vi.hoisted(() => ({
  exposed: [] as Array<readonly [string, unknown]>,
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld(name: string, value: unknown) {
      electronBoundary.exposed.push([name, value])
    },
  },
  ipcRenderer: {
    invoke: electronBoundary.invoke,
    on: electronBoundary.on,
    removeListener: electronBoundary.removeListener,
    send: electronBoundary.send,
  },
}))

class TestCustomEvent<Value> extends Event {
  readonly detail: Value

  constructor(type: string, init: { detail: Value }) {
    super(type)
    this.detail = init.detail
  }
}

describe('packaged preload boundary', () => {
  it('exposes only the desktop sentinel and the frozen Profile, keychain, harness, and link preview bridges', async () => {
    const rendererWindow = new EventTarget()
    vi.stubGlobal('window', rendererWindow)
    vi.stubGlobal('CustomEvent', TestCustomEvent)
    electronBoundary.invoke.mockImplementation(
      async (channel: string, request: ProfileBridgeRequest | KeychainBridgeRequest) => ({
        ...(channel === KEYCHAIN_BRIDGE_CHANNEL
          ? {
              version: KEYCHAIN_BRIDGE_VERSION,
              requestId: request.requestId,
              operation: request.operation,
              ok: true,
              value: { apiKey: 'sk-protected' },
            }
          : {
        version: PROFILE_BRIDGE_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        value: request.operation === 'create-ordinary-idea'
          ? {
              ideaId: request.payload.ideaId,
              authorized: true,
              createdAt: '2026-07-23T01:00:00.001Z',
            }
          : null,
            }),
      }),
    )

    await import('./preload')

    expect(electronBoundary.exposed.map(([name]) => name)).toEqual([
      'eidoDesktop',
      'eidoProfile',
      'eidoKeychain',
      'eidoAiHarness',
      'eidoLinkPreviews',
    ])
    expect(electronBoundary.exposed[0]?.[1]).toBe(true)

    const bridge = electronBoundary.exposed[1]?.[1] as InstalledProfileBridge
    expect(Object.isFrozen(bridge)).toBe(true)
    expect(Object.keys(bridge)).toEqual([
      'runtimeProbe',
      'hydrate',
      'ackHydration',
      'createOrdinaryIdea',
      'commitGuiProjection',
      'flush',
      'status',
      'capabilities',
      'query',
      'exportPortable',
      'duplicateIdea',
      'importIdeaClosure',
      'inspectRecovery',
      'restoreRecovery',
      'startFresh',
    ])

    await expect(bridge.status()).resolves.toEqual({ ok: true, value: null })
    const request = electronBoundary.invoke.mock.calls[0]?.[1] as ProfileBridgeRequest
    expect(electronBoundary.invoke).toHaveBeenCalledWith(
      PROFILE_BRIDGE_CHANNEL,
      request,
    )
    expect(request).toMatchObject({
      version: PROFILE_BRIDGE_VERSION,
      operation: 'status',
      payload: {},
    })
    expect(JSON.stringify(request)).not.toMatch(
      /authorization|context|trustedActor|databasePath|ownerToken|rawSql|record|command/i,
    )

    await expect(bridge.createOrdinaryIdea('idea-owner-issued-time')).resolves.toEqual({
      ok: true,
      value: {
        ideaId: 'idea-owner-issued-time',
        authorized: true,
        createdAt: '2026-07-23T01:00:00.001Z',
      },
    })
    expect(electronBoundary.invoke).toHaveBeenLastCalledWith(
      PROFILE_BRIDGE_CHANNEL,
      expect.objectContaining({
        operation: 'create-ordinary-idea',
        payload: { ideaId: 'idea-owner-issued-time' },
      }),
    )

    const keychain = electronBoundary.exposed[2]?.[1] as InstalledKeychainBridge
    expect(Object.isFrozen(keychain)).toBe(true)
    expect(Object.keys(keychain)).toEqual(['get', 'set', 'clear', 'migrateLegacy'])
    await expect(keychain.get()).resolves.toEqual({
      ok: true,
      value: { apiKey: 'sk-protected' },
    })
    const keychainRequest = electronBoundary.invoke.mock.calls[2]?.[1] as KeychainBridgeRequest
    expect(electronBoundary.invoke).toHaveBeenLastCalledWith(KEYCHAIN_BRIDGE_CHANNEL, keychainRequest)
    expect(keychainRequest).toMatchObject({
      version: KEYCHAIN_BRIDGE_VERSION,
      operation: 'get',
      payload: {},
    })

    const linkPreviewBridge = electronBoundary.exposed.find(
      ([name]) => name === 'eidoLinkPreviews',
    )?.[1] as InstalledLinkPreviewBridge
    expect(Object.isFrozen(linkPreviewBridge)).toBe(true)
    expect(Object.keys(linkPreviewBridge)).toEqual([
      'load',
      'recognize',
      'recognizeLocal',
      'loadLocal',
      'openLocal',
    ])

    let checkpointToken: string | undefined
    rendererWindow.addEventListener(PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT, (event) => {
      checkpointToken = (event as TestCustomEvent<{ token: string }>).detail.token
    })
    const checkpointListener = electronBoundary.on.mock.calls.find(
      ([channel]) => channel === PROFILE_BRIDGE_CHANNEL,
    )?.[1] as (
      event: unknown,
      candidate: unknown,
    ) => void
    checkpointListener({}, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-request',
      token: 'checkpoint-token',
    })
    expect(checkpointToken).toBe('checkpoint-token')

    let agentBarrier: unknown
    rendererWindow.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT, (event) => {
      agentBarrier = (event as TestCustomEvent<unknown>).detail
    })
    checkpointListener({}, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'agent-barrier-request',
      token: 'agent-barrier-token',
      phase: 'complete',
      revision: 8,
    })
    expect(agentBarrier).toEqual({
      token: 'agent-barrier-token',
      phase: 'complete',
      revision: 8,
    })

    rendererWindow.dispatchEvent(new TestCustomEvent(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, {
      detail: {
        token: 'agent-barrier-token',
        phase: 'begin',
        ok: true,
        generation: 2,
        nativeGeneration: 2,
        revision: 7,
      },
    }))
    expect(electronBoundary.send).toHaveBeenCalledWith(PROFILE_BRIDGE_CHANNEL, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'agent-barrier-ack',
      token: 'agent-barrier-token',
      phase: 'begin',
      ok: true,
      generation: 2,
      nativeGeneration: 2,
      revision: 7,
    })

    rendererWindow.dispatchEvent(new TestCustomEvent(PROFILE_RENDERER_CHECKPOINT_ACK_EVENT, {
      detail: {
        token: 'checkpoint-token',
        ok: true,
        generation: 2,
        nativeGeneration: 2,
        revision: 4,
      },
    }))
    expect(electronBoundary.send).toHaveBeenCalledWith(PROFILE_BRIDGE_CHANNEL, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      token: 'checkpoint-token',
      ok: true,
      generation: 2,
      nativeGeneration: 2,
      revision: 4,
    })

    let agentRunRequest: ProfileAgentRunWireRequest | undefined
    rendererWindow.addEventListener(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT, (event) => {
      agentRunRequest = (event as TestCustomEvent<ProfileAgentRunWireRequest>).detail
    })
    const runChannelListener = electronBoundary.on.mock.calls.find(
      ([channel]) => channel === PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
    )?.[1] as (event: unknown, candidate: unknown) => void
    const requestFromMain = createProfileAgentRunWireRequest(
      'agent-run-token',
      { kind: 'agent', client: 'codex', sessionId: 'authenticated-session' },
      'run.status',
      { runId: 'agent-run-1' },
    )

    runChannelListener({}, {
      ...requestFromMain,
      payload: { ...requestFromMain.payload, credentials: 'must-not-cross' },
    })
    expect(agentRunRequest).toBeUndefined()
    runChannelListener({}, requestFromMain)
    expect(agentRunRequest).toEqual(requestFromMain)

    const responseFromRenderer = createProfileAgentRunWireResponse(
      'agent-run-token',
      'run.status',
      {
        ok: false,
        code: 'not-found',
        retryable: false,
        message: 'The requested agent run was not found.',
      },
    )
    rendererWindow.dispatchEvent(new TestCustomEvent(
      PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT,
      { detail: responseFromRenderer },
    ))
    expect(electronBoundary.send).toHaveBeenCalledWith(
      PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
      responseFromRenderer,
    )
  })

})
