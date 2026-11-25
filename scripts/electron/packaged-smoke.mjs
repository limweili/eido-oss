import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFile, listPackage } from '@electron/asar'
import {
  MAC_EIDO_COMMAND,
  MAC_EIDO_COMMAND_INSTALL_SCRIPT,
  REMOVE_MAC_EIDO_COMMAND_CANARY,
  renderMacEidoCommandLauncher,
} from '../../electron/eidoCommandLauncher.ts'

import {
  INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
  PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
} from '../../src/persistence/profileAgentCommandManifest.ts'
import { PROFILE_GATEWAY_VERSIONS } from '../../src/persistence/profileServiceContract.ts'
import { readNativeProofIdentity } from '../ci/native-desktop-proof.mjs'
import { inspectUnsignedWindowsExecutable, parseProfileCliResponse } from './proof-host.mjs'

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const outputRoot = path.join(repositoryRoot, '.local', 'electron-shell')
const evidencePath = path.join(outputRoot, 'proof-evidence.json')
const protocolPrefix = 'EIDO_PROFILE_PROOF:'
const profileCliMaxInputBytes = 512 * 1024
const localCredentialRelativePath = path.join('credentials', 'openrouter-api-key.v2.json')
const legacyPlaintextCredentialRelativePath = path.join('credentials', 'openrouter-api-key.v1.json')
const legacySafeStorageBlobRelativePath = path.join('credentials', 'openrouter-api-key.bin')
const profileMcpToolNames = [
  'profile.status',
  'profile.capabilities',
  'idea.list',
  'graph.query',
  'record.get',
  'mod-template.list',
  'command.batch',
]
// A disposable Profile does not isolate the macOS login Keychain. Put this on
// the native command line before Electron starts, so credential proof uses
// Chromium's test key and cannot request the installed app's Safe Storage key.
// This proves encryption framing and migration, not real Keychain protection.
const proofKeychainArguments = process.platform === 'darwin' ? ['--use-mock-keychain'] : []
const shellTimeoutMs = readShellTimeout(process.argv)

const proofRoot = await mkdtemp(path.join(os.tmpdir(), 'eido-profile-proof-'))
let proofPayload
let hostedMcpProfileRoot

try {
  const executable = packagedExecutable(outputRoot)
  const resources = packagedResources(outputRoot)
  const asarPath = path.join(resources, 'app.asar')
  assert(existsSync(executable), 'Packaged executable is missing')
  assert(existsSync(asarPath), 'Packaged app.asar is missing')
  assert(!existsSync(`${asarPath}.unpacked`), 'app.asar.unpacked must not exist')
  const proofSigningBoundary = assertProofSigningBoundary(executable)
  const mcpEntry = packagedMcpEntry(outputRoot, executable)
  const mcpPackageBoundary = await assertMcpPackageBoundary(mcpEntry)
  const eidoPathCommand = await provePackagedEidoPathCommand(outputRoot)

  const manifest = JSON.parse(await readFile(path.join(resources, 'shell-manifest.json'), 'utf8'))
  assertDeepEqual(manifest, {
    schemaVersion: 1,
    scope: '#465',
    promotable: false,
    profileAuthority: 'installed',
  })

  const normalizedListing = listPackage(asarPath).join('\n').replaceAll('\\', '/')
  const packagedFiles = new Set(normalizedListing.split(/\r?\n/).filter(Boolean))
  for (const expectedFile of [
    '/dist/index.html',
    '/dist-electron/main.cjs',
    '/dist-electron/profile-utility.cjs',
    '/dist-electron/preload.cjs',
  ]) {
    assert(packagedFiles.has(expectedFile), `ASAR is missing ${expectedFile}`)
  }
  assert(!/(?:^|\n).*\.node\r?$/im.test(normalizedListing), 'ASAR must not contain native .node modules')
  assert(!/(?:^|\n).*\.map\r?$/im.test(normalizedListing), 'ASAR must not contain source maps')
  const packagedSurface = assertPackagedSurface(asarPath, packagedFiles)

  const fusesCli = path.join(
    path.dirname(fileURLToPath(import.meta.resolve('@electron/fuses'))),
    'bin.js',
  )
  const fuseReadback = await run(process.execPath, [fusesCli, 'read', '--app', executable])
  assert(fuseReadback.code === 0, `Fuse readback failed:\n${fuseReadback.stderr}`)
  for (const expectedFuse of [
    'RunAsNode is Disabled',
    'EnableCookieEncryption is Disabled',
    'EnableNodeOptionsEnvironmentVariable is Disabled',
    'EnableNodeCliInspectArguments is Disabled',
    'EnableEmbeddedAsarIntegrityValidation is Enabled',
    'OnlyLoadAppFromAsar is Enabled',
    'LoadBrowserProcessSpecificV8Snapshot is Disabled',
    'GrantFileProtocolExtraPrivileges is Disabled',
    'WasmTrapHandlers is Enabled',
  ]) {
    assert(fuseReadback.stdout.includes(expectedFuse), `Unexpected fuse state: ${expectedFuse}`)
  }

  const absentInspection = assertAbsentProfileInspection(await runProfileCli(executable, {
    version: 1,
    requestId: 'packaged-profile-absent',
    operation: 'profile.status',
    params: {},
  }))
  const overLimitInspection = assertOverLimitProfileInspection(
    await runHeldOpenOverLimitProfileCli(executable),
  )
  const databasePath = path.join(proofRoot, 'profiles', 'default', 'eido-profile.sqlite')
  assert(!existsSync(path.dirname(databasePath)), 'Absent CLI inspection created the Profile directory')
  assert(!existsSync(databasePath), 'Absent CLI inspection created the Profile database')
  assert(!existsSync(`${databasePath}.owner.sqlite`), 'Absent CLI inspection created the owner sidecar')

  const stamped = assertStampReport(await runProfileLaunch(executable, ['stamp']))
  const localCredentialFile = await assertLocalCredentialFile(
    proofRoot,
    packagedSurface.proofApiKey,
  )
  const inspected = assertInstalledProfileInspection(await runProfileCli(executable, {
    version: 1,
    requestId: 'packaged-profile-inspection',
    operation: 'graph.query',
    params: {
      recordKinds: ['card'],
      recordIds: [stamped.cardId],
      limit: 1,
      byteLimit: 4_096,
    },
  }), stamped)
  const reopened = assertVerifyReport(await runProfileLaunch(executable, [
    'verify',
    stamped.cardId,
    stamped.modId,
    String(stamped.revision),
  ]), stamped)
  await assertLocalCredentialFile(
    proofRoot,
    packagedSurface.proofApiKey,
    localCredentialFile.sha256,
  )
  const agentCapabilities = assertInstalledAgentCapabilities(await runProfileCli(executable, {
    version: 1,
    requestId: 'packaged-agent-capabilities',
    operation: 'profile.capabilities',
    params: {},
  }))
  const agentRequest = createPackagedAgentRequest(
    ideaIdFromBoardOwner(inspected.result.items[0].ownerId),
    reopened.revision,
  )
  const appliedAgentBatch = assertAppliedAgentBatch(await runProfileCli(executable, {
    version: 1,
    requestId: 'packaged-agent-apply',
    operation: 'command.batch',
    params: agentRequest,
  }), agentRequest)
  const replayedAgentBatch = assertReplayedAgentBatch(await runProfileCli(executable, {
    version: 1,
    requestId: 'packaged-agent-retry',
    operation: 'command.batch',
    params: agentRequest,
  }), appliedAgentBatch)
  const queriedAgentRecords = assertAppliedAgentQuery(await runProfileCli(executable, {
    version: 1,
    requestId: 'packaged-agent-query',
    operation: 'graph.query',
    params: {
      recordKinds: ['card', 'connection'],
      recordIds: [...appliedAgentBatch.recordIds].sort(),
      limit: appliedAgentBatch.recordIds.length,
      byteLimit: 32 * 1024,
    },
  }), appliedAgentBatch)
  const mcpAgentRequest = {
    ...createPackagedAgentRequest(
      ideaIdFromBoardOwner(inspected.result.items[0].ownerId),
      appliedAgentBatch.receipt.revision,
    ),
    idempotencyKey: 'packaged-mcp-mixed-board-v1',
  }
  const persistentMcp = await provePersistentProfileMcp(mcpEntry, mcpAgentRequest)

  proofPayload = {
    schemaVersion: 1,
    scope: '#465,#526,#527,#676,#712',
    platform: process.platform,
    arch: process.arch,
    evidenceIdentity: readNativeProofIdentity({ cwd: repositoryRoot }),
    manifest,
    package: {
      executablePresent: true,
      asarPresent: true,
      profileUtilityPresent: true,
      mcpEntry: mcpPackageBoundary,
      eidoPathCommand,
      asarUnpacked: false,
      nativeModules: false,
      sourceMaps: false,
      egressSurface: packagedSurface.evidence,
    },
    signingBoundary: proofSigningBoundary,
    security: stamped.security,
    fusesVerified: true,
    journey: {
      syntheticIdentitySha256: syntheticIdentitySha256(stamped.cardId, stamped.modId),
      firstLaunch: {
        hydratedAndAcknowledged: true,
        action: 'addModFromLibrary:current-built-in-template',
        checkpoint: {
          nativeGeneration: stamped.nativeGeneration,
          revision: stamped.revision,
        },
        logicalClose: stamped.logicalClose,
        utilityJoined: stamped.utilityJoined,
        credential: stamped.credential,
        egress: stamped.egress,
        localCredentialFile: {
          present: true,
          exactVersionedJson: true,
          stableAcrossOfflineReopen: true,
          posixMode: process.platform === 'win32' ? 'not-applicable' : '0600',
          legacyBlobAbsent: true,
        },
      },
      headlessInspection: {
        overLimitWithoutEof: overLimitInspection,
        absent: absentInspection,
        installed: {
          profileIdentitySha256: createHash('sha256')
            .update(inspected.result.profileId, 'utf8')
            .digest('hex'),
          revision: inspected.result.revision,
          boundedLogicalRecord: inspected.result.items[0].kind,
          matchedStampedCard: inspected.result.items[0].recordId === stamped.cardId,
          responseAfterUtilityJoin: true,
        },
      },
      offlineRelaunch: {
        offline: reopened.offline,
        normalHydrationFoundStampedMod: true,
        boundedQuery: {
          adapter: reopened.adapter,
          revision: reopened.queryRevision,
          matchedStampedMod: true,
        },
        checkpoint: {
          nativeGeneration: reopened.nativeGeneration,
          revision: reopened.revision,
        },
        logicalClose: reopened.logicalClose,
        utilityJoined: reopened.utilityJoined,
        credential: reopened.credential,
        egress: reopened.egress,
      },
      headlessAgentCommands: {
        capabilities: {
          adapter: agentCapabilities.adapter,
          version: agentCapabilities.commandBatch.version,
          commandNames: agentCapabilities.commands,
          maxRequestBytes: agentCapabilities.commandBatch.limits.maxRequestBytes,
          maxDurableChangeBytes: agentCapabilities.commandBatch.limits.maxDurableChangeBytes,
        },
        mixedBoardApply: {
          commandNames: appliedAgentBatch.receipt.commandResults.map((result) => result.name),
          previousRevision: appliedAgentBatch.receipt.previousRevision,
          revision: appliedAgentBatch.receipt.revision,
          intentEventCount: appliedAgentBatch.receipt.intentEventIds.length,
          profileAgentEventCount: appliedAgentBatch.receipt.profileAgentEventIds.length,
          queriedRecordKinds: queriedAgentRecords.recordKinds,
        },
        freshProcessRetry: {
          replayed: replayedAgentBatch.replayed,
          revision: replayedAgentBatch.revision,
          exactReceipt: true,
        },
        responseAfterUtilityJoin: true,
      },
      persistentMcp,
      sameRevisionObserved: reopened.queryRevision === stamped.revision,
      disposableRootRemoved: true,
    },
  }
} finally {
  let cleanupFailure
  if (hostedMcpProfileRoot !== undefined) {
    try {
      await removeHostedMcpProfileRoot(hostedMcpProfileRoot)
    } catch (error) {
      cleanupFailure = error
    }
  }
  try {
    await rm(proofRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })
  } catch (error) {
    cleanupFailure ??= error
  }
  if (cleanupFailure !== undefined) throw cleanupFailure
}

assert(!existsSync(proofRoot), 'Disposable Profile proof root was not removed')
await writeFile(evidencePath, `${JSON.stringify(proofPayload, null, 2)}\n`, 'utf8')

async function runProfileLaunch(executable, launch) {
  const [phase, cardId, modId, revision] = launch
  const args = [
    ...proofKeychainArguments,
    `--eido-profile-proof-root=${proofRoot}`,
    `--eido-profile-proof-phase=${phase}`,
    ...(phase === 'verify'
      ? [
          `--eido-profile-proof-card-id=${cardId}`,
          `--eido-profile-proof-mod-id=${modId}`,
          `--eido-profile-proof-revision=${revision}`,
        ]
      : []),
  ]
  const result = await run(executable, args, { env: profileProofEnvironment(), timeoutMs: shellTimeoutMs })
  assert(result.code === 0, `Packaged Profile ${phase} launch failed:\n${result.stderr}\n${result.stdout}`)
  const reports = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(protocolPrefix))
  assert(reports.length === 1, `Packaged Profile ${phase} launch emitted ${reports.length} proof reports`)
  return JSON.parse(reports[0].slice(protocolPrefix.length))
}

async function runProfileCli(executable, request) {
  return run(executable, [
    ...proofKeychainArguments,
    `--eido-profile-proof-root=${proofRoot}`,
    '--eido-profile-json',
  ], {
    env: profileProofEnvironment(),
    input: JSON.stringify(request),
    timeoutMs: shellTimeoutMs,
  })
}

function runHeldOpenOverLimitProfileCli(executable) {
  return run(executable, [
    ...proofKeychainArguments,
    `--eido-profile-proof-root=${proofRoot}`,
    '--eido-profile-json',
  ], {
    closeInput: false,
    env: profileProofEnvironment(),
    input: Buffer.alloc(profileCliMaxInputBytes + 1, 0x78),
    timeoutMs: shellTimeoutMs,
  })
}

async function provePersistentProfileMcp(entry, agentRequest) {
  const context = await hostedMcpProofContext()
  if (context.authoritative === false) {
    return {
      status: 'not-run',
      authority: 'non-authoritative',
      reason: 'requires-github-hosted-ephemeral-os-user',
    }
  }

  assert(!existsSync(context.profileRoot), 'Hosted MCP proof requires an absent fixed Profile root')
  assert(
    existsSync(path.join(proofRoot, 'profiles', 'default', 'eido-profile.sqlite')),
    'Hosted MCP proof source Profile is missing',
  )
  const [sourceAuthority, targetParent] = await Promise.all([
    stat(proofRoot),
    stat(path.dirname(context.profileRoot)),
  ])
  assert(
    sourceAuthority.dev === targetParent.dev,
    'Hosted MCP proof requires a same-volume identity-preserving Profile relocation',
  )
  // The owner sidecar binds the Profile database's physical file identity. Move the
  // already-closed proof root onto the hosted user's ordinary product path so this
  // native proof preserves that authority instead of manufacturing corrupt copies.
  await rename(proofRoot, context.profileRoot)
  hostedMcpProfileRoot = context.profileRoot
  const moved = await lstat(context.profileRoot)
  assert(moved.isDirectory() && !moved.isSymbolicLink(), 'Hosted MCP proof root is not a directory')
  assert(!existsSync(proofRoot), 'Hosted MCP proof did not move the Profile authority')

  return {
    status: 'passed',
    authority: 'github-hosted-ephemeral-os-user',
    ...assertPersistentProfileMcp(await runProfileMcp(entry, agentRequest), agentRequest),
  }
}

async function hostedMcpProofContext(environment = process.env) {
  if (environment.GITHUB_ACTIONS !== 'true') {
    return { authoritative: false }
  }
  assert(environment.CI === 'true', 'Hosted MCP proof requires GitHub Actions CI')
  assert(
    environment.EIDO_DESKTOP_PROOF_OS_USER_SCOPE === 'github-hosted',
    'Hosted MCP proof refuses a non-ephemeral runner',
  )
  assert(
    environment.EIDO_DESKTOP_PROOF_EXPECTED_PLATFORM === process.platform
      && environment.EIDO_DESKTOP_PROOF_EXPECTED_ARCH === process.arch,
    'Hosted MCP proof native identity changed',
  )

  const nativeAppData = process.platform === 'win32'
    ? environment.APPDATA
    : environment.HOME === undefined
      ? undefined
      : path.join(environment.HOME, 'Library', 'Application Support')
  assert(
    typeof nativeAppData === 'string'
      && nativeAppData.length > 0
      && path.isAbsolute(nativeAppData),
    'Hosted MCP proof app-data root is invalid',
  )
  const canonicalAppData = await realpath(nativeAppData)
  const profileRoot = path.join(canonicalAppData, 'Eido')
  assert(
    path.dirname(profileRoot) === canonicalAppData && path.basename(profileRoot) === 'Eido',
    'Hosted MCP proof fixed Profile root is invalid',
  )
  return { authoritative: true, profileRoot }
}

async function removeHostedMcpProfileRoot(candidate) {
  const context = await hostedMcpProofContext()
  assert(
    context.authoritative === true && candidate === context.profileRoot,
    'Refusing to remove an unowned hosted MCP Profile root',
  )
  await rm(candidate, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })
  assert(!existsSync(candidate), 'Hosted MCP Profile root was not removed')
}

async function runProfileMcp(entry, agentRequest) {
  const responseLoss = await runProfileMcpResponseLoss(entry, agentRequest)
  const retry = await run(entry.command, entry.args, {
    env: profileProofEnvironment(),
    input: [
      profileMcpInitialize(11),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'command.batch', arguments: agentRequest },
      },
      {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: { name: 'profile.status', arguments: {} },
      },
    ].map(jsonLine).join(''),
    timeoutMs: shellTimeoutMs,
  })
  return { responseLoss, retry }
}

function profileMcpInitialize(id) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'eido-packaged-proof', version: '1.0.0' },
    },
  }
}

function runProfileMcpResponseLoss(entry, agentRequest) {
  const initialInput = [
    profileMcpInitialize(1),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'profile.status', arguments: {} },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'command.batch',
        arguments: { ...agentRequest, dryRun: true },
      },
    },
  ].map(jsonLine).join('')
  const applyInput = jsonLine({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'command.batch', arguments: agentRequest },
  })

  return new Promise((resolve, reject) => {
    const child = spawn(entry.command, entry.args, {
      cwd: repositoryRoot,
      detached: process.platform !== 'win32',
      env: profileProofEnvironment(),
      windowsHide: true,
    })
    const stdoutChunks = []
    const messages = []
    let pending = Buffer.alloc(0)
    let stderr = ''
    let applySentAtEof = false
    let stdoutDisconnected = false
    let applyResponseObservedBeforeDisconnect = false
    let settled = false
    const timeout = setTimeout(() => {
      fail(new Error(`Packaged Profile MCP timed out after ${shellTimeoutMs}ms`))
    }, shellTimeoutMs)

    child.stdout.on('data', (chunk) => {
      const bytes = Buffer.from(chunk)
      stdoutChunks.push(bytes)
      pending = Buffer.concat([pending, bytes])
      try {
        while (true) {
          const newline = pending.indexOf(0x0a)
          if (newline === -1) break
          let line = pending.subarray(0, newline)
          pending = pending.subarray(newline + 1)
          if (line[line.byteLength - 1] === 0x0d) line = line.subarray(0, -1)
          assert(line.byteLength > 0, 'Packaged Profile MCP emitted a blank protocol line')
          const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
          messages.push(message)
          if (message.id === 5 && !stdoutDisconnected) {
            applyResponseObservedBeforeDisconnect = true
            throw new Error('Packaged Profile MCP apply response arrived before output loss')
          }
          if (message.id === 4 && !applySentAtEof) {
            applySentAtEof = true
            child.stdin.end(applyInput, 'utf8')
            if (messages.some((candidate) => candidate.id === 5)) {
              throw new Error('Packaged Profile MCP parsed apply response before output loss')
            }
            stdoutDisconnected = true
            child.stdout.destroy()
          }
        }
      } catch (error) {
        fail(error)
      }
    })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.on('error', (error) => {
      if (!applySentAtEof) fail(error)
    })
    child.on('error', fail)
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        code,
        stdoutBytes: Buffer.concat(stdoutChunks),
        stderr,
        messages,
        completeLineRemainderBytes: pending.byteLength,
        applySentAtEof,
        stdoutDisconnected,
        applyResponseObservedBeforeDisconnect,
        childClosed: true,
      })
    })
    child.stdin.write(initialInput, 'utf8', (error) => {
      if (error) fail(error)
    })

    function fail(error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      terminateChild(child)
      reject(error)
    }
  })
}

function assertPersistentProfileMcp(result, request) {
  const lost = result.responseLoss
  assert(lost.stdoutBytes[0] === 0x7b, 'Packaged Profile MCP stdout did not begin at byte zero with JSON')
  assert(lost.applySentAtEof === true, 'Packaged Profile MCP did not send apply while closing input')
  assert(lost.stdoutDisconnected === true, 'Packaged Profile MCP output remained connected')
  assert(
    lost.applyResponseObservedBeforeDisconnect === false,
    'Packaged Profile MCP parsed the apply response before output loss',
  )
  assert(lost.childClosed === true, 'Packaged Profile MCP did not close after output loss')
  assert(lost.messages.length === 4, 'Packaged Profile MCP emitted an unexpected pre-loss response count')
  assert(
    lost.messages.every((message) => message?.jsonrpc === '2.0'),
    'Packaged Profile MCP emitted a non-protocol line',
  )
  const byId = new Map(lost.messages.map((message) => [message.id, message]))
  for (const id of [1, 2, 3, 4]) {
    assert(byId.has(id), `Packaged Profile MCP omitted response ${id}`)
    assert(byId.get(id).error === undefined, `Packaged Profile MCP response ${id} failed`)
  }
  assert(!byId.has(5), 'Packaged Profile MCP observed the deliberately lost apply response')

  assertDeepEqual(byId.get(1).result.capabilities, { tools: {} })
  const tools = byId.get(2).result.tools
  assertDeepEqual(tools.map(({ name }) => name), profileMcpToolNames)
  assert(tools.every(({ outputSchema }) => outputSchema === undefined), 'MCP tools invented output schemas')
  const status = readMcpGatewayResponse(byId.get(3))
  assert(
    status.ok === true && status.result.state === 'ready',
    `MCP status did not observe a ready Profile (${status.error?.code ?? 'unexpected-status'})`,
  )
  assert(
    status.result.owner.route === 'exclusive-headless-owner',
    'MCP status did not use the installed headless owner',
  )

  const preview = readMcpGatewayResponse(byId.get(4))
  assert(preview.ok === true, 'MCP command preview failed')
  assert(preview.result.dryRun === true, 'MCP command preview mutated the Profile')
  assert(preview.result.previousRevision === request.expectedRevision, 'MCP preview used the wrong base')
  assert(preview.result.revision === request.expectedRevision, 'MCP preview advanced the revision')
  assert(preview.result.proposedRevision === request.expectedRevision + 1, 'MCP preview proposed the wrong revision')

  const retryResult = result.retry
  assert(retryResult.code === 0, `Fresh-process MCP retry returned ${retryResult.code}:\n${retryResult.stderr}`)
  assert(retryResult.stderr === '', `Fresh-process MCP retry emitted stderr:\n${retryResult.stderr}`)
  const retryMessages = parseCompleteMcpMessages(retryResult.stdoutBytes)
  assert(retryMessages.length === 3, 'Fresh-process MCP retry emitted an unexpected response count')
  const retryById = new Map(retryMessages.map((message) => [message.id, message]))
  for (const id of [11, 12, 13]) {
    assert(retryById.has(id), `Fresh-process MCP retry omitted response ${id}`)
    assert(retryById.get(id).error === undefined, `Fresh-process MCP response ${id} failed`)
  }
  assertDeepEqual(retryById.get(11).result.capabilities, { tools: {} })
  const replayed = readMcpGatewayResponse(retryById.get(12))
  assert(replayed.ok === true, 'Fresh-process MCP retry failed')
  const receipt = replayed.result
  assertDeepEqual(Object.keys(receipt).sort(), [
    'commandResults',
    'commitId',
    'dryRun',
    'effects',
    'intentEventIds',
    'kind',
    'previousRevision',
    'profileAgentEventIds',
    'proposedRevision',
    'replayed',
    'revision',
    'version',
  ])
  assert(
    receipt.kind === 'agent-command-batch'
      && receipt.version === PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
    'MCP retry receipt version changed',
  )
  assert(receipt.dryRun === false && receipt.replayed === true, 'MCP retry did not return the stored receipt')
  assert(receipt.previousRevision === request.expectedRevision, 'MCP retry receipt changed its expected base')
  assert(receipt.revision === request.expectedRevision + 1, 'MCP retry did not retain one atomic revision')
  assert(receipt.proposedRevision === receipt.revision, 'MCP retry proposed the wrong revision')
  assert(typeof receipt.commitId === 'string' && receipt.commitId.length > 0, 'MCP retry omitted commit identity')
  assertCanonicalJsonEqual(receipt.effects, {
    inserted: 5,
    updated: 0,
    deleted: 0,
    intentEvents: 3,
    profileAgentEvents: 0,
  })
  assert(receipt.intentEventIds.length === 3, 'MCP retry changed the persisted Intent count')
  assert(receipt.profileAgentEventIds.length === 0, 'MCP retry invented a Profile Agent event')
  assert(
    receipt.commandResults.length === request.commands.length,
    'MCP retry changed the command result count',
  )
  assertDeepEqual(
    receipt.commandResults.map((command) => command.name),
    request.commands.map((command) => command.name),
  )

  const finalStatus = readMcpGatewayResponse(retryById.get(13))
  assert(finalStatus.ok === true && finalStatus.result.state === 'ready', 'MCP retry final status was not ready')
  assert(
    finalStatus.result.owner.route === 'exclusive-headless-owner',
    'MCP retry final status did not use the installed headless owner',
  )
  assert(
    finalStatus.result.revision === request.expectedRevision + 1,
    'MCP retry duplicated or lost the accepted revision',
  )

  return {
    tools: profileMcpToolNames,
    capabilities: { tools: true, resources: false, prompts: false },
    byteZeroJson: true,
    persistentSession: true,
    representativeRead: 'profile.status',
    previewRevision: preview.result.revision,
    appliedRevision: receipt.revision,
    acceptedApplyDrainedAfterEof: true,
    ambiguousOutcome: {
      parentReadEndDestroyedBeforeApplyResponseObserved: true,
      childClosed: true,
      freshProcessReplayProvesFirstProcessCommittedExactlyOnce: true,
    },
    freshProcessRetry: {
      sameMcpTransport: true,
      sameIdempotencyKey: true,
      replayed: true,
      exactStoredReceipt: true,
      revision: receipt.revision,
      finalRevision: finalStatus.result.revision,
    },
    responseAfterUtilityJoin: true,
  }
}

function parseCompleteMcpMessages(stdoutBytes) {
  assert(stdoutBytes[0] === 0x7b, 'Fresh-process MCP retry did not begin at byte zero with JSON')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(stdoutBytes)
  assert(text.endsWith('\n'), 'Fresh-process MCP retry ended with an incomplete line')
  const lines = text.slice(0, -1).split('\n')
  assert(lines.every((line) => line.length > 0), 'Fresh-process MCP retry emitted a blank line')
  return lines.map((line) => JSON.parse(line))
}

function readMcpGatewayResponse(message) {
  const response = message?.result?.structuredContent
  assert(response && typeof response === 'object', 'MCP tool result omitted structured Gateway content')
  assertDeepEqual(message.result.content, [{ type: 'text', text: JSON.stringify(response) }])
  return response
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`
}

function assertAbsentProfileInspection(result) {
  assert(result.code === 6, `Absent Profile CLI returned ${result.code}:\n${result.stderr}`)
  const response = parseProfileCliResponse(result.stdoutBytes)
  assert(response.requestId === 'packaged-profile-absent', 'Absent CLI request identity changed')
  assert(response.ok === false && response.error?.code === 'not-found', 'Absent CLI was not typed not-found')
  assert(!result.stderr.includes(proofRoot), 'Absent CLI diagnostic exposed the disposable root')
  return {
    typedNotFound: true,
    profileDirectoryAbsent: true,
    databaseAbsent: true,
    ownerSidecarAbsent: true,
  }
}

function assertOverLimitProfileInspection(result) {
  assert(result.code === 2, `Over-limit Profile CLI returned ${result.code}:\n${result.stderr}`)
  const response = parseProfileCliResponse(result.stdoutBytes)
  assert(response.requestId === null, 'Over-limit CLI invented request identity')
  assert(response.ok === false && response.error?.code === 'invalid', 'Over-limit CLI was not typed invalid')
  assert(!result.stderr.includes(proofRoot), 'Over-limit CLI diagnostic exposed the disposable root')
  return {
    rejectedWithoutEof: true,
    processExitedAfterResponse: true,
  }
}

function assertInstalledProfileInspection(result, stamped) {
  assert(result.code === 0, `Installed Profile CLI failed:\n${result.stderr}\n${result.stdout}`)
  assert(result.stderr === '', `Installed Profile CLI emitted stderr:\n${result.stderr}`)
  const response = parseProfileCliResponse(result.stdoutBytes)
  assert(response.requestId === 'packaged-profile-inspection', 'Installed CLI request identity changed')
  assert(response.ok === true, 'Installed Profile CLI did not succeed')
  assert(response.result?.revision === stamped.revision, 'CLI inspection changed the Profile revision')
  assert(typeof response.result?.profileId === 'string' && response.result.profileId.length > 0, 'CLI omitted Profile identity')
  assert(response.result?.items?.length === 1, 'CLI inspection did not return one bounded record')
  assert(response.result.items[0]?.kind === 'card', 'CLI inspection returned the wrong logical kind')
  assert(response.result.items[0]?.recordId === stamped.cardId, 'CLI inspection missed the stamped card')
  assert(response.result.truncated === false, 'CLI inspection unexpectedly truncated one exact record')
  return response
}

function assertInstalledAgentCapabilities(result) {
  assert(result.code === 0, `Installed Agent capabilities failed:\n${result.stderr}\n${result.stdout}`)
  assert(result.stderr === '', `Installed Agent capabilities emitted stderr:\n${result.stderr}`)
  const response = parseProfileCliResponse(result.stdoutBytes)
  assert(response.requestId === 'packaged-agent-capabilities', 'Agent capability request identity changed')
  assert(response.ok === true, 'Installed Agent capabilities did not succeed')
  assertDeepEqual(Object.keys(response.result).sort(), [
    'adapter',
    'commandBatch',
    'commands',
    'queries',
    'queryLimits',
    'versions',
  ])
  assert(response.result.adapter === 'sqlite', 'Headless Agent capability did not report SQLite')
  assertDeepEqual(response.result.versions, PROFILE_GATEWAY_VERSIONS)
  assertDeepEqual(response.result.queries, [
    'profile.status',
    'profile.capabilities',
    'idea.list',
    'graph.query',
    'record.get',
    'mod-template.list',
  ])
  assertDeepEqual(response.result.queryLimits, {
    defaultItems: 50,
    maxItems: 200,
    defaultBytes: 64 * 1024,
    maxBytes: 256 * 1024,
    maxFilterValues: 16,
    maxFilterValueBytes: 512,
    maxProjectionFields: 16,
    maxProjectionFieldBytes: 128,
    maxCursorBytes: 256 * 1024,
  })
  assertDeepEqual(response.result.commands, INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
  assertDeepEqual(response.result.commandBatch, INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY)
  return response.result
}

function createPackagedAgentRequest(ideaId, expectedRevision) {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision,
    idempotencyKey: 'packaged-agent-mixed-board-v1',
    dryRun: false,
    commands: [
      {
        version: 1,
        id: 'packaged-agent-create-source',
        name: 'card.create',
        payload: {
          ideaId,
          kind: 'note',
          position: { x: 220, y: 180 },
          text: 'Packaged Agent source',
        },
      },
      {
        version: 1,
        id: 'packaged-agent-create-target',
        name: 'card.create',
        payload: {
          ideaId,
          kind: 'note',
          position: { x: 620, y: 180 },
          text: 'Packaged Agent target',
        },
      },
      {
        version: 1,
        id: 'packaged-agent-connect-created',
        name: 'connection.create',
        payload: {
          ideaId,
          from: { createdByCommandId: 'packaged-agent-create-source' },
          to: { createdByCommandId: 'packaged-agent-create-target' },
          strength: 'strong',
          polarity: 'helps',
          reason: 'Packaged Agent mixed-batch proof',
        },
      },
    ],
  }
}

function assertAppliedAgentBatch(result, request) {
  assert(result.code === 0, `Installed Agent batch failed:\n${result.stderr}\n${result.stdout}`)
  assert(result.stderr === '', `Installed Agent batch emitted stderr:\n${result.stderr}`)
  const response = parseProfileCliResponse(result.stdoutBytes)
  assert(response.requestId === 'packaged-agent-apply', 'Agent apply request identity changed')
  assert(response.ok === true, 'Installed Agent batch did not succeed')
  const receipt = response.result
  assertDeepEqual(Object.keys(receipt).sort(), [
    'commandResults',
    'commitId',
    'dryRun',
    'effects',
    'intentEventIds',
    'kind',
    'previousRevision',
    'profileAgentEventIds',
    'proposedRevision',
    'replayed',
    'revision',
    'version',
  ])
  assert(
    receipt.kind === 'agent-command-batch'
      && receipt.version === PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
    'Agent receipt version changed',
  )
  assert(receipt.previousRevision === request.expectedRevision, 'Agent receipt changed its expected base')
  assert(receipt.revision === request.expectedRevision + 1, 'Agent batch did not advance exactly one revision')
  assert(receipt.proposedRevision === receipt.revision, 'Agent receipt proposed the wrong revision')
  assert(typeof receipt.commitId === 'string' && receipt.commitId.length > 0, 'Agent receipt omitted commit identity')
  assert(receipt.dryRun === false && receipt.replayed === false, 'First Agent apply was not a new durable commit')
  assertDeepEqual(receipt.effects, {
    inserted: 5,
    updated: 0,
    deleted: 0,
    intentEvents: 3,
    profileAgentEvents: 0,
  })
  assert(receipt.intentEventIds.length === 3, 'Agent batch did not persist one Intent per Board command')
  assert(receipt.profileAgentEventIds.length === 0, 'Board batch invented a Profile Agent event')
  assert(receipt.commandResults.length === request.commands.length, 'Agent receipt changed command result count')
  const [source, target, connection] = receipt.commandResults
  assert(source?.commandId === request.commands[0].id && source.name === 'card.create', 'Agent source result changed')
  assert(target?.commandId === request.commands[1].id && target.name === 'card.create', 'Agent target result changed')
  assertProofId(source.cardId, 'Agent source card')
  assertProofId(source.blockId, 'Agent source block')
  assertProofId(target.cardId, 'Agent target card')
  assertProofId(target.blockId, 'Agent target block')
  assert(connection?.commandId === request.commands[2].id, 'Agent connection result changed identity')
  assert(connection.name === 'connection.create' && connection.route === 'direct', 'Agent connection was not direct')
  assert(connection.connectionIds?.length === 1, 'Agent direct connection returned the wrong identity count')
  assert(connection.resultCardId === null && connection.resultCreated === false, 'Agent direct connection invented a Result')
  assertProofId(connection.connectionIds[0], 'Agent connection')
  const recordIds = [source.cardId, target.cardId, connection.connectionIds[0]]
  assert(new Set(recordIds).size === recordIds.length, 'Agent batch reused a logical record identity')
  return { receipt, recordIds }
}

function assertReplayedAgentBatch(result, applied) {
  assert(result.code === 0, `Fresh-process Agent retry failed:\n${result.stderr}\n${result.stdout}`)
  assert(result.stderr === '', `Fresh-process Agent retry emitted stderr:\n${result.stderr}`)
  const response = parseProfileCliResponse(result.stdoutBytes)
  assert(response.requestId === 'packaged-agent-retry', 'Agent retry request identity changed')
  assert(response.ok === true, 'Fresh-process Agent retry did not succeed')
  assert(response.result.replayed === true, 'Fresh-process Agent retry was not an exact replay')
  assertCanonicalJsonEqual({ ...response.result, replayed: false }, applied.receipt)
  return response.result
}

function assertAppliedAgentQuery(result, applied) {
  assert(result.code === 0, `Post-Agent bounded query failed:\n${result.stderr}\n${result.stdout}`)
  assert(result.stderr === '', `Post-Agent bounded query emitted stderr:\n${result.stderr}`)
  const response = parseProfileCliResponse(result.stdoutBytes)
  assert(response.requestId === 'packaged-agent-query', 'Post-Agent query request identity changed')
  assert(response.ok === true, 'Post-Agent bounded query did not succeed')
  assert(response.result.revision === applied.receipt.revision, 'Post-Agent query observed the wrong revision')
  assert(response.result.truncated === false, 'Post-Agent exact query was truncated')
  assert(response.result.nextCursor === undefined, 'Post-Agent exact query returned a cursor')
  assert(response.result.items.length === applied.recordIds.length, 'Post-Agent query returned the wrong record count')
  const kindsById = new Map(response.result.items.map((item) => [item.recordId, item.kind]))
  assert(kindsById.get(applied.recordIds[0]) === 'card', 'Post-Agent query missed the source Card')
  assert(kindsById.get(applied.recordIds[1]) === 'card', 'Post-Agent query missed the target Card')
  assert(kindsById.get(applied.recordIds[2]) === 'connection', 'Post-Agent query missed the Connection')
  return { recordKinds: [...kindsById.values()].sort() }
}

function ideaIdFromBoardOwner(ownerId) {
  assert(typeof ownerId === 'string' && ownerId.startsWith('board:'), 'Stamped Card owner was not a Board')
  const ideaId = ownerId.slice('board:'.length)
  assert(
    ideaId.length > 0 && Buffer.byteLength(ideaId, 'utf8') <= 512,
    'Idea identity was invalid',
  )
  return ideaId
}

function profileProofEnvironment() {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.NODE_OPTIONS
  return environment
}

function assertStampReport(report) {
  assertDeepEqual(Object.keys(report).sort(), [
    'cardId',
    'credential',
    'egress',
    'logicalClose',
    'modId',
    'nativeGeneration',
    'phase',
    'revision',
    'security',
    'utilityJoined',
  ])
  assert(report.phase === 'stamp', 'First launch reported the wrong proof phase')
  assertProofId(report.cardId, 'card')
  assertProofId(report.modId, 'Mod')
  assertPositiveSafeInteger(report.nativeGeneration, 'First native generation')
  assertPositiveSafeInteger(report.revision, 'First revision')
  assert(report.logicalClose === true, 'First launch did not complete logical close')
  assert(report.utilityJoined === true, 'First launch did not join the Profile utility')
  assertPackagedCredentialReport(report.credential)
  assertPackagedEgressReport(report.egress)
  assertDeepEqual(report.security, {
    origin: 'eido://app',
    nodeGlobal: 'undefined',
    requireGlobal: 'undefined',
    permissionState: 'denied',
    popupDenied: true,
    webviewCapability: 'undefined',
    // Pin the shipped renderer allowlist independently of the protocol code.
    connectSrc: "'self' https://openrouter.ai https://api.linkup.so",
  })
  return report
}

function assertVerifyReport(report, stamped) {
  assertDeepEqual(Object.keys(report).sort(), [
    'adapter',
    'cardId',
    'credential',
    'egress',
    'logicalClose',
    'modId',
    'nativeGeneration',
    'offline',
    'phase',
    'queryRevision',
    'revision',
    'utilityJoined',
  ])
  assert(report.phase === 'verify', 'Offline relaunch reported the wrong proof phase')
  assert(report.cardId === stamped.cardId, 'Offline hydration did not retain the stamped card')
  assert(report.modId === stamped.modId, 'Offline hydration did not retain the stamped Mod')
  assert(report.adapter === 'sqlite', 'Installed Profile capabilities did not report SQLite')
  assert(report.queryRevision === stamped.revision, 'Bounded query did not observe the first close revision')
  assertPositiveSafeInteger(report.nativeGeneration, 'Offline native generation')
  assertPositiveSafeInteger(report.revision, 'Offline close revision')
  assertDeepEqual(report.offline, {
    scope: 'window-session',
    networkEmulationEnabled: true,
  })
  assert(report.logicalClose === true, 'Offline relaunch did not complete logical close')
  assert(report.utilityJoined === true, 'Offline relaunch did not join the Profile utility')
  assertPackagedCredentialReport(report.credential)
  assertPackagedEgressReport(report.egress)
  return report
}

function assertPackagedCredentialReport(credential) {
  assertDeepEqual(credential, {
    localRoundTrip: true,
    legacyPlaintextRemoved: true,
    linkupRoundTrip: true,
  })
}

function assertPackagedEgressReport(egress) {
  assertDeepEqual(egress, { externalRequestCount: 0 })
}

function assertPackagedSurface(asarPath, packagedFiles) {
  const packagedJavaScript = [...packagedFiles]
    .filter((file) => (file.startsWith('/dist/') || file.startsWith('/dist-electron/'))
      && /\.(?:cjs|js)$/i.test(file))
    // `packagedFiles` entries are forward-slash-normalized (see `normalizedListing` above) for
    // stable cross-platform Set membership checks. `@electron/asar`'s Filesystem.getFile splits
    // the path it's given on `path.sep`, which is `\` on Windows, so a forward-slash path never
    // splits into directory segments there and every nested lookup fails. Convert back to the
    // platform-native separator only for the actual extraction call.
    .map((file) => extractFile(asarPath, file.replace(/^\//, '').split('/').join(path.sep)))
  const source = Buffer.concat(packagedJavaScript).toString('utf8')
  const chatCompletionsEndpoint = 'https://openrouter.ai/api/v1/chat/completions'
  // The model catalog is a live endpoint again (#1034). #676 deleted it as dead
  // code and this proof pinned its absence; context windows are now read from
  // the catalog rather than from a hand-kept table that had aged out of the
  // product, so the packaged surface is expected to carry it and its absence is
  // now the drift worth failing on.
  //
  // The offline Profile proof asserts zero external requests. Catalog requests
  // are made when the user runs a completion with their OpenRouter key.
  const modelCatalogEndpoint = 'https://openrouter.ai/api/v1/models'
  assert(source.includes(chatCompletionsEndpoint), 'Packaged AI chat endpoint is missing')
  assert(source.includes(modelCatalogEndpoint), 'Packaged model catalog endpoint is missing')
  for (const retiredSurface of [
    '.i.posthog.com', '/v1/hosted/', '/v1/managed/openrouter/', 'r.jina.ai',
    'updates.eido.so', 'eido:update:v1',
  ]) {
    assert(!source.includes(retiredSurface), `Packaged code contains retired network surface ${retiredSurface}`)
  }
  const proofApiKeys = [...new Set(source.match(/sk-eido-packaged-proof-[a-z-]+/g) ?? [])]
  assert(proofApiKeys.length === 1, 'Packaged credential proof fixture is missing or ambiguous')
  return {
    proofApiKey: proofApiKeys[0],
    evidence: {
      cspConnectSrc: ["'self'", 'https://openrouter.ai', 'https://api.linkup.so'],
      chatCompletionsEndpoint: true,
      modelCatalogEndpoint: true,
    },
  }
}

// #1359 inverted what this proves. It used to assert the credential file was
// byte-for-byte the readable v1 fixture, which is now the one shape that must
// never reach a customer's disk. It asserts the protected frame instead, and
// then goes looking for the key everywhere under the proof root: the frame
// being well formed says nothing about whether a readable copy was left
// somewhere else on the way.
async function assertLocalCredentialFile(root, proofApiKey, expectedSha256) {
  const credentialPath = path.join(root, localCredentialRelativePath)
  const bytes = await readFile(credentialPath)
  const frame = JSON.parse(bytes.toString('utf8'))
  assert(
    Object.keys(frame).sort().join(',') === 'protected,version',
    'Protected credential frame carries fields beyond version and ciphertext',
  )
  assert(frame.version === 2, 'Local credential file is not the protected v2 frame')
  assert(
    typeof frame.protected === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(frame.protected),
    'Protected credential frame does not carry base64 ciphertext',
  )
  const ciphertext = Buffer.from(frame.protected, 'base64')
  assert(ciphertext.byteLength > 0, 'Protected credential ciphertext is empty')
  assert(
    !ciphertext.includes(Buffer.from(proofApiKey, 'utf8')),
    'Protected credential ciphertext still contains the key',
  )

  const metadata = await lstat(credentialPath)
  assert(metadata.isFile() && metadata.nlink === 1, 'Local credential path is not one regular file')
  assert(metadata.size === bytes.byteLength, 'Local credential file size changed during inspection')
  if (process.platform !== 'win32') {
    assert((metadata.mode & 0o777) === 0o600, 'Local credential file mode is not 0600')
  }
  assert(
    !existsSync(path.join(root, legacySafeStorageBlobRelativePath)),
    'Legacy safeStorage blob remains active',
  )
  assert(
    !existsSync(path.join(root, legacyPlaintextCredentialRelativePath)),
    'Readable v1 credential file remains after migration',
  )
  await assertNoReadableApiKeyOnDisk(root, proofApiKey)

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (expectedSha256 !== undefined) {
    assert(sha256 === expectedSha256, 'Local credential file changed during read-only reopen')
  }
  return { sha256 }
}

// The whole promise, checked against the whole proof root rather than the one
// file we happen to know about. A key that survives readable in a log, a
// LevelDB record or a temp file is stored as plaintext no matter what the
// credential file says.
async function assertNoReadableApiKeyOnDisk(root, proofApiKey) {
  const needle = Buffer.from(proofApiKey, 'utf8')
  const readable = []
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      if ((await readFile(absolute)).includes(needle)) {
        readable.push(path.relative(root, absolute))
      }
    }
  }
  await walk(root)
  assert(
    readable.length === 0,
    `Readable API key found on disk at: ${readable.join(', ')}`,
  )
}

function syntheticIdentitySha256(cardId, modId) {
  return createHash('sha256').update(`${cardId}\0${modId}`, 'utf8').digest('hex')
}

function packagedExecutable(root) {
  if (process.platform === 'win32') return path.join(root, 'win-unpacked', 'Eido Shell Proof.exe')
  if (process.platform === 'darwin') {
    return path.join(root, 'mac-arm64', 'Eido Shell Proof.app', 'Contents', 'MacOS', 'Eido Shell Proof')
  }
  throw new Error(`Unsupported desktop proof host: ${process.platform}; expected win32 or darwin`)
}

function packagedMcpEntry(root, executable) {
  if (process.platform === 'win32') {
    return Object.freeze({
      strategy: 'windows-sea-relay',
      command: path.join(root, 'win-unpacked', 'eido-profile-mcp.exe'),
      args: ['--eido-profile-mcp'],
    })
  }
  if (process.platform === 'darwin') {
    return Object.freeze({
      strategy: 'macos-direct-electron',
      command: executable,
      args: ['--eido-profile-mcp'],
    })
  }
  throw new Error(`Unsupported desktop proof host: ${process.platform}; expected win32 or darwin`)
}

async function provePackagedEidoPathCommand(root) {
  const executable = process.platform === 'win32'
    ? path.join(root, 'win-unpacked', 'resources', 'bin', 'eido.exe')
    : path.join(
        root,
        'mac-arm64',
        'Eido Shell Proof.app',
        'Contents',
        'Resources',
        'bin',
        'eido',
      )
  assert(existsSync(executable), 'Packaged eido PATH command is missing')
  const workingDirectory = path.join(proofRoot, 'unrelated-path-cwd')
  await mkdir(workingDirectory, { recursive: false })
  const hostedMacCanary = process.platform === 'darwin'
    && process.env.GITHUB_ACTIONS === 'true'
    && process.env.CI === 'true'
    && process.env.EIDO_DESKTOP_PROOF_OS_USER_SCOPE === 'github-hosted'
  const fixedMacCommand = MAC_EIDO_COMMAND
  const launcher = process.platform === 'darwin'
    ? renderMacEidoCommandLauncher(await realpath(executable))
    : undefined
  let fixedMacCommandOwned = false
  const commandDirectory = process.platform === 'darwin'
    ? hostedMacCanary ? path.dirname(fixedMacCommand) : path.join(proofRoot, 'offered-path-bin')
    : path.dirname(executable)
  try {
    if (process.platform === 'darwin') {
      if (hostedMacCanary) {
        assert(await pathEntryIsAbsent(fixedMacCommand), 'Hosted macOS PATH canary target is already occupied')
      }
      const installer = ['/bin/sh', '-c', MAC_EIDO_COMMAND_INSTALL_SCRIPT, 'eido-install',
        path.join(commandDirectory, 'eido'), await realpath(executable), launcher]
      const [command, ...args] = hostedMacCanary ? ['/usr/bin/sudo', ...installer] : installer
      const installed = await run(command, args, { timeoutMs: shellTimeoutMs })
      assert(installed.code === 0, `macOS PATH canary could not install eido: ${installed.stderr}`)
      fixedMacCommandOwned = hostedMacCanary
    }
    const environment = profileProofEnvironment()
    const inheritedPath = Object.entries(environment)
      .find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
    for (const key of Object.keys(environment)) {
      if (key.toUpperCase() === 'PATH') delete environment[key]
    }
    if (hostedMacCanary) {
      assert(
        inheritedPath.split(path.delimiter).some((entry) => path.resolve(entry) === commandDirectory),
        'Hosted macOS PATH canary requires /usr/local/bin on the fresh shell PATH',
      )
      environment.PATH = inheritedPath
    } else {
      environment.PATH = `${commandDirectory}${path.delimiter}${inheritedPath}`
    }

    if (process.platform === 'win32') {
      const resolution = await run('where.exe', ['eido'], {
        cwd: workingDirectory,
        env: environment,
        timeoutMs: shellTimeoutMs,
      })
      const firstResolution = resolution.stdout.split(/\r?\n/u).find(Boolean)
      assert(
        resolution.code === 0
          && canonicalWindowsPath(firstResolution) === canonicalWindowsPath(executable),
        'Packaged eido command name resolved to a different executable',
      )
    } else {
      const command = path.join(commandDirectory, 'eido')
      assert(
        (await lstat(command)).isFile() && (await readFile(command, 'utf8')) === launcher,
        'Packaged eido command launcher did not target the packaged executable',
      )
    }

    const result = await run('eido', ['--help'], {
      cwd: workingDirectory,
      env: environment,
      timeoutMs: shellTimeoutMs,
    })
    assert(result.code === 0, `Packaged eido PATH command failed:\n${result.stderr}\n${result.stdout}`)
    assert(result.stderr === '', 'Packaged eido PATH command emitted diagnostics for --help')
    assert(
      result.stdout.includes('Eido is a local visual thinking board.')
        && result.stdout.includes('eido describe'),
      'Packaged eido PATH command did not orient a zero-context caller',
    )
    return {
      resolvedByCommandName: true,
      unrelatedWorkingDirectory: true,
      platform: process.platform,
      architecture: process.arch,
      naturalPathOrder: hostedMacCanary,
      installationConvention: hostedMacCanary
        ? 'fixed-/usr/local/bin-hosted-canary'
        : process.platform === 'darwin'
          ? 'offered-launcher'
          : 'installer-owned-path-directory',
    }
  } finally {
    if (fixedMacCommandOwned) {
      const removed = await run('/usr/bin/sudo', [
        '/bin/sh',
        '-c',
        REMOVE_MAC_EIDO_COMMAND_CANARY,
        'eido-path-cleanup',
        fixedMacCommand,
        launcher,
      ], {
        timeoutMs: shellTimeoutMs,
      })
      assert(
        removed.code === 0,
        `Hosted macOS PATH canary changed before cleanup and was left untouched: ${removed.stderr}`,
      )
      assert(await pathEntryIsAbsent(fixedMacCommand), 'Hosted macOS PATH canary left /usr/local/bin/eido behind')
    }
  }
}

async function pathEntryIsAbsent(candidate) {
  try {
    await lstat(candidate)
    return false
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    throw error
  }
}

function canonicalWindowsPath(candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return undefined
  return path.win32.normalize(candidate.trim().replace(/^"(.*)"$/u, '$1'))
    .replace(/[\\/]+$/u, '')
    .toLowerCase()
}

async function assertMcpPackageBoundary(entry) {
  assert(existsSync(entry.command), 'Packaged Profile MCP entry is missing')
  if (process.platform === 'darwin') {
    return {
      strategy: entry.strategy,
      executablePresent: true,
      directElectron: true,
    }
  }

  const executable = await readFile(entry.command)
  const peOffset = executable.readUInt32LE(0x3c)
  assert(executable.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0')), 'MCP relay is not PE')
  assert(executable.readUInt16LE(peOffset + 4) === 0x8664, 'MCP relay is not Windows x64')
  const optionalHeader = peOffset + 24
  assert(executable.readUInt16LE(optionalHeader) === 0x20b, 'MCP relay is not PE32+')
  assert(executable.readUInt16LE(optionalHeader + 68) === 3, 'MCP relay is not a console executable')
  assert(
    executable.includes(Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1', 'ascii')),
    'MCP relay SEA fuse is not armed',
  )
  const metadata = await stat(entry.command)
  const signature = inspectUnsignedWindowsExecutable(entry.command, { cwd: repositoryRoot })
  return {
    strategy: entry.strategy,
    executablePresent: true,
    consoleSubsystem: true,
    architecture: 'x64',
    seaNodeVersion: process.versions.node,
    bytes: metadata.size,
    signableExtension: '.exe',
    unsignedProofStatus: signature.status,
  }
}

function packagedResources(root) {
  if (process.platform === 'win32') return path.join(root, 'win-unpacked', 'resources')
  if (process.platform === 'darwin') {
    return path.join(root, 'mac-arm64', 'Eido Shell Proof.app', 'Contents', 'Resources')
  }
  throw new Error(`Unsupported desktop proof host: ${process.platform}; expected win32 or darwin`)
}

function readShellTimeout(arguments_) {
  const value = arguments_.find((argument) => argument.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length)
  if (value === undefined) return 45_000
  const timeout = Number(value)
  assert(Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= 60_000, 'Invalid smoke timeout')
  return timeout
}

function assertProofSigningBoundary(executable) {
  if (process.platform === 'win32') {
    return {
      platform: process.platform,
      scope: 'main-executable',
      ...inspectUnsignedWindowsExecutable(executable, { cwd: repositoryRoot }),
    }
  }

  if (process.platform === 'darwin') {
    const appBundle = path.resolve(executable, '..', '..', '..')
    const verification = spawnSync(
      'codesign',
      ['--verify', '--deep', '--strict', appBundle],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )
    assert(
      !verification.error && verification.status === 0,
      `Ad-hoc proof signature verification failed: ${verification.stderr || verification.error}`,
    )
    const signature = spawnSync(
      'codesign',
      ['--display', '--verbose=4', appBundle],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )
    assert(!signature.error && signature.status === 0, `codesign readback failed: ${signature.stderr}`)
    const output = `${signature.stdout}\n${signature.stderr}`
    assert(output.includes('Signature=adhoc'), `Proof app signature was not ad-hoc:\n${output}`)
    assert(output.includes('TeamIdentifier=not set'), `Proof app unexpectedly has a TeamIdentifier:\n${output}`)
    assert(!/^Authority=/m.test(output), `Proof app unexpectedly has a signing authority:\n${output}`)
    return { platform: process.platform, scope: 'app-bundle', status: 'ad-hoc', teamIdentifier: 'not set' }
  }

  throw new Error(`Unsupported desktop proof host: ${process.platform}; expected win32 or darwin`)
}

function assertProofId(value, label) {
  assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value), `${label} identity was invalid`)
}

function assertPositiveSafeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} was not a positive safe integer`)
}

function assertDeepEqual(actual, expected) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  assert(actualJson === expectedJson, `Expected ${expectedJson}, received ${actualJson}`)
}

function assertCanonicalJsonEqual(actual, expected) {
  assertDeepEqual(canonicalJsonValue(actual), canonicalJsonValue(expected))
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]),
  )
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

function run(command, args, {
  closeInput = true,
  cwd = repositoryRoot,
  env = process.env,
  input,
  timeoutMs = 30_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      env,
      windowsHide: true,
    })
    const stdoutChunks = []
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.from(chunk))
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    let inputWritten = closeInput
    let processClosed = false
    let result
    let settled = false
    const timeout = setTimeout(() => {
      fail(new Error(`Packaged Profile launch timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    if (closeInput) {
      child.stdin.end(input)
    } else {
      child.stdin.write(input, (error) => {
        if (error) {
          fail(error)
          return
        }
        inputWritten = true
        finish()
      })
      child.stdin.on('error', fail)
    }
    child.on('error', fail)
    child.on('close', (code) => {
      processClosed = true
      const stdoutBytes = Buffer.concat(stdoutChunks)
      result = { code, stdout: stdoutBytes.toString('utf8'), stdoutBytes, stderr }
      finish()
    })

    function finish() {
      if (!settled && inputWritten && processClosed) {
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }
    }

    function fail(error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (!processClosed) terminateChild(child)
      reject(error)
    }
  })
}

function terminateChild(child) {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}
