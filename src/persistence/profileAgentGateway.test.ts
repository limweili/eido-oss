import { describe, expect, it, vi } from 'vitest'
import { createSeedMod } from '../mods'
import {
  INSTALLED_PROFILE_AGENT_CAPABILITY_DISCOVERY,
  PROFILE_GATEWAY_OPERATION_NAMES,
  createProfileGatewaySession,
  executeProfileGatewayRequest,
  profileGatewayOperationSupportsAdapter,
  type ProfileGatewayService,
} from './profileAgentGateway'
import {
  createInstalledProfileAgentCapabilities,
  INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES,
  INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
  isInstalledProfileAgentCommandBatchSuccessForRequest,
  isInstalledOrReplayedProfileAgentCommandReceipt,
  isProfileAgentCommandBatchReceipt,
  isProfileAgentCommandBatchReceiptForSurface,
} from './profileAgentCommandInstallation'
import { isProfileTransportCapabilities } from './profileTransportContract'

describe('installed Profile Agent Gateway command admission', () => {
  it('admits bounded run variations without exposing execution or credential knobs', async () => {
    const submitAgentRun = vi.fn(async () => ({
      ok: false as const,
      code: 'live-app-required' as const,
      retryable: true,
      message: 'live app required',
    }))
    const service = Object.freeze({ submitAgentRun }) as unknown as ProfileGatewayService
    const variations = {
      ideaId: 'idea-1',
      targetCardId: 'conversation-1',
      mode: 'variations',
      variationCount: 3,
    }

    await executeProfileGatewayRequest(service, {
      version: 1,
      requestId: 'run-variations',
      operation: 'run.submit',
      params: variations,
    })
    expect(submitAgentRun).toHaveBeenCalledWith(variations)

    for (const params of [
      { ...variations, variationCount: 9 },
      { ...variations, model: 'caller/model' },
      { ideaId: 'idea-1', targetCardId: 'ask-1', mode: 'run', variationCount: 1 },
    ]) {
      await expect(executeProfileGatewayRequest(service, {
        version: 1,
        requestId: `invalid-${Object.keys(params).length}-${String(params.variationCount)}`,
        operation: 'run.submit',
        params,
      })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    }
    expect(submitAgentRun).toHaveBeenCalledTimes(1)
  })

  it('passes the bounded creator filter through graph.query unchanged in meaning', async () => {
    const query = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: 'profile-query',
        revision: 4,
        items: [],
        truncated: false,
      },
    }))
    const service = Object.freeze({ query }) as unknown as ProfileGatewayService

    await expect(executeProfileGatewayRequest(service, {
      version: 1,
      requestId: 'creator-filter',
      operation: 'graph.query',
      params: { creator: 'agent' },
    })).resolves.toMatchObject({
      ok: true,
      requestId: 'creator-filter',
      result: { items: [] },
    })
    expect(query).toHaveBeenCalledWith({
      creator: 'agent',
      limit: 50,
      byteLimit: 65_536,
    })
  })

  it('describes exact installed operations without authority and drains accepted session work', async () => {
    let resolveStatus: ((value: Awaited<ReturnType<ProfileGatewayService['status']>>) => void)
      | undefined
    const status = new Promise<Awaited<ReturnType<ProfileGatewayService['status']>>>((resolve) => {
      resolveStatus = resolve
    })
    const close = vi.fn(async () => undefined)
    const service = Object.freeze({
      status: vi.fn(() => status),
      capabilities: vi.fn(async () => ({
        ok: true as const,
        value: createInstalledProfileAgentCapabilities('sqlite'),
      })),
      query: vi.fn(),
      changes: vi.fn(),
      applyAgentCommandBatch: vi.fn(),
      close,
    })
    const openService = vi.fn(async () => ({ ok: true as const, value: service }))
    const session = createProfileGatewaySession({ openService })

    const description = session.describe()
    expect(description.operations.map((descriptor) => descriptor.name))
      .toEqual(PROFILE_GATEWAY_OPERATION_NAMES)
    expect(description.operations).toHaveLength(15)
    expect(description.operations
      .filter((operation) => profileGatewayOperationSupportsAdapter(operation, 'mcp'))
      .map((operation) => operation.name)).toEqual([
        'profile.status',
        'profile.capabilities',
        'idea.list',
        'graph.query',
        'record.get',
        'mod-template.list',
        'command.batch',
      ])
    const agentDescription = session.describeAgentCli()
    expect(agentDescription.operations.map((operation) => operation.name)).toEqual([
      'profile.status',
      'idea.list',
      'graph.query',
      'record.get',
      'mod-template.list',
      'agent.capabilities',
      'result.inspect',
      'graph.neighbors',
      'graph.bounds',
      'changes.list',
      'command.batch',
      'run.submit',
      'run.status',
      'run.read',
    ])
    expect(description.operations.every((operation) => !('agentCliInput' in operation))).toBe(true)
    expect(agentDescription.operations.every((operation) => !('agentCliInput' in operation)))
      .toBe(true)
    const describedCommandVariants = (
      description.operations.find(({ name }) => name === 'command.batch')
        ?.schema.input.properties.commands as { items: { oneOf: Array<{
          properties: { name: { const: string } }
        }> } }
    ).items.oneOf
    expect(describedCommandVariants.map(({ properties }) => properties.name.const))
      .toEqual(INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
    const agentCommandVariants = (
      agentDescription.operations.find(({ name }) => name === 'command.batch')
        ?.schema.input.properties.commands as { items: { oneOf: Array<{
          properties: { name: { const: string } }
        }> } }
    ).items.oneOf
    expect(agentCommandVariants.map(({ properties }) => properties.name.const))
      .toEqual(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES)
    expect(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES).toHaveLength(15)
    expect(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES)
      .not.toEqual(INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
    expect(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES.every((name) => (
      !name.startsWith('mod-')
    ))).toBe(true)
    expect(description.agentCapabilities).toBe(INSTALLED_PROFILE_AGENT_CAPABILITY_DISCOVERY)
    expect(description.operations.every((descriptor) => (
      descriptor.availability === (descriptor.name.startsWith('run.') ? 'live-app' : 'installed')
      && descriptor.schema.version === 1
      && descriptor.schema.input.type === 'object'
    ))).toBe(true)
    expect(description.operations.find(({ name }) => name === 'graph.query')?.schema.input)
      .toMatchObject({
        anyOf: [
          { required: ['recordKinds'] },
          { required: ['recordIds'] },
          { required: ['ownerIds'] },
          { required: ['parentIds'] },
          { required: ['creator'] },
        ],
        properties: {
          creator: { enum: ['agent', 'user'] },
          recordIds: { minItems: 1 },
          ownerIds: { minItems: 1 },
        },
      })
    expect(description.operations.find(({ name }) => name === 'changes.list'))
      .toMatchObject({
        mutating: false,
        limits: { changes: { maxItems: 200, maxBytes: 262_144 } },
      })
    expect(description.operations.find(({ name }) => name === 'result.inspect'))
      .toMatchObject({
        adapters: ['cli'],
        agentCliDiscoverable: true,
        mutating: false,
        schema: {
          input: {
            required: ['ideaId', 'resultCardId'],
            additionalProperties: false,
          },
        },
        limits: { query: { maxItems: 200, maxBytes: 262_144 } },
      })
    expect(description.operations.find(({ name }) => name === 'graph.bounds')
      ?.schema.input.properties.cards).not.toHaveProperty('uniqueItems')
    expect(openService).not.toHaveBeenCalled()

    await expect(session.invoke({ nope: true })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
    for (const [requestId, params] of [
      ['session-empty-query', {}],
      ['session-empty-query-filter', { recordIds: [] }],
    ] as const) {
      await expect(session.invoke({
        version: 1,
        requestId,
        operation: 'graph.query',
        params,
      })).resolves.toMatchObject({
        ok: false,
        requestId,
        error: { code: 'invalid' },
      })
    }
    await expect(session.invoke({
      version: 1,
      requestId: 'session-uninstalled',
      operation: '__proto__',
      params: {},
    })).resolves.toMatchObject({
      ok: false,
      requestId: 'session-uninstalled',
      error: { code: 'capability-denied' },
    })
    expect(openService).not.toHaveBeenCalled()

    const inspected = session.invoke({
      version: 1,
      requestId: 'session-status',
      operation: 'profile.status',
      params: {},
    })
    const discovered = session.invoke({
      version: 1,
      requestId: 'session-capabilities',
      operation: 'profile.capabilities',
      params: {},
    })
    await vi.waitFor(() => expect(openService).toHaveBeenCalledTimes(1))

    const closing = session.close()
    await expect(session.invoke({
      version: 1,
      requestId: 'session-after-close',
      operation: 'profile.status',
      params: {},
    })).resolves.toMatchObject({
      ok: false,
      requestId: 'session-after-close',
      error: { code: 'busy' },
    })
    expect(close).not.toHaveBeenCalled()

    resolveStatus?.({
      ok: true,
      value: {
        profileId: 'profile-session',
        revision: 4,
        versions: {
          profile: 1,
          schema: 1,
          record: 2,
          asset: 1,
          app: 1,
          command: 1,
          export: 1,
        },
        state: 'ready',
        owner: { mode: 'mutable', route: 'exclusive-headless-owner' },
        dirty: 'clean',
        compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
      },
    })
    await expect(inspected).resolves.toMatchObject({ ok: true, requestId: 'session-status' })
    await expect(discovered).resolves.toMatchObject({
      ok: true,
      requestId: 'session-capabilities',
    })
    await expect(closing).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('describes every installed v5 batch command as an exact discriminated schema', async () => {
    const openService = vi.fn()
    const session = createProfileGatewaySession({ openService })
    const commandBatch = session.describe().operations.find(({ name }) => name === 'command.batch')
    const commands = commandBatch?.schema.input.properties.commands as Record<string, unknown>
    expect(commands).toMatchObject({ minItems: 1, maxItems: 64 })
    expect(commandBatch?.schema.input.properties.idempotencyKey).toMatchObject({
      minLength: 1,
      'x-eido-maxUtf8Bytes': 256,
    })
    expect(commandBatch?.schema.input.properties.expectedRevision).toMatchObject({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    })
    const items = commands.items as Record<string, unknown>
    const variants = items.oneOf as Array<Record<string, unknown>>
    const variantsByName = new Map(variants.map((variant) => {
      const properties = variant.properties as Record<string, Record<string, unknown>>
      return [properties.name.const as string, variant] as const
    }))

    expect(variantsByName.get('connection.update-meaning')?.description)
      .toBe('Ergonomic CLI: eido connection update-meaning CONNECTION [meaning options].')

    expect([...variantsByName.keys()]).toEqual([
      'card.create',
      'card.update-content',
      'card.delete',
      'connection.create',
      'connection.update-meaning',
      'connection.delete',
      'mod-template.create',
      'mod-template.update',
      'mod-template.delete',
      'mod-instance.stamp',
      'idea.create',
      'ask.set-model',
      'card.set-identity',
      'cards.arrange',
      'cards.reorder-layer',
      'group.membership.set',
      'output.choose-version',
      'output.set-accepted',
      'mod-instance.create',
      'mod-instance.configure',
      'mod-instance.delete',
      'idea.activate',
    ])

    const requiredByName: Readonly<Record<string, readonly string[]>> = {
      'card.delete': ['ideaId', 'cardId'],
      'connection.create': ['ideaId', 'from', 'to'],
      'connection.update-meaning': ['ideaId', 'connectionId'],
      'connection.delete': ['ideaId', 'connectionId'],
      'mod-template.create': ['templateId', 'mod'],
      'mod-template.update': ['templateId', 'expectedTemplateVersion', 'mod'],
      'mod-template.delete': ['templateId', 'expectedTemplateVersion'],
      'mod-instance.stamp': ['ideaId', 'templateId', 'expectedTemplateVersion', 'position'],
      'idea.create': ['name'],
      'ask.set-model': ['ideaId', 'card', 'model'],
      'card.set-identity': ['ideaId', 'card', 'identity'],
      'cards.arrange': ['ideaId', 'frames'],
      'cards.reorder-layer': ['ideaId', 'cards', 'direction'],
      'group.membership.set': ['ideaId', 'card', 'group'],
      'output.choose-version': ['ideaId', 'outputId', 'versionId'],
      'output.set-accepted': ['ideaId', 'outputId', 'versionId', 'accepted'],
      'mod-instance.create': ['ideaId', 'mod', 'position'],
      'mod-instance.configure': ['ideaId', 'cardId', 'mod'],
      'mod-instance.delete': ['ideaId', 'cardId'],
      'idea.activate': ['ideaId'],
    }
    for (const [name, required] of Object.entries(requiredByName)) {
      const variant = variantsByName.get(name)!
      const properties = variant.properties as Record<string, Record<string, unknown>>
      expect(variant).toMatchObject({
        type: 'object',
        required: ['version', 'id', 'name', 'payload'],
        additionalProperties: false,
      })
      expect(properties.payload).toMatchObject({
        type: 'object',
        required,
        additionalProperties: false,
      })
    }

    const cardCreatePayload = (
      variantsByName.get('card.create')!.properties as Record<string, Record<string, unknown>>
    ).payload
    const cardUpdatePayload = (
      variantsByName.get('card.update-content')!.properties as Record<string, Record<string, unknown>>
    ).payload
    expect(cardCreatePayload.anyOf).toHaveLength(5)
    expect(cardUpdatePayload.oneOf).toHaveLength(4)

    const identityPayload = (
      variantsByName.get('card.set-identity')!.properties as Record<
        string,
        Record<string, unknown>
      >
    ).payload
    expect(identityPayload).toMatchObject({
      properties: {
        identity: {
          description: 'On a Mod Card, a preset also sets the Mod accent; clear keeps that accent.',
          oneOf: [
            {
              type: 'null',
              description: 'Clear the Card fill; an existing Mod accent remains unchanged.',
            },
            {
              properties: {
                preset: {
                  enum: [
                    'coral', 'red', 'amber', 'orange', 'mint', 'green',
                    'sky', 'blue', 'orchid', 'purple', 'slate', 'charcoal',
                  ],
                },
                fill: { enum: ['soft', 'body', 'pattern'] },
              },
            },
          ],
        },
      },
    })

    const reorderPayload = (
      variantsByName.get('cards.reorder-layer')!.properties as Record<
        string,
        Record<string, unknown>
      >
    ).payload
    expect(reorderPayload).toMatchObject({
      properties: {
        cards: { minItems: 1, maxItems: 100 },
        direction: { enum: ['front', 'back'] },
      },
    })

    const arrangePayload = (
      variantsByName.get('cards.arrange')!.properties as Record<string, Record<string, unknown>>
    ).payload
    expect(arrangePayload).toMatchObject({
      properties: {
        frames: {
          minItems: 1,
          maxItems: 100,
          items: {
            properties: {
              position: {
                properties: {
                  x: { minimum: -1_000_000, maximum: 1_000_000 },
                  y: { minimum: -1_000_000, maximum: 1_000_000 },
                },
              },
              size: {
                properties: {
                  width: { exclusiveMinimum: 0, maximum: 1_000_000 },
                  height: { exclusiveMinimum: 0, maximum: 1_000_000 },
                },
              },
            },
          },
        },
      },
    })

    const modCreatePayload = (
      variantsByName.get('mod-instance.create')!.properties as Record<string, Record<string, unknown>>
    ).payload
    const modSchemas = (
      (modCreatePayload.properties as Record<string, Record<string, unknown>>).mod.oneOf as Array<{
        additionalProperties: boolean
        not: { required: string[] }
        properties: { kind: { const: string }; state: { additionalProperties: boolean } }
      }>
    )
    const modKinds = modSchemas.map((schema) => schema.properties.kind.const)
    expect(modKinds).toEqual([
      'mixer',
      'filter',
      'slider',
      'dial',
      'count',
      'switch',
      'pad',
      'select',
      'order',
      'radar',
      'matrix',
    ])
    expect(modSchemas.every((schema) => (
      schema.additionalProperties
      && schema.properties.state.additionalProperties
      && schema.not.required[0] === 'id'
    ))).toBe(true)

    const agentCommands = session.describeAgentCli().operations
      .find(({ name }) => name === 'command.batch')?.schema.input.properties.commands as Record<
        string,
        unknown
      >
    const agentVariants = (agentCommands.items as Record<string, unknown>).oneOf as Array<
      Record<string, unknown>
    >
    expect(agentVariants.map((variant) => (
      (variant.properties as Record<string, Record<string, unknown>>).name.const
    ))).toEqual(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES)
    expect(openService).not.toHaveBeenCalled()
    await session.close()
  })

  it('normalizes and invokes the bounded Agent change trail without command authority', async () => {
    const changes = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: 'profile-changes',
        revision: 9,
        since: 4,
        items: [],
        truncated: false,
      },
    }))
    const service = Object.freeze({ changes }) as unknown as ProfileGatewayService

    await expect(executeProfileGatewayRequest(service, {
      version: 1,
      requestId: 'changes-defaults',
      operation: 'changes.list',
      params: { since: 4 },
    })).resolves.toMatchObject({
      ok: true,
      result: { revision: 9, since: 4, items: [], truncated: false },
    })
    expect(changes).toHaveBeenCalledWith({
      since: 4,
      limit: 50,
      byteLimit: 65_536,
    })
  })

  it('normalizes and invokes bounded Result inspection only through the CLI descriptor', async () => {
    const inspectResult = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: 'profile-result',
        revision: 9,
        ideaId: 'idea-1',
        resultCardId: 'card-result',
        items: [],
        truncated: false,
      },
    }))
    const service = Object.freeze({ inspectResult }) as unknown as ProfileGatewayService

    await expect(executeProfileGatewayRequest(service, {
      version: 1,
      requestId: 'result-defaults',
      operation: 'result.inspect',
      params: { ideaId: 'idea-1', resultCardId: 'card-result' },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        revision: 9,
        ideaId: 'idea-1',
        resultCardId: 'card-result',
        items: [],
        truncated: false,
      },
    })
    expect(inspectResult).toHaveBeenCalledWith({
      ideaId: 'idea-1',
      resultCardId: 'card-result',
      limit: 50,
      byteLimit: 65_536,
    })

    await expect(executeProfileGatewayRequest(service, {
      version: 1,
      requestId: 'result-extra',
      operation: 'result.inspect',
      params: { ideaId: 'idea-1', resultCardId: 'card-result', projection: ['text'] },
    })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(inspectResult).toHaveBeenCalledTimes(1)
  })

  it('discovers the filtered four-class Agent surface without opening Profile authority', async () => {
    const openService = vi.fn(async () => ({
      ok: false as const,
      code: 'not-found' as const,
      retryable: false,
      message: 'Profile should not be opened for static discovery.',
    }))
    const session = createProfileGatewaySession({ openService })
    const response = await session.invoke({
      version: 1,
      requestId: 'agent-capabilities',
      operation: 'agent.capabilities',
      params: {},
    })

    expect(response).toEqual({
      version: 1,
      requestId: 'agent-capabilities',
      ok: true,
      result: INSTALLED_PROFILE_AGENT_CAPABILITY_DISCOVERY,
    })
    expect(openService).not.toHaveBeenCalled()
    await session.close()
    const classes = INSTALLED_PROFILE_AGENT_CAPABILITY_DISCOVERY.classes
    expect(Object.keys(classes)).toEqual(['enabled', 'humanOnly', 'systemOnly', 'prohibited'])
    const enabledNames = classes.enabled.capabilities.map(({ name }) => name)
    expect(enabledNames.filter((name) => (
      INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES.includes(
        name as (typeof INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES)[number],
      )
    ))).toEqual(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES)
    expect(INSTALLED_PROFILE_AGENT_COMMAND_NAMES.every((name) => enabledNames.includes(name)))
      .toBe(true)
    expect(enabledNames).toEqual(expect.arrayContaining([
      'idea.create',
      'card.create',
      'card.update-content',
      'card.delete',
      'connection.create',
      'connection.update-meaning',
      'connection.delete',
      'ask.set-model',
      'card.set-identity',
      'cards.arrange',
      'cards.reorder-layer',
      'group.membership.set',
      'output.choose-version',
      'output.set-accepted',
      'mod-template.create',
      'mod-template.update',
      'mod-template.delete',
      'mod-instance.stamp',
      'mod-instance.create',
      'mod-instance.configure',
      'mod-instance.delete',
      'graph.neighbors',
      'graph.bounds',
      'result.inspect',
      'journey.connected-thought',
    ]))
    expect(classes.enabled.capabilities.find(({ name }) => name === 'cards.arrange'))
      .toMatchObject({
        version: 5,
        details: {
          maxFrames: 100,
          maxAbsoluteCoordinate: 1_000_000,
          effects: ['card'],
        },
      })
    expect(classes.enabled.capabilities.find(({ name }) => name === 'card.set-identity'))
      .toMatchObject({
        summary: 'Set or clear one approved visual identity on an eligible non-Title Card, including Mods.',
        version: 5,
        details: {
          effects: ['card', 'mod-instance'],
          conditionalEffects: true,
        },
      })
    expect(classes.enabled.capabilities.find(({ name }) => name === 'mod-instance.create'))
      .toMatchObject({
        version: 5,
        details: {
          effects: ['card', 'block', 'mod-instance'],
        },
      })
    expect(classes.enabled.capabilities.find(({ name }) => name === 'idea.create'))
      .toMatchObject({
        summary: 'Create one named inactive Idea and its empty Board as an audited aggregate.',
        version: 4,
        details: {
          result: ['ideaId', 'boardId', 'ideaName'],
          effects: ['idea', 'board'],
          activatesIdea: false,
        },
      })
    expect(classes.enabled.capabilities.find(({ name }) => name === 'idea.activate'))
      .toMatchObject({
        summary: 'Switch the active Profile head to an existing Idea without mutating either Board.',
        version: 5,
        details: {
          result: ['previousActiveIdeaId', 'activeIdeaId'],
          effects: ['idea'],
          activatesIdea: true,
        },
      })
    expect(classes.enabled.capabilities.find(({ name }) => name === 'run.delegation'))
      .toMatchObject({
        version: 2,
        details: {
          execution: 'ordinary-visible-engine',
          targets: ['askAi', 'conversation'],
          variations: { min: 1, max: 8 },
          artifacts: 'bounded-references-only',
        },
      })
    expect(classes.enabled.capabilities.find(({ name }) => name === 'connection.create'))
      .toMatchObject({
        summary: 'Connect supported Cards; Ask-to-Ask may create an empty structural Result shell.',
        details: {
          excludedKinds: ['title'],
          effects: ['card', 'block', 'connection'],
          conditionalEffects: true,
        },
      })
    expect(classes.enabled.capabilities.find(({ name }) => name === 'card.delete'))
      .toMatchObject({
        details: {
          effects: INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS['card.delete'].effects,
          conditionalEffects: true,
        },
      })
    expect(INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS['card.delete'].effects)
      .toContain('mod-instance')
    expect(classes.systemOnly.capabilities.map(({ name }) => name)).toEqual([
      'result.create-or-edit',
      'conversation.transcript.write',
      'follow-up.answer.write',
    ])
    expect(classes.prohibited.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'connection.title' }),
    ]))
    expect(classes.prohibited.capabilities.map(({ name }) => name))
      .not.toContain('card.mod.create-edit-delete')
  })

  it('normalizes and forwards bounded neighbor and bounds reads', async () => {
    const agentCardNeighbors = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: 'profile-spatial',
        revision: 9,
        ideaId: 'idea-1',
        card: { cardId: 'card-1', deepLink: 'eido://app/?idea=idea-1&card=card-1' },
        items: [],
        truncated: false,
      },
    }))
    const agentCardSetBounds = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: 'profile-spatial',
        revision: 9,
        ideaId: 'idea-1',
        cards: [{
          cardId: 'card-1',
          deepLink: 'eido://app/?idea=idea-1&card=card-1',
          kind: 'note' as const,
          position: { x: 1, y: 2 },
          size: { width: 3, height: 4 },
        }],
        bounds: { x: 1, y: 2, width: 3, height: 4 },
      },
    }))
    const service = Object.freeze({
      agentCardNeighbors,
      agentCardSetBounds,
    }) as unknown as ProfileGatewayService

    await expect(executeProfileGatewayRequest(service, {
      version: 1,
      requestId: 'neighbors',
      operation: 'graph.neighbors',
      params: { ideaId: 'idea-1', card: 'card-1' },
    })).resolves.toMatchObject({ ok: true, result: { revision: 9, items: [] } })
    expect(agentCardNeighbors).toHaveBeenCalledWith({
      ideaId: 'idea-1',
      card: 'card-1',
      limit: 25,
      byteLimit: 32_768,
    })

    await expect(executeProfileGatewayRequest(service, {
      version: 1,
      requestId: 'bounds',
      operation: 'graph.bounds',
      params: {
        ideaId: 'idea-1',
        cards: ['card-1', 'eido://app/?idea=idea-1&card=card-1&x=999&y=-999&zoom=0.1'],
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        revision: 9,
        cards: [{
          cardId: 'card-1',
          kind: 'note',
          position: { x: 1, y: 2 },
          size: { width: 3, height: 4 },
        }],
        bounds: { x: 1, y: 2, width: 3, height: 4 },
      },
    })
    expect(agentCardSetBounds).toHaveBeenCalledWith({
      ideaId: 'idea-1',
      cards: ['card-1', 'eido://app/?idea=idea-1&card=card-1&x=999&y=-999&zoom=0.1'],
    })
  })

  it('admits an installed Mod command and denies uninstalled names before execution', async () => {
    const applyAgentCommandBatch = vi.fn(async () => ({
      ok: true as const,
      value: Object.freeze({
        kind: 'agent-command-batch' as const,
        version: 5 as const,
        previousRevision: 4,
        revision: 4,
        proposedRevision: 5,
        commitId: null,
        commandResults: Object.freeze([Object.freeze({
          commandId: 'create-template',
          name: 'mod-template.create' as const,
          templateId: 'template-1',
          templateVersion: 1,
        })]),
        effects: Object.freeze({
          inserted: 1,
          updated: 0,
          deleted: 0,
          intentEvents: 0,
          profileAgentEvents: 1,
        }),
        intentEventIds: Object.freeze([]),
        profileAgentEventIds: Object.freeze([]),
        dryRun: true,
        replayed: false,
      }),
    }))
    const service = Object.freeze({
      applyAgentCommandBatch,
    }) as unknown as ProfileGatewayService

    const allowed = await executeProfileGatewayRequest(service, gatewayRequest([{
      version: 1,
      id: 'create-template',
      name: 'mod-template.create',
      payload: {
        templateId: 'template-1',
        mod: createSeedMod('switch', {
          title: 'TEMPLATE',
          createId: (role, ordinal) => `gateway-${role}-${ordinal}`,
        }),
      },
    }]))
    expect(allowed).toMatchObject({ ok: true, requestId: 'request-1' })
    expect(applyAgentCommandBatch).toHaveBeenCalledTimes(1)

    applyAgentCommandBatch.mockClear()
    const denied = await executeProfileGatewayRequest(service, gatewayRequest([{
      version: 1,
      id: 'list-templates',
      name: 'mod-template.list',
      payload: {},
    }]))
    expect(denied).toMatchObject({
      ok: false,
      requestId: 'request-1',
      error: { code: 'capability-denied' },
    })
    expect(applyAgentCommandBatch).not.toHaveBeenCalled()
  })

  it('rejects a legacy root-ID Mod document before installed execution', async () => {
    const applyAgentCommandBatch = vi.fn(async () => {
      throw new Error('Legacy Mod admission reached the installed executor')
    })
    const service = Object.freeze({
      applyAgentCommandBatch,
    }) as unknown as ProfileGatewayService

    const response = await executeProfileGatewayRequest(service, gatewayRequest([{
      version: 1,
      id: 'create-legacy-template',
      name: 'mod-template.create',
      payload: {
        templateId: 'template-legacy',
        mod: {
          id: 'template-legacy',
          label: 'Legacy template',
          controls: [],
        },
      },
    }]))

    expect(response).toMatchObject({
      ok: false,
      requestId: 'request-1',
      error: { code: 'invalid' },
    })
    expect(applyAgentCommandBatch).not.toHaveBeenCalled()
  })

  it('projects exact versioned capability metadata from the same executable descriptor set', () => {
    const capabilities = createInstalledProfileAgentCapabilities('sqlite')
    expect(capabilities.commands).toEqual(INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
    expect(capabilities.commands).toContain('idea.create')
    expect(capabilities.commandBatch).toMatchObject({ version: 5 })
    expect(capabilities.commandBatch?.descriptors.map((descriptor) => descriptor.name))
      .toEqual(INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
    expect(Object.keys(INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS))
      .toEqual(INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
    expect(Object.values(INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS).every((descriptor) => (
      descriptor.executor === 'applyAgentCommandBatch'
      && descriptor.schema.validateRequest instanceof Function
      && descriptor.planner instanceof Function
    ))).toBe(true)
    expect(isProfileTransportCapabilities(capabilities)).toBe(true)
    expect(isProfileTransportCapabilities({
      ...capabilities,
      commandBatch: { ...capabilities.commandBatch, version: 1 },
    })).toBe(false)
  })

  it('rejects a structurally valid v2 receipt whose event class cannot come from its commands', () => {
    const request = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: 4,
      idempotencyKey: 'template-event-class',
      dryRun: true,
      commands: [{
        version: 1 as const,
        id: 'create-template',
        name: 'mod-template.create' as const,
        payload: {
          templateId: 'template-1',
          mod: createSeedMod('switch', {
            title: 'TEMPLATE',
            createId: (role, ordinal) => `gateway-${role}-${ordinal}`,
          }),
        },
      }],
    }
    const forgedReceipt = {
      kind: 'agent-command-batch' as const,
      version: 2 as const,
      previousRevision: 4,
      revision: 4,
      proposedRevision: 5,
      commitId: null,
      commandResults: [{
        commandId: 'create-template',
        name: 'mod-template.create' as const,
        templateId: 'template-1',
        templateVersion: 1,
      }],
      effects: {
        inserted: 1,
        updated: 0,
        deleted: 0,
        intentEvents: 1,
        profileAgentEvents: 0,
      },
      intentEventIds: [],
      profileAgentEventIds: [],
      dryRun: true,
      replayed: false,
    }

    expect(isProfileAgentCommandBatchReceiptForSurface(forgedReceipt, 2)).toBe(true)
    expect(isInstalledProfileAgentCommandBatchSuccessForRequest(forgedReceipt, request)).toBe(false)

    const forgedLifecycleIntentReceipt = {
      ...forgedReceipt,
      effects: { ...forgedReceipt.effects, profileAgentEvents: 1 },
    }
    expect(isProfileAgentCommandBatchReceiptForSurface(forgedLifecycleIntentReceipt, 2)).toBe(true)
    expect(isInstalledProfileAgentCommandBatchSuccessForRequest(
      forgedLifecycleIntentReceipt,
      request,
    )).toBe(false)
  })

  it('accepts an exact persisted v1 Board receipt only as a replay', async () => {
    const service = Object.freeze({
      applyAgentCommandBatch: vi.fn(async () => ({
        ok: true as const,
        value: {
          kind: 'agent-command-batch' as const,
          version: 1 as const,
          previousRevision: 4,
          revision: 5,
          proposedRevision: 5,
          commitId: 'legacy-board-commit',
          commandResults: [{
            commandId: 'create-note',
            name: 'card.create' as const,
            cardId: 'card-1',
            blockId: 'block-1',
          }],
          effects: {
            inserted: 2,
            updated: 0,
            deleted: 0,
            intentEvents: 1,
          },
          intentEventIds: ['legacy-board-intent'],
          dryRun: false,
          replayed: true,
        },
      })),
    }) as unknown as ProfileGatewayService

    const response = await executeProfileGatewayRequest(service, gatewayRequest([{
      version: 1,
      id: 'create-note',
      name: 'card.create',
      payload: {
        ideaId: 'idea-1',
        kind: 'note',
        position: { x: 10, y: 20 },
        text: 'A note',
      },
    }], false))

    expect(response).toMatchObject({
      ok: true,
      requestId: 'request-1',
      result: { version: 1, replayed: true, commitId: 'legacy-board-commit' },
    })
  })

  it('rejects fresh v1 success and a replay whose submitted request is not valid on v1', async () => {
    const legacyBoardReceipt = {
      kind: 'agent-command-batch' as const,
      version: 1 as const,
      previousRevision: 4,
      revision: 5,
      proposedRevision: 5,
      commitId: 'legacy-board-commit',
      commandResults: [{
        commandId: 'legacy-create-note',
        name: 'card.create' as const,
        cardId: 'card-1',
        blockId: 'block-1',
      }],
      effects: { inserted: 2, updated: 0, deleted: 0, intentEvents: 1 },
      intentEventIds: ['legacy-board-intent'],
      dryRun: false,
      replayed: true,
    }
    const applyAgentCommandBatch = vi.fn(async () => ({
      ok: true as const,
      value: legacyBoardReceipt,
    }))
    const service = Object.freeze({ applyAgentCommandBatch }) as unknown as ProfileGatewayService

    expect(isInstalledOrReplayedProfileAgentCommandReceipt(legacyBoardReceipt)).toBe(true)
    expect(isInstalledOrReplayedProfileAgentCommandReceipt({
      ...legacyBoardReceipt,
      replayed: false,
    })).toBe(false)

    applyAgentCommandBatch.mockResolvedValueOnce({
      ok: true as const,
      value: { ...legacyBoardReceipt, replayed: false },
    })
    const freshV1 = await executeProfileGatewayRequest(service, gatewayRequest([{
      version: 1,
      id: 'legacy-create-note',
      name: 'card.create',
      payload: {
        ideaId: 'idea-1',
        kind: 'note',
        position: { x: 10, y: 20 },
      },
    }], false))
    expect(freshV1).toMatchObject({ ok: false, error: { code: 'internal' } })

    const v1ForMod = await executeProfileGatewayRequest(service, gatewayRequest([{
      version: 1,
      id: 'create-template',
      name: 'mod-template.create',
      payload: {
        templateId: 'template-1',
        mod: createSeedMod('switch', {
          title: 'TEMPLATE',
          createId: (role, ordinal) => `gateway-v1-${role}-${ordinal}`,
        }),
      },
    }], false))
    expect(v1ForMod).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('keeps persisted v1-v4 exact while the installed receipt discriminator is v5', () => {
    const forgedV1ModReceipt = {
      kind: 'agent-command-batch',
      version: 1,
      previousRevision: 7,
      revision: 8,
      proposedRevision: 8,
      commitId: 'agent:profile-scope-zero-intent',
      commandResults: [{
        commandId: 'create-template',
        name: 'mod-template.create',
        templateId: 'template-1',
        templateVersion: 1,
      }],
      effects: { inserted: 1, updated: 0, deleted: 0, intentEvents: 0 },
      intentEventIds: [],
      dryRun: false,
      replayed: false,
    }
    expect(isProfileAgentCommandBatchReceipt(forgedV1ModReceipt)).toBe(false)
    const persistedV2 = {
      ...forgedV1ModReceipt,
      version: 2,
      effects: {
        ...forgedV1ModReceipt.effects,
        profileAgentEvents: 1,
      },
      profileAgentEventIds: ['profile-agent-event-1'],
    }
    expect(isProfileAgentCommandBatchReceipt(persistedV2)).toBe(false)
    expect(isProfileAgentCommandBatchReceiptForSurface(persistedV2, 2)).toBe(true)
    const persistedV3 = { ...persistedV2, version: 3 }
    expect(isProfileAgentCommandBatchReceiptForSurface(persistedV3, 3)).toBe(true)
    expect(isProfileAgentCommandBatchReceipt(persistedV3)).toBe(false)
    const persistedV4 = { ...persistedV3, version: 4 }
    expect(isProfileAgentCommandBatchReceiptForSurface(persistedV4, 4)).toBe(true)
    expect(isProfileAgentCommandBatchReceipt(persistedV4)).toBe(false)
    expect(isProfileAgentCommandBatchReceipt({ ...persistedV4, version: 5 })).toBe(true)
  })
})

function gatewayRequest(commands: readonly unknown[], dryRun = true) {
  return {
    version: 1,
    requestId: 'request-1',
    operation: 'command.batch',
    params: {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 4,
      idempotencyKey: 'batch-1',
      dryRun,
      commands,
    },
  }
}
