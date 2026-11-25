import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
  copyFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import postject from 'postject'
import { buildProfileLiveGatewayHelper } from './profile-live-gateway-helper.mjs'

const execFileAsync = promisify(execFile)
const { inject } = postject

export const PROFILE_MCP_SEA_EXECUTABLE = 'eido-profile-mcp.exe'
export const EIDO_CLI_SEA_EXECUTABLE = 'eido.exe'
export const PROFILE_LIVE_GATEWAY_HELPER_EXECUTABLE = 'eido-profile-live-gateway-helper.exe'
export const PROFILE_MCP_SEA_RESOURCE = 'NODE_SEA_BLOB'
export const PROFILE_MCP_SEA_SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
export const MAC_STANDALONE_BINARIES = Object.freeze([
  'Contents/Resources/bin/eido',
  'Contents/Resources/bin/eido-profile-live-gateway-helper',
])

const ELECTRON_BUILDER_X64_ARCH = 1
const PROFILE_MCP_RELAY_ARGUMENT = '--eido-profile-mcp'

export default async function addProfileMcpSeaEntry(context) {
  if (context?.electronPlatformName === 'darwin') {
    await addMacStandaloneEidoEntry(context)
    return
  }
  if (context?.electronPlatformName !== 'win32') return
  requireWindowsSeaBuildContext(context)

  const productFilename = requireWindowsExecutableBasename(
    context.packager?.appInfo?.productFilename,
  )
  const appOutDir = requireAbsoluteDirectory(context.appOutDir)
  const electronExecutable = path.join(appOutDir, `${productFilename}.exe`)
  const relayExecutable = path.join(appOutDir, PROFILE_MCP_SEA_EXECUTABLE)
  const binDirectory = path.join(appOutDir, 'resources', 'bin')
  const cliExecutable = path.join(binDirectory, EIDO_CLI_SEA_EXECUTABLE)
  const helperExecutable = path.join(binDirectory, PROFILE_LIVE_GATEWAY_HELPER_EXECUTABLE)
  await mkdir(binDirectory, { recursive: true })
  await stat(electronExecutable)

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'eido-profile-mcp-sea-'))
  try {
    const relaySource = path.join(temporaryDirectory, 'profile-mcp-relay.cjs')
    const seaConfiguration = path.join(temporaryDirectory, 'sea-config.json')
    const seaBlob = path.join(temporaryDirectory, 'profile-mcp-relay.blob')
    await writeFile(
      relaySource,
      createWindowsProfileMcpRelaySource(`${productFilename}.exe`),
      { encoding: 'utf8', flag: 'wx' },
    )
    await buildSeaBlob(relaySource, seaBlob, seaConfiguration)
    await copyFile(process.execPath, relayExecutable, fsConstants.COPYFILE_FICLONE)
    await inject(relayExecutable, PROFILE_MCP_SEA_RESOURCE, await readFile(seaBlob), {
      sentinelFuse: PROFILE_MCP_SEA_SENTINEL,
      overwrite: true,
    })

    const cliSource = path.join(temporaryDirectory, 'eido-cli-relay.cjs')
    const cliSeaConfiguration = path.join(temporaryDirectory, 'eido-cli-sea-config.json')
    const cliSeaBlob = path.join(temporaryDirectory, 'eido-cli-relay.blob')
    await copyFile(
      new URL('../../dist-electron/eido-cli-sea.cjs', import.meta.url),
      cliSource,
    )
    await buildSeaBlob(cliSource, cliSeaBlob, cliSeaConfiguration)
    await copyFile(process.execPath, cliExecutable, fsConstants.COPYFILE_FICLONE)
    await inject(cliExecutable, PROFILE_MCP_SEA_RESOURCE, await readFile(cliSeaBlob), {
      sentinelFuse: PROFILE_MCP_SEA_SENTINEL,
      overwrite: true,
    })
    buildProfileLiveGatewayHelper({
      platform: 'win32',
      outputPath: helperExecutable,
    })
  } finally {
    await removeOwnedTemporaryDirectory(temporaryDirectory)
  }
}

async function addMacStandaloneEidoEntry(context) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Eido CLI SEA entry requires a native macOS arm64 Node executable')
  }
  const productFilename = requireWindowsExecutableBasename(
    context.packager?.appInfo?.productFilename,
  )
  const appOutDir = requireAbsoluteDirectory(context.appOutDir)
  const binDirectory = path.join(
    appOutDir,
    `${productFilename}.app`,
    'Contents',
    'Resources',
    'bin',
  )
  const cliExecutable = path.join(binDirectory, 'eido')
  const helperExecutable = path.join(binDirectory, 'eido-profile-live-gateway-helper')
  await mkdir(binDirectory, { recursive: true })
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'eido-profile-mcp-sea-'))
  try {
    const cliSource = path.join(temporaryDirectory, 'eido-cli.cjs')
    const seaConfiguration = path.join(temporaryDirectory, 'eido-cli-sea-config.json')
    const seaBlob = path.join(temporaryDirectory, 'eido-cli.blob')
    await copyFile(
      new URL('../../dist-electron/eido-cli-sea.cjs', import.meta.url),
      cliSource,
    )
    await buildSeaBlob(cliSource, seaBlob, seaConfiguration)
    await copyFile(process.execPath, cliExecutable, fsConstants.COPYFILE_FICLONE)
    await execFileAsync('/usr/bin/codesign', ['--remove-signature', cliExecutable])
    await inject(cliExecutable, PROFILE_MCP_SEA_RESOURCE, await readFile(seaBlob), {
      sentinelFuse: PROFILE_MCP_SEA_SENTINEL,
      overwrite: true,
      machoSegmentName: 'NODE_SEA',
    })
    await chmod(cliExecutable, 0o755)
    buildProfileLiveGatewayHelper({
      platform: 'darwin',
      outputPath: helperExecutable,
    })
    await chmod(helperExecutable, 0o755)
    await signMacStandaloneExecutables(context, [cliExecutable, helperExecutable])
  } finally {
    await removeOwnedTemporaryDirectory(temporaryDirectory)
  }
}

async function buildSeaBlob(main, output, configuration) {
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
  // Node 24.7 added the setting that keeps NODE_OPTIONS out of the SEA.
  if (nodeMajor === 24 && nodeMinor < 7) {
    throw new Error('Use Node 24.7 or newer within the Node 24 line to package Eido.')
  }
  await writeFile(configuration, `${JSON.stringify({
    main,
    output,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    execArgv: ['--no-experimental-webstorage'],
    execArgvExtension: 'none',
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

  // The calling hook also copies this executable into the installed CLI.
  try {
    await execFileAsync(process.execPath, ['--experimental-sea-config', configuration], {
      cwd: path.dirname(configuration),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
  } catch (error) {
    if (error?.stderr?.includes('Single executable application is disabled')) {
      throw new Error(
        'This Node.js build disables standalone executables. Use an official Node.js distribution to package Eido.',
        { cause: error },
      )
    }
    throw error
  }
}

export async function signMacStandaloneExecutables(
  context,
  executables,
  execute = execFileAsync,
) {
  // Electron Builder signs after this hook. A real identity will replace the
  // injected executables' signatures through mac.binaries; identity:null skips
  // that phase entirely, so proof packages need explicit ad-hoc signatures.
  if (context?.packager?.platformSpecificBuildOptions?.identity !== null) return
  if (!Array.isArray(executables) || executables.length !== MAC_STANDALONE_BINARIES.length) {
    throw new Error('Eido macOS standalone executable signing set is invalid')
  }
  for (const executable of executables) {
    if (typeof executable !== 'string' || !path.isAbsolute(executable)) {
      throw new Error('Eido macOS standalone executable signing path is invalid')
    }
    await execute(
      '/usr/bin/codesign',
      ['--force', '--sign', '-', executable],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    )
  }
}
export function createWindowsProfileMcpRelaySource(electronExecutableName) {
  const executable = requireWindowsExecutableBasename(electronExecutableName)
  return `'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')

const ELECTRON_EXECUTABLE = ${JSON.stringify(executable)}
const MCP_ARGUMENT = ${JSON.stringify(PROFILE_MCP_RELAY_ARGUMENT)}
const CHILD_ENVIRONMENT_KEYS = Object.freeze([
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
])

function childEnvironment(source) {
  const environment = Object.create(null)
  const available = Object.keys(source)
  for (const expected of CHILD_ENVIRONMENT_KEYS) {
    const actual = available.find((key) => key.toUpperCase() === expected.toUpperCase())
    const value = actual === undefined ? undefined : source[actual]
    if (typeof value === 'string' && value.length > 0 && !value.includes('\\0')) {
      environment[expected] = value
    }
  }
  return environment
}

async function run() {
  const userArguments = process.argv.slice(2)
  if (userArguments.length !== 1 || userArguments[0] !== MCP_ARGUMENT) {
    throw new Error('profile-mcp-relay-arguments-invalid')
  }
  const applicationDirectory = path.dirname(process.execPath)
  const child = spawn(path.join(applicationDirectory, ELECTRON_EXECUTABLE), [MCP_ARGUMENT], {
    cwd: applicationDirectory,
    env: childEnvironment(process.env),
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore', 'overlapped', 'overlapped', 'overlapped'],
    windowsHide: true,
  })
  const requestInput = child.stdio[3]
  const protocolOutput = child.stdio[4]
  const diagnosticOutput = child.stdio[5]
  if (!requestInput || !protocolOutput || !diagnosticOutput) {
    child.kill()
    throw new Error('profile-mcp-relay-pipes-unavailable')
  }

  const hardTerminate = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
  let requestShutdown = false
  const requestGracefulShutdown = () => {
    if (requestShutdown) return
    requestShutdown = true
    process.stdin.unpipe(requestInput)
    process.stdin.pause()
    if (!requestInput.destroyed && !requestInput.writableEnded) requestInput.end()
  }
  process.once('exit', hardTerminate)
  process.on('SIGINT', requestGracefulShutdown)
  process.on('SIGTERM', requestGracefulShutdown)

  const childOutcome = new Promise((resolve) => {
    let failedToSpawn = false
    child.once('error', () => { failedToSpawn = true })
    child.once('close', (code, signal) => resolve({ code, signal, failedToSpawn }))
  })
  const requestPump = pipeline(process.stdin, requestInput)
  const protocolPump = pipeline(protocolOutput, process.stdout, { end: false })
  const diagnosticPump = pipeline(diagnosticOutput, process.stderr, { end: false })
  void requestPump.catch(requestGracefulShutdown)
  void protocolPump.catch(requestGracefulShutdown)
  void diagnosticPump.catch(requestGracefulShutdown)

  const outcome = await childOutcome
  // A child can close normally before its caller closes stdin. Explicitly sever the
  // request pump so relay completion is governed by child and output completion.
  requestGracefulShutdown()
  requestInput.destroy()
  const settled = await Promise.allSettled([requestPump, protocolPump, diagnosticPump])
  process.removeListener('exit', hardTerminate)
  process.removeListener('SIGINT', requestGracefulShutdown)
  process.removeListener('SIGTERM', requestGracefulShutdown)
  if (settled[1].status === 'rejected'
    || settled[2].status === 'rejected'
    || outcome.failedToSpawn
    || outcome.code !== 0
    || outcome.signal !== null) {
    throw new Error('profile-mcp-relay-failed')
  }
}

run().catch(() => {
  try {
    process.stderr.write('Eido Profile MCP failed.\\n')
  } catch {
    // The protocol and diagnostic pipes are already unavailable.
  }
  process.exitCode = 1
})
`
}

function requireWindowsSeaBuildContext(context) {
  if (process.platform !== 'win32'
    || process.arch !== 'x64'
    || context.arch !== ELECTRON_BUILDER_X64_ARCH) {
    throw new Error('Profile MCP SEA entry requires a native Windows x64 Node executable')
  }
}

function requireWindowsExecutableBasename(candidate) {
  if (typeof candidate !== 'string'
    || candidate.length === 0
    || candidate === '.'
    || candidate === '..'
    || /[<>:"/\\|?*\0\r\n]/.test(candidate)) {
    throw new Error('Profile MCP Electron executable name is invalid')
  }
  return candidate
}

function requireAbsoluteDirectory(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw new Error('Profile MCP package directory is invalid')
  }
  return path.resolve(candidate)
}

async function removeOwnedTemporaryDirectory(candidate) {
  const temporaryRoot = path.resolve(os.tmpdir())
  const resolved = path.resolve(candidate)
  if (path.dirname(resolved) !== temporaryRoot
    || !path.basename(resolved).startsWith('eido-profile-mcp-sea-')) {
    throw new Error('Profile MCP SEA temporary directory was not owned')
  }
  await rm(resolved, { recursive: true, force: true })
}
