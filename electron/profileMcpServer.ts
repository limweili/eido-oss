import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import {
  createProfileGatewayFailureResponse,
  profileGatewayOperationSupportsAdapter,
  type ProfileGatewayOperationName,
  type ProfileGatewayResponse,
  type ProfileGatewaySession,
} from '../src/persistence/profileAgentGateway'
import { PROFILE_GATEWAY_PROTOCOL_VERSION, profileServiceFailure } from '../src/persistence/profileServiceContract'

export const PROFILE_MCP_LIMITS = Object.freeze({
  maxInputLineBytes: 512 * 1024,
  maxGatewayResponseBytes: 512 * 1024,
  maxToolResultBytes: 2 * 1024 * 1024,
  maxDiagnosticBytes: 256,
})

export type ProfileMcpServerOptions = Readonly<{
  gateway: ProfileGatewaySession
  createRequestId(): string
  handlerTracker?: ProfileMcpHandlerTracker
}>

export type ProfileMcpHandlerTracker = Readonly<{
  track<Result>(work: Promise<Result>): Promise<Result>
  drain(): Promise<void>
}>

export type ProfileMcpOperationOptions = ProfileMcpServerOptions & Readonly<{
  name: string
  params: Readonly<Record<string, unknown>>
  signal: AbortSignal
}>

export function createProfileMcpServer(options: ProfileMcpServerOptions): Server {
  const description = options.gateway.describe()
  const server = new Server(
    { name: 'eido-profile', version: String(description.version) },
    { capabilities: { tools: {} } },
  )
  const tools: Tool[] = description.operations
    .filter((operation) => profileGatewayOperationSupportsAdapter(operation, 'mcp'))
    .map((operation) => ({
    name: operation.name,
    description: operation.summary,
    inputSchema: operation.schema.input as Tool['inputSchema'],
    annotations: {
      readOnlyHint: !operation.mutating,
      destructiveHint: operation.mutating,
      idempotentHint: true,
      openWorldHint: false,
    },
    }))
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }))
  const callToolMethodSchema = CallToolRequestSchema.pick({ method: true }).loose()
  server.setRequestHandler(callToolMethodSchema, (candidate, extra) => {
    const request = CallToolRequestSchema.parse(candidate)
    const handled = invokeProfileMcpOperation({
      ...options,
      name: request.params.name,
      params: request.params.arguments ?? {},
      signal: extra.signal,
    })
    return options.handlerTracker?.track(handled) ?? handled
  })
  return server
}

export function createProfileMcpHandlerTracker(): ProfileMcpHandlerTracker {
  const active = new Set<Promise<unknown>>()
  return Object.freeze({
    track<Result>(work: Promise<Result>): Promise<Result> {
      active.add(work)
      void work.then(
        () => active.delete(work),
        () => active.delete(work),
      )
      return work
    },
    async drain(): Promise<void> {
      while (active.size > 0) await Promise.allSettled([...active])
    },
  })
}

export async function invokeProfileMcpOperation(
  options: ProfileMcpOperationOptions,
): Promise<CallToolResult> {
  const operation = options.gateway.describe().operations.find((candidate) => (
    candidate.name === options.name
    && profileGatewayOperationSupportsAdapter(candidate, 'mcp')
  ))
  if (!operation) throw new McpError(ErrorCode.InvalidParams, 'Unknown Eido Profile tool')

  const requestId = options.createRequestId()
  if (options.signal.aborted) {
    throw new McpError(ErrorCode.ConnectionClosed, 'Request was cancelled')
  }
  const admitted = options.gateway.invoke({
    version: PROFILE_GATEWAY_PROTOCOL_VERSION,
    requestId,
    operation: operation.name as ProfileGatewayOperationName,
    params: options.params,
  })
  let response: ProfileGatewayResponse
  try {
    response = await admitted
  } catch {
    response = createProfileGatewayFailureResponse(
      requestId,
      profileServiceFailure('internal'),
    )
  }
  return profileGatewayResponseToMcp(response)
}

function profileGatewayResponseToMcp(candidate: ProfileGatewayResponse): CallToolResult {
  let response = candidate
  let text = JSON.stringify(response)
  if (utf8ByteLength(text) > PROFILE_MCP_LIMITS.maxGatewayResponseBytes) {
    response = createProfileGatewayFailureResponse(
      response.requestId,
      profileServiceFailure('internal'),
    )
    text = JSON.stringify(response)
  }
  let result: CallToolResult = {
    content: [{ type: 'text', text }],
    structuredContent: response as unknown as Record<string, unknown>,
    ...(response.ok ? {} : { isError: true }),
  }
  if (utf8ByteLength(JSON.stringify(result)) > PROFILE_MCP_LIMITS.maxToolResultBytes) {
    response = createProfileGatewayFailureResponse(
      response.requestId,
      profileServiceFailure('internal'),
    )
    text = JSON.stringify(response)
    result = {
      content: [{ type: 'text', text }],
      structuredContent: response as unknown as Record<string, unknown>,
      isError: true,
    }
  }
  if (utf8ByteLength(JSON.stringify(result)) > PROFILE_MCP_LIMITS.maxToolResultBytes) {
    throw new McpError(ErrorCode.InternalError, 'Eido Profile result was unavailable')
  }
  return result
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
