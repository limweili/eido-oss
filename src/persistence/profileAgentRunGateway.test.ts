import { describe, expect, it, vi } from 'vitest'
import { AGENT_RUN_CONTRACT_VERSION } from '../brain/agentRunContract'
import {
  createProfileGatewaySession,
  type ProfileGatewaySessionService,
} from './profileAgentGateway'
import {
  mapProfileAgentRunGatewayFailure,
} from './profileAgentRunGateway'

const actor = Object.freeze({
  kind: 'agent' as const,
  client: 'eido-cli',
  sessionId: 'authenticated-live-session',
})

describe('Profile Agent run Gateway integration', () => {
  it('discovers three explicit CLI-only live-app operations with bounded schemas', async () => {
    const gateway = createProfileGatewaySession({
      openService: async () => { throw new Error('static discovery opened Profile authority') },
    })

    const description = gateway.describeAgentCli()
    const operations = description.operations.filter(({ name }) => (
      name.startsWith('run.')
    ))
    expect(operations.map(({ name }) => name)).toEqual([
      'run.submit',
      'run.status',
      'run.read',
    ])
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'run.submit',
        summary: 'Run one bounded non-Agentic OpenRouter Ask AI or Conversation target, or 1–8 variations, in the live app.',
        availability: 'live-app',
        adapters: ['cli'],
        agentCliDiscoverable: true,
        mutating: true,
        schema: expect.objectContaining({ input: expect.objectContaining({
          additionalProperties: false,
          oneOf: [
            {
              type: 'object',
              properties: {
                ideaId: { type: 'string', minLength: 1 },
                targetCardId: { type: 'string', minLength: 1 },
              },
              required: ['ideaId', 'targetCardId'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                ideaId: { type: 'string', minLength: 1 },
                targetCardId: { type: 'string', minLength: 1 },
                mode: { type: 'string', enum: ['variations'] },
                variationCount: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 8,
                },
              },
              required: ['ideaId', 'targetCardId', 'mode', 'variationCount'],
              additionalProperties: false,
            },
          ],
        }) }),
      }),
      expect.objectContaining({
        name: 'run.read',
        limits: expect.objectContaining({
          agentRunArtifacts: expect.objectContaining({ maxItems: 200, maxBytes: 262_144 }),
        }),
      }),
    ]))
    expect(operations.every(({ adapters }) => !adapters.includes('mcp'))).toBe(true)
    expect(description.agentCapabilities.classes.enabled).toMatchObject({
      limits: {
        maxAgentRunSessionRuns: 100,
        maxAgentRunSessionPlannedSteps: 500,
        maxAgentRunAppRuns: 1_000,
        maxAgentRunAppPlannedSteps: 5_000,
        maxAgentRunAppSessions: 256,
        maxAgentRunRetainedJobs: 500,
        maxAgentRunArtifactItems: 200,
        maxAgentRunArtifactBytes: 262_144,
      },
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          name: 'run.delegation',
          details: expect.objectContaining({
            operations: ['run.submit', 'run.status', 'run.read'],
            availability: 'live-app',
          }),
        }),
      ]),
    })
    expect(description.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'busy', reason: 'live-app-required' }),
      expect.objectContaining({ code: 'internal', reason: 'submit-outcome-unknown' }),
    ]))
    await gateway.close()
  })

  it('invokes the live run service and rejects caller-controlled actor or oversized bounds', async () => {
    const submitAgentRun = vi.fn(async () => ({
      ok: true as const,
      value: {
        version: AGENT_RUN_CONTRACT_VERSION,
        runId: 'agent-run-1',
        ideaId: 'idea-live',
        targetCardId: 'ask-live',
        actor,
        status: 'queued' as const,
        submittedAt: '2026-07-22T01:00:00.000Z',
        plannedStepIds: ['ask:ask-live'],
        reusedStepIds: [],
      },
    }))
    const service = installedService({ submitAgentRun })
    const gateway = createProfileGatewaySession({
      openService: async () => ({ ok: true, value: service }),
    })

    await expect(gateway.invoke({
      version: 1,
      requestId: 'gateway-run-submit',
      operation: 'run.submit',
      params: { ideaId: 'idea-live', targetCardId: 'ask-live' },
    })).resolves.toMatchObject({
      ok: true,
      result: { runId: 'agent-run-1', actor },
    })
    expect(submitAgentRun).toHaveBeenCalledWith({
      ideaId: 'idea-live',
      targetCardId: 'ask-live',
    })

    for (const [requestId, operation, params] of [
      [
        'gateway-run-forged-actor',
        'run.submit',
        { ideaId: 'idea-live', targetCardId: 'ask-live', actor: { kind: 'agent' } },
      ],
      [
        'gateway-run-oversized-read',
        'run.read',
        { runId: 'agent-run-1', limit: 201 },
      ],
    ] as const) {
      await expect(gateway.invoke({ version: 1, requestId, operation, params }))
        .resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    }
    expect(submitAgentRun).toHaveBeenCalledOnce()
    await gateway.close()
  })

  it('returns canonical live-app-required without opening a headless run method', async () => {
    const service = installedService()
    const gateway = createProfileGatewaySession({
      openService: async () => ({ ok: true, value: service }),
    })

    await expect(gateway.invoke({
      version: 1,
      requestId: 'gateway-run-app-closed',
      operation: 'run.submit',
      params: { ideaId: 'idea-live', targetCardId: 'ask-live' },
    })).resolves.toEqual({
      version: 1,
      requestId: 'gateway-run-app-closed',
      ok: false,
      error: {
        code: 'busy',
        reason: 'live-app-required',
        retryable: true,
        message: 'Open Eido to run AI. Headless agent runs are not available.',
      },
    })
    await gateway.close()
  })

  it('projects run meanings onto stable exit categories and marks ambiguous submit non-retryable', () => {
    expect([
      ['live-app-required', 'busy'],
      ['invalid', 'invalid'],
      ['not-found', 'not-found'],
      ['run-not-finished', 'busy'],
      ['budget-exhausted', 'capability-denied'],
      ['grant-required', 'busy'],
      ['grant-denied', 'capability-denied'],
      ['internal', 'internal'],
    ].map(([reason]) => {
      const mapped = mapProfileAgentRunGatewayFailure('run.status', {
        ok: false,
        code: reason as never,
        retryable: reason === 'live-app-required' || reason === 'run-not-finished'
          || reason === 'grant-required' || reason === 'internal',
        message: `canonical ${reason}`,
      })
      return [mapped.reason, mapped.code, mapped.retryable, mapped.message]
    })).toEqual([
      ['live-app-required', 'busy', true, 'canonical live-app-required'],
      ['invalid', 'invalid', false, 'canonical invalid'],
      ['not-found', 'not-found', false, 'canonical not-found'],
      ['run-not-finished', 'busy', true, 'canonical run-not-finished'],
      ['budget-exhausted', 'capability-denied', false, 'canonical budget-exhausted'],
      ['grant-required', 'busy', true, 'canonical grant-required'],
      ['grant-denied', 'capability-denied', false, 'canonical grant-denied'],
      ['internal', 'internal', true, 'canonical internal'],
    ])

    expect(mapProfileAgentRunGatewayFailure('run.submit', {
      ok: false,
      code: 'internal',
      retryable: false,
      message: 'The agent run submission outcome is unknown. Do not retry this submission.',
    })).toEqual({
      ok: false,
      code: 'internal',
      reason: 'submit-outcome-unknown',
      retryable: false,
      message: 'The agent run submission outcome is unknown. Do not retry this submission.',
    })
  })

  it('fails a rejecting submit service as non-retryable outcome-unknown', async () => {
    let started = false
    const gateway = createProfileGatewaySession({
      openService: async () => ({
        ok: true,
        value: installedService({
          submitAgentRun: async () => {
            started = true
            throw new Error('response lost after admission')
          },
        }),
      }),
    })

    await expect(gateway.invoke({
      version: 1,
      requestId: 'gateway-run-rejected-after-admission',
      operation: 'run.submit',
      params: { ideaId: 'idea-live', targetCardId: 'ask-live' },
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'internal',
        reason: 'submit-outcome-unknown',
        retryable: false,
      },
    })
    expect(started).toBe(true)
    await gateway.close()
  })
})

function installedService(
  run: Partial<Pick<ProfileGatewaySessionService,
    'submitAgentRun' | 'statusAgentRun' | 'readAgentRun'>> = {},
): ProfileGatewaySessionService {
  return {
    status: vi.fn(async () => { throw new Error('unused') }),
    capabilities: vi.fn(async () => { throw new Error('unused') }),
    query: vi.fn(async () => { throw new Error('unused') }),
    close: vi.fn(async () => undefined),
    ...run,
  } as unknown as ProfileGatewaySessionService
}
