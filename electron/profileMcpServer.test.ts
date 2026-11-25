import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createProfileGatewaySession,
  profileGatewayOperationSupportsAdapter,
  type ProfileGatewaySession,
  type ProfileGatewaySessionService,
} from '../src/persistence/profileAgentGateway'
import { PROFILE_CONTRACT_VERSIONS } from '../src/persistence/profileServiceContract'
import {
  createProfileMcpServer,
  invokeProfileMcpOperation,
  PROFILE_MCP_LIMITS,
} from './profileMcpServer'

describe('installed Profile MCP server', () => {
  it('initializes with tools only and discovers the exact static Gateway operations', async () => {
    const openService = vi.fn(async () => ({
      ok: true as const,
      value: createUnusedService(),
    }))
    const gateway = createProfileGatewaySession({ openService })
    const server = createProfileMcpServer({
      gateway,
      createRequestId: () => 'mcp-request-unused',
    })
    const client = new Client({ name: 'eido-profile-mcp-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      expect(client.getServerCapabilities()).toEqual({ tools: {} })
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        'profile.status',
        'profile.capabilities',
        'idea.list',
        'graph.query',
        'record.get',
        'mod-template.list',
        'command.batch',
      ])
      expect(listed.tools).toHaveLength(7)
      expect(listed.tools.map((tool) => tool.inputSchema)).toEqual(
        gateway.describe().operations
          .filter((operation) => profileGatewayOperationSupportsAdapter(operation, 'mcp'))
          .map((operation) => operation.schema.input),
      )
      expect(listed.tools.every((tool) => tool.outputSchema === undefined)).toBe(true)
      await expect(client.callTool({ name: 'graph.neighbors', arguments: {} }))
        .rejects.toMatchObject({ code: ErrorCode.InvalidParams })
      await expect(client.callTool({ name: 'changes.list', arguments: {} }))
        .rejects.toMatchObject({ code: ErrorCode.InvalidParams })
      expect(openService).not.toHaveBeenCalled()
    } finally {
      await client.close()
      await server.close()
      await gateway.close()
    }
  })

  it('maps Gateway outcomes to bounded text plus structured content with trusted correlation', async () => {
    const status = {
      profileId: 'profile-mcp',
      revision: 4,
      versions: PROFILE_CONTRACT_VERSIONS,
      state: 'ready' as const,
      owner: { mode: 'mutable' as const, route: 'exclusive-headless-owner' as const },
      dirty: 'clean' as const,
      compatibility: {
        read: 'supported' as const,
        write: 'supported' as const,
        source: 'friends-alpha' as const,
      },
    } as const
    const close = vi.fn(async () => undefined)
    const openService = vi.fn(async () => ({
      ok: true as const,
      value: Object.freeze({
        ...createUnusedService(),
        status: vi.fn(async () => ({ ok: true as const, value: status })),
        close,
      }),
    }))
    const gateway = createProfileGatewaySession({ openService })
    const createRequestId = vi.fn()
      .mockReturnValueOnce('mcp-generated-1')
      .mockReturnValueOnce('mcp-generated-2')
    const server = createProfileMcpServer({ gateway, createRequestId })
    const client = new Client({ name: 'eido-profile-mcp-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const inspected = await client.callTool({ name: 'profile.status', arguments: {} })
      const expected = {
        version: 1,
        requestId: 'mcp-generated-1',
        ok: true,
        result: status,
      }
      expect(inspected).toEqual({
        content: [{ type: 'text', text: JSON.stringify(expected) }],
        structuredContent: expected,
      })

      const denied = await client.callTool({
        name: 'profile.status',
        arguments: { requestId: 'caller-cannot-spoof' },
      })
      expect(denied).toMatchObject({
        isError: true,
        structuredContent: {
          version: 1,
          requestId: 'mcp-generated-2',
          ok: false,
          error: { code: 'invalid' },
        },
      })
      expect(createRequestId).toHaveBeenCalledTimes(2)

      await expect(client.callTool({ name: 'board.snapshot', arguments: {} }))
        .rejects.toBeInstanceOf(McpError)
      expect(createRequestId).toHaveBeenCalledTimes(2)

      await expect(client.request({
        method: 'tools/call',
        params: { name: 17 },
      } as never, CallToolResultSchema)).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      })
    } finally {
      await client.close()
      await gateway.close()
      await server.close()
    }
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not acquire Profile authority when cancellation wins before Gateway admission', async () => {
    const openService = vi.fn(async () => ({
      ok: true as const,
      value: createUnusedService(),
    }))
    const gateway = createProfileGatewaySession({ openService })
    const cancellation = new AbortController()
    cancellation.abort()

    await expect(invokeProfileMcpOperation({
      gateway,
      createRequestId: () => 'mcp-cancelled-before-admission',
      name: 'profile.status',
      params: {},
      signal: cancellation.signal,
    })).rejects.toMatchObject({ code: ErrorCode.ConnectionClosed })
    expect(openService).not.toHaveBeenCalled()
    await gateway.close()
  })

  it('replaces an oversized Gateway response instead of truncating protocol content', async () => {
    const described = createProfileGatewaySession({
      openService: async () => ({ ok: true, value: createUnusedService() }),
    }).describe()
    const invoke: ProfileGatewaySession['invoke'] = vi.fn(async (candidate) => ({
      version: 1,
      requestId: (candidate as { requestId: string }).requestId,
      ok: true,
      result: {
        profileId: 'x'.repeat(PROFILE_MCP_LIMITS.maxGatewayResponseBytes),
        revision: 4,
        versions: PROFILE_CONTRACT_VERSIONS,
        state: 'ready',
        owner: { mode: 'mutable', route: 'exclusive-headless-owner' },
        dirty: 'clean',
        compatibility: {
          read: 'supported',
          write: 'supported',
          source: 'friends-alpha',
        },
      },
    } as const))
    const gateway: ProfileGatewaySession = Object.freeze({
      describe: () => described,
      describeAgentCli: () => described,
      invoke,
      close: vi.fn(async () => undefined),
    })

    const result = await invokeProfileMcpOperation({
      gateway,
      createRequestId: () => 'mcp-oversized-result',
      name: 'profile.status',
      params: {},
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        requestId: 'mcp-oversized-result',
        ok: false,
        error: { code: 'internal' },
      },
    })
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8'))
      .toBeLessThanOrEqual(PROFILE_MCP_LIMITS.maxToolResultBytes)
  })
})

function createUnusedService(): ProfileGatewaySessionService {
  const unused = () => Promise.reject(new Error('Static discovery opened Profile authority'))
  return Object.freeze({
    status: unused,
    capabilities: unused,
    query: unused,
    applyAgentCommandBatch: unused,
    close: vi.fn(async () => undefined),
  })
}
