import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildProfileLiveGatewayHelperForDevelopment,
  profileLiveGatewayHelperBuildPlan,
  profileLiveGatewayWindowsMsvcDiscoveryTimeoutMs,
  profileLiveGatewayWindowsMsvcEnvironmentTimeoutMs,
  resolveProfileLiveGatewayWindowsMsvcEnvironment,
} from './profile-live-gateway-helper.mjs'
import {
  runBoundedNativeBuild,
  terminateBoundedProcessTree,
} from './bounded-native-build.mjs'

const scratchRoots = []
const windowsPipeSecurityProbeSource = resolve(
  'native/profile-live-gateway/windows_pipe_security_probe.c',
)
const suppliedNativeHelperPath = process.env.EIDO_PROFILE_LIVE_GATEWAY_TEST_HELPER
const windowsNativeHelperPath = suppliedNativeHelperPath
const windowsNativeSecurityProbePath =
  process.env.EIDO_PROFILE_LIVE_GATEWAY_TEST_SECURITY_PROBE
const hasCompleteWindowsNativeProof = Boolean(
  windowsNativeHelperPath && windowsNativeSecurityProbePath,
)
if (process.platform === 'win32'
  && Boolean(windowsNativeHelperPath) !== Boolean(windowsNativeSecurityProbePath)) {
  throw new Error('Windows native proof requires both prebuilt executables')
}
const windowsNativeIt = it.runIf(
  process.platform === 'win32' && hasCompleteWindowsNativeProof,
)
const macNativeIt = it.runIf(
  process.platform === 'darwin' && Boolean(suppliedNativeHelperPath),
)
const expectedHostedPlatform = process.env.EIDO_DESKTOP_PROOF_EXPECTED_PLATFORM
if (expectedHostedPlatform !== undefined && expectedHostedPlatform !== process.platform) {
  throw new Error(
    `Native Live Gateway proof expected ${expectedHostedPlatform}, received ${process.platform}`,
  )
}

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })))
})

describe('Profile Live Gateway native helper build seam', () => {
  it('bounds and destroys a native peer that never connects', async () => {
    const peer = Object.assign(new EventEmitter(), {
      destroy() {
        this.destroyed = true
      },
      destroyed: false,
    })

    await expect(connectNativePeer(
      'synthetic-endpoint',
      'synthetic native peer',
      10,
      () => peer,
    )).rejects.toThrow('synthetic native peer did not connect within 10ms')
    expect(peer.destroyed).toBe(true)
    expect(peer.listenerCount('connect')).toBe(0)
  })

  it('drains fragmented native output while waiting for a complete frame', async () => {
    const stream = new PassThrough({ highWaterMark: 64 })
    const fragments = [
      Buffer.alloc(64, 0x11),
      Buffer.alloc(64, 0x22),
      Buffer.alloc(64, 0x33),
    ]
    const frame = Buffer.concat(fragments)
    const reading = readBytes(stream, frame.byteLength)

    try {
      stream.write(fragments[0])
      await new Promise(setImmediate)
      stream.write(fragments[1])
      await new Promise(setImmediate)
      stream.end(fragments[2])

      await expect(withTimeout(
        reading,
        5_000,
        'fragmented native output was not drained',
      )).resolves.toEqual(frame)
    } finally {
      stream.destroy()
    }
  })

  it('captures a bounded native probe with its declared nonzero result', async () => {
    const result = await runBoundedNativeBuild({
      command: process.execPath,
      args: ['-e', "process.stdout.write('bounded probe'); process.exit(20)"],
      label: 'synthetic native probe',
      timeoutMs: 1_000,
      allowedExitCodes: [20],
    })

    expect(result).toEqual({
      code: 20,
      signal: null,
      stdout: 'bounded probe',
      stderr: '',
    })
  })

  it('bounds a native build and reaps a descendant retaining captured streams', async () => {
    const fixture = [
      "const { spawn } = require('node:child_process')",
      "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] })",
      "process.stdout.write(`BUILD_PIDS ${process.pid} ${grandchild.pid}\\n`)",
      'setInterval(() => {}, 1000)',
    ].join(';')
    // Give the fixture time to start even when the full suite is saturating
    // the host. The assertion concerns bounded teardown, not Node startup.
    const started = performance.now()
    let failure
    try {
      await runBoundedNativeBuild({
        command: process.execPath,
        args: ['-e', fixture],
        label: 'synthetic native build',
        timeoutMs: 1_000,
        terminationGraceMs: 250,
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain('synthetic native build timed out after 1000ms')
    const pids = /BUILD_PIDS (\d+) (\d+)/.exec(failure.message)
    expect(pids).not.toBeNull()
    const childPid = Number(pids[1])
    const grandchildPid = Number(pids[2])
    try {
      expect(performance.now() - started).toBeLessThan(4_000)
      await expect(waitForPidExit(childPid, 1_000)).resolves.toBeUndefined()
      await expect(waitForPidExit(grandchildPid, 1_000)).resolves.toBeUndefined()
    } finally {
      await terminateFixtureTree(childPid, grandchildPid)
    }
  }, 5_000)

  it('observes a rejected Windows peer close after a broken-pipe read', async () => {
    const peer = new EventEmitter()
    const closed = waitForClose(peer, 'rejected Windows peer', 100, {
      ignoredErrorCodes: ['EPIPE'],
    })

    peer.emit('error', Object.assign(new Error('read EPIPE'), { code: 'EPIPE' }))
    peer.emit('close')

    await expect(closed).resolves.toBeUndefined()

    const unexpected = new EventEmitter()
    const failed = waitForClose(unexpected, 'unexpectedly failed peer', 100, {
      ignoredErrorCodes: ['EPIPE'],
    })
    unexpected.emit('error', Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
    }))
    await expect(failed).rejects.toMatchObject({ code: 'ECONNRESET' })
  })

  it('keeps ordinary development builds portable on unsupported platforms', () => {
    expect(buildProfileLiveGatewayHelperForDevelopment({
      platform: 'linux',
      outputPath: '/tmp/must-not-build',
    })).toEqual({ state: 'skipped', platform: 'linux' })
  })

  it('declares reviewable macOS and Windows compiler inputs', () => {
    expect(profileLiveGatewayHelperBuildPlan({
      platform: 'darwin',
      outputPath: '/tmp/eido-helper',
    })).toMatchObject({
      command: 'clang',
      args: expect.arrayContaining(['-Wunreachable-code']),
      platformSource: expect.stringMatching(/transport_macos\.c$/),
      outputPath: '/tmp/eido-helper',
    })
    expect(profileLiveGatewayHelperBuildPlan({
      platform: 'win32',
      outputPath: 'C:\\scratch\\eido-helper.exe',
      environment: {
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        comspec: 'C:\\Windows\\System32\\cmd.exe',
      },
    })).toMatchObject({
      command: 'cl.exe',
      args: expect.arrayContaining(['/D_WIN32_WINNT=0x0600', 'advapi32.lib']),
      platformSource: expect.stringMatching(/transport_windows\.c$/),
      outputPath: 'C:\\scratch\\eido-helper.exe',
      toolchain: {
        discovery: {
          command: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
          args: [
            '-latest',
            '-products', '*',
            '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
            '-property', 'installationPath',
          ],
        },
        commandInterpreter: 'C:\\Windows\\System32\\cmd.exe',
        architectureArguments: ['-no_logo', '-arch=amd64', '-host_arch=amd64'],
      },
    })
  })

  it('discovers and enters the x64 MSVC developer environment before compiling', () => {
    const plan = profileLiveGatewayHelperBuildPlan({
      platform: 'win32',
      outputPath: 'C:\\scratch\\eido-helper.exe',
      environment: {
        'programfiles(X86)': 'C:\\Program Files (x86)',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
    })
    const invocations = []
    const environment = resolveProfileLiveGatewayWindowsMsvcEnvironment(
      plan.toolchain,
      (command, args, options) => {
        invocations.push({ command, args, options })
        if (invocations.length === 1) {
          return {
            status: 0,
            stdout: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\r\n',
            stderr: '',
          }
        }
        return {
          status: 0,
          stdout: [
            'Path=C:\\MSVC\\bin;C:\\Windows\\System32',
            'INCLUDE=C:\\MSVC\\include',
            'LIB=C:\\MSVC\\lib',
            'VCToolsInstallDir=C:\\MSVC\\',
            '',
          ].join('\r\n'),
          stderr: '',
        }
      },
      windowsBuildEnvironment(),
    )

    expect(invocations).toEqual([
      {
        command: plan.toolchain.discovery.command,
        args: plan.toolchain.discovery.args,
        options: {
          encoding: 'utf8',
          timeout: profileLiveGatewayWindowsMsvcDiscoveryTimeoutMs,
          windowsHide: true,
        },
      },
      {
        command: 'C:\\Windows\\System32\\cmd.exe',
        args: [
          '/d',
          '/s',
          '/c',
          'call "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\Tools\\VsDevCmd.bat" -no_logo -arch=amd64 -host_arch=amd64 >nul && set',
        ],
        options: {
          encoding: 'utf8',
          timeout: profileLiveGatewayWindowsMsvcEnvironmentTimeoutMs,
          windowsHide: true,
          env: {
            'ProgramFiles(x86)': 'C:\\Program Files (x86)',
            ComSpec: 'C:\\Windows\\System32\\cmd.exe',
            VSCMD_SKIP_SENDTELEMETRY: '1',
          },
          windowsVerbatimArguments: true,
        },
      },
    ])
    expect(environment).toMatchObject({
      Path: 'C:\\MSVC\\bin;C:\\Windows\\System32',
      INCLUDE: 'C:\\MSVC\\include',
      LIB: 'C:\\MSVC\\lib',
      VCToolsInstallDir: 'C:\\MSVC\\',
    })
  })

  it('passes VsDevCmd telemetry suppression through environment setup', () => {
    const baseEnvironment = {
      ...windowsBuildEnvironment(),
      VSCMD_SKIP_SENDTELEMETRY: '0',
    }
    const plan = profileLiveGatewayHelperBuildPlan({
      platform: 'win32',
      outputPath: 'C:\\scratch\\eido-helper.exe',
      environment: baseEnvironment,
    })
    let invocation = 0

    const environment = resolveProfileLiveGatewayWindowsMsvcEnvironment(
      plan.toolchain,
      (_command, _args, options) => {
        invocation += 1
        if (invocation === 1) {
          return {
            status: 0,
            stdout: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\r\n',
            stderr: '',
          }
        }
        if (options.env?.VSCMD_SKIP_SENDTELEMETRY !== '1') {
          return {
            error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
            status: null,
            stdout: '',
            stderr: '',
          }
        }
        return {
          status: 0,
          stdout: [
            'Path=C:\\MSVC\\bin;C:\\Windows\\System32',
            'INCLUDE=C:\\MSVC\\include',
            'LIB=C:\\MSVC\\lib',
            'VCToolsInstallDir=C:\\MSVC\\',
            'VSCMD_SKIP_SENDTELEMETRY=1',
            '',
          ].join('\r\n'),
          stderr: '',
        }
      },
      baseEnvironment,
    )

    expect(environment.VSCMD_SKIP_SENDTELEMETRY).toBe('1')
  })

  it('passes the compound developer-environment command verbatim to cmd.exe', () => {
    const plan = profileLiveGatewayHelperBuildPlan({
      platform: 'win32',
      outputPath: 'C:\\scratch\\eido-helper.exe',
      environment: windowsBuildEnvironment(),
    })
    let invocation = 0

    const environment = resolveProfileLiveGatewayWindowsMsvcEnvironment(
      plan.toolchain,
      (_command, _args, options) => {
        invocation += 1
        if (invocation === 1) {
          return {
            status: 0,
            stdout: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\r\n',
            stderr: '',
          }
        }
        if (options.windowsVerbatimArguments !== true) {
          return {
            status: 1,
            stdout: '',
            stderr: 'The filename, directory name, or volume label syntax is incorrect.',
          }
        }
        return {
          status: 0,
          stdout: [
            'Path=C:\\MSVC\\bin;C:\\Windows\\System32',
            'INCLUDE=C:\\MSVC\\include',
            'LIB=C:\\MSVC\\lib',
            'VCToolsInstallDir=C:\\MSVC\\',
            '',
          ].join('\r\n'),
          stderr: '',
        }
      },
    )

    expect(environment).toMatchObject({
      Path: 'C:\\MSVC\\bin;C:\\Windows\\System32',
      VCToolsInstallDir: 'C:\\MSVC\\',
    })
  })

  it('reports bounded MSVC setup diagnostics without exposing environment stdout', () => {
    const plan = profileLiveGatewayHelperBuildPlan({
      platform: 'win32',
      outputPath: 'C:\\scratch\\eido-helper.exe',
      environment: windowsBuildEnvironment(),
    })
    let invocation = 0

    expect(() => resolveProfileLiveGatewayWindowsMsvcEnvironment(
      plan.toolchain,
      () => {
        invocation += 1
        return invocation === 1
          ? {
              status: 0,
              stdout: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\r\n',
              stderr: '',
            }
          : {
              status: 1,
              stdout: 'GITHUB_TOKEN=must-not-be-reported',
              stderr: `VsDevCmd failed ${'x'.repeat(600)}`,
            }
      },
    )).toThrowError(expect.objectContaining({
      message: expect.stringMatching(/^Profile Live Gateway Windows MSVC environment setup failed: exit 1: VsDevCmd failed x{490,512}$/),
    }))
  })

  it('names the timed-out Windows toolchain command instead of stalling silently', () => {
    const plan = profileLiveGatewayHelperBuildPlan({
      platform: 'win32',
      outputPath: 'C:\\scratch\\eido-helper.exe',
      environment: windowsBuildEnvironment(),
    })
    const timedOut = () => ({
      error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      status: null,
      stdout: '',
      stderr: '',
    })

    expect(() => resolveProfileLiveGatewayWindowsMsvcEnvironment(
      plan.toolchain,
      timedOut,
    )).toThrowError(
      'Profile Live Gateway Windows MSVC discovery failed: vswhere.exe timed out after '
      + `${profileLiveGatewayWindowsMsvcDiscoveryTimeoutMs}ms`,
    )

    let invocation = 0
    expect(() => resolveProfileLiveGatewayWindowsMsvcEnvironment(
      plan.toolchain,
      () => {
        invocation += 1
        return invocation === 1
          ? {
              status: 0,
              stdout: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\r\n',
              stderr: '',
            }
          : timedOut()
      },
    )).toThrowError(
      'Profile Live Gateway Windows MSVC environment setup failed: VsDevCmd.bat timed out after '
      + `${profileLiveGatewayWindowsMsvcEnvironmentTimeoutMs}ms`,
    )
  })

  it('keeps Windows listener DACL and accepted-peer checks on the executable path', async () => {
    const plan = profileLiveGatewayHelperBuildPlan({
      platform: 'win32',
      outputPath: 'C:\\scratch\\eido-helper.exe',
      environment: windowsBuildEnvironment(),
    })
    const source = await readFile(plan.platformSource, 'utf8')

    expect(source).toContain('eido_transport_create_current_user_pipe_security(')
    expect(source).toMatch(/CreateNamedPipeA\([\s\S]*&attributes/)
    expect(source).toContain('PIPE_REJECT_REMOTE_CLIENTS')
    expect(source).toContain('GetNamedPipeClientProcessId(listener, &client_process_id)')
    expect(source).toContain('process_user_matches_current_process(client_process_id)')
    expect(source).toContain('WaitNamedPipeA(endpoint, remaining)')
    expect(source).toContain('busy_deadline = GetTickCount64() + 5000U')
  })

  it('keeps the Windows server frame-read deadline on the executable path', async () => {
    const plan = profileLiveGatewayHelperBuildPlan({
      platform: 'win32',
      outputPath: 'C:\\scratch\\eido-helper.exe',
      environment: windowsBuildEnvironment(),
    })
    const [commonSource, platformSource] = await Promise.all([
      readFile(plan.commonSource, 'utf8'),
      readFile(plan.platformSource, 'utf8'),
    ])

    expect(commonSource).toContain('EIDO_SERVER_CLIENT_READ_TIMEOUT_MS')
    expect(commonSource).toContain('eido_transport_read_exact_bounded(')
    expect(platformSource).toContain('PeekNamedPipe(')
    expect(platformSource).toContain('GetTickCount64()')
    expect(platformSource).toContain('EIDO_TRANSPORT_READ_TIMEOUT')
  })

  it('ships the Windows kernel-security probe used by hosted black-box proof', async () => {
    const source = await readFile(windowsPipeSecurityProbeSource, 'utf8')

    expect(source).toContain('ImpersonateAnonymousToken(GetCurrentThread())')
    expect(source).toContain('GetSecurityInfo(')
    expect(source).toContain('EqualSid(')
  })

  windowsNativeIt(
    'proves an owner-only DACL and same-user round-trip with compiled server and client helpers',
    async () => {
      const proof = await startWindowsServer('security')
      try {
        const probe = await runBoundedNativeBuild({
          command: proof.securityProbePath,
          args: [proof.endpoint],
          label: 'Windows pipe security probe',
          timeoutMs: 10_000,
        })
        expect(probe.stdout.trim()).toBe('anonymous denied; owner-only DACL verified')
        await expect(readBytes(proof.server.stdout, 4)).resolves.toEqual(Buffer.alloc(4))
        await expect(readBytes(proof.server.stdout, 4)).resolves.toEqual(Buffer.alloc(4, 0xff))

        const frame = encodeFrame(Buffer.from([0xde, 0xad, 0xbe, 0xef]))
        await expect(serverRoundTrip(
          proof.server,
          proof.helperPath,
          proof.endpoint,
          [frame],
        )).resolves.toEqual(frame)
      } finally {
        await stopWindowsServer(proof.server)
      }
    },
    30_000,
  )

  windowsNativeIt(
    'contains malformed and maximum-bound frames, then serves the next native client',
    async () => {
      const proof = await startWindowsServer('malformed')
      let malformed
      try {
        malformed = await connectNativePeer(
          proof.endpoint,
          'malformed Windows peer',
        )
        await expect(readBytes(proof.server.stdout, 4)).resolves.toEqual(Buffer.alloc(4))
        malformed.end(Buffer.from([0x00, 0x08, 0x00, 0x01]))
        await waitForClose(malformed, 'malformed Windows peer', 10_000, {
          ignoredErrorCodes: ['EPIPE'],
        })
        await expect(readBytes(proof.server.stdout, 4)).resolves.toEqual(Buffer.alloc(4, 0xff))

        const maximumFrame = encodeFrame(Buffer.alloc(512 * 1024, 0xa5))
        await expect(serverRoundTrip(
          proof.server,
          proof.helperPath,
          proof.endpoint,
          [maximumFrame],
        )).resolves.toEqual(maximumFrame)
      } finally {
        malformed?.destroy()
        await stopWindowsServer(proof.server)
      }
    },
    30_000,
  )

  windowsNativeIt(
    'evicts a stalled partial-frame peer within the deadline and recovers',
    async () => {
      const proof = await startWindowsServer('stalled')
      let stalled
      try {
        stalled = await connectNativePeer(
          proof.endpoint,
          'stalled Windows peer',
        )
        await expect(readBytes(proof.server.stdout, 4)).resolves.toEqual(Buffer.alloc(4))
        const started = performance.now()
        stalled.write(Buffer.from([0x00, 0x00]))
        await waitForClose(stalled, 'stalled Windows peer', 15_000, {
          ignoredErrorCodes: ['EPIPE'],
        })
        const elapsed = performance.now() - started
        expect(elapsed).toBeGreaterThanOrEqual(4_000)
        expect(elapsed).toBeLessThan(12_000)
        await expect(readBytes(proof.server.stdout, 4)).resolves.toEqual(Buffer.alloc(4, 0xff))

        const frame = encodeFrame(Buffer.from([0xca, 0xfe]))
        await expect(serverRoundTrip(
          proof.server,
          proof.helperPath,
          proof.endpoint,
          [frame],
        )).resolves.toEqual(frame)
      } finally {
        stalled?.destroy()
        await stopWindowsServer(proof.server)
      }
    },
    30_000,
  )

  macNativeIt('runs the prebuilt warning-clean macOS helper', async () => {
    const version = await runBoundedNativeBuild({
      command: requireNativeHelperPath(),
      args: ['--version'],
      label: 'Prebuilt macOS helper version proof',
      timeoutMs: 10_000,
    })
    expect(version.stdout.trim()).toBe('eido-profile-live-gateway-helper 1')
  })

  macNativeIt('relays opaque frames through a same-user socket', async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), 'eido-live-gateway-relay-'))
    scratchRoots.push(scratchRoot)
    const helperPath = requireNativeHelperPath()
    const endpoint = join(scratchRoot, 'gateway.sock')
    const frame = Buffer.from([0, 0, 0, 4, 0xde, 0xad, 0xbe, 0xef])
    const server = createServer((socket) => socket.pipe(socket))
    let child
    try {
      server.listen(endpoint)
      await once(server, 'listening')
      await chmod(endpoint, 0o600)

      child = spawn(helperPath, ['--client', endpoint], { stdio: ['pipe', 'pipe', 'pipe'] })
      const output = []
      child.stdout.on('data', (chunk) => output.push(chunk))
      child.stdin.end(frame)
      const [status] = await withTimeout(
        once(child, 'close'),
        10_000,
        'native macOS client did not close after the echo response',
      )

      expect(status).toBe(0)
      expect(Buffer.concat(output)).toEqual(frame)
    } finally {
      if (child) await stopNativeChild(child, 'native macOS client', 'SIGKILL', 2_000)
      if (server.listening) {
        const serverClosed = once(server, 'close')
        server.close()
        await withTimeout(serverClosed, 2_000, 'macOS echo server did not close')
      }
    }
  })

  macNativeIt('reserves absence for a missing endpoint', async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), 'eido-live-gateway-absent-'))
    scratchRoots.push(scratchRoot)
    const absent = await runBoundedNativeBuild({
      command: requireNativeHelperPath(),
      args: ['--client', join(scratchRoot, 'missing.sock')],
      label: 'Missing-endpoint macOS helper proof',
      timeoutMs: 10_000,
      allowedExitCodes: [20],
    })

    expect(absent.code).toBe(20)
  })

  macNativeIt(
    'owns an owner-only listener, contains a malformed client, and cleans up',
    async () => {
      const scratchRoot = await mkdtemp(join(tmpdir(), 'eido-live-gateway-server-'))
      scratchRoots.push(scratchRoot)
      const helperPath = requireNativeHelperPath()
      const endpoint = join(scratchRoot, 'gateway.sock')
      const handshakeFrame = Buffer.from([0, 0, 0, 1, 0x01])
      const firstFrame = Buffer.from([0, 0, 0, 3, 0x11, 0x22, 0x33])
      const secondFrame = Buffer.from([0, 0, 0, 2, 0xaa, 0xbb])
      const server = spawn(helperPath, ['--server', endpoint], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let malformed
      try {
        await waitForText(server.stderr, 'ready\n')
        expect((await stat(endpoint)).mode & 0o777).toBe(0o600)
        const duplicate = await runBoundedNativeBuild({
          command: helperPath,
          args: ['--server', endpoint],
          label: 'Duplicate-listener macOS helper proof',
          timeoutMs: 10_000,
          allowedExitCodes: [22],
        })
        expect(duplicate.code).toBe(22)
        await expect(readBytes(server.stdout, 4)).resolves.toEqual(Buffer.alloc(4))
        await expect(readBytes(server.stdout, 4)).resolves.toEqual(Buffer.alloc(4, 0xff))

        await expect(serverRoundTrip(
          server,
          helperPath,
          endpoint,
          [handshakeFrame, firstFrame],
        )).resolves.toEqual(Buffer.concat([handshakeFrame, firstFrame]))

        malformed = await connectNativePeer(endpoint, 'malformed macOS peer')
        await expect(readBytes(server.stdout, 4)).resolves.toEqual(Buffer.alloc(4))
        malformed.end(Buffer.from([0, 0, 0, 0]))
        await waitForClose(malformed, 'malformed macOS peer')
        await expect(readBytes(server.stdout, 4)).resolves.toEqual(Buffer.alloc(4, 0xff))

        await expect(serverRoundTrip(server, helperPath, endpoint, [secondFrame]))
          .resolves.toEqual(secondFrame)
        expect(server.exitCode).toBeNull()
      } finally {
        malformed?.destroy()
        await stopNativeChild(server, 'native macOS server', 'SIGTERM', 2_000)
      }
      await expect(stat(endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  macNativeIt(
    'evicts a stalled partial-frame peer and serves the next client',
    async () => {
      const scratchRoot = await mkdtemp(join(tmpdir(), 'eido-live-gateway-stalled-'))
      scratchRoots.push(scratchRoot)
      const helperPath = requireNativeHelperPath()
      const endpoint = join(scratchRoot, 'gateway.sock')
      const frame = Buffer.from([0, 0, 0, 2, 0xca, 0xfe])
      const server = spawn(helperPath, ['--server', endpoint], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stalled
      try {
        await waitForText(server.stderr, 'ready\n')

        stalled = await connectNativePeer(endpoint, 'stalled macOS peer')
        await expect(readBytes(server.stdout, 4)).resolves.toEqual(Buffer.alloc(4))
        stalled.write(Buffer.from([0, 0]))
        await waitForClose(stalled, 'stalled macOS peer', 15_000)
        await expect(readBytes(server.stdout, 4)).resolves.toEqual(Buffer.alloc(4, 0xff))

        await expect(serverRoundTrip(server, helperPath, endpoint, [frame]))
          .resolves.toEqual(frame)
      } finally {
        stalled?.destroy()
        await stopNativeChild(
          server,
          'native macOS stalled-peer server',
          'SIGTERM',
          2_000,
        )
      }
    },
    20_000,
  )

  macNativeIt(
    'withdraws the endpoint before a peer observes parent-output loss',
    async () => {
      const scratchRoot = await mkdtemp(join(tmpdir(), 'eido-live-gateway-parent-loss-'))
      scratchRoots.push(scratchRoot)
      const helperPath = requireNativeHelperPath()
      const endpoint = join(scratchRoot, 'gateway.sock')
      const server = spawn(helperPath, ['--server', endpoint], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const serverClosed = once(server, 'close')
      let client
      try {
        await waitForText(server.stderr, 'ready\n')

        const stdoutClosed = once(server.stdout, 'close')
        server.stdout.destroy()
        await withTimeout(stdoutClosed, 10_000, 'native macOS server stdout did not close')
        client = connect(endpoint)
        client.on('error', () => undefined)
        await waitForClose(client, 'post-parent-loss macOS peer')

        await expect(stat(endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
        const [status, signal] = await withTimeout(
          serverClosed,
          10_000,
          'native macOS parent-loss server did not close',
        )
        expect(status).toBe(22)
        expect(signal).toBeNull()
      } finally {
        client?.destroy()
        await stopNativeChild(server, 'native macOS parent-loss server', 'SIGKILL', 2_000)
      }
    },
    20_000,
  )

  macNativeIt('refuses a listener in a permissive directory', async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), 'eido-live-gateway-mode-'))
    scratchRoots.push(scratchRoot)
    const endpoint = join(scratchRoot, 'gateway.sock')
    await chmod(scratchRoot, 0o755)

    const refused = await runBoundedNativeBuild({
      command: requireNativeHelperPath(),
      args: ['--server', endpoint],
      label: 'Permissive-directory macOS helper proof',
      timeoutMs: 10_000,
      allowedExitCodes: [21],
    })

    expect(refused.code).toBe(21)
    await expect(stat(endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function serverRoundTrip(server, helperPath, endpoint, frames) {
  const client = spawn(helperPath, ['--client', endpoint], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const clientOutput = []
  client.stdout.on('data', chunk => clientOutput.push(Buffer.from(chunk)))
  try {
    client.stdin.end(Buffer.concat(frames))
    await expect(readBytes(server.stdout, 4)).resolves.toEqual(Buffer.alloc(4))
    for (const frame of frames) {
      const fromClient = await readBytes(server.stdout, frame.byteLength)
      expect(fromClient).toEqual(frame)
      server.stdin.write(frame)
    }
    const [status] = await withTimeout(
      once(client, 'close'),
      10_000,
      'native client did not close after receiving its response',
    )
    expect(status).toBe(0)
    await expect(readBytes(server.stdout, 4)).resolves.toEqual(Buffer.alloc(4, 0xff))
    return Buffer.concat(clientOutput)
  } finally {
    await stopNativeChild(client, 'native client', 'SIGKILL', 2_000)
  }
}

async function connectNativePeer(
  endpoint,
  label,
  timeoutMs = 5_000,
  open = connect,
) {
  const peer = open(endpoint)
  const controller = new AbortController()
  try {
    await withTimeout(
      once(peer, 'connect', { signal: controller.signal }),
      timeoutMs,
      `${label} did not connect`,
    )
    return peer
  } catch (error) {
    peer.destroy()
    throw error
  } finally {
    controller.abort()
  }
}

function windowsBuildEnvironment() {
  return {
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  }
}

function requireNativeHelperPath() {
  if (!suppliedNativeHelperPath) {
    throw new Error('Native Profile Live Gateway helper was not prebuilt')
  }
  return suppliedNativeHelperPath
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') return
      throw error
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Process ${pid} remained alive after ${timeoutMs}ms`)
}

async function terminateFixtureTree(...pids) {
  await Promise.all(pids
    .filter(pid => Number.isInteger(pid) && pid > 0)
    .map(pid => terminateBoundedProcessTree({ pid, timeoutMs: 1_000 })))
}

async function startWindowsServer(label) {
  if (!windowsNativeHelperPath || !windowsNativeSecurityProbePath) {
    throw new Error('Profile Live Gateway Windows native proof binaries are unavailable')
  }
  const endpoint = `\\\\.\\pipe\\eido-live-gateway-${process.pid}-${label}-${Date.now()}`
  const server = spawn(windowsNativeHelperPath, ['--server', endpoint], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  try {
    await waitForText(server.stderr, 'ready\n', 5_000)
  } catch (error) {
    await stopNativeChild(server, 'unready native Windows server', 'SIGKILL', 2_000)
    throw error
  }
  return {
    endpoint,
    helperPath: windowsNativeHelperPath,
    securityProbePath: windowsNativeSecurityProbePath,
    server,
  }
}

async function stopWindowsServer(server) {
  await stopNativeChild(server, 'native Windows server', 'SIGTERM', 10_000)
}

async function stopNativeChild(child, label, signal, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  child.kill(signal)
  try {
    await withTimeout(closed, timeoutMs, `${label} did not stop`)
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null && signal !== 'SIGKILL') {
      const forcedClosed = once(child, 'close')
      child.kill('SIGKILL')
      await withTimeout(forcedClosed, 2_000, `${label} did not stop after SIGKILL`)
    }
    throw error
  }
}

function encodeFrame(payload) {
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.byteLength)
  return Buffer.concat([header, payload])
}

async function readBytes(stream, length) {
  const chunks = []
  let remaining = length
  while (remaining > 0) {
    const available = stream.readableLength
    if (available > 0) {
      const chunk = stream.read(Math.min(remaining, available))
      if (chunk !== null) {
        const bytes = Buffer.from(chunk)
        chunks.push(bytes)
        remaining -= bytes.byteLength
        continue
      }
    }
    if (stream.readableEnded || stream.destroyed) {
      throw new Error(`Stream ended with ${remaining} of ${length} bytes still unread`)
    }
    await waitForReadable(stream, remaining)
  }
  return Buffer.concat(chunks, length)
}

async function waitForReadable(stream, length, timeoutMs = 10_000) {
  await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => finish(new Error(
      `Stream did not make ${length} bytes readable within ${timeoutMs}ms`,
    )), timeoutMs)
    const onReadable = () => finish()
    const onEnd = () => finish(new Error(
      `Stream ended before ${length} bytes were readable`,
    ))
    const onError = error => finish(error)
    const finish = (error) => {
      clearTimeout(timer)
      stream.off('readable', onReadable)
      stream.off('end', onEnd)
      stream.off('close', onEnd)
      stream.off('error', onError)
      if (error) rejectPromise(error)
      else resolvePromise()
    }
    stream.once('readable', onReadable)
    stream.once('end', onEnd)
    stream.once('close', onEnd)
    stream.once('error', onError)
  })
}

async function waitForClose(
  stream,
  label,
  timeoutMs = 10_000,
  { ignoredErrorCodes = [] } = {},
) {
  await withTimeout(
    new Promise((resolvePromise, rejectPromise) => {
      const ignored = new Set(ignoredErrorCodes)
      const onClose = () => finish()
      const onError = error => {
        if (!ignored.has(error?.code)) finish(error)
      }
      const finish = error => {
        stream.off('close', onClose)
        stream.off('error', onError)
        if (error) rejectPromise(error)
        else resolvePromise()
      }
      stream.once('close', onClose)
      stream.on('error', onError)
    }),
    timeoutMs,
    `${label} did not close`,
  )
}

async function withTimeout(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, rejectPromise) => {
        timer = setTimeout(() => rejectPromise(new Error(
          `${message} within ${timeoutMs}ms`,
        )), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitForText(stream, expected, timeoutMs = 10_000) {
  let captured = ''
  await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => finish(new Error(
      `Stream did not emit ${JSON.stringify(expected)} within ${timeoutMs}ms; `
        + `captured ${JSON.stringify(captured.slice(-1_024))}`,
    )), timeoutMs)
    const onData = (chunk) => {
      captured += chunk.toString('utf8')
      if (captured.replaceAll('\r\n', '\n').includes(expected)) finish()
    }
    const onEnd = () => finish(new Error(
      `Stream ended before ${JSON.stringify(expected)}; `
        + `captured ${JSON.stringify(captured.slice(-1_024))}`,
    ))
    const finish = (error) => {
      clearTimeout(timer)
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('close', onEnd)
      if (error) rejectPromise(error)
      else resolvePromise()
    }
    stream.on('data', onData)
    stream.once('end', onEnd)
    stream.once('close', onEnd)
  })
}
