import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type {
  ProfileGatewayRequest,
  ProfileGatewayResponse,
} from '../src/persistence/profileAgentGateway'
import {
  classifyProfileLiveGatewayAbsent,
  classifyProfileLiveGatewayServed,
  classifyProfileLiveGatewayUnavailable,
  type ProfileLiveGatewayClient,
  type ProfileLiveGatewayServer,
} from './profileLiveGatewayTransport'

describe('Profile Live Gateway transport classification', () => {
  it('permits headless fallback only for confirmed pre-admission absence', () => {
    expect(classifyProfileLiveGatewayAbsent('locator-not-found')).toEqual({
      state: 'absent',
      reason: 'locator-not-found',
      admission: 'none',
      fallback: 'headless',
    })
    expect(classifyProfileLiveGatewayAbsent('endpoint-not-found')).toEqual({
      state: 'absent',
      reason: 'endpoint-not-found',
      admission: 'none',
      fallback: 'headless',
    })
  })

  it.each([
    ['locator-rejected', 'none'],
    ['peer-rejected', 'none'],
    ['token-rejected', 'none'],
    ['protocol-failure', 'none'],
    ['protocol-failure', 'admitted'],
    ['transport-failure', 'none'],
    ['transport-failure', 'unknown'],
    ['disconnected', 'none'],
    ['disconnected', 'unknown'],
  ] as const)('forbids fallback after %s', (reason, admission) => {
    expect(classifyProfileLiveGatewayUnavailable(reason, admission)).toEqual({
      state: 'unavailable',
      reason,
      admission,
      fallback: 'forbidden',
    })
  })

  it('retains a served Gateway response without changing its envelope', () => {
    const response = {
      version: 1,
      requestId: 'request-1',
      ok: false,
      error: { code: 'internal-error', message: 'synthetic' },
    } as unknown as ProfileGatewayResponse

    expect(classifyProfileLiveGatewayServed(response)).toEqual({
      state: 'served',
      response,
    })
  })

  it('publishes narrow client and lifecycle interfaces', () => {
    const invoke: ProfileLiveGatewayClient['invoke'] = vi.fn(
      async () => classifyProfileLiveGatewayAbsent('locator-not-found'),
    )
    const client = { invoke } satisfies ProfileLiveGatewayClient
    const server = {
      close: vi.fn(async () => undefined),
      terminate: vi.fn(async () => undefined),
    } satisfies ProfileLiveGatewayServer

    expectTypeOf(client.invoke).parameter(0).toMatchTypeOf<ProfileGatewayRequest>()
    expectTypeOf(client.invoke).parameter(1).toMatchTypeOf<{
      client: string
      sessionId: string
    }>()
    expect(server.close).toBeTypeOf('function')
    expect(server.terminate).toBeTypeOf('function')
  })
})
