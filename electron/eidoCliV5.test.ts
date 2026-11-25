import { describe, expect, it, vi } from 'vitest'
import { createSeedMod } from '../src/mods'
import type { ProfileGatewayRequest } from '../src/persistence/profileAgentGateway'
import type { ProfileJsonValue, ProfileQueryPage } from '../src/persistence/profileServiceContract'
import { EIDO_CLI_HELP, planEidoCli, runEidoCli } from './eidoCli'
import { findEidoCliCommand, renderEidoCliCommandHelp } from './eidoCliCommands'
import { deriveEidoCliIdempotencyKey } from './eidoCliMutationKey'
import { completeEidoCliModConfigure } from './eidoCliV5'

const SAFETY = [
  '--expected-revision', '17',
  '--apply',
  '--request-id', 'request-v5',
  '--idempotency-key', 'idempotency-v5',
  '--command-id', 'command-v5',
] as const

const SWITCH_SPEC = Object.freeze({
  version: 1,
  kind: 'switch',
  title: 'EVIDENCE LENS',
  identity: 'mint',
  treatment: null,
  state: {
    items: [{ label: 'SKEPTICAL', on: true, frame: 'Challenge weak evidence.' }],
  },
})

describe('Eido CLI v5 research and Mod workflows', () => {
  it('derives the v5 mutation key from the command and lets an explicit key win', () => {
    const argv = [
      'card', 'layer', 'front', 'card-7', '--idea', 'idea-main',
      '--expected-revision', '17', '--apply',
    ]
    const key = (planned: ReturnType<typeof planEidoCli>): unknown => (
      planned.ok && planned.plan.kind === 'invoke'
        ? (planned.plan.request.params as Record<string, unknown>).idempotencyKey
        : undefined
    )

    const first = planEidoCli(argv, () => 'request-a')
    const second = planEidoCli(argv, () => 'request-b')
    const changed = planEidoCli([...argv.slice(0, 3), 'card-8', ...argv.slice(4)], () => 'request-c')
    const explicit = planEidoCli([...argv, '--idempotency-key', 'scripted'], () => 'request-d')

    expect(key(first)).toBe(deriveEidoCliIdempotencyKey([
      'cards', 'layer', 'front', 'card-7', '--idea', 'idea-main',
      '--expected-revision', '17', '--apply',
    ]))
    expect(key(second)).toBe(key(first))
    expect(key(changed)).not.toBe(key(first))
    expect(key(explicit)).toBe('scripted')
    // The request id stays the attempt identity, never part of the key.
    expect(first).toMatchObject({ plan: { request: { requestId: 'request-a' } } })
    expect(second).toMatchObject({ plan: { request: { requestId: 'request-b' } } })
  })

  it('advertises the first-class v5 surface through the layered help table', () => {
    // The index is a short orientation, so the surface detail now lives in the
    // group and leaf help generated from the command table.
    expect(EIDO_CLI_HELP).toContain('Command groups:')
    expect(EIDO_CLI_HELP).not.toContain('mod-template')
    for (const path of [
      ['ask', 'model'],
      ['card', 'arrange'],
      ['card', 'identity'],
      ['group', 'add'],
      ['result', 'choose'],
      ['mod', 'create'],
      ['mod', 'template', 'create'],
    ]) {
      const spec = findEidoCliCommand(path)
      expect(spec, `${path.join(' ')} is missing from the command table`).toBeDefined()
      expect(renderEidoCliCommandHelp(spec!)).toContain(`eido ${path.join(' ')}`)
    }
    expect(renderEidoCliCommandHelp(findEidoCliCommand(['card', 'identity'])!))
      .toContain('On Mods the accent is kept.')
    expect(renderEidoCliCommandHelp(findEidoCliCommand(['mod', 'create'])!))
      .toContain('direct Mod instance')
    expect(renderEidoCliCommandHelp(findEidoCliCommand(['card', 'arrange'])!))
      .toContain('eido cards arrange')
  })

  it('plans the complete research and organization command family', () => {
    expect(commands(['ask', 'model', 'ask-1', '--idea', 'idea-main', '--model', 'openai/gpt-5.6', ...SAFETY]))
      .toEqual([command('ask.set-model', {
        ideaId: 'idea-main', card: { cardId: 'ask-1' }, model: 'openai/gpt-5.6',
      })])

    expect(commands(['card', 'identity', 'note-1', '--idea', 'idea-main', '--identity', 'amber', '--fill', 'pattern', ...SAFETY]))
      .toEqual([command('card.set-identity', {
        ideaId: 'idea-main', card: { cardId: 'note-1' },
        identity: { preset: 'amber', fill: 'pattern' },
      })])
    expect(commands(['card', 'identity', 'note-1', '--idea', 'idea-main', '--clear', ...SAFETY]))
      .toEqual([command('card.set-identity', {
        ideaId: 'idea-main', card: { cardId: 'note-1' }, identity: null,
      })])
    expect(planEidoCli([
      'card', 'identity', 'note-1', '--idea', 'idea-main', '--clear', '--pretty', ...SAFETY,
    ], sequenceIds())).toMatchObject({ ok: true, plan: { kind: 'invoke', pretty: true } })

    const frames = JSON.stringify([
      { card: 'note-1', x: 10, y: 20, width: 300, height: 180 },
      { card: 'ask-1', x: 420, y: 20 },
    ])
    expect(commands(['cards', 'arrange', '--idea', 'idea-main', '--frames', frames, ...SAFETY]))
      .toEqual([command('cards.arrange', {
        ideaId: 'idea-main',
        frames: [
          { card: { cardId: 'note-1' }, position: { x: 10, y: 20 }, size: { width: 300, height: 180 } },
          { card: { cardId: 'ask-1' }, position: { x: 420, y: 20 } },
        ],
      })])
    expect(commands(['cards', 'layer', 'front', 'note-1', 'ask-1', '--idea', 'idea-main', ...SAFETY]))
      .toEqual([command('cards.reorder-layer', {
        ideaId: 'idea-main',
        cards: [{ cardId: 'note-1' }, { cardId: 'ask-1' }],
        direction: 'front',
      })])

    expect(commands(['group', 'add', 'group-1', 'note-1', 'ask-1', '--idea', 'idea-main', ...SAFETY]))
      .toEqual([
        command('group.membership.set', {
          ideaId: 'idea-main', card: { cardId: 'note-1' }, group: { cardId: 'group-1' },
        }),
        { ...command('group.membership.set', {
          ideaId: 'idea-main', card: { cardId: 'ask-1' }, group: { cardId: 'group-1' },
        }), id: 'command-v5:2' },
      ])
    expect(commands(['group', 'remove', 'note-1', 'ask-1', '--idea', 'idea-main', ...SAFETY]))
      .toEqual([
        command('group.membership.set', {
          ideaId: 'idea-main', card: { cardId: 'note-1' }, group: null,
        }),
        { ...command('group.membership.set', {
          ideaId: 'idea-main', card: { cardId: 'ask-1' }, group: null,
        }), id: 'command-v5:2' },
      ])

    expect(commands(['result', 'choose', 'output-1', '--idea', 'idea-main', '--version', 'version-2', ...SAFETY]))
      .toEqual([command('output.choose-version', {
        ideaId: 'idea-main', outputId: 'output-1', versionId: 'version-2',
      })])
    expect(commands(['result', 'accept', 'output-1', '--idea', 'idea-main', '--version', 'version-2', ...SAFETY]))
      .toEqual([command('output.set-accepted', {
        ideaId: 'idea-main', outputId: 'output-1', versionId: 'version-2', accepted: true,
      })])
    expect(commands(['result', 'unaccept', 'output-1', '--idea', 'idea-main', '--version', 'version-2', ...SAFETY]))
      .toEqual([command('output.set-accepted', {
        ideaId: 'idea-main', outputId: 'output-1', versionId: 'version-2', accepted: false,
      })])
  })

  it('keeps mod create direct and template creation explicitly separate', () => {
    const spec = JSON.stringify(SWITCH_SPEC)
    expect(commands([
      'mod', 'create', '--idea', 'idea-main', '--spec', spec, '--x', '100', '--y', '200',
      '--connect-to', 'ask-1', '--strength', 'weak', ...SAFETY,
    ])).toEqual([
      command('mod-instance.create', {
        ideaId: 'idea-main',
        mod: expect.objectContaining({
          kind: 'switch', title: 'EVIDENCE LENS', accent: '#65b563',
          state: { items: [{
            id: 'mod-part:command-v5:switch-item:0',
            label: 'SKEPTICAL', on: true, frame: 'Challenge weak evidence.',
          }] },
        }),
        position: { x: 100, y: 200 },
      }),
      {
        version: 1,
        id: 'command-v5:connect',
        name: 'connection.create',
        payload: {
          ideaId: 'idea-main',
          from: { createdByCommandId: 'command-v5' },
          to: { cardId: 'ask-1' },
          strength: 'weak',
          polarity: 'helps',
        },
      },
    ])

    expect(commands(['mod', 'template', 'create', 'template-evidence', '--spec', spec, ...SAFETY]))
      .toEqual([command('mod-template.create', {
        templateId: 'template-evidence',
        mod: expect.objectContaining({ kind: 'switch', title: 'EVIDENCE LENS' }),
      })])
  })

  it('plans Mod connect, stamp, delete, template delete, and bounded template listing', () => {
    expect(commands(['mod', 'connect', 'mod-card', 'ask-1', '--idea', 'idea-main', '--strength', 'strong', ...SAFETY]))
      .toEqual([command('connection.create', {
        ideaId: 'idea-main',
        from: { cardId: 'mod-card' },
        to: { cardId: 'ask-1' },
        strength: 'strong',
        polarity: 'helps',
      })])
    expect(commands(['mod', 'stamp', 'template-1', '--template-version', '3', '--idea', 'idea-main', '--x', '50', '--y', '60', ...SAFETY]))
      .toEqual([command('mod-instance.stamp', {
        ideaId: 'idea-main', templateId: 'template-1', expectedTemplateVersion: 3,
        position: { x: 50, y: 60 },
      })])
    expect(commands(['mod', 'delete', 'mod-card', '--idea', 'idea-main', ...SAFETY]))
      .toEqual([command('mod-instance.delete', { ideaId: 'idea-main', cardId: 'mod-card' })])
    expect(commands(['mod', 'template', 'delete', 'template-1', '--template-version', '3', ...SAFETY]))
      .toEqual([command('mod-template.delete', {
        templateId: 'template-1', expectedTemplateVersion: 3,
      })])

    expect(planEidoCli([
      'mod', 'template', 'list', '--limit', '20',
      '--projection', 'recordId', '--projection', 'payload',
    ], () => 'read-request'))
      .toMatchObject({
        ok: true,
        plan: {
          kind: 'invoke',
          request: {
            operation: 'mod-template.list',
            params: { limit: 20, projection: ['recordId', 'payload'] },
          },
        },
      })
  })

  it('plans inspection and configuration as read-then-adapt workflows', () => {
    const spec = JSON.stringify(SWITCH_SPEC)
    expect(planEidoCli(['mod', 'inspect', 'mod-card', '--idea', 'idea-main'], () => 'read-request'))
      .toMatchObject({
        ok: true,
        plan: {
          kind: 'mod-inspect',
          target: { kind: 'instance', cardId: 'mod-card' },
          request: {
            requestId: 'read-request',
            operation: 'graph.query',
            params: { recordKinds: ['mod-instance'], parentIds: ['mod-card'], limit: 2 },
          },
        },
      })
    expect(planEidoCli(['mod', 'template', 'inspect', 'template-1'], () => 'read-request'))
      .toMatchObject({
        ok: true,
        plan: {
          kind: 'mod-inspect',
          target: { kind: 'template', templateId: 'template-1' },
          request: { operation: 'record.get', params: { recordId: 'template-1' } },
        },
      })
    expect(planEidoCli([
      'mod', 'configure', 'mod-card', '--idea', 'idea-main', '--spec', spec, ...SAFETY,
    ], sequenceIds())).toMatchObject({
      ok: true,
      plan: {
        kind: 'mod-configure',
        target: { kind: 'instance', ideaId: 'idea-main', cardId: 'mod-card' },
        request: { requestId: 'generated-1', operation: 'graph.query' },
        mutation: {
          requestId: 'request-v5', expectedRevision: 17,
          idempotencyKey: 'idempotency-v5', commandId: 'command-v5', dryRun: false,
        },
      },
    })
    expect(planEidoCli([
      'mod', 'template', 'configure', 'template-1', '--template-version', '3', '--spec', spec,
      ...SAFETY,
    ], sequenceIds())).toMatchObject({
      ok: true,
      plan: {
        kind: 'mod-configure',
        target: { kind: 'template', templateId: 'template-1', expectedTemplateVersion: 3 },
        request: { requestId: 'generated-1', operation: 'record.get' },
      },
    })
  })

  it('rejects mutation safety ambiguity, foreign options, and malformed ergonomic specs', () => {
    const base = ['ask', 'model', 'ask-1', '--idea', 'idea-main', '--model', 'model-1']
    expect(planEidoCli([...base, '--apply'], sequenceIds())).toMatchObject({ ok: false })
    expect(planEidoCli([
      ...base, '--expected-revision', '1', '--apply', '--dry-run',
    ], sequenceIds())).toMatchObject({ ok: false })
    expect(planEidoCli([
      ...base, '--expected-revision', '1', '--apply', '--unknown', 'value',
    ], sequenceIds())).toMatchObject({ ok: false })
    expect(planEidoCli([
      'mod', 'create', '--idea', 'idea-main', '--spec', '{bad', '--x', '0', '--y', '0',
      '--expected-revision', '1', '--dry-run',
    ], sequenceIds())).toMatchObject({ ok: false })
  })

  it('runs Mod inspection as a bounded read and emits a round-trippable ergonomic spec', async () => {
    const mod = workflowSwitch('INSPECTED LENS')
    const invoke = vi.fn(async (request: ProfileGatewayRequest) => ({
      servedBy: 'live' as const,
      live: { state: 'served' as const, admission: 'admitted' as const },
      response: {
        version: 1 as const,
        requestId: request.requestId,
        ok: true as const,
        result: queryPage({
          recordId: 'mod-instance-1',
          kind: 'mod-instance',
          parentId: 'mod-card',
          payload: { source: { kind: 'direct' }, createdAt: '2026-08-05T00:00:00.000Z', mod },
        }),
      },
    }))
    const stdout: string[] = []
    const exitCode = await runEidoCli({
      argv: ['mod', 'inspect', 'mod-card', '--idea', 'idea-main'],
      createRequestId: () => 'inspect-request',
      describeGateway: () => { throw new Error('unexpected discovery') },
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: () => undefined },
      invoke: invoke as never,
      runRaw: async () => { throw new Error('unexpected raw route') },
    })

    expect(exitCode).toBe(0)
    expect(invoke).toHaveBeenCalledWith({
      version: 1,
      requestId: 'inspect-request',
      operation: 'graph.query',
      params: { recordKinds: ['mod-instance'], parentIds: ['mod-card'], limit: 2 },
    })
    const output = JSON.parse(stdout.join(''))
    expect(output).toMatchObject({
      ok: true,
      result: {
        target: {
          kind: 'instance', cardId: 'mod-card', instanceId: 'mod-instance-1',
          source: { kind: 'direct' },
        },
        spec: {
          version: 1,
          kind: 'switch',
          title: 'INSPECTED LENS',
          identity: 'green',
          state: { items: [expect.objectContaining({ id: 'existing-toggle' })] },
        },
        context: { treatment: expect.any(String), valueSentences: expect.any(Array) },
      },
      cli: { servedBy: 'live', live: { state: 'served' } },
    })
    expect(output.result.spec).not.toHaveProperty('context')
  })

  it('runs Mod configure as read, identity-preserving adaptation, then one pinned mutation', async () => {
    const existing = workflowSwitch('BEFORE')
    const spec = {
      version: 1,
      kind: 'switch',
      title: 'AFTER',
      identity: 'green',
      treatment: null,
      state: {
        items: [{
          id: 'existing-toggle', label: 'ON', on: true, frame: 'Keep the strongest evidence.',
        }],
      },
    }
    const requests: ProfileGatewayRequest[] = []
    const invoke = vi.fn(async (request: ProfileGatewayRequest) => {
      requests.push(request)
      if (request.operation === 'graph.query') {
        return {
          servedBy: 'headless' as const,
          live: { state: 'absent' as const, admission: 'none' as const, fallback: 'headless' as const },
          response: {
            version: 1 as const,
            requestId: request.requestId,
            ok: true as const,
            result: queryPage({
              recordId: 'mod-instance-1',
              kind: 'mod-instance',
              parentId: 'mod-card',
              payload: {
                source: { kind: 'direct' }, createdAt: '2026-08-05T00:00:00.000Z', mod: existing,
              },
            }),
          },
        }
      }
      return {
        servedBy: 'headless' as const,
        live: { state: 'absent' as const, admission: 'none' as const, fallback: 'headless' as const },
        response: {
          version: 1 as const,
          requestId: request.requestId,
          ok: true as const,
          result: { kind: 'agent-command-batch', version: 5 },
        },
      }
    })
    const stdout: string[] = []
    const exitCode = await runEidoCli({
      argv: [
        'mod', 'configure', 'mod-card', '--idea', 'idea-main', '--spec', JSON.stringify(spec),
        ...SAFETY,
      ],
      createRequestId: sequenceIds(),
      describeGateway: () => { throw new Error('unexpected discovery') },
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: () => undefined },
      invoke: invoke as never,
      runRaw: async () => { throw new Error('unexpected raw route') },
    })

    expect(exitCode).toBe(0)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual({
      version: 1,
      requestId: 'request-v5',
      operation: 'command.batch',
      params: {
        version: 1,
        schemaVersion: 1,
        expectedRevision: 17,
        idempotencyKey: 'idempotency-v5',
        dryRun: false,
        commands: [{
          version: 1,
          id: 'command-v5',
          name: 'mod-instance.configure',
          payload: {
            ideaId: 'idea-main',
            cardId: 'mod-card',
            mod: expect.objectContaining({
              title: 'AFTER',
              state: { items: [{
                id: 'existing-toggle', label: 'ON', on: true,
                frame: 'Keep the strongest evidence.',
              }] },
            }),
          },
        }],
      },
    })
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      ok: true,
      cli: { servedBy: 'headless', live: { fallback: 'headless' } },
    })
  })

  it('reconstructs an exact applied configure request when omitted ids were command-derived', () => {
    const expectedId = 'mod-part:command-v5:switch-item:1'
    const before = workflowSwitch('BEFORE')
    const spec = {
      version: 1,
      kind: 'switch',
      title: 'AFTER',
      identity: 'green',
      treatment: null,
      state: {
        items: [{
          id: 'existing-toggle',
          label: 'ON',
          on: true,
          frame: '',
        }, {
          label: 'VERIFY',
          on: true,
          frame: 'Keep the strongest evidence.',
        }],
      },
    }
    const planned = planEidoCli([
      'mod', 'configure', 'mod-card', '--idea', 'idea-main', '--spec', JSON.stringify(spec),
      ...SAFETY,
    ], sequenceIds())
    expect(planned).toMatchObject({ ok: true, plan: { kind: 'mod-configure' } })
    if (!planned.ok || planned.plan.kind !== 'mod-configure') return

    const firstRequest = completeEidoCliModConfigure(planned.plan, {
      version: 1,
      requestId: planned.plan.request.requestId,
      ok: true,
      result: queryPage({
        recordId: 'mod-instance-1',
        kind: 'mod-instance',
        parentId: 'mod-card',
        payload: {
          source: { kind: 'direct' },
          createdAt: '2026-08-05T00:00:00.000Z',
          mod: before,
        },
      }),
    })
    expect(firstRequest).toMatchObject({
      operation: 'command.batch',
      params: {
        idempotencyKey: 'idempotency-v5',
        commands: [{
          id: 'command-v5',
          name: 'mod-instance.configure',
          payload: {
            mod: { state: { items: [{ id: 'existing-toggle' }, { id: expectedId }] } },
          },
        }],
      },
    })
    const applied = firstRequest as unknown as Readonly<{
      params: Readonly<{
        commands: readonly [Readonly<{
          payload: Readonly<{ mod: ProfileJsonValue }>
        }>]
      }>
    }>
    const retryRequest = completeEidoCliModConfigure(planned.plan, {
      version: 1,
      requestId: planned.plan.request.requestId,
      ok: true,
      result: queryPage({
        recordId: 'mod-instance-1',
        kind: 'mod-instance',
        parentId: 'mod-card',
        payload: {
          source: { kind: 'direct' },
          createdAt: '2026-08-05T00:00:00.000Z',
          mod: applied.params.commands[0].payload.mod,
        },
      }),
    })

    expect(retryRequest).toEqual(firstRequest)
  })
})

function commands(argv: readonly string[]): readonly unknown[] {
  const result = planEidoCli(argv, sequenceIds())
  expect(result.ok).toBe(true)
  if (!result.ok || result.plan.kind !== 'invoke') return []
  expect(result.plan.request.operation).toBe('command.batch')
  return result.plan.request.params.commands as readonly unknown[]
}

function command(name: string, payload: unknown) {
  return { version: 1, id: 'command-v5', name, payload }
}

function sequenceIds(): () => string {
  let value = 0
  return () => `generated-${++value}`
}

function queryPage(item: Readonly<{
  recordId: string
  kind: 'mod-instance' | 'mod-template'
  parentId: string
  payload: ProfileJsonValue
}>): ProfileQueryPage {
  return {
    profileId: 'profile-main',
    revision: 17,
    items: [{
      ...item,
      ownerId: item.kind === 'mod-instance' ? 'board:idea-main' : 'profile-main',
      ordinal: 0,
      recordVersion: 2,
    }],
    truncated: false,
  }
}

async function* emptyInput(): AsyncGenerator<string> {
  // No stdin is consumed by ergonomic commands.
}

function workflowSwitch(title: string) {
  const mod = createSeedMod('switch', {
    title,
    createId: (_role, ordinal) => `existing-toggle-${ordinal}`,
  })
  mod.state.items = [{
    id: 'existing-toggle',
    label: 'ON',
    on: true,
    frame: '',
  }]
  return mod
}
