import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  createProfileGatewayFailureResponse,
  createProfileGatewaySession,
  type ProfileGatewayRequest,
  type ProfileGatewayResponse,
} from '../src/persistence/profileAgentGateway'
import {
  isProfileAgentRunGatewayOperation,
  profileAgentRunLiveRequiredGatewayFailure,
  profileAgentRunSubmitOutcomeUnknownGatewayFailure,
} from '../src/persistence/profileAgentRunGateway'
import { profileServiceFailure } from '../src/persistence/profileServiceContract'
import {
  EIDO_CLI_HELP,
  planEidoCliIdentity,
  runEidoCli,
  writeEidoCliUsageFailure,
  type EidoCliIdentity,
  type EidoCliRawIo,
} from './eidoCli'
import { createProfileLiveGatewayClient } from './profileLiveGatewayClient'
import type { ProfileLiveGatewayClient } from './profileLiveGatewayTransport'
import {
  PROFILE_JSON_CLI_EXIT_CODES,
  PROFILE_JSON_CLI_LIMITS,
  profileJsonCliExitCodeFor,
  type ProfileJsonCliWriter,
} from './profileJsonCli'
import type { EidoCliUsageError } from './eidoCliCommands'
import {
  resolveProfileInstallation,
  type ProfileInstallation,
} from './profileInstallation'

const PROFILE_PROOF_ROOT_ARGUMENT = '--eido-profile-proof-root='
const DEFAULT_HEADLESS_PROCESS_TIMEOUT_MS = 30_000
const DEFAULT_HEADLESS_TERMINATION_GRACE_MS = 1_000

export type StandaloneEidoCliOptions = Readonly<{
  argv: readonly string[]
  environment: Readonly<Record<string, string | undefined>>
  platform: 'darwin' | 'win32'
  executablePath: string
  homeDirectory: string
  stdin: AsyncIterable<string | Uint8Array>
  stdout: ProfileJsonCliWriter
  stderr: ProfileJsonCliWriter
  createRequestId?: () => string
  createSessionId?: () => string
  liveClient?: ProfileLiveGatewayClient
  invokeHeadless?: (
    request: ProfileGatewayRequest,
    identity: EidoCliIdentity,
  ) => Promise<ProfileGatewayResponse>
  runHeadlessRaw?: (
    io: EidoCliRawIo,
    identity: EidoCliIdentity,
  ) => Promise<number>
  appVersion?: string
  headlessProcessTimeoutMs?: number
  headlessTerminationGraceMs?: number
}>

export async function runStandaloneEidoCli(
  options: StandaloneEidoCliOptions,
): Promise<number> {
  const installationPlan = planStandaloneInstallation(
    options.argv,
    options.platform,
    options.environment,
    options.homeDirectory,
  )
  if (!installationPlan.ok) {
    return standaloneUsageFailure(options, {
      code: 'cli.usage',
      message: 'The Eido Profile installation could not be resolved from this environment.',
      hint: 'Run `eido --help`. This command never accepts a Profile path or storage credentials.',
    })
  }
  const identityPlan = planEidoCliIdentity(
    installationPlan.argv,
    options.environment,
    options.createSessionId ?? randomUUID,
  )
  if (!identityPlan.ok) {
    return standaloneUsageFailure(options, {
      code: 'cli.usage',
      message: 'The --agent-client and --agent-session identity options are not valid.',
      hint: 'Each accepts one bounded single-line value. Run `eido --help`.',
    })
  }
  const helperName = options.platform === 'win32'
    ? 'eido-profile-live-gateway-helper.exe'
    : 'eido-profile-live-gateway-helper'
  const helperPath = path.join(path.dirname(options.executablePath), helperName)
  const liveClient = options.liveClient ?? createProfileLiveGatewayClient({
    installation: installationPlan.installation,
    platform: options.platform,
    helperPath,
  })
  const invokeHeadless = options.invokeHeadless ?? (async (request, identity) => (
    invokeHeadlessElectron({
      request,
      identity,
      platform: options.platform,
      executablePath: options.executablePath,
      environment: options.environment,
      proofRoot: installationPlan.proofRoot,
      processTimeoutMs: options.headlessProcessTimeoutMs,
      terminationGraceMs: options.headlessTerminationGraceMs,
    })
  ))
  const runHeadlessRaw = options.runHeadlessRaw ?? (async (io, identity) => (
    runHeadlessElectronRaw({
      io,
      identity,
      platform: options.platform,
      executablePath: options.executablePath,
      environment: options.environment,
      proofRoot: installationPlan.proofRoot,
      processTimeoutMs: options.headlessProcessTimeoutMs,
      terminationGraceMs: options.headlessTerminationGraceMs,
    })
  ))
  const discovery = createProfileGatewaySession({
    openService: async () => profileServiceFailure('internal'),
  })
  try {
    return await runEidoCli({
      argv: identityPlan.argv,
      createRequestId: options.createRequestId ?? randomUUID,
      describeGateway: () => discovery.describeAgentCli(),
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      invoke: (request) => routeStandaloneRequest(
        liveClient,
        request,
        identityPlan.identity,
        invokeHeadless,
      ),
      runRaw: (io) => runStandaloneRaw(
        io,
        liveClient,
        identityPlan.identity,
        runHeadlessRaw,
      ),
    })
  } finally {
    await discovery.close()
  }
}

export async function routeStandaloneRequest(
  liveClient: ProfileLiveGatewayClient,
  request: ProfileGatewayRequest,
  identity: EidoCliIdentity,
  invokeHeadless: (request: ProfileGatewayRequest, identity: EidoCliIdentity) => Promise<ProfileGatewayResponse>,
): Promise<Readonly<{
  response: ProfileGatewayResponse
  servedBy: 'live' | 'headless'
  live: Readonly<{
    state: 'served' | 'absent' | 'unavailable'
    reason?: string
    admission?: 'none' | 'admitted' | 'unknown'
    fallback?: 'headless' | 'forbidden'
  }>
}>> {
  let live: Awaited<ReturnType<ProfileLiveGatewayClient['invoke']>>
  try {
    live = await liveClient.invoke(request, identity)
  } catch {
    return Object.freeze({
      response: createProfileGatewayFailureResponse(
        request.requestId,
        request.operation === 'run.submit'
          ? profileAgentRunSubmitOutcomeUnknownGatewayFailure()
          : profileServiceFailure('internal'),
      ),
      servedBy: 'live' as const,
      live: Object.freeze({
        state: 'unavailable' as const,
        reason: 'client-error',
        admission: 'unknown' as const,
        fallback: 'forbidden' as const,
      }),
    })
  }
  if (live.state === 'served') {
    return Object.freeze({
      response: live.response,
      servedBy: 'live' as const,
      live: Object.freeze({ state: 'served' as const }),
    })
  }
  if (isProfileAgentRunGatewayOperation(request.operation)) {
    const failure = live.state === 'absent'
      ? profileAgentRunLiveRequiredGatewayFailure(request.operation)
      : request.operation === 'run.submit'
        ? profileAgentRunSubmitOutcomeUnknownGatewayFailure()
        : profileServiceFailure('internal')
    return Object.freeze({
      response: createProfileGatewayFailureResponse(request.requestId, failure),
      servedBy: 'live' as const,
      live: Object.freeze({ ...live, fallback: 'forbidden' as const }),
    })
  }
  if (live.state === 'absent' && live.fallback === 'headless') {
    let response: ProfileGatewayResponse
    try {
      response = await invokeHeadless(request, identity)
    } catch {
      response = createProfileGatewayFailureResponse(
        request.requestId,
        profileServiceFailure('internal'),
      )
    }
    return Object.freeze({
      response,
      servedBy: 'headless' as const,
      live: Object.freeze({ ...live }),
    })
  }
  return Object.freeze({
    response: createProfileGatewayFailureResponse(
      request.requestId,
      profileServiceFailure('internal'),
    ),
    servedBy: 'live' as const,
    live: Object.freeze({ ...live }),
  })
}

async function runStandaloneRaw(
  io: EidoCliRawIo,
  liveClient: ProfileLiveGatewayClient,
  identity: EidoCliIdentity,
  runHeadlessRaw: (io: EidoCliRawIo, identity: EidoCliIdentity) => Promise<number>,
): Promise<number> {
  let input: Readonly<{ bytes: Uint8Array; text: string }>
  try {
    input = await readBoundedInput(io.stdin)
  } catch {
    return writeRawOutcome(
      io,
      createProfileGatewayFailureResponse(null, profileServiceFailure('invalid')),
    )
  }
  let candidate: unknown
  try {
    candidate = JSON.parse(input.text)
  } catch {
    return writeRawOutcome(
      io,
      createProfileGatewayFailureResponse(null, profileServiceFailure('invalid')),
    )
  }
  const request = minimallyValidGatewayRequest(candidate)
  if (!request) {
    return writeRawOutcome(
      io,
      createProfileGatewayFailureResponse(null, profileServiceFailure('invalid')),
    )
  }
  let live: Awaited<ReturnType<ProfileLiveGatewayClient['invoke']>>
  try {
    live = await liveClient.invoke(request, identity)
  } catch {
    return writeRawOutcome(
      io,
      createProfileGatewayFailureResponse(
        request.requestId,
        request.operation === 'run.submit'
          ? profileAgentRunSubmitOutcomeUnknownGatewayFailure()
          : profileServiceFailure('internal'),
      ),
    )
  }
  if (live.state === 'served') return writeRawOutcome(io, live.response)
  if (isProfileAgentRunGatewayOperation(request.operation)) {
    const failure = live.state === 'absent'
      ? profileAgentRunLiveRequiredGatewayFailure(request.operation)
      : request.operation === 'run.submit'
        ? profileAgentRunSubmitOutcomeUnknownGatewayFailure()
        : profileServiceFailure('internal')
    return writeRawOutcome(
      io,
      createProfileGatewayFailureResponse(request.requestId, failure),
    )
  }
  if (live.state === 'absent' && live.fallback === 'headless') {
    return runHeadlessRaw({
      stdin: exactInput(input.bytes),
      stdout: io.stdout,
      stderr: io.stderr,
    }, identity)
  }
  return writeRawOutcome(
    io,
    createProfileGatewayFailureResponse(request.requestId, profileServiceFailure('internal')),
  )
}

async function writeRawOutcome(
  io: Pick<EidoCliRawIo, 'stdout' | 'stderr'>,
  response: ProfileGatewayResponse,
): Promise<number> {
  try {
    await io.stdout.write(`${JSON.stringify(response)}\n`)
  } catch {
    return PROFILE_JSON_CLI_EXIT_CODES.internal
  }
  if (response.ok) return PROFILE_JSON_CLI_EXIT_CODES.success
  try {
    await io.stderr.write(`Eido Profile inspection failed (${response.error.code}).\n`)
  } catch {
    // Raw JSON is the authoritative machine outcome.
  }
  return profileJsonCliExitCodeFor(response.error.code)
}

async function invokeHeadlessElectron(input: Readonly<{
  request: ProfileGatewayRequest
  identity: EidoCliIdentity
  platform: 'darwin' | 'win32'
  executablePath: string
  environment: Readonly<Record<string, string | undefined>>
  proofRoot?: string
  processTimeoutMs?: number
  terminationGraceMs?: number
}>): Promise<ProfileGatewayResponse> {
  const electronPath = await resolvePackagedElectronPath(
    input.platform,
    input.executablePath,
  )
  const args = [
    '--eido-profile-json',
    ...(input.proofRoot === undefined
      ? []
      : [`${PROFILE_PROOF_ROOT_ARGUMENT}${input.proofRoot}`]),
  ]
  const child = spawn(electronPath, args, {
    cwd: path.dirname(electronPath),
    env: createStandaloneHeadlessEnvironment(input.environment, input.identity),
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdin.end(JSON.stringify(input.request))
  const [stdout, _stderr, outcome] = await collectBoundedHeadlessProcess(
    child,
    PROFILE_JSON_CLI_LIMITS.maxOutputBytes + 2,
    PROFILE_JSON_CLI_LIMITS.maxDiagnosticBytes,
    input.processTimeoutMs ?? DEFAULT_HEADLESS_PROCESS_TIMEOUT_MS,
    input.terminationGraceMs ?? DEFAULT_HEADLESS_TERMINATION_GRACE_MS,
  )
  if (outcome.signal !== null || outcome.code === null) {
    throw new Error('Headless Eido process did not exit normally')
  }
  const normalized = stdout[0] === 13 && stdout[1] === 10
    ? stdout.subarray(2)
    : stdout
  const candidate = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(normalized)) as unknown
  if (!isCorrelatedGatewayResponse(candidate, input.request.requestId)) {
    throw new Error('Headless Eido response was uncorrelated')
  }
  return candidate
}

async function runHeadlessElectronRaw(input: Readonly<{
  io: EidoCliRawIo
  identity: EidoCliIdentity
  platform: 'darwin' | 'win32'
  executablePath: string
  environment: Readonly<Record<string, string | undefined>>
  proofRoot?: string
  processTimeoutMs?: number
  terminationGraceMs?: number
}>): Promise<number> {
  const electronPath = await resolvePackagedElectronPath(
    input.platform,
    input.executablePath,
  )
  const child = spawn(electronPath, [
    '--eido-profile-json',
    ...(input.proofRoot === undefined
      ? []
      : [`${PROFILE_PROOF_ROOT_ARGUMENT}${input.proofRoot}`]),
  ], {
    cwd: path.dirname(electronPath),
    env: createStandaloneHeadlessEnvironment(input.environment, input.identity),
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const requestBytes = await collectBoundedInputBytes(input.io.stdin)
  child.stdin.end(requestBytes)
  const [rawStdout, rawStderr, outcome] = await collectBoundedHeadlessProcess(
    child,
    PROFILE_JSON_CLI_LIMITS.maxOutputBytes + 2,
    PROFILE_JSON_CLI_LIMITS.maxDiagnosticBytes,
    input.processTimeoutMs ?? DEFAULT_HEADLESS_PROCESS_TIMEOUT_MS,
    input.terminationGraceMs ?? DEFAULT_HEADLESS_TERMINATION_GRACE_MS,
  )
  if (outcome.signal !== null
    || outcome.code === null
    || outcome.code < 0
    || outcome.code > 255) {
    throw new Error('Headless Eido raw process did not exit normally')
  }
  const stdout = input.platform === 'win32' && rawStdout[0] === 13 && rawStdout[1] === 10
    ? rawStdout.subarray(2)
    : rawStdout
  const decoder = new TextDecoder('utf-8', { fatal: true })
  if (stdout.byteLength > 0) await input.io.stdout.write(decoder.decode(stdout))
  if (rawStderr.byteLength > 0) await input.io.stderr.write(decoder.decode(rawStderr))
  return outcome.code
}

async function resolvePackagedElectronPath(
  platform: 'darwin' | 'win32',
  cliExecutablePath: string,
): Promise<string> {
  const binDirectory = path.dirname(cliExecutablePath)
  const applicationDirectory = path.resolve(binDirectory, '..', '..')
  if (platform === 'darwin') {
    const macosDirectory = path.join(applicationDirectory, 'MacOS')
    const entries = await readdir(macosDirectory)
    const candidates: string[] = []
    for (const entry of entries) {
      const candidate = path.join(macosDirectory, entry)
      if ((await stat(candidate)).isFile()) candidates.push(candidate)
    }
    if (candidates.length !== 1) throw new Error('Packaged Eido executable was ambiguous')
    return candidates[0]!
  }
  const entries = await readdir(applicationDirectory)
  const candidates = entries.filter((entry) => (
    /\.exe$/i.test(entry)
      && !/^eido-profile-mcp\.exe$/i.test(entry)
      && !/^uninstall\s/i.test(entry)
  ))
  if (candidates.length !== 1) throw new Error('Packaged Eido executable was ambiguous')
  return path.join(applicationDirectory, candidates[0]!)
}

function planStandaloneInstallation(
  argv: readonly string[],
  platform: 'darwin' | 'win32',
  environment: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): Readonly<{
  ok: true
  argv: readonly string[]
  installation: ProfileInstallation
  proofRoot?: string
}> | Readonly<{ ok: false }> {
  const proofArguments = argv.filter((argument) => argument.startsWith(PROFILE_PROOF_ROOT_ARGUMENT))
  if (proofArguments.length > 1) return { ok: false }
  const proofRoot = proofArguments[0]?.slice(PROFILE_PROOF_ROOT_ARGUMENT.length)
  if (proofRoot === '') return { ok: false }
  const appData = platform === 'darwin'
    ? path.join(homeDirectory, 'Library', 'Application Support')
    : environmentValue(environment, 'APPDATA')
  if (!appData || !path.isAbsolute(appData)) return { ok: false }
  try {
    return Object.freeze({
      ok: true as const,
      argv: Object.freeze(argv.filter((argument) => !argument.startsWith(PROFILE_PROOF_ROOT_ARGUMENT))),
      installation: resolveProfileInstallation({
        appData,
        ...(proofRoot === undefined ? {} : { proofRoot }),
      }),
      ...(proofRoot === undefined ? {} : { proofRoot }),
    })
  } catch {
    return { ok: false }
  }
}

export function createStandaloneHeadlessEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  identity: EidoCliIdentity,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.create(null)
  const allowed = ['APPDATA', 'HOME', 'LOCALAPPDATA', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
  for (const key of allowed) {
    const value = environmentValue(source, key)
    if (value && !value.includes('\0')) environment[key] = value
  }
  environment.EIDO_AGENT_CLIENT = identity.client
  environment.EIDO_AGENT_SESSION_ID = identity.sessionId
  return environment
}

function environmentValue(
  source: Readonly<Record<string, string | undefined>>,
  expected: string,
): string | undefined {
  const actual = Object.keys(source).find((key) => key.toUpperCase() === expected.toUpperCase())
  return actual === undefined ? undefined : source[actual]
}

async function readBoundedInput(
  input: AsyncIterable<string | Uint8Array>,
): Promise<Readonly<{ bytes: Uint8Array; text: string }>> {
  const bytes = await collectBoundedInputBytes(input)
  return Object.freeze({
    bytes,
    text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  })
}

async function collectBoundedInputBytes(
  input: AsyncIterable<string | Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let byteLength = 0
  for await (const chunk of input) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
    if (!(bytes instanceof Uint8Array)) throw new Error('Eido batch input was invalid')
    byteLength += bytes.byteLength
    if (byteLength > PROFILE_JSON_CLI_LIMITS.maxInputBytes) {
      throw new Error('Eido batch input exceeded its byte limit')
    }
    chunks.push(bytes)
  }
  const combined = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

async function* exactInput(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes
}

async function collectBoundedStream(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.byteLength
    if (total > maxBytes) throw new Error('Packaged Eido child output exceeded its byte limit')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

async function collectBoundedHeadlessProcess(
  child: ChildProcessWithoutNullStreams,
  maxOutputBytes: number,
  maxDiagnosticBytes: number,
  timeoutMs: number,
  terminationGraceMs: number,
): Promise<readonly [
  stdout: Uint8Array,
  stderr: Uint8Array,
  outcome: Readonly<{ code: number | null; signal: NodeJS.Signals | null }>,
]> {
  const timeout = requireHeadlessTimeout(timeoutMs)
  const terminationGrace = requireHeadlessTimeout(terminationGraceMs)
  const outcome = new Promise<Readonly<{
    code: number | null
    signal: NodeJS.Signals | null
  }>>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const settled = outcome.then(() => undefined, () => undefined)
  const completed = Promise.all([
    collectBoundedStream(child.stdout, maxOutputBytes),
    collectBoundedStream(child.stderr, maxDiagnosticBytes),
    outcome,
  ] as const)
  let timeoutHandle: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      void terminateHeadlessProcess(child, settled, terminationGrace).finally(() => {
        reject(new Error('Headless Eido process exceeded its time limit'))
      })
    }, timeout)
  })
  try {
    return await Promise.race([completed, deadline])
  } catch (error) {
    await terminateHeadlessProcess(child, settled, terminationGrace)
    throw error
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

async function terminateHeadlessProcess(
  child: ChildProcessWithoutNullStreams,
  settled: Promise<void>,
  graceMs: number,
): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGTERM')
    } catch {
      // The bounded hard-termination attempt below remains authoritative.
    }
  }
  if (await settlesWithin(settled, graceMs)) return
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Stream destruction below prevents an unbounded CLI wait.
    }
  }
  if (await settlesWithin(settled, graceMs)) return
  child.stdin.destroy()
  child.stdout.destroy()
  child.stderr.destroy()
}

async function settlesWithin(settled: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeoutHandle: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      settled.then(() => true),
      new Promise<false>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function requireHeadlessTimeout(candidate: number): number {
  if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > 120_000) {
    throw new Error('Headless Eido process timeout was invalid')
  }
  return candidate
}

function minimallyValidGatewayRequest(candidate: unknown): ProfileGatewayRequest | undefined {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
  const record = candidate as Record<string, unknown>
  return record.version === 1
    && typeof record.requestId === 'string'
    && typeof record.operation === 'string'
    && record.params !== null
    && typeof record.params === 'object'
    && !Array.isArray(record.params)
    ? candidate as ProfileGatewayRequest
    : undefined
}

function isCorrelatedGatewayResponse(
  candidate: unknown,
  requestId: string,
): candidate is ProfileGatewayResponse {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
  const record = candidate as Record<string, unknown>
  return record.version === 1
    && record.requestId === requestId
    && typeof record.ok === 'boolean'
    && (record.ok ? 'result' in record : 'error' in record)
}

async function standaloneUsageFailure(
  io: Readonly<{ stdout: ProfileJsonCliWriter; stderr: ProfileJsonCliWriter }>,
  error: EidoCliUsageError,
): Promise<number> {
  return writeEidoCliUsageFailure(io, error)
}

export { EIDO_CLI_HELP }
