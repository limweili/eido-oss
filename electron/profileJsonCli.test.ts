import { describe, expect, it } from 'vitest'
import { createCompleteProfileFixture } from '../src/persistence/fixtures/profileLogicalProjectionFixture'
import { projectProfileSnapshot } from '../src/persistence/profileLogicalProjection'
import { queryProfileLogicalDocument } from '../src/persistence/profileLogicalQuery'
import { inspectProfileLogicalResult } from '../src/persistence/profileResultInspection'
import {
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_QUERY_LIMITS,
  createProfileCapabilities,
  profileServiceFailure,
  type ProfileStatus,
} from '../src/persistence/profileServiceContract'
import type { ProfileGatewayService } from '../src/persistence/profileAgentGateway'
import {
  PROFILE_JSON_CLI_EXIT_CODES,
  PROFILE_JSON_CLI_LIMITS,
  runProfileJsonCli,
  type ProfileJsonCliOptions,
} from './profileJsonCli'

describe('injected Profile JSON process adapter (#523)', () => {
  it('admits one complete request before opening and closes before stdout', async () => {
    const events: string[] = []
    const stdout: string[] = []
    let requestedMethods = 0
    let reportCloseStarted!: () => void
    let releaseClose!: () => void
    const closeStarted = new Promise<void>((resolve) => { reportCloseStarted = resolve })
    const closeReleased = new Promise<void>((resolve) => { releaseClose = resolve })

    const running = runProfileJsonCli({
      openService: async () => {
        events.push('open')
        return {
          ok: true,
          value: {
            async status() {
              requestedMethods += 1
              events.push('status')
              return { ok: true, value: readyStatus() }
            },
            async capabilities() {
              throw new Error('unexpected capabilities request')
            },
            async query() {
              throw new Error('unexpected query request')
            },
            async close() {
              events.push('close:start')
              reportCloseStarted()
              await closeReleased
              events.push('close:complete')
            },
          },
        }
      },
      stdin: orderedInput(),
      stdout: {
        async write(value) {
          events.push('stdout')
          stdout.push(value)
        },
      },
      stderr: { write: () => undefined },
    })

    await closeStarted
    expect(stdout).toEqual([])
    releaseClose()
    const exitCode = await running
    expect(exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.success)
    expect(requestedMethods).toBe(1)
    expect(events).toEqual([
      'stdin:start',
      'stdin:end',
      'open',
      'status',
      'close:start',
      'close:complete',
      'stdout',
    ])
    expect(stdout).toHaveLength(1)
    expect(stdout[0]!.endsWith('\n')).toBe(true)

    async function* orderedInput(): AsyncGenerator<Uint8Array> {
      events.push('stdin:start')
      yield new TextEncoder().encode(JSON.stringify({
        version: 1,
        requestId: 'request-ordered',
        operation: 'profile.status',
        params: {},
      }))
      events.push('stdin:end')
    }
  })

  it('does not open the installed service for rejected envelopes or operation parameters', async () => {
    const rejected = [
      '{',
      JSON.stringify({
        version: 99,
        requestId: 'request-future',
        operation: 'profile.status',
        params: {},
      }),
      JSON.stringify({
        version: 1,
        requestId: 'request-forbidden',
        operation: 'raw-sql',
        params: {},
      }),
      JSON.stringify({
        version: 1,
        requestId: 'request-status-invalid',
        operation: 'profile.status',
        params: { path: 'forbidden' },
      }),
      JSON.stringify({
        version: 1,
        requestId: 'request-capabilities-invalid',
        operation: 'profile.capabilities',
        params: { verbose: true },
      }),
      JSON.stringify({
        version: 1,
        requestId: 'request-ideas-invalid',
        operation: 'idea.list',
        params: { limit: 0 },
      }),
      JSON.stringify({
        version: 1,
        requestId: 'request-templates-invalid',
        operation: 'mod-template.list',
        params: { projection: [''] },
      }),
      JSON.stringify({
        version: 1,
        requestId: 'request-query-invalid',
        operation: 'graph.query',
        params: {},
      }),
      JSON.stringify({
        version: 1,
        requestId: 'request-record-invalid',
        operation: 'record.get',
        params: { recordId: '', projection: ['name'] },
      }),
      JSON.stringify({
        version: 1,
        requestId: 'request-command-malformed-mod',
        operation: 'command.batch',
        params: {
          version: 1,
          schemaVersion: 1,
          expectedRevision: 7,
          idempotencyKey: 'malformed-mod-command',
          dryRun: true,
          commands: [{
            version: 1,
            id: 'create-template',
            name: 'mod-template.create',
            payload: {},
          }],
        },
      }),
    ]

    for (const input of rejected) {
      let opens = 0
      const result = await invokeCli(input, async () => {
        opens += 1
        throw new Error('rejected request opened the installed service')
      })
      expect(opens).toBe(0)
      expect(JSON.parse(result.stdout[0]!)).toMatchObject({ ok: false })
    }
  })

  it('forwards one admitted Agent batch and joins close before stdout', async () => {
    const events: string[] = []
    const observed: unknown[] = []
    const stdout: string[] = []
    const commandRequest = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: 7,
      idempotencyKey: 'cli-command-batch',
      dryRun: false,
      commands: [{
        version: 1 as const,
        id: 'create-note',
        name: 'card.create' as const,
        payload: {
          ideaId: 'idea-main',
          kind: 'note' as const,
          position: { x: 10, y: 20 },
          text: 'CLI native command',
        },
      }],
    }
    const receipt = {
      kind: 'agent-command-batch' as const,
      version: 5 as const,
      previousRevision: 7,
      revision: 8,
      proposedRevision: 8,
      commitId: 'agent-cli-commit',
      commandResults: [{
        commandId: 'create-note',
        name: 'card.create' as const,
        cardId: 'card-created',
        blockId: 'block-created',
        position: { x: 10, y: 20 },
      }],
      effects: {
        inserted: 2,
        updated: 0,
        deleted: 0,
        intentEvents: 1,
        profileAgentEvents: 0,
      },
      intentEventIds: ['intent-created'],
      profileAgentEventIds: [],
      dryRun: false,
      replayed: false,
    }
    const exitCode = await runProfileJsonCli({
      openService: async () => ({
        ok: true,
        value: {
          async status() {
            throw new Error('unexpected status request')
          },
          async capabilities() {
            throw new Error('unexpected capabilities request')
          },
          async query() {
            throw new Error('unexpected query request')
          },
          async applyAgentCommandBatch(request) {
            events.push('command')
            observed.push(request)
            return { ok: true, value: receipt }
          },
          async close() {
            events.push('close')
          },
        },
      }),
      stdin: chunks(JSON.stringify({
        version: 1,
        requestId: 'request-cli-command',
        operation: 'command.batch',
        params: commandRequest,
      })),
      stdout: {
        write(value) {
          events.push('stdout')
          stdout.push(value)
        },
      },
      stderr: { write: () => undefined },
    })

    expect(exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.success)
    expect(events).toEqual(['command', 'close', 'stdout'])
    expect(observed).toEqual([commandRequest])
    expect(JSON.parse(stdout[0]!)).toEqual({
      version: 1,
      requestId: 'request-cli-command',
      ok: true,
      result: receipt,
    })
  })

  it('forwards only normalized canonical queries after admission', async () => {
    const cases = [
      {
        operation: 'graph.query',
        params: { recordKinds: ['idea'], projection: ['name', 'id'] },
        expected: {
          recordKinds: ['idea'],
          projection: ['id', 'name'],
          limit: PROFILE_QUERY_LIMITS.defaultItems,
          byteLimit: PROFILE_QUERY_LIMITS.defaultBytes,
        },
      },
      {
        operation: 'idea.list',
        params: { projection: ['name', 'id'] },
        expected: {
          recordKinds: ['idea'],
          projection: ['id', 'name'],
          limit: PROFILE_QUERY_LIMITS.defaultItems,
          byteLimit: PROFILE_QUERY_LIMITS.defaultBytes,
        },
      },
      {
        operation: 'mod-template.list',
        params: { limit: 3 },
        expected: {
          recordKinds: ['mod-template'],
          limit: 3,
          byteLimit: PROFILE_QUERY_LIMITS.defaultBytes,
        },
      },
      {
        operation: 'record.get',
        params: { recordId: 'idea-main', projection: ['name', 'id'] },
        expected: {
          recordIds: ['idea-main'],
          projection: ['id', 'name'],
          limit: 1,
          byteLimit: PROFILE_QUERY_LIMITS.defaultBytes,
        },
      },
    ] as const

    for (const entry of cases) {
      const observed: unknown[] = []
      const result = await invokeCli(JSON.stringify({
        version: 1,
        requestId: `request-canonical-${entry.operation}`,
        operation: entry.operation,
        params: entry.params,
      }), {
        async status() {
          throw new Error('unexpected status request')
        },
        async capabilities() {
          throw new Error('unexpected capabilities request')
        },
        async query(request) {
          observed.push(request)
          return {
            ok: true,
            value: {
              profileId: 'profile-synthetic',
              revision: 7,
              items: [{
                recordId: 'idea-main',
                kind: 'idea',
                ownerId: 'profile-synthetic',
                parentId: 'profile-synthetic',
                ordinal: 0,
                recordVersion: 1,
                payload: { id: 'idea-main', name: 'Synthetic' },
              }],
              truncated: false,
            },
          }
        },
      })

      expect(result.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.success)
      expect(observed).toEqual([entry.expected])
    }
  })

  it('preserves typed existing-only acquisition failures without invoking a service', async () => {
    const cases = [
      { code: 'busy', exitCode: PROFILE_JSON_CLI_EXIT_CODES.unavailable },
      { code: 'not-found', exitCode: PROFILE_JSON_CLI_EXIT_CODES.notFound },
    ] as const

    for (const entry of cases) {
      let opens = 0
      const result = await invokeCli(JSON.stringify({
        version: 1,
        requestId: `request-${entry.code}`,
        operation: 'profile.status',
        params: {},
      }), async () => {
        opens += 1
        return profileServiceFailure(entry.code)
      })

      expect(opens).toBe(1)
      expect(result.exitCode).toBe(entry.exitCode)
      expect(JSON.parse(result.stdout[0]!)).toMatchObject({
        requestId: `request-${entry.code}`,
        ok: false,
        error: { code: entry.code },
      })
    }
  })

  it('maps uncertain close to internal before writing stdout', async () => {
    const events: string[] = []
    const result = await invokeCli(JSON.stringify({
      version: 1,
      requestId: 'request-close-failure',
      operation: 'profile.status',
      params: {},
    }), async () => ({
      ok: true,
      value: {
        async status() {
          events.push('status')
          return { ok: true, value: readyStatus() }
        },
        async capabilities() {
          throw new Error('unexpected capabilities request')
        },
        async query() {
          throw new Error('unexpected query request')
        },
        async close() {
          events.push('close')
          throw new Error('synthetic uncertain close')
        },
      },
    }))

    expect(events).toEqual(['status', 'close'])
    expect(result.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.internal)
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({
      requestId: 'request-close-failure',
      ok: false,
      error: { code: 'internal' },
    })
  })

  it('contains lazy installation setup failures inside the JSON contract', async () => {
    const result = await invokeCli(JSON.stringify({
      version: 1,
      requestId: 'request-setup-failure',
      operation: 'profile.status',
      params: {},
    }), async () => {
      throw new Error('synthetic installation setup failure')
    })

    expect(result.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.internal)
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({
      requestId: 'request-setup-failure',
      ok: false,
      error: { code: 'internal' },
    })
    expect(result.stderr.join('')).not.toContain('synthetic installation setup failure')
  })

  it('emits one bounded response with stable admission, protocol, and exit behavior', async () => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.ideas[0]!.name = 'Alpha 🧠'
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const service: ProfileGatewayService = {
      async status() {
        return { ok: true, value: readyStatus() }
      },
      async capabilities() {
        return { ok: true, value: createProfileCapabilities('sqlite') }
      },
      async query(request) {
        return queryProfileLogicalDocument(document, request)
      },
      async inspectResult(request) {
        return inspectProfileLogicalResult(document, request)
      },
    }

    const successful = await invokeCli(JSON.stringify({
      version: 1,
      requestId: 'request-ideas',
      operation: 'idea.list',
      params: { projection: ['name'], limit: 10, byteLimit: 4_096 },
    }), service)
    expect(successful.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.success)
    expect(successful.stdout).toHaveLength(1)
    expect(successful.stderr).toEqual([])
    expect(JSON.parse(successful.stdout[0]!)).toMatchObject({
      version: 1,
      requestId: 'request-ideas',
      ok: true,
      result: {
        profileId: 'profile-synthetic',
        revision: 7,
        items: [
          { kind: 'idea', payload: { name: 'Alpha 🧠' } },
          { kind: 'idea', payload: { name: 'Synthetic Second' } },
        ],
      },
    })

    const inspectedResult = await invokeCli(JSON.stringify({
      version: 1,
      requestId: 'request-result-inspect',
      operation: 'result.inspect',
      params: {
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        limit: 4,
        byteLimit: 65_536,
      },
    }), service)
    expect(inspectedResult.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.success)
    expect(inspectedResult.stderr).toEqual([])
    expect(JSON.parse(inspectedResult.stdout[0]!)).toMatchObject({
      version: 1,
      requestId: 'request-result-inspect',
      ok: true,
      result: {
        profileId: 'profile-synthetic',
        revision: 7,
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        items: [
          { kind: 'card', recordId: 'card-result' },
          { kind: 'output', recordId: 'output-result' },
          { kind: 'output-version', recordId: 'version-result-1' },
          { kind: 'run', recordId: 'run-main' },
        ],
        truncated: true,
      },
    })

    const forbidden = await invokeCli(JSON.stringify({
      version: 1,
      requestId: 'request-forbidden',
      operation: 'raw-sql',
      params: { statement: 'SELECT secret FROM private_state' },
    }), service)
    expect(forbidden.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.capabilityDenied)
    expect(forbidden.stdout).toHaveLength(1)
    expect(JSON.parse(forbidden.stdout[0]!)).toMatchObject({
      requestId: 'request-forbidden',
      ok: false,
      error: { code: 'capability-denied', retryable: false },
    })
    expect(forbidden.stderr).toEqual(['Eido Profile inspection failed (capability-denied).\n'])
    expect(forbidden.stderr.join('')).not.toContain('SELECT secret')

    const futureProtocol = await invokeCli(JSON.stringify({
      version: 99,
      requestId: 'request-future',
      operation: 'profile.status',
      params: {},
    }), service)
    expect(futureProtocol.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.unsupportedFutureVersion)
    expect(JSON.parse(futureProtocol.stdout[0]!)).toMatchObject({
      requestId: 'request-future',
      ok: false,
      error: { code: 'unsupported-future-version', supportedGatewayProtocolVersion: 1 },
    })

    const oversizedInput = await invokeCli(
      'x'.repeat(PROFILE_JSON_CLI_LIMITS.maxInputBytes + 1),
      service,
    )
    expect(oversizedInput.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.invalid)
    expect(oversizedInput.stdout).toHaveLength(1)
    expect(JSON.parse(oversizedInput.stdout[0]!)).toMatchObject({
      requestId: null,
      ok: false,
      error: { code: 'invalid' },
    })

    const oversizedOutput = await invokeCli(JSON.stringify({
      version: 1,
      requestId: 'request-output-bound',
      operation: 'profile.status',
      params: {},
    }), {
      ...service,
      async status() {
        return {
          ok: true,
          value: {
            ...readyStatus(),
            profileId: 'x'.repeat(PROFILE_JSON_CLI_LIMITS.maxOutputBytes),
          },
        }
      },
    })
    expect(oversizedOutput.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.internal)
    expect(oversizedOutput.stdout).toHaveLength(1)
    expect(JSON.parse(oversizedOutput.stdout[0]!)).toMatchObject({
      requestId: 'request-output-bound',
      ok: false,
      error: { code: 'internal' },
    })
    expect(oversizedOutput.stdout[0]!.length).toBeLessThan(PROFILE_JSON_CLI_LIMITS.maxOutputBytes)

    const largeValue = (index: number) => `${'\u0001'.repeat(500)}-${index}`
    const largeProjection = (index: number) => `${'\u0001'.repeat(120)}-${index}`
    const maximalParams = {
      recordKinds: ['idea'],
      recordIds: [
        'idea-main',
        'idea-second',
        ...Array.from({ length: PROFILE_QUERY_LIMITS.maxFilterValues - 2 }, (_, index) => (
          largeValue(index)
        )),
      ],
      ownerIds: [
        'profile-synthetic',
        ...Array.from({ length: PROFILE_QUERY_LIMITS.maxFilterValues - 1 }, (_, index) => (
          largeValue(index + 100)
        )),
      ],
      parentIds: [
        'profile-synthetic',
        ...Array.from({ length: PROFILE_QUERY_LIMITS.maxFilterValues - 1 }, (_, index) => (
          largeValue(index + 200)
        )),
      ],
      projection: Array.from(
        { length: PROFILE_QUERY_LIMITS.maxProjectionFields },
        (_, index) => largeProjection(index),
      ),
      limit: 1,
      byteLimit: PROFILE_QUERY_LIMITS.maxBytes,
    }
    const maximalFirst = await invokeCli(JSON.stringify({
      version: 1,
      requestId: 'request-maximal-first',
      operation: 'graph.query',
      params: maximalParams,
    }), service)
    expect(maximalFirst.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.success)
    const maximalFirstResponse = JSON.parse(maximalFirst.stdout[0]!) as {
      result: { nextCursor: string }
    }
    expect(maximalFirstResponse.result.nextCursor.length).toBeGreaterThan(16 * 1024)
    expect(maximalFirstResponse.result.nextCursor.length).toBeLessThanOrEqual(
      PROFILE_QUERY_LIMITS.maxCursorBytes,
    )

    const maximalSecond = await invokeCli(JSON.stringify({
      version: 1,
      requestId: 'request-maximal-second',
      operation: 'graph.query',
      params: { ...maximalParams, cursor: maximalFirstResponse.result.nextCursor },
    }), service)
    expect(maximalSecond.exitCode).toBe(PROFILE_JSON_CLI_EXIT_CODES.success)
    expect(JSON.parse(maximalSecond.stdout[0]!)).toMatchObject({
      ok: true,
      result: { items: [{ recordId: 'idea-second' }], truncated: false },
    })
  })
})

async function invokeCli(
  input: string,
  serviceOrFactory: ProfileGatewayService | ProfileJsonCliOptions['openService'],
) {
  const stdout: string[] = []
  const stderr: string[] = []
  const openService = typeof serviceOrFactory === 'function'
    ? serviceOrFactory
    : async () => ({
        ok: true as const,
        value: {
          ...serviceOrFactory,
          close: async () => undefined,
        },
      })
  const exitCode = await runProfileJsonCli({
    openService,
    stdin: chunks(input),
    stdout: { write: (value) => { stdout.push(value) } },
    stderr: { write: (value) => { stderr.push(value) } },
  })
  return { exitCode, stdout, stderr }
}

async function* chunks(value: string): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(value)
  const midpoint = Math.ceil(bytes.byteLength / 2)
  yield bytes.slice(0, midpoint)
  yield bytes.slice(midpoint)
}

function readyStatus(): ProfileStatus {
  return {
    profileId: 'profile-synthetic',
    revision: 7,
    versions: PROFILE_CONTRACT_VERSIONS,
    state: 'ready',
    owner: { mode: 'mutable', route: 'exclusive-headless-owner' },
    dirty: 'clean',
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}
