import { describe, expect, it, vi } from 'vitest'
import type { ProfileGatewaySessionService } from '../src/persistence/profileAgentGateway'
import type { ProfileAgentRunRendererBroker } from './profileAgentRunRendererBroker'
import { createProfileAgentRunLiveService } from './profileAgentRunLiveService'

describe('authenticated live Agent run service', () => {
  it('binds socket identity as trusted actor and keeps the app broker shared across session close', async () => {
    const closeBase = vi.fn(async () => undefined)
    const base = { close: closeBase } as unknown as ProfileGatewaySessionService
    const dispatch = vi.fn(async () => ({
      ok: false as const,
      code: 'not-found' as const,
      retryable: false,
      message: 'The requested agent run was not found.',
    }))
    const broker = {
      dispatch,
      close: vi.fn(),
    } as unknown as ProfileAgentRunRendererBroker
    const mutableIdentity = { client: 'codex', sessionId: 'live-session-1' }
    const service = createProfileAgentRunLiveService(base, mutableIdentity, broker)
    mutableIdentity.sessionId = 'caller-mutated-session'

    await expect(service.statusAgentRun({ runId: 'agent-run-1' })).resolves.toEqual({
      ok: false,
      code: 'not-found',
      reason: 'not-found',
      retryable: false,
      message: 'The requested agent run was not found.',
    })
    expect(dispatch).toHaveBeenCalledWith(
      {
        kind: 'agent',
        client: 'codex',
        sessionId: 'live-session-1',
      },
      'run.status',
      { runId: 'agent-run-1' },
    )

    await service.close()
    expect(closeBase).toHaveBeenCalledOnce()
    expect(broker.close).not.toHaveBeenCalled()
  })
})
