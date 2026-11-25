import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoot = join(repositoryRoot, 'native/profile-live-gateway')
const commonSource = join(sourceRoot, 'main.c')

// Every toolchain call below is bounded so a stalled Windows toolchain fails
// with a named command instead of hanging until the CI step timeout kills the
// runner with an empty log.
export const profileLiveGatewayHelperCompileTimeoutMs = 120_000
export const profileLiveGatewayWindowsMsvcDiscoveryTimeoutMs = 30_000
export const profileLiveGatewayWindowsMsvcEnvironmentTimeoutMs = 60_000
const visualStudioTelemetrySkipVariable = 'VSCMD_SKIP_SENDTELEMETRY'

export function profileLiveGatewayHelperBuildPlan({
  platform = process.platform,
  outputPath,
  environment = process.env,
} = {}) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('Profile Live Gateway helper output path is required')
  }
  if (platform === 'darwin') {
    const platformSource = join(sourceRoot, 'transport_macos.c')
    return Object.freeze({
      command: 'clang',
      args: Object.freeze([
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Wunreachable-code',
        '-Werror',
        '-pedantic',
        '-O2',
        '-mmacosx-version-min=13.0',
        commonSource,
        platformSource,
        '-o',
        outputPath,
      ]),
      commonSource,
      platformSource,
      outputPath,
    })
  }
  if (platform === 'win32') {
    const platformSource = join(sourceRoot, 'transport_windows.c')
    const toolchain = windowsMsvcToolchainPlan(environment)
    return Object.freeze({
      command: 'cl.exe',
      args: Object.freeze([
        '/nologo',
        '/std:c11',
        '/D_WIN32_WINNT=0x0600',
        '/W4',
        '/WX',
        '/O2',
        commonSource,
        platformSource,
        '/link',
        'advapi32.lib',
        `/out:${outputPath}`,
      ]),
      commonSource,
      platformSource,
      outputPath,
      toolchain,
    })
  }
  throw new Error(`Unsupported Profile Live Gateway helper platform: ${platform}`)
}

export function buildProfileLiveGatewayHelper(options = {}) {
  const plan = profileLiveGatewayHelperBuildPlan(options)
  const compilerEnvironment = plan.toolchain === undefined
    ? undefined
    : resolveProfileLiveGatewayWindowsMsvcEnvironment(
        plan.toolchain,
        spawnSync,
        options.environment ?? process.env,
      )
  const build = spawnSync(plan.command, plan.args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: profileLiveGatewayHelperCompileTimeoutMs,
    windowsHide: true,
    ...(compilerEnvironment === undefined ? {} : { env: compilerEnvironment }),
  })
  if (build.error || build.status !== 0) {
    const detail = commandTimeoutDetail(build, {
      label: plan.command,
      timeoutMs: profileLiveGatewayHelperCompileTimeoutMs,
    }) ?? (build.error?.message || build.stderr || build.stdout || 'unknown failure')
    throw new Error(`Profile Live Gateway helper build failed: ${detail.trim()}`)
  }
  return plan.outputPath
}

export function resolveProfileLiveGatewayWindowsMsvcEnvironment(
  toolchain,
  run = spawnSync,
  baseEnvironment = process.env,
) {
  if (!toolchain
    || typeof toolchain !== 'object'
    || typeof toolchain.discovery?.command !== 'string'
    || !Array.isArray(toolchain.discovery?.args)
    || typeof toolchain.commandInterpreter !== 'string'
    || !Array.isArray(toolchain.architectureArguments)) {
    throw new Error('Profile Live Gateway Windows MSVC toolchain plan is invalid')
  }
  const discovered = run(
    toolchain.discovery.command,
    toolchain.discovery.args,
    {
      encoding: 'utf8',
      timeout: profileLiveGatewayWindowsMsvcDiscoveryTimeoutMs,
      windowsHide: true,
    },
  )
  if (discovered?.error || discovered?.status !== 0 || typeof discovered?.stdout !== 'string') {
    const timedOut = commandTimeoutDetail(discovered, {
      label: 'vswhere.exe',
      timeoutMs: profileLiveGatewayWindowsMsvcDiscoveryTimeoutMs,
    })
    throw new Error(timedOut === undefined
      ? 'Profile Live Gateway Windows MSVC discovery failed'
      : `Profile Live Gateway Windows MSVC discovery failed: ${timedOut}`)
  }
  const installationPath = discovered.stdout.trim()
  if (!safeWindowsBatchPath(installationPath)) {
    throw new Error('Profile Live Gateway Windows MSVC installation path is invalid')
  }
  const vsDevCmdPath = win32.join(
    installationPath,
    'Common7',
    'Tools',
    'VsDevCmd.bat',
  )
  // Ask VsDevCmd to skip its own telemetry while producing the compiler
  // environment. Compiler descendants remain owned by the outer bounded-build
  // process tree; this setting is not treated as process cleanup.
  const telemetrySafeEnvironment = suppressVisualStudioTelemetry(baseEnvironment)
  const entered = run(
    toolchain.commandInterpreter,
    [
      '/d',
      '/s',
      '/c',
      `call "${vsDevCmdPath}" ${toolchain.architectureArguments.join(' ')} >nul && set`,
    ],
    {
      encoding: 'utf8',
      timeout: profileLiveGatewayWindowsMsvcEnvironmentTimeoutMs,
      windowsHide: true,
      env: telemetrySafeEnvironment,
      // cmd.exe parses the remainder after /c itself. Node's default C-runtime
      // quoting would escape the embedded batch-path quotes for a parser that
      // does not understand those escapes, so pass the command string verbatim.
      windowsVerbatimArguments: true,
    },
  )
  if (entered?.error || entered?.status !== 0 || typeof entered?.stdout !== 'string') {
    throw new Error(
      `Profile Live Gateway Windows MSVC environment setup failed: ${windowsCommandFailureDetail(entered, {
        label: 'VsDevCmd.bat',
        timeoutMs: profileLiveGatewayWindowsMsvcEnvironmentTimeoutMs,
      })}`,
    )
  }
  const environment = suppressVisualStudioTelemetry(
    parseWindowsEnvironment(entered.stdout),
  )
  for (const required of ['PATH', 'INCLUDE', 'LIB', 'VCToolsInstallDir']) {
    if (!environmentValue(environment, required)) {
      throw new Error('Profile Live Gateway Windows MSVC environment is incomplete')
    }
  }
  return Object.freeze(environment)
}

export function buildProfileLiveGatewayHelperForDevelopment({
  platform = process.platform,
  outputPath,
} = {}) {
  if (platform !== 'darwin' && platform !== 'win32') {
    return Object.freeze({ state: 'skipped', platform })
  }
  return Object.freeze({
    state: 'built',
    platform,
    outputPath: buildProfileLiveGatewayHelper({ platform, outputPath }),
  })
}

const isCli = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  const outputPath = process.argv[2] ?? join(
    repositoryRoot,
    'dist-electron',
    process.platform === 'win32'
      ? 'eido-profile-live-gateway-helper.exe'
      : 'eido-profile-live-gateway-helper',
  )
  const result = buildProfileLiveGatewayHelperForDevelopment({ outputPath })
  if (result.state === 'skipped') {
    console.log(`Profile Live Gateway helper build skipped on ${result.platform}`)
  }
}

function windowsMsvcToolchainPlan(environment) {
  const programFilesX86 = environmentValue(environment, 'ProgramFiles(x86)')
  const commandInterpreter = environmentValue(environment, 'ComSpec')
    ?? (() => {
      const systemRoot = environmentValue(environment, 'SystemRoot')
      return systemRoot ? win32.join(systemRoot, 'System32', 'cmd.exe') : undefined
    })()
  if (!safeWindowsPathRoot(programFilesX86) || !safeWindowsPathRoot(commandInterpreter)) {
    throw new Error('Profile Live Gateway Windows MSVC discovery environment is invalid')
  }
  return Object.freeze({
    discovery: Object.freeze({
      command: win32.join(
        programFilesX86,
        'Microsoft Visual Studio',
        'Installer',
        'vswhere.exe',
      ),
      args: Object.freeze([
        '-latest',
        '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath',
      ]),
    }),
    commandInterpreter,
    architectureArguments: Object.freeze([
      '-no_logo',
      '-arch=amd64',
      '-host_arch=amd64',
    ]),
  })
}

function parseWindowsEnvironment(source) {
  const environment = Object.create(null)
  for (const line of source.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)
    if (key.includes('\0') || value.includes('\0')) continue
    environment[key] = value
  }
  return environment
}

function environmentValue(environment, expected) {
  if (!environment || typeof environment !== 'object') return undefined
  const actual = Object.keys(environment).find(
    (key) => key.toUpperCase() === expected.toUpperCase(),
  )
  const value = actual === undefined ? undefined : environment[actual]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function suppressVisualStudioTelemetry(environment) {
  const safeEnvironment = Object.create(null)
  for (const [key, value] of Object.entries(environment ?? {})) {
    if (key.toUpperCase() === visualStudioTelemetrySkipVariable) continue
    safeEnvironment[key] = value
  }
  safeEnvironment[visualStudioTelemetrySkipVariable] = '1'
  return safeEnvironment
}

function safeWindowsPathRoot(candidate) {
  return typeof candidate === 'string'
    && win32.isAbsolute(candidate)
    && !/[\0\r\n]/.test(candidate)
}

function safeWindowsBatchPath(candidate) {
  return safeWindowsPathRoot(candidate) && !/["%]/.test(candidate)
}

function commandTimeoutDetail(result, { label, timeoutMs }) {
  const timedOut = result?.error?.code === 'ETIMEDOUT'
    || (result?.error?.message?.includes('ETIMEDOUT') ?? false)
  return timedOut ? `${label} timed out after ${timeoutMs}ms` : undefined
}

function windowsCommandFailureDetail(result, bounds) {
  const timedOut = bounds === undefined
    ? undefined
    : commandTimeoutDetail(result, bounds)
  if (timedOut !== undefined) return timedOut
  if (result?.error?.message) return result.error.message
  const status = Number.isInteger(result?.status) ? `exit ${result.status}` : 'invalid result'
  const stderr = typeof result?.stderr === 'string'
    ? result.stderr.trim().replace(/\s+/g, ' ').slice(0, 512)
    : ''
  return stderr.length === 0 ? status : `${status}: ${stderr}`
}
