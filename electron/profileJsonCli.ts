import {
  createProfileGatewaySession,
  createProfileGatewayFailureResponse,
  type ProfileGatewayResponse,
  type ProfileGatewaySessionService,
} from '../src/persistence/profileAgentGateway'
import {
  profileServiceFailure,
  type ProfileServiceErrorCode,
  type ProfileServiceResult,
} from '../src/persistence/profileServiceContract'

export const PROFILE_JSON_CLI_LIMITS = {
  maxInputBytes: 512 * 1024,
  maxOutputBytes: 512 * 1024,
  maxDiagnosticBytes: 256,
} as const

export const PROFILE_JSON_CLI_EXIT_CODES = {
  success: 0,
  internal: 1,
  invalid: 2,
  capabilityDenied: 3,
  unavailable: 4,
  unsupportedFutureVersion: 5,
  notFound: 6,
  recoveryRequired: 7,
} as const

export type ProfileJsonCliWriter = {
  write(value: string): void | PromiseLike<void>
}

export type ProfileJsonCliOptions = {
  openService: () => Promise<ProfileServiceResult<ProfileJsonCliService>>
  stdin: AsyncIterable<string | Uint8Array>
  stdout: ProfileJsonCliWriter
  stderr: ProfileJsonCliWriter
}

export type ProfileJsonCliService = ProfileGatewaySessionService

export async function runProfileJsonCli(options: ProfileJsonCliOptions): Promise<number> {
  let response: ProfileGatewayResponse | undefined
  try {
    const input = await readBoundedInput(options.stdin)
    if (!input.ok) {
      response = createProfileGatewayFailureResponse(null, profileServiceFailure(input.code))
    } else {
      let candidate: unknown
      try {
        candidate = JSON.parse(input.value) as unknown
      } catch {
        response = createProfileGatewayFailureResponse(null, profileServiceFailure('invalid'))
        return writeResult(options, response)
      }
      const session = createProfileGatewaySession({ openService: options.openService })
      try {
        response = await session.invoke(candidate)
      } finally {
        await session.close()
      }
    }
  } catch {
    response = createProfileGatewayFailureResponse(
      response?.requestId ?? null,
      profileServiceFailure('internal'),
    )
  }
  response ??= createProfileGatewayFailureResponse(null, profileServiceFailure('internal'))
  return writeResult(options, response)
}

export function finishProfileJsonCliPreflightFailure(
  options: Pick<ProfileJsonCliOptions, 'stdout' | 'stderr'>,
): Promise<number> {
  return writeResult(
    options,
    createProfileGatewayFailureResponse(null, profileServiceFailure('internal')),
  )
}

async function writeResult(
  options: Pick<ProfileJsonCliOptions, 'stdout' | 'stderr'>,
  candidate: ProfileGatewayResponse,
): Promise<number> {
  let response = candidate
  let output = `${JSON.stringify(response)}\n`
  if (utf8ByteLength(output) > PROFILE_JSON_CLI_LIMITS.maxOutputBytes) {
    response = createProfileGatewayFailureResponse(
      response.requestId,
      profileServiceFailure('internal'),
    )
    output = `${JSON.stringify(response)}\n`
  }

  try {
    await options.stdout.write(output)
  } catch {
    await writeDiagnostic(options.stderr, 'internal')
    return PROFILE_JSON_CLI_EXIT_CODES.internal
  }
  if (response.ok) return PROFILE_JSON_CLI_EXIT_CODES.success
  await writeDiagnostic(options.stderr, response.error.code)
  return profileJsonCliExitCodeFor(response.error.code)
}

async function readBoundedInput(
  stdin: AsyncIterable<string | Uint8Array>,
): Promise<{ ok: true; value: string } | { ok: false; code: 'invalid' | 'internal' }> {
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of stdin) {
      const bytes = typeof chunk === 'string'
        ? new TextEncoder().encode(chunk)
        : chunk instanceof Uint8Array
          ? new Uint8Array(chunk)
          : undefined
      if (!bytes) return { ok: false, code: 'invalid' }
      total += bytes.byteLength
      if (total > PROFILE_JSON_CLI_LIMITS.maxInputBytes) return { ok: false, code: 'invalid' }
      chunks.push(bytes)
    }
  } catch {
    return { ok: false, code: 'internal' }
  }
  if (total === 0) return { ok: false, code: 'invalid' }

  const input = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    input.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(input) }
  } catch {
    return { ok: false, code: 'invalid' }
  }
}

async function writeDiagnostic(writer: ProfileJsonCliWriter, code: ProfileServiceErrorCode): Promise<void> {
  const message = `Eido Profile inspection failed (${code}).\n`
  const bounded = utf8ByteLength(message) <= PROFILE_JSON_CLI_LIMITS.maxDiagnosticBytes
    ? message
    : 'Eido Profile inspection failed.\n'
  try {
    await writer.write(bounded)
  } catch {
    // The JSON response remains the sole machine-readable result.
  }
}

export function profileJsonCliExitCodeFor(code: ProfileServiceErrorCode): number {
  switch (code) {
    case 'invalid':
    case 'idea-remap-too-large':
      return PROFILE_JSON_CLI_EXIT_CODES.invalid
    case 'capability-denied':
      return PROFILE_JSON_CLI_EXIT_CODES.capabilityDenied
    case 'busy':
    case 'conflict':
      return PROFILE_JSON_CLI_EXIT_CODES.unavailable
    case 'unsupported-future-version':
      return PROFILE_JSON_CLI_EXIT_CODES.unsupportedFutureVersion
    case 'not-found':
      return PROFILE_JSON_CLI_EXIT_CODES.notFound
    case 'corrupt-or-recovery-required':
      return PROFILE_JSON_CLI_EXIT_CODES.recoveryRequired
    case 'internal':
      return PROFILE_JSON_CLI_EXIT_CODES.internal
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
