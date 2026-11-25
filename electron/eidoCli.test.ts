import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createProfileGatewaySession } from '../src/persistence/profileAgentGateway'
import { EIDO_CLI_HELP, planEidoCli, planEidoCliIdentity, runEidoCli } from './eidoCli'
import { deriveEidoCliIdempotencyKey } from './eidoCliMutationKey'
import { resolveEidoCliValueSources } from './eidoCliValueSources'
import {
  EIDO_CLI_COMMANDS,
  EIDO_CLI_GROUPS,
  renderEidoCliCommandHelp,
} from './eidoCliCommands'

/** Split one help example the way a POSIX shell would, honouring both quotes. */
function tokenizeShellLine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let started = false
  let quote: '\'' | '"' | null = null
  for (const character of line) {
    if (quote === null && (character === '\'' || character === '"')) {
      quote = character
      started = true
      continue
    }
    if (quote === character) {
      quote = null
      continue
    }
    const quoted = quote !== null
    if (!quoted && /\s/.test(character)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += character
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

describe('eido command planning (#712)', () => {
  it('assembles status into one Gateway envelope', () => {
    expect(planEidoCli(['status'], () => 'request-fixed')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-fixed',
          operation: 'profile.status',
          params: {},
        },
      },
    })
  })

  it('keeps ergonomic capabilities Agent-filtered', () => {
    expect(planEidoCli(['--pretty', 'capabilities'], () => 'request-capabilities')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: true,
        request: {
          version: 1,
          requestId: 'request-capabilities',
          operation: 'agent.capabilities',
          params: {},
        },
      },
    })
    expect(planEidoCli(['agent', 'capabilities'], () => 'request-agent-capabilities'))
      .toMatchObject({
        ok: true,
        plan: {
          request: {
            requestId: 'request-agent-capabilities',
            operation: 'agent.capabilities',
            params: {},
          },
        },
      })
  })

  it('assembles bounded Idea list options without transport authority', () => {
    expect(planEidoCli([
      'idea', 'list',
      '--limit', '4',
      '--byte-limit', '4096',
      '--cursor', 'cursor-next',
      '--projection', 'id',
      '--projection', 'name',
    ], () => 'request-ideas')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-ideas',
          operation: 'idea.list',
          params: {
            limit: 4,
            byteLimit: 4096,
            cursor: 'cursor-next',
            projection: ['id', 'name'],
          },
        },
      },
    })
  })

  it('plans one named Idea dry-run with explicit replay identities', () => {
    expect(planEidoCli([
      'idea', 'create', 'Chicken Research_1',
      '--expected-revision', '3233',
      '--dry-run',
      '--request-id', 'request-create-idea',
      '--idempotency-key', 'retry-create-idea',
      '--command-id', 'command-create-idea',
    ], () => 'unexpected-generated-id')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-create-idea',
          operation: 'command.batch',
          params: {
            version: 1,
            schemaVersion: 1,
            expectedRevision: 3233,
            idempotencyKey: 'retry-create-idea',
            dryRun: true,
            commands: [{
              version: 1,
              id: 'command-create-idea',
              name: 'idea.create',
              payload: { name: 'Chicken Research_1' },
            }],
          },
        },
      },
    })
  })

  it('plans one named Idea apply with a derived retry identity', () => {
    let generated = 0
    const derivedKey = deriveEidoCliIdempotencyKey([
      'idea', 'create', 'Chicken Research_2',
      '--expected-revision', '3234',
      '--apply',
    ])
    expect(planEidoCli([
      'idea', 'create', 'Chicken Research_2',
      '--expected-revision', '3234',
      '--apply',
      '--pretty',
    ], () => `generated-${++generated}`)).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: true,
        request: {
          version: 1,
          requestId: 'generated-1',
          operation: 'command.batch',
          params: {
            version: 1,
            schemaVersion: 1,
            expectedRevision: 3234,
            idempotencyKey: derivedKey,
            dryRun: false,
            commands: [{
              version: 1,
              id: `command:${derivedKey}`,
              name: 'idea.create',
              payload: { name: 'Chicken Research_2' },
            }],
          },
        },
      },
    })
    // Only the request id is generated; the key comes from the command itself.
    expect(generated).toBe(1)
  })

  it('separates a previewed mutation from the real one in the derived key', () => {
    const base = ['idea', 'create', 'Chicken Research_4', '--expected-revision', '3235'] as const
    const preview = deriveEidoCliIdempotencyKey([...base, '--dry-run'])
    const apply = deriveEidoCliIdempotencyKey([...base, '--apply'])

    // A shared key would let the preview swallow the apply as a duplicate retry.
    expect(preview).not.toBe(apply)

    // Envelope identity and formatting are attempt detail, so the intent is one key.
    expect(deriveEidoCliIdempotencyKey([
      ...base, '--apply', '--pretty',
      '--request-id', 'request-a', '--command-id', 'command-a',
      '--idempotency-key', 'key-a',
    ])).toBe(apply)
    expect(deriveEidoCliIdempotencyKey([
      ...base, '--apply',
      '--request-id', 'request-b', '--command-id', 'command-b',
      '--idempotency-key', 'key-b',
    ])).toBe(apply)
  })

  it('rejects malformed Idea creation before minting request identity', () => {
    let generated = 0
    for (const argv of [
      ['idea', 'create'],
      ['idea', 'create', ''],
      ['idea', 'create', 'Chicken Research_3', 'unexpected'],
      ['idea', 'create', 'Chicken Research_3', '--expected-revision', '-1', '--dry-run'],
      ['idea', 'create', 'Chicken Research_3', '--expected-revision', '7'],
      [
        'idea', 'create', 'Chicken Research_3',
        '--expected-revision', '7', '--dry-run', '--apply',
      ],
      [
        'idea', 'create', '--apply',
        '--expected-revision', '7', '--dry-run',
        '--request-id', 'request-option-name',
        '--idempotency-key', 'retry-option-name',
      ],
    ]) {
      expect(planEidoCli(argv, () => `generated-${++generated}`)).toMatchObject({ ok: false })
    }
    expect(generated).toBe(0)
  })

  it('plans one existing Idea activation from a raw id or Card Deep Link', () => {
    const expected = {
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-activate',
          operation: 'command.batch',
          params: {
            version: 1,
            schemaVersion: 1,
            expectedRevision: 8,
            idempotencyKey: 'activate-second',
            dryRun: false,
            commands: [{
              version: 1,
              id: 'activate-second-command',
              name: 'idea.activate',
              payload: { ideaId: 'idea-second' },
            }],
          },
        },
      },
    }
    const options = [
      '--expected-revision', '8',
      '--apply',
      '--request-id', 'request-activate',
      '--idempotency-key', 'activate-second',
      '--command-id', 'activate-second-command',
    ]
    expect(planEidoCli(['idea', 'activate', 'idea-second', ...options], () => 'unexpected'))
      .toEqual(expected)
    expect(planEidoCli([
      'idea', 'activate',
      'eido://app/?idea=idea-second&card=context-card&x=99&y=-40&zoom=0.2',
      ...options,
    ], () => 'unexpected')).toEqual(expected)

    let generated = 0
    const oversizedIdeaId = 'i'.repeat(513)
    for (const argv of [
      ['idea', 'activate'],
      ['idea', 'activate', 'eido://app/?card=context-card'],
      [
        'idea', 'activate', oversizedIdeaId,
        '--expected-revision', '8', '--apply',
      ],
      [
        'idea', 'activate',
        `eido://app/?idea=${oversizedIdeaId}&card=context-card`,
        '--expected-revision', '8', '--apply',
      ],
      ['idea', 'activate', 'idea-second', 'unexpected'],
      ['idea', 'activate', 'idea-second', '--expected-revision', '8'],
      ['idea', 'activate', 'idea-second', '--expected-revision', '8', '--dry-run', '--apply'],
    ]) {
      expect(planEidoCli(argv, () => `generated-${++generated}`)).toMatchObject({ ok: false })
    }
    expect(generated).toBe(0)
  })

  it('assembles the bounded newest-first Agent change trail with paging', () => {
    expect(planEidoCli([
      'changes',
      '--since', '4',
      '--limit', '3',
      '--byte-limit', '4096',
      '--cursor', 'cursor-next',
      '--pretty',
    ], () => 'request-changes')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: true,
        request: {
          version: 1,
          requestId: 'request-changes',
          operation: 'changes.list',
          params: {
            since: 4,
            limit: 3,
            byteLimit: 4096,
            cursor: 'cursor-next',
          },
        },
      },
    })
    expect(planEidoCli(['changes'], () => 'request-all-changes')).toMatchObject({
      ok: true,
      plan: { request: { operation: 'changes.list', params: {} } },
    })
  })

  it('rejects invalid Agent change trail bounds before creating request identity', () => {
    let generated = 0
    for (const argv of [
      ['changes', '--since', '-1'],
      ['changes', '--since', '1.5'],
      ['changes', '--limit', '0'],
      ['changes', '--since', '1', '--since', '2'],
      ['changes', '--projection', 'recordId'],
    ]) {
      expect(planEidoCli(argv, () => `generated-${++generated}`)).toMatchObject({ ok: false })
    }
    expect(generated).toBe(0)
  })

  it('uses Card Deep Link identity and ignores viewport hints for graph reads', () => {
    const link = 'eido://app/?idea=idea-linked&card=card-linked&x=900&y=-40&zoom=0.5'
    expect(planEidoCli([
      'graph', 'query',
      '--kind', 'card',
      '--card', link,
      '--idea', link,
      '--parent', link,
    ], () => 'request-graph')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-graph',
          operation: 'graph.query',
          params: {
            recordKinds: ['card'],
            recordIds: ['card-linked'],
            ownerIds: ['board:idea-linked'],
            parentIds: ['card-linked'],
          },
        },
      },
    })
  })

  it('keeps exact logical ownership distinct from ergonomic Idea Board scope', () => {
    expect(planEidoCli([
      'graph', 'query',
      '--kind', 'card',
      '--owner', 'owner-raw',
      '--idea', 'idea-linked',
    ], () => 'request-owner-scope')).toMatchObject({
      ok: true,
      plan: {
        request: {
          operation: 'graph.query',
          params: {
            recordKinds: ['card'],
            ownerIds: ['owner-raw', 'board:idea-linked'],
          },
        },
      },
    })
    expect(planEidoCli([
      'graph', 'query',
      '--owner', 'eido://app/?idea=idea-linked&card=card-linked',
    ], () => 'request-owner-link')).toMatchObject({ ok: false })
  })

  it('assembles one bounded neighborhood read from a Card Deep Link', () => {
    expect(planEidoCli([
      'graph', 'neighbors',
      'eido://app/?idea=idea-linked&card=card-linked&x=900&y=-40&zoom=0.5',
      '--limit', '7',
      '--byte-limit', '8192',
    ], () => 'request-neighbors')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-neighbors',
          operation: 'graph.neighbors',
          params: {
            ideaId: 'idea-linked',
            card: 'card-linked',
            limit: 7,
            byteLimit: 8192,
          },
        },
      },
    })
  })

  it('assembles one bounding-box read from interchangeable Card addresses', () => {
    expect(planEidoCli([
      'graph', 'bounds',
      'eido://app/?idea=idea-linked&card=card-b&x=9&y=8&zoom=0.2',
      'card-a',
      '--idea', 'idea-linked',
    ], () => 'request-bounds')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-bounds',
          operation: 'graph.bounds',
          params: {
            ideaId: 'idea-linked',
            cards: ['card-b', 'card-a'],
          },
        },
      },
    })
  })

  it('passes the bounded Card creator filter through graph query', () => {
    expect(planEidoCli([
      'graph', 'query', '--creator', 'agent', '--kind', 'card',
    ], () => 'request-agent-cards')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-agent-cards',
          operation: 'graph.query',
          params: { creator: 'agent', recordKinds: ['card'] },
        },
      },
    })

    let generated = 0
    for (const argv of [
      ['graph', 'query', '--creator', 'system'],
      ['graph', 'query', '--creator', 'agent', '--creator', 'user'],
    ]) {
      expect(planEidoCli(argv, () => `generated-${++generated}`)).toMatchObject({ ok: false })
    }
    expect(generated).toBe(0)
  })

  it('gets the authoritative Card from a deep link', () => {
    const link = 'eido://app/?idea=idea-linked&card=card-linked&x=1&y=2&zoom=3'
    expect(planEidoCli([
      'record', 'get', link,
      '--byte-limit', '2048',
      '--projection', 'payload',
    ], () => 'request-record')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-record',
          operation: 'record.get',
          params: {
            recordId: 'card-linked',
            byteLimit: 2048,
            projection: ['payload'],
          },
        },
      },
    })
  })

  it('plans bounded Result inspection from a Deep Link or explicit Idea', () => {
    expect(planEidoCli([
      'result', 'inspect',
      'eido://app/?idea=idea-linked&card=result-linked&x=1&y=2&zoom=3',
      '--limit', '5',
      '--byte-limit', '8192',
      '--cursor', 'next-result-page',
      '--pretty',
    ], () => 'request-result-inspect')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: true,
        request: {
          version: 1,
          requestId: 'request-result-inspect',
          operation: 'result.inspect',
          params: {
            ideaId: 'idea-linked',
            resultCardId: 'result-linked',
            limit: 5,
            byteLimit: 8192,
            cursor: 'next-result-page',
          },
        },
      },
    })
    expect(planEidoCli([
      'result', 'inspect', 'result-explicit', '--idea', 'idea-explicit',
    ], () => 'request-result-explicit')).toMatchObject({
      ok: true,
      plan: {
        request: {
          operation: 'result.inspect',
          params: { ideaId: 'idea-explicit', resultCardId: 'result-explicit' },
        },
      },
    })

    let generated = 0
    for (const argv of [
      ['result', 'inspect', 'result-without-idea'],
      ['result', 'inspect', 'eido://app/?idea=idea-a&card=result-a', '--idea', 'idea-b'],
      ['result', 'inspect', 'result-a', '--idea', 'idea-a', '--limit', '0'],
      ['result', 'inspect', 'result-a', '--idea', 'idea-a', '--projection', 'text'],
    ]) {
      expect(planEidoCli(argv, () => `generated-${++generated}`)).toMatchObject({ ok: false })
    }
    expect(generated).toBe(0)
  })

  it('submits a live delegated run from either a Card Deep Link or explicit Idea', () => {
    expect(planEidoCli([
      'run',
      'eido://app/?idea=idea-linked&card=ask-linked&x=1&y=2&zoom=3',
    ], () => 'request-run-submit')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-run-submit',
          operation: 'run.submit',
          params: { ideaId: 'idea-linked', targetCardId: 'ask-linked' },
        },
      },
    })
    expect(planEidoCli([
      'run', 'ask-explicit', '--idea', 'idea-explicit', '--variations', '3', '--pretty',
    ], () => 'request-run-explicit')).toMatchObject({
      ok: true,
      plan: {
        pretty: true,
        request: {
          operation: 'run.submit',
          params: {
            ideaId: 'idea-explicit',
            targetCardId: 'ask-explicit',
            mode: 'variations',
            variationCount: 3,
          },
        },
      },
    })
    expect(planEidoCli([
      'run', 'ask-explicit', '--idea', 'idea-explicit', '--variations', '9',
    ], () => 'unused')).toMatchObject({ ok: false })
  })

  it('plans run status and bounded artifact-reference reads', () => {
    expect(planEidoCli([
      'run', 'status', 'agent-run_1',
    ], () => 'request-run-status')).toMatchObject({
      ok: true,
      plan: {
        request: {
          requestId: 'request-run-status',
          operation: 'run.status',
          params: { runId: 'agent-run_1' },
        },
      },
    })
    expect(planEidoCli([
      'run', 'read', 'agent-run_1',
      '--limit', '5',
      '--byte-limit', '8192',
      '--cursor', 'next-page',
    ], () => 'request-run-read')).toMatchObject({
      ok: true,
      plan: {
        request: {
          requestId: 'request-run-read',
          operation: 'run.read',
          params: {
            runId: 'agent-run_1',
            limit: 5,
            byteLimit: 8192,
            cursor: 'next-page',
          },
        },
      },
    })
  })

  it('rejects ambiguous or unbounded run arguments before minting request identity', () => {
    let generated = 0
    for (const argv of [
      ['run', 'ask-without-idea'],
      ['run', 'eido://app/?idea=idea-a&card=ask-a', '--idea', 'idea-b'],
      ['run', 'status'],
      ['run', 'status', 'agent-run_1', '--idea', 'idea-a'],
      ['run', 'read', 'agent-run_1', '--limit', '0'],
      ['run', 'read', 'agent-run_1', '--projection', 'payload'],
      ['run', 'read', 'eido://app/?idea=idea-a&card=ask-a'],
    ]) {
      expect(planEidoCli(argv, () => `generated-${++generated}`)).toMatchObject({ ok: false })
    }
    expect(generated).toBe(0)
  })

  it('keeps installed Mod template reads out of ergonomic Agent CLI discovery', () => {
    let generated = 0
    expect(planEidoCli([
      'mod-template', 'list', '--limit', '3',
    ], () => `request-mod-templates-${++generated}`)).toMatchObject({ ok: false })
    expect(EIDO_CLI_HELP).not.toContain('mod-template')
    expect(generated).toBe(0)
  })

  it('plans static discovery without creating a request identity', () => {
    let ids = 0
    expect(planEidoCli(['describe', 'graph.query'], () => {
      ids += 1
      return 'unexpected'
    })).toEqual({
      ok: true,
      plan: { kind: 'describe', operation: 'graph.query', full: false, pretty: false },
    })
    expect(ids).toBe(0)
  })

  it('orients a zero-context caller and preserves raw batch mode', () => {
    expect(planEidoCli([], () => 'unused')).toEqual({
      ok: true,
      plan: { kind: 'help', topic: { kind: 'index' } },
    })
    expect(planEidoCli(['--help'], () => 'unused')).toEqual({
      ok: true,
      plan: { kind: 'help', topic: { kind: 'index' } },
    })
    expect(planEidoCli(['batch'], () => 'unused')).toEqual({
      ok: true,
      plan: { kind: 'batch' },
    })
  })

  it('projects the installed Gateway registry without opening Profile authority', async () => {
    let opens = 0
    const gateway = createProfileGatewaySession({
      async openService() {
        opens += 1
        throw new Error('static discovery opened authority')
      },
    })
    const stdout: string[] = []
    const exitCode = await runEidoCli({
      argv: ['describe', 'graph.query'],
      createRequestId: () => 'unused',
      describeGateway: () => gateway.describeAgentCli(),
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: () => undefined },
      runRaw: async () => { throw new Error('describe invoked raw transport') },
    })

    expect(exitCode).toBe(0)
    expect(opens).toBe(0)
    expect(JSON.parse(stdout.join(''))).toEqual(
      gateway.describeAgentCli().operations.find(operation => operation.name === 'graph.query'),
    )
  })

  it('orients a zero-context agent from bare eido with a short index', async () => {
    const printed = await helpOutput([])

    expect(printed.exitCode).toBe(0)
    expect(printed.stdout).toContain('Eido is a local visual thinking board')
    expect(printed.stdout).toContain('Command groups:')
    expect(printed.stdout).toContain('eido <group> --help')
    expect(printed.stdout).toContain('eido status')
    expect(printed.stdout).toContain('eido agent capabilities')
    expect(printed.stdout).toContain('eido describe')
    for (const group of EIDO_CLI_GROUPS) {
      expect(printed.stdout).toContain(group.name)
    }
    // The index must stay a short orientation, not the whole surface.
    expect(printed.stdout.split('\n').length).toBeLessThanOrEqual(40)
    expect(printed.stdout).not.toContain('--conversation-style')
    expect(printed.stdout).not.toContain('--connect-from')
    expect(printed.stdout).not.toContain('mixer')
    expect(printed.stdout).not.toContain('orchid')
    expect(printed.stdout).not.toContain('surface-v4')
    expect(printed.stdout).toBe(EIDO_CLI_HELP)
    expect(await helpOutput(['--help'])).toEqual(printed)
    expect(await helpOutput(['-h'])).toEqual(printed)
    expect(await helpOutput(['help'])).toEqual(printed)
    expect(await helpOutput(['--help', '--pretty'])).toEqual(printed)
  })

  it('teaches one command at a time through layered help', async () => {
    const group = await helpOutput(['card', '--help'])
    expect(group.exitCode).toBe(0)
    expect(group.stdout).toContain('card create')
    expect(group.stdout).toContain('card delete')
    expect(group.stdout).not.toContain('--compression-prompt')

    const leaf = await helpOutput(['card', 'create', '--help'])
    expect(leaf.exitCode).toBe(0)
    expect(leaf.stdout).toContain('Synopsis:')
    expect(leaf.stdout).toContain('--compression-prompt')
    expect(leaf.stdout).toContain('Examples:')
    expect(leaf.stdout).toContain('--expected-revision 12 --dry-run')
    expect(leaf.stdout).toContain('confirmation bypass')
    expect(leaf.stdout).toContain('stderr carries diagnostics')
    expect(await helpOutput(['help', 'card', 'create'])).toEqual(leaf)
    expect(await helpOutput(['card', '--help', 'create'])).toEqual(leaf)

    const run = await helpOutput(['run', '--help'])
    expect(run.stdout).toContain('run status')
    expect(run.stdout).toContain('run read')

    const mod = await helpOutput(['mod', '--help'])
    expect(mod.stdout).toContain('mod template create')
  })

  it('gives every command in the table a real example invocation', () => {
    for (const spec of EIDO_CLI_COMMANDS) {
      expect(spec.examples.length).toBeGreaterThan(0)
      for (const example of spec.examples) expect(example).toContain('eido ')
      const help = renderEidoCliCommandHelp(spec)
      expect(help).toContain('Examples:')
      expect(help).toContain(spec.examples[0]!.split('\n').at(-1)!)
      if (!spec.mutating) continue
      const sequence = spec.examples.find(example => (
        example.includes('eido status')
          && example.includes('--dry-run')
          && example.includes('--apply')
      ))
      expect(sequence, `mutating ${spec.path.join(' ')} needs a safe sequence example`)
        .toBeDefined()
    }
  })

  it('plans every example in the table, so the help never teaches a rejected command', () => {
    for (const spec of EIDO_CLI_COMMANDS) {
      for (const example of spec.examples) {
        // A shell recipe (substitutions, line continuations) is prose about
        // chaining commands, not a single invocation the planner can read.
        if (/[$\\]/.test(example)) continue
        for (const line of example.split('\n')) {
          if (line.trimStart().startsWith('#')) continue
          const argv = tokenizeShellLine(line)
          // A piped example (`cat note.md | eido …`) still plans from `eido`.
          const start = argv.indexOf('eido')
          expect(start, `example: ${line}`).toBeGreaterThanOrEqual(0)
          // Anything piped or redirected after the invocation belongs to the shell.
          const tail = argv.slice(start + 1)
          const end = tail.findIndex(token => token === '|' || token === '>')
          const invocation = end < 0 ? tail : tail.slice(0, end)
          // `-` and `@PATH` values are resolved before planning, so a planner
          // check on them would only be testing the placeholder text.
          if (invocation.some(token => token === '-' || token.startsWith('@'))) continue
          expect(planEidoCli(invocation, () => 'request-example'), `example: ${line}`)
            .toMatchObject({ ok: true })
        }
      }
    }
  })

  it('prints the threaded app version', async () => {
    const stdout: string[] = []
    const exitCode = await runEidoCli({
      argv: ['--version'],
      appVersion: '9.9.9',
      createRequestId: () => 'unused',
      describeGateway: () => { throw new Error('version requested discovery') },
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: () => undefined },
      runRaw: async () => { throw new Error('version invoked raw transport') },
    })

    expect(exitCode).toBe(0)
    expect(stdout.join('')).toBe('eido 9.9.9\n')
  })

  it('names the offending token and answers on stdout when usage fails', async () => {
    const failure = await runOutput(['idea', 'list', '--limit', 'abc'])

    expect(failure.exitCode).toBe(2)
    expect(JSON.parse(failure.stdout)).toEqual({
      version: 1,
      requestId: null,
      ok: false,
      error: {
        code: 'cli.usage',
        message: 'Value "abc" is not valid for --limit.',
        command: ['idea', 'list'],
        hint: expect.stringContaining('eido idea list --help'),
      },
    })
    expect(failure.stderr).toContain('Value "abc" is not valid for --limit.')
    expect(failure.stderr).toContain('eido idea list --limit 20')

    const unknownFlag = await runOutput(['graph', 'neighbors', 'card-7', '--idea', 'idea-main', '--foo', '1'])
    expect(unknownFlag.stderr).toContain('Unknown option --foo.')

    const missingValue = await runOutput(['card', 'create', '--idea'])
    expect(missingValue.stderr).toContain('Option --idea needs a value.')

    const badAddress = await runOutput(['card', 'delete', 'card-7'])
    expect(badAddress.stderr).toContain('needs --idea IDEA')

    const missingRevision = await runOutput(['card', 'delete', 'card-7', '--idea', 'idea-main', '--apply'])
    expect(missingRevision.stderr).toContain('--expected-revision')

    const unsupported = await runOutput(['record', 'get', 'card-7', '--limit', '3'])
    expect(unsupported.stderr).toContain('does not support --limit or --cursor')
    expect(unsupported.stderr).toContain('--byte-limit')

    const batchPretty = await runOutput(['batch', '--pretty'])
    expect(batchPretty.stderr).toContain('unchanged Gateway envelope')
  })

  it('warns once about the deprecated --text alias without changing the outcome', async () => {
    const planned = planEidoCli([
      'card', 'update', 'card-7', '--idea', 'idea-main', '--text', 'Body',
      '--expected-revision', '3', '--apply',
    ], () => 'request-text')

    expect(planned.ok).toBe(true)
    // A usage failure still carries the notice, and stdout stays the outcome.
    const printed = await runOutput(['card', 'update', 'card-7', '--text', 'Body'])
    expect(printed.stderr).toContain('--text is a deprecated alias for --body')
  })

  it('keeps older spellings working as aliases beside the canonical ones', () => {
    const identical = (left: readonly string[], right: readonly string[]) => {
      expect(planEidoCli(left, () => 'request-alias'))
        .toEqual(planEidoCli(right, () => 'request-alias'))
    }
    identical(['capabilities'], ['agent', 'capabilities'])
    identical(['changes', '--limit', '5'], ['changes', 'list', '--limit', '5'])
    identical(
      ['cards', 'layer', 'front', 'card-7', '--idea', 'idea-main', '--expected-revision', '3', '--apply'],
      ['card', 'layer', 'front', 'card-7', '--idea', 'idea-main', '--expected-revision', '3', '--apply'],
    )
    identical(
      ['cards', 'arrange', '--idea', 'idea-main', '--frames', '[{"card":"card-7","x":0,"y":0}]', '--expected-revision', '3', '--apply'],
      ['card', 'arrange', '--idea', 'idea-main', '--frames', '[{"card":"card-7","x":0,"y":0}]', '--expected-revision', '3', '--apply'],
    )
  })

  it('summarizes the operation registry and suggests near misses', async () => {
    const gateway = createProfileGatewaySession({
      async openService() { throw new Error('describe opened authority') },
    })
    const summary = await runOutput(['describe'], () => gateway.describeAgentCli())
    const parsed = JSON.parse(summary.stdout) as {
      operations: readonly { name: string; summary: string; mutating: boolean }[]
    }
    expect(summary.exitCode).toBe(0)
    expect(parsed.operations.length).toBe(gateway.describeAgentCli().operations.length)
    expect(parsed.operations[0]).toEqual({
      name: gateway.describeAgentCli().operations[0]!.name,
      summary: gateway.describeAgentCli().operations[0]!.summary,
      mutating: gateway.describeAgentCli().operations[0]!.mutating,
    })
    expect(summary.stdout).not.toContain('additionalProperties')

    const full = await runOutput(['describe', '--full'], () => gateway.describeAgentCli())
    expect(JSON.parse(full.stdout)).toEqual(gateway.describeAgentCli())

    const unknown = await runOutput(['describe', 'graph.querry'], () => gateway.describeAgentCli())
    expect(unknown.exitCode).toBe(2)
    expect(unknown.stderr).toContain('Unknown operation "graph.querry"')
    expect(unknown.stderr).toContain('graph.query')
    await gateway.close()
  })

  it('passes batch stdin and process writers to the certified raw adapter unchanged', async () => {
    const stdin = emptyInput()
    const stdout = { write: (_value: string) => undefined }
    const stderr = { write: (_value: string) => undefined }
    let calls = 0
    const exitCode = await runEidoCli({
      argv: ['batch'],
      createRequestId: () => 'unused',
      describeGateway: () => { throw new Error('batch requested discovery') },
      stdin,
      stdout,
      stderr,
      async runRaw(io) {
        calls += 1
        expect(io).toEqual({ stdin, stdout, stderr })
        return 7
      },
    })

    expect(calls).toBe(1)
    expect(exitCode).toBe(7)
  })

  it('strips bounded global Agent identity before command planning', () => {
    expect(planEidoCliIdentity([
      '--agent-client', 'codex',
      'status',
      '--agent-session', 'codex-process-7',
    ], {
      EIDO_AGENT_CLIENT: 'ignored-env-client',
      EIDO_AGENT_SESSION_ID: 'ignored-env-session',
    }, () => 'generated-session')).toEqual({
      ok: true,
      argv: ['status'],
      identity: { client: 'codex', sessionId: 'codex-process-7' },
    })
    expect(planEidoCliIdentity(['status'], {
      EIDO_AGENT_CLIENT: 'claude-code',
    }, () => 'generated-process-session')).toEqual({
      ok: true,
      argv: ['status'],
      identity: { client: 'claude-code', sessionId: 'generated-process-session' },
    })
    for (const argv of [
      ['--agent-client', 'bad\nclient', 'status'],
      ['--agent-session', 'x'.repeat(129), 'status'],
      ['--agent-client', 'one', '--agent-client', 'two', 'status'],
    ]) {
      expect(planEidoCliIdentity(argv, {}, () => 'session')).toMatchObject({ ok: false })
    }
  })

  it('preserves identity-looking content values while stripping globals at any placement', () => {
    const planned = planEidoCliIdentity([
      'card',
      '--agent-client', 'codex',
      'create',
      '--idea', 'idea-main',
      '--kind', 'note',
      '--x', '1',
      '--y', '2',
      '--body', '--agent-client',
      '--connect-from', 'card-anchor',
      '--reason', '--agent-session',
      '--expected-revision', '7',
      '--apply',
      '--agent-session', 'codex-process-8',
    ], {
      EIDO_AGENT_CLIENT: 'ignored-env-client',
      EIDO_AGENT_SESSION_ID: 'ignored-env-session',
    }, () => 'generated-session')

    expect(planned).toEqual({
      ok: true,
      argv: [
        'card', 'create',
        '--idea', 'idea-main',
        '--kind', 'note',
        '--x', '1',
        '--y', '2',
        '--body', '--agent-client',
        '--connect-from', 'card-anchor',
        '--reason', '--agent-session',
        '--expected-revision', '7',
        '--apply',
      ],
      identity: { client: 'codex', sessionId: 'codex-process-8' },
    })
    if (!planned.ok) throw new Error('expected identity plan')
    expect(planEidoCli(planned.argv, () => 'request-literal-identity-content')).toMatchObject({
      ok: true,
      plan: {
        pretty: false,
        request: {
          requestId: 'request-literal-identity-content',
          params: {
            commands: [
              { payload: { body: '--agent-client' } },
              { payload: { reason: '--agent-session' } },
            ],
          },
        },
      },
    })
  })

  it('keeps duplicate and missing global identity failures distinct from literal content', () => {
    for (const argv of [
      [
        'card', 'update', 'card-main',
        '--idea', 'idea-main',
        '--body', '--agent-client',
        '--agent-client', 'one',
        '--agent-client', 'two',
        '--expected-revision', '7',
        '--apply',
      ],
      ['status', '--agent-session'],
    ]) {
      expect(planEidoCliIdentity(argv, {}, () => 'session')).toMatchObject({ ok: false })
    }
  })

  it('adds stable live/headless metadata only to ergonomic output', async () => {
    const stdout: string[] = []
    const exitCode = await runEidoCli({
      argv: ['status'],
      createRequestId: () => 'request-live',
      describeGateway: () => { throw new Error('status requested discovery') },
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: () => undefined },
      runRaw: async () => { throw new Error('ergonomic invoke used raw transport') },
      invoke: async (request) => ({
        servedBy: 'live',
        live: { state: 'served' },
        response: {
          version: 1,
          requestId: request.requestId,
          ok: true,
          result: { revision: 7 },
        } as never,
      }),
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout.join(''))).toEqual({
      version: 1,
      requestId: 'request-live',
      ok: true,
      result: { revision: 7 },
      cli: { version: 1, servedBy: 'live', live: { state: 'served' } },
    })
  })

  it('sends a planned read through the injected raw-envelope transport', async () => {
    const stdout: string[] = []
    const exitCode = await runEidoCli({
      argv: ['status'],
      createRequestId: () => 'request-runtime',
      describeGateway: () => { throw new Error('status requested discovery') },
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: () => undefined },
      async runRaw(io) {
        const chunks: Uint8Array[] = []
        for await (const chunk of io.stdin) {
          expect(chunk).toBeInstanceOf(Uint8Array)
          chunks.push(chunk as Uint8Array)
        }
        expect(new TextDecoder().decode(chunks[0])).toBe(JSON.stringify({
          version: 1,
          requestId: 'request-runtime',
          operation: 'profile.status',
          params: {},
        }))
        await io.stdout.write('{"version":1,"requestId":"request-runtime","ok":false,"error":{"code":"not-found"}}\n')
        return 6
      },
    })

    expect(exitCode).toBe(6)
    expect(stdout).toEqual([
      '{"version":1,"requestId":"request-runtime","ok":false,"error":{"code":"not-found"}}\n',
    ])
  })

  it('pretty-prints only when explicitly requested', async () => {
    const stdout: string[] = []
    const exitCode = await runEidoCli({
      argv: ['status', '--pretty'],
      createRequestId: () => 'request-pretty',
      describeGateway: () => { throw new Error('status requested discovery') },
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: () => undefined },
      async runRaw(io) {
        await io.stdout.write('{"version":1,"requestId":"request-pretty","ok":true,"result":{"revision":7}}\n')
        return 0
      },
    })

    expect(exitCode).toBe(0)
    expect(stdout).toEqual([
      '{\n  "version": 1,\n  "requestId": "request-pretty",\n  "ok": true,\n  "result": {\n    "revision": 7\n  }\n}\n',
    ])
  })

  it('keeps a raw preflight exit when pretty mode has no response envelope', async () => {
    const exitCode = await runEidoCli({
      argv: ['status', '--pretty'],
      createRequestId: () => 'request-preflight',
      describeGateway: () => { throw new Error('status requested discovery') },
      stdin: emptyInput(),
      stdout: { write: () => { throw new Error('preflight produced output') } },
      stderr: { write: () => undefined },
      runRaw: async () => 7,
    })

    expect(exitCode).toBe(7)
  })

  it('assembles one dry-run note creation batch with explicit replay identities (#714)', () => {
    expect(planEidoCli([
      'card', 'create',
      '--idea', 'idea-main',
      '--kind', 'note',
      '--x', '120',
      '--y', '-40.5',
      '--text', 'A bounded thought',
      '--expected-revision', '7',
      '--dry-run',
      '--request-id', 'request-create-fixed',
      '--idempotency-key', 'retry-create-fixed',
      '--command-id', 'command-create-fixed',
    ], () => 'unexpected-generated-id')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-create-fixed',
          operation: 'command.batch',
          params: {
            version: 1,
            schemaVersion: 1,
            expectedRevision: 7,
            idempotencyKey: 'retry-create-fixed',
            dryRun: true,
            commands: [{
              version: 1,
              id: 'command-create-fixed',
              name: 'card.create',
              payload: {
                ideaId: 'idea-main',
                kind: 'note',
                position: { x: 120, y: -40.5 },
                text: 'A bounded thought',
              },
            }],
          },
        },
      },
    })
  })

  it('creates body-backed thought structure beside repeated Card anchors (#720)', () => {
    expect(planEidoCli([
      'card', 'create',
      '--idea', 'eido://app/?idea=idea-linked&card=card-context',
      '--kind', 'note',
      '--near', 'card-anchor-a',
      '--near', 'eido://app/?idea=idea-linked&card=card-anchor-b&x=90&y=80&zoom=2',
      '--body', 'A spatial thought',
      '--expected-revision', '13',
      '--apply',
      '--idempotency-key', 'retry-near-note',
    ], () => 'request-near-note')).toMatchObject({
      ok: true,
      plan: {
        request: {
          requestId: 'request-near-note',
          operation: 'command.batch',
          params: {
            expectedRevision: 13,
            dryRun: false,
            commands: [{
              id: 'command:retry-near-note',
              name: 'card.create',
              payload: {
                ideaId: 'idea-linked',
                kind: 'note',
                near: ['card-anchor-a', 'card-anchor-b'],
                body: 'A spatial thought',
              },
            }],
          },
        },
      },
    })
  })

  it('creates a Title with the body field and explicit position (#719)', () => {
    expect(planEidoCli([
      'card', 'create',
      '--idea', 'idea-main',
      '--kind', 'title',
      '--x', '24',
      '--y', '48',
      '--body', 'Storyboard directions',
      '--expected-revision', '14',
      '--dry-run',
      '--idempotency-key', 'retry-title',
    ], () => 'request-title')).toMatchObject({
      ok: true,
      plan: { request: { params: { commands: [{ payload: {
        ideaId: 'idea-main',
        kind: 'title',
        position: { x: 24, y: 48 },
        body: 'Storyboard directions',
      } }] } } },
    })
  })

  it('creates a Group with only Group-owned content fields (#719)', () => {
    expect(planEidoCli([
      'card', 'create',
      '--idea', 'idea-main',
      '--kind', 'group',
      '--near', 'card-anchor',
      '--group-title', 'Act two',
      '--compression-prompt', 'Preserve the causal beats.',
      '--expected-revision', '14',
      '--apply',
      '--idempotency-key', 'retry-group',
    ], () => 'request-group')).toMatchObject({
      ok: true,
      plan: { request: { params: { commands: [{ payload: {
        ideaId: 'idea-main',
        kind: 'group',
        near: ['card-anchor'],
        groupTitle: 'Act two',
        compressionPrompt: 'Preserve the causal beats.',
      } }] } } },
    })
  })

  it('creates a Conversation with settings but no Run-owned transcript field (#719)', () => {
    expect(planEidoCli([
      'card', 'create',
      '--idea', 'idea-main',
      '--kind', 'conversation',
      '--x', '72',
      '--y', '96',
      '--topic', 'Challenge the launch sequence',
      '--conversation-style', 'critique',
      '--conversation-turns', '6',
      '--expected-revision', '14',
      '--apply',
      '--idempotency-key', 'retry-conversation',
    ], () => 'request-conversation')).toMatchObject({
      ok: true,
      plan: { request: { params: { commands: [{ payload: {
        ideaId: 'idea-main',
        kind: 'conversation',
        position: { x: 72, y: 96 },
        topic: 'Challenge the launch sequence',
        conversationStyle: 'critique',
        conversationTurns: 6,
      } }] } } },
    })
  })

  it('atomically connects an existing Card to the newly created thought (#720)', () => {
    expect(planEidoCli([
      'card', 'create',
      '--idea', 'idea-linked',
      '--kind', 'askAi',
      '--near', 'card-source',
      '--body', 'What is the strongest counterexample?',
      '--connect-from', 'eido://app/?idea=idea-linked&card=card-source',
      '--strength', 'weak',
      '--polarity', 'pushesAgainst',
      '--reason', 'Challenge the premise',
      '--group-mode', 'compress',
      '--expected-revision', '15',
      '--apply',
      '--command-id', 'command-connected-thought',
      '--idempotency-key', 'retry-connected-thought',
    ], () => 'request-connected-thought')).toMatchObject({
      ok: true,
      plan: { request: { params: { commands: [
        {
          id: 'command-connected-thought',
          name: 'card.create',
          payload: {
            ideaId: 'idea-linked',
            kind: 'askAi',
            near: ['card-source'],
            body: 'What is the strongest counterexample?',
          },
        },
        {
          id: 'command-connected-thought:connect',
          name: 'connection.create',
          payload: {
            ideaId: 'idea-linked',
            from: { cardId: 'card-source' },
            to: { createdByCommandId: 'command-connected-thought' },
            strength: 'weak',
            polarity: 'pushesAgainst',
            reason: 'Challenge the premise',
            groupMode: 'compress',
          },
        },
      ] } } },
    })
  })

  it('updates Card content addressed by a deep link and derives a replay-stable command id', () => {
    expect(planEidoCli([
      'card', 'update',
      'eido://app/?idea=idea-linked&card=card-linked&x=8&y=9&zoom=2',
      '--block', 'block-linked',
      '--text', 'Revised thought',
      '--expected-revision', '8',
      '--apply',
      '--idempotency-key', 'retry-update-fixed',
    ], () => 'request-update-generated')).toEqual({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: false,
        request: {
          version: 1,
          requestId: 'request-update-generated',
          operation: 'command.batch',
          params: {
            version: 1,
            schemaVersion: 1,
            expectedRevision: 8,
            idempotencyKey: 'retry-update-fixed',
            dryRun: false,
            commands: [{
              version: 1,
              id: 'command:retry-update-fixed',
              name: 'card.update-content',
              payload: {
                ideaId: 'idea-linked',
                cardId: 'card-linked',
                blockId: 'block-linked',
                text: 'Revised thought',
              },
            }],
          },
        },
      },
    })
  })

  it('updates a body-backed Card without requiring its Block id (#719)', () => {
    expect(planEidoCli([
      'card', 'update',
      'eido://app/?idea=idea-linked&card=card-linked',
      '--body', 'A domain-shaped revision',
      '--expected-revision', '16',
      '--apply',
      '--idempotency-key', 'retry-body-update',
    ], () => 'request-body-update')).toMatchObject({
      ok: true,
      plan: { request: { params: { commands: [{
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-linked',
          cardId: 'card-linked',
          body: 'A domain-shaped revision',
        },
      }] } } },
    })
  })

  it('preserves --pretty as an exact Card content value', () => {
    expect(planEidoCli([
      'card', 'update', 'card-note',
      '--idea', 'idea-main',
      '--body', '--pretty',
      '--expected-revision', '16',
      '--dry-run',
      '--idempotency-key', 'retry-pretty-body',
    ], () => 'request-pretty-body')).toMatchObject({
      ok: true,
      plan: {
        pretty: false,
        request: {
          requestId: 'request-pretty-body',
          params: {
            commands: [{
              payload: {
                ideaId: 'idea-main',
                cardId: 'card-note',
                body: '--pretty',
              },
            }],
          },
        },
      },
    })
  })

  it('keeps --text as a deprecated unambiguous body alias', () => {
    expect(planEidoCli([
      'card', 'update', 'card-note',
      '--idea', 'idea-main',
      '--text', 'Legacy argv, domain-shaped payload',
      '--expected-revision', '16',
      '--dry-run',
      '--idempotency-key', 'retry-text-alias',
    ], () => 'request-text-alias')).toMatchObject({
      ok: true,
      plan: { request: { params: { commands: [{ payload: {
        ideaId: 'idea-main',
        cardId: 'card-note',
        body: 'Legacy argv, domain-shaped payload',
      } }] } } },
    })
  })

  it('updates one or both Group-owned fields as one exact family (#719)', () => {
    expect(planEidoCli([
      'card', 'update', 'card-group',
      '--idea', 'idea-main',
      '--group-title', 'Reframed act',
      '--compression-prompt', '',
      '--expected-revision', '16',
      '--apply',
      '--idempotency-key', 'retry-group-update',
    ], () => 'request-group-update')).toMatchObject({
      ok: true,
      plan: { request: { params: { commands: [{ payload: {
        ideaId: 'idea-main',
        cardId: 'card-group',
        groupTitle: 'Reframed act',
        compressionPrompt: '',
      } }] } } },
    })
  })

  it('updates Conversation settings without exposing transcripts (#719)', () => {
    expect(planEidoCli([
      'card', 'update', 'card-conversation',
      '--idea', 'idea-main',
      '--topic', '',
      '--conversation-style', 'interview',
      '--conversation-turns', '4',
      '--expected-revision', '16',
      '--apply',
      '--idempotency-key', 'retry-conversation-update',
    ], () => 'request-conversation-update')).toMatchObject({
      ok: true,
      plan: { request: { params: { commands: [{ payload: {
        ideaId: 'idea-main',
        cardId: 'card-conversation',
        topic: '',
        conversationStyle: 'interview',
        conversationTurns: 4,
      } }] } } },
    })
  })

  it('assembles equivalent Card deletion batches from id and deep-link addresses', () => {
    const common = [
      '--expected-revision', '9',
      '--apply',
      '--request-id', 'request-delete-fixed',
      '--idempotency-key', 'retry-delete-fixed',
    ]
    const byId = planEidoCli([
      'card', 'delete', 'card-linked', '--idea', 'idea-linked', ...common,
    ], () => 'unexpected-generated-id')
    const byLink = planEidoCli([
      'card', 'delete',
      'eido://app/?idea=idea-linked&card=card-linked&x=99&y=100&zoom=4',
      ...common,
    ], () => 'unexpected-generated-id')

    expect(byLink).toEqual(byId)
    expect(byId).toMatchObject({
      ok: true,
      plan: {
        request: {
          operation: 'command.batch',
          params: {
            commands: [{
              id: 'command:retry-delete-fixed',
              name: 'card.delete',
              payload: { ideaId: 'idea-linked', cardId: 'card-linked' },
            }],
          },
        },
      },
    })
  })

  it('creates one meaning-bearing connection between deep-linked Cards', () => {
    expect(planEidoCli([
      'connection', 'create',
      'eido://app/?idea=idea-linked&card=card-from',
      'eido://app/?idea=idea-linked&card=card-to',
      '--strength', 'weak',
      '--polarity', 'pushesAgainst',
      '--reason', 'Synthetic tension',
      '--group-mode', 'compress',
      '--expected-revision', '10',
      '--dry-run',
      '--request-id', 'request-connection-create',
      '--idempotency-key', 'retry-connection-create',
    ], () => 'unexpected-generated-id')).toMatchObject({
      ok: true,
      plan: {
        request: {
          requestId: 'request-connection-create',
          operation: 'command.batch',
          params: {
            expectedRevision: 10,
            dryRun: true,
            commands: [{
              id: 'command:retry-connection-create',
              name: 'connection.create',
              payload: {
                ideaId: 'idea-linked',
                from: { cardId: 'card-from' },
                to: { cardId: 'card-to' },
                strength: 'weak',
                polarity: 'pushesAgainst',
                reason: 'Synthetic tension',
                groupMode: 'compress',
              },
            }],
          },
        },
      },
    })
  })

  it('updates Connection meaning and represents clearing a reason explicitly', () => {
    expect(planEidoCli([
      'connection', 'update-meaning', 'connection-linked',
      '--idea', 'eido://app/?idea=idea-linked&card=card-context',
      '--strength', 'strong',
      '--clear-reason',
      '--expected-revision', '11',
      '--apply',
      '--idempotency-key', 'retry-connection-meaning',
      '--pretty',
    ], () => 'request-connection-meaning')).toMatchObject({
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: true,
        request: {
          requestId: 'request-connection-meaning',
          operation: 'command.batch',
          params: {
            expectedRevision: 11,
            dryRun: false,
            commands: [{
              id: 'command:retry-connection-meaning',
              name: 'connection.update-meaning',
              payload: {
                ideaId: 'idea-linked',
                connectionId: 'connection-linked',
                strength: 'strong',
                reason: null,
              },
            }],
          },
        },
      },
    })
  })

  it('assembles one Connection deletion batch without widening to Mod commands', () => {
    expect(planEidoCli([
      'connection', 'delete', 'connection-linked',
      '--idea', 'idea-linked',
      '--expected-revision', '12',
      '--dry-run',
      '--request-id', 'request-connection-delete',
      '--idempotency-key', 'retry-connection-delete',
      '--command-id', 'command-connection-delete',
    ], () => 'unexpected-generated-id')).toMatchObject({
      ok: true,
      plan: {
        request: {
          operation: 'command.batch',
          params: {
            expectedRevision: 12,
            dryRun: true,
            commands: [{
              id: 'command-connection-delete',
              name: 'connection.delete',
              payload: { ideaId: 'idea-linked', connectionId: 'connection-linked' },
            }],
          },
        },
      },
    })
    expect(planEidoCli([
      'mod', 'create', '--expected-revision', '12', '--dry-run',
    ], () => 'unused')).toMatchObject({ ok: false })
  })

  it('requires explicit revision and exactly one mutation mode while keeping retry ids stable', () => {
    const base = [
      'card', 'create', '--idea', 'idea-main', '--kind', 'note', '--x', '1', '--y', '2',
    ]
    expect(planEidoCli([...base, '--expected-revision', '7'], () => 'unused'))
      .toMatchObject({ ok: false })
    expect(planEidoCli([
      ...base, '--expected-revision', '7', '--dry-run', '--apply',
    ], () => 'unused')).toMatchObject({ ok: false })
    expect(planEidoCli([...base, '--apply'], () => 'unused')).toMatchObject({ ok: false })

    let sequence = 0
    const generated = planEidoCli([
      ...base,
      '--expected-revision', '7',
      '--apply',
      '--idempotency-key', 'scripted-retry-key',
    ], () => `generated-${++sequence}`)
    expect(generated).toMatchObject({
      ok: true,
      plan: {
        request: {
          requestId: 'generated-1',
          params: {
            idempotencyKey: 'scripted-retry-key',
            commands: [{ id: 'command:scripted-retry-key' }],
          },
        },
      },
    })
  })

  it('rejects spatial, kind-family, and connected-thought conflicts before minting ids', () => {
    const safety = ['--expected-revision', '17', '--apply']
    const invalid = [
      [
        'card', 'create', '--idea', 'idea-main', '--kind', 'note',
        '--x', '1', '--y', '2', '--near', 'card-anchor', ...safety,
      ],
      [
        'card', 'create', '--idea', 'idea-main', '--kind', 'note',
        '--near', 'eido://app/?idea=idea-other&card=card-anchor', ...safety,
      ],
      [
        'card', 'create', '--idea', 'idea-main', '--kind', 'group',
        '--near', 'card-anchor', '--body', 'Wrong family', ...safety,
      ],
      [
        'card', 'create', '--idea', 'idea-main', '--kind', 'conversation',
        '--near', 'card-anchor', '--conversation-style', 'monologue', ...safety,
      ],
      [
        'card', 'create', '--idea', 'idea-main', '--kind', 'title',
        '--near', 'card-anchor', '--connect-from', 'card-anchor', ...safety,
      ],
      [
        'card', 'create', '--idea', 'idea-main', '--kind', 'result',
        '--near', 'card-anchor', ...safety,
      ],
      [
        'card', 'create', '--idea', 'idea-main', '--kind', 'mod',
        '--near', 'card-anchor', ...safety,
      ],
      [
        'card', 'create', '--idea', 'idea-main', '--kind', 'note',
        '--near', 'card-anchor', '--strength', 'weak', ...safety,
      ],
      [
        'card', 'update', 'card-main', '--idea', 'idea-main',
        '--body', 'Body', '--group-title', 'Group', ...safety,
      ],
      [
        'card', 'update', 'card-main', '--idea', 'idea-main',
        '--block', 'block-main', '--body', 'Body', ...safety,
      ],
      [
        'card', 'update', 'card-main', '--idea', 'idea-main',
        '--topic', 'Topic', '--transcript', 'Forbidden', ...safety,
      ],
    ]
    let generated = 0
    for (const argv of invalid) {
      expect(planEidoCli(argv, () => `unexpected-${++generated}`)).toMatchObject({ ok: false })
    }
    expect(generated).toBe(0)
  })

  it('rejects incomplete or cross-Idea spatial reads before minting request ids', () => {
    let generated = 0
    for (const argv of [
      ['graph', 'neighbors', 'card-without-idea'],
      [
        'graph', 'neighbors',
        'eido://app/?idea=idea-a&card=card-a',
        '--idea', 'idea-b',
      ],
      ['graph', 'bounds'],
      [
        'graph', 'bounds',
        'eido://app/?idea=idea-a&card=card-a',
        'eido://app/?idea=idea-b&card=card-b',
      ],
    ]) {
      expect(planEidoCli(argv, () => `unexpected-${++generated}`)).toMatchObject({ ok: false })
    }
    expect(generated).toBe(0)
  })

  it('derives one stable idempotency key from the command, with a fresh request id', () => {
    let sequence = 0
    const generate = () => `generated-${++sequence}`
    const argv = [
      'card', 'create',
      '--idea', 'idea-main',
      '--kind', 'askAi',
      '--x', '10',
      '--y', '20',
      '--expected-revision', '7',
      '--apply',
    ]

    const first = planEidoCli(argv, generate)
    const second = planEidoCli(argv, generate)
    const changed = planEidoCli([...argv.slice(0, -2), '--expected-revision', '8', '--apply'], generate)
    const explicit = planEidoCli([...argv, '--idempotency-key', 'scripted'], generate)

    const key = keyOf(first)
    expect(key).toMatch(/^derived:[0-9a-f]{64}$/)
    expect(first).toMatchObject({
      ok: true,
      plan: { request: {
        requestId: 'generated-1',
        params: { idempotencyKey: key, commands: [{ id: `command:${key}` }] },
      } },
    })
    // Same argv, same key. The request id still identifies the attempt.
    expect(keyOf(second)).toBe(key)
    expect(second).toMatchObject({ ok: true, plan: { request: { requestId: 'generated-2' } } })
    expect(keyOf(changed)).not.toBe(key)
    expect(keyOf(explicit)).toBe('scripted')
  })

  it('derives the same key whatever order the options are written in', () => {
    const generate = () => 'request'
    const left = planEidoCli([
      'card', 'update', 'card-7', '--idea', 'idea-main', '--body', 'one',
      '--expected-revision', '7', '--apply',
    ], generate)
    const right = planEidoCli([
      'card', 'update', 'card-7', '--apply', '--body', 'one',
      '--expected-revision', '7', '--idea', 'idea-main',
    ], generate)

    expect(keyOf(left)).toBe(keyOf(right))
  })

  it('rejects Card Deep Links as Connection ids before generating mutation identity', () => {
    let generated = 0

    expect(planEidoCli([
      'connection', 'delete', 'eido://app/?idea=idea-linked&card=card-linked',
      '--idea', 'idea-linked',
      '--expected-revision', '12',
      '--apply',
    ], () => `generated-${++generated}`)).toMatchObject({ ok: false })
    expect(generated).toBe(0)
  })
})

async function* emptyInput(): AsyncGenerator<Uint8Array> {}

async function helpOutput(argv: readonly string[]): Promise<Readonly<{
  exitCode: number
  stdout: string
}>> {
  const stdout: string[] = []
  const exitCode = await runEidoCli({
    argv,
    createRequestId: () => 'unused',
    describeGateway: () => { throw new Error('help requested discovery') },
    stdin: emptyInput(),
    stdout: { write: value => { stdout.push(value) } },
    stderr: { write: () => undefined },
    runRaw: async () => { throw new Error('help invoked raw transport') },
  })
  return Object.freeze({ exitCode, stdout: stdout.join('') })
}

async function runOutput(
  argv: readonly string[],
  describeGateway?: () => ReturnType<ReturnType<typeof createProfileGatewaySession>['describeAgentCli']>,
): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = await runEidoCli({
    argv,
    createRequestId: () => 'request-usage',
    describeGateway: describeGateway ?? (() => { throw new Error('usage requested discovery') }),
    stdin: emptyInput(),
    stdout: { write: value => { stdout.push(value) } },
    stderr: { write: value => { stderr.push(value) } },
    runRaw: async () => { throw new Error('usage invoked raw transport') },
  })
  return Object.freeze({ exitCode, stdout: stdout.join(''), stderr: stderr.join('') })
}

function keyOf(planned: ReturnType<typeof planEidoCli>): string | undefined {
  if (!planned.ok || planned.plan.kind !== 'invoke') return undefined
  const params = planned.plan.request.params as Record<string, unknown>
  return params.idempotencyKey as string | undefined
}

async function* textInput(value: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(value)
}

async function resolved(
  argv: readonly string[],
  stdin: AsyncIterable<string | Uint8Array> = emptyInput(),
): Promise<ReturnType<typeof resolveEidoCliValueSources>> {
  return resolveEidoCliValueSources(argv, stdin)
}

describe('eido CLI stdin and file value sources', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-cli-value-sources-'))
  const specPath = path.join(root, 'spec.json')
  const bodyPath = path.join(root, 'body.md')
  const hugePath = path.join(root, 'huge.txt')
  writeFileSync(specPath, '{"version":1,"kind":"switch"}\n')
  writeFileSync(bodyPath, 'line one\nline two\n')
  writeFileSync(hugePath, 'x'.repeat(8 * 1024 + 1))

  it('reads a spec from a file and a body from a pipe', async () => {
    await expect(resolved([
      'mod', 'create', '--idea', 'idea-main', '--spec', `@${specPath}`,
    ])).resolves.toEqual({
      ok: true,
      argv: ['mod', 'create', '--idea', 'idea-main', '--spec', '{"version":1,"kind":"switch"}'],
    })

    await expect(resolved(
      ['card', 'create', '--idea', 'idea-main', '--body', '-'],
      textInput('piped thought\n'),
    )).resolves.toEqual({
      ok: true,
      argv: ['card', 'create', '--idea', 'idea-main', '--body', 'piped thought'],
    })
  })

  it('resolves every listed flag family', async () => {
    for (const flag of [
      '--spec', '--frames', '--body', '--text', '--group-title',
      '--compression-prompt', '--topic', '--reason',
    ]) {
      await expect(resolved(['card', 'create', flag, `@${bodyPath}`]))
        .resolves.toEqual({ ok: true, argv: ['card', 'create', flag, 'line one\nline two'] })
    }
  })

  it('keeps literal @ and - expressible through doubling', async () => {
    await expect(resolved(['card', 'create', '--body', '@@literal', '--topic', '--']))
      .resolves.toEqual({ ok: true, argv: ['card', 'create', '--body', '@literal', '--topic', '-'] })
  })

  it('leaves an unlisted flag value alone', async () => {
    await expect(resolved(['card', 'create', '--body', 'plain', '--idea', `@${specPath}`]))
      .resolves.toEqual({
        ok: true,
        argv: ['card', 'create', '--body', 'plain', '--idea', `@${specPath}`],
      })
  })

  it('rejects a second flag asking for stdin', async () => {
    const outcome = await resolved(
      ['card', 'create', '--body', '-', '--topic', '-'],
      textInput('one'),
    )
    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) throw new Error('expected a usage failure')
    expect(outcome.error.message).toContain('--body')
    expect(outcome.error.message).toContain('--topic')
    expect(outcome.error.code).toBe('cli.usage')
  })

  it('reports a missing file as a typed usage error naming path and flag', async () => {
    const outcome = await resolved(['card', 'create', '--body', `@${path.join(root, 'absent.md')}`])
    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) throw new Error('expected a usage failure')
    expect(outcome.error.code).toBe('cli.usage')
    expect(outcome.error.message).toContain('absent.md')
    expect(outcome.error.message).toContain('--body')
  })

  it('reports an oversize file with the actual size against the limit', async () => {
    const outcome = await resolved(['connection', 'create', 'card-7', 'card-8', '--reason', `@${hugePath}`])
    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) throw new Error('expected a usage failure')
    expect(outcome.error.message).toContain(`${8 * 1024 + 1} bytes`)
    expect(outcome.error.message).toContain(`${8 * 1024} byte limit`)
  })

  it('leaves eido batch and help reading raw stdin', async () => {
    await expect(resolved(['batch'], textInput('{}'))).resolves.toEqual({ ok: true, argv: ['batch'] })
    await expect(resolved(['card', 'create', '--body', '-', '--help']))
      .resolves.toEqual({ ok: true, argv: ['card', 'create', '--body', '-', '--help'] })
  })

  it('feeds a resolved value into the plan and its derived key', async () => {
    const outcome = await resolved(
      ['card', 'update', 'card-7', '--idea', 'idea-main', '--body', '-',
        '--expected-revision', '7', '--apply'],
      textInput('piped body\n'),
    )
    if (!outcome.ok) throw new Error('expected resolution to succeed')
    const planned = planEidoCli(outcome.argv, () => 'request-1')
    expect(planned).toMatchObject({ ok: true })
    expect(keyOf(planned)).toBe(deriveEidoCliIdempotencyKey([
      'card', 'update', 'card-7', '--idea', 'idea-main', '--body', 'piped body',
      '--expected-revision', '7', '--apply',
    ]))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })
})
