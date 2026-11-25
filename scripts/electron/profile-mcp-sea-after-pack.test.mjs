import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  createWindowsProfileMcpRelaySource,
  signMacStandaloneExecutables,
} from './profile-mcp-sea-after-pack.mjs'

const nativeRequire = createRequire(import.meta.url)
const relayArgument = '--eido-profile-mcp'
const execFileAsync = promisify(execFile)

describe('macOS standalone executable signing', () => {
  it('ad-hoc signs both nested code objects only when package identity is intentionally absent', async () => {
    const invocations = []
    const executables = ['/package/Eido.app/Contents/Resources/bin/eido', '/package/Eido.app/Contents/Resources/bin/helper']

    await signMacStandaloneExecutables(
      { packager: { platformSpecificBuildOptions: { identity: null } } },
      executables,
      async (...args) => invocations.push(args),
    )

    expect(invocations).toEqual(executables.map((executable) => [
      '/usr/bin/codesign',
      ['--force', '--sign', '-', executable],
      expect.objectContaining({ windowsHide: true }),
    ]))

    invocations.length = 0
    for (const identity of ['Developer ID Application: Eido (A1B2C3D4E5)', '-', undefined]) {
      await signMacStandaloneExecutables(
        { packager: { platformSpecificBuildOptions: { identity } } },
        executables,
        async (...args) => invocations.push(args),
      )
    }
    expect(invocations).toEqual([])
  })

  it.runIf(process.platform === 'darwin')(
    'leaves identity-null nested Mach-O executables verifiably runnable',
    async () => {
      const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'eido-sea-signing-test-'))
      try {
        const executables = [
          path.join(temporaryDirectory, 'eido'),
          path.join(temporaryDirectory, 'eido-profile-live-gateway-helper'),
        ]
        for (const executable of executables) {
          await copyFile('/usr/bin/printf', executable)
          await execFileAsync('/usr/bin/codesign', ['--remove-signature', executable])
        }

        await signMacStandaloneExecutables(
          { packager: { platformSpecificBuildOptions: { identity: null } } },
          executables,
        )

        for (const executable of executables) {
          await execFileAsync('/usr/bin/codesign', ['--verify', '--strict', executable])
          const { stdout } = await execFileAsync(executable, ['%s\n', 'signed CLI proof'])
          expect(stdout).toBe('signed CLI proof\n')
        }
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true })
      }
    },
  )
})

describe('Windows Profile MCP SEA relay', () => {
  it.each([
    ['missing', []],
    ['repeated', [relayArgument, relayArgument]],
    ['conflicting', ['--eido-profile-json']],
  ])('rejects %s control arguments without spawning or touching stdout', async (_name, args) => {
    const spawn = vi.fn()
    const runtime = executeRelay(args, spawn)

    await vi.waitFor(() => expect(runtime.process.exitCode).toBe(1))
    expect(spawn).not.toHaveBeenCalled()
    expect(runtime.stdout.text()).toBe('')
    expect(runtime.stderr.text()).toBe('Eido Profile MCP failed.\n')
  })

  it('accepts the exact SEA argv shape and completes when the child exits before caller stdin', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const runtime = executeRelay([relayArgument], spawn)
    expect(runtime.process.stdin.readableEnded).toBe(false)

    child.exitCode = 0
    child.stdio[4].end()
    child.stdio[5].end()
    child.emit('close', 0, null)

    await vi.waitFor(() => expect(runtime.process.listenerCount('SIGINT')).toBe(0))
    expect(spawn).toHaveBeenCalledWith(
      path.join(path.dirname(runtime.process.execPath), 'Eido Shell Proof.exe'),
      [relayArgument],
      expect.objectContaining({
        cwd: path.dirname(runtime.process.execPath),
        shell: false,
        stdio: ['ignore', 'ignore', 'ignore', 'overlapped', 'overlapped', 'overlapped'],
        windowsHide: true,
      }),
    )
    expect(runtime.process.stdin.readableEnded).toBe(false)
    expect(runtime.process.stdin.destroyed).toBe(true)
    expect(runtime.process.exitCode).toBeUndefined()
    expect(runtime.stdout.text()).toBe('')
    expect(runtime.stderr.text()).toBe('')
  })

  it('turns a relay signal into child input EOF without killing accepted work', async () => {
    const child = fakeChild()
    const runtime = executeRelay([relayArgument], vi.fn(() => child))

    runtime.process.emit('SIGINT')
    await vi.waitFor(() => expect(child.stdio[3].writableEnded).toBe(true))
    expect(runtime.process.listenerCount('SIGINT')).toBe(1)
    runtime.process.emit('SIGINT')
    expect(runtime.process.listenerCount('SIGINT')).toBe(1)
    expect(child.kill).not.toHaveBeenCalled()

    child.exitCode = 0
    child.stdio[4].end()
    child.stdio[5].end()
    child.emit('close', 0, null)

    await vi.waitFor(() => expect(runtime.process.listenerCount('SIGINT')).toBe(0))
    expect(child.kill).not.toHaveBeenCalled()
    expect(runtime.process.exitCode).toBeUndefined()
    expect(runtime.stderr.text()).toBe('')
  })

  it('stops child admission on output pump failure without killing accepted work', async () => {
    const child = fakeChild()
    const runtime = executeRelay(
      [relayArgument],
      vi.fn(() => child),
      { stdout: failingWrites() },
    )

    child.stdio[4].write('{"jsonrpc":"2.0"}\n')
    await vi.waitFor(() => expect(child.stdio[3].writableEnded).toBe(true))
    expect(child.kill).not.toHaveBeenCalled()

    child.exitCode = 0
    child.stdio[5].end()
    child.emit('close', 0, null)

    await vi.waitFor(() => expect(runtime.process.exitCode).toBe(1))
    expect(child.kill).not.toHaveBeenCalled()
    expect(runtime.stderr.text()).toBe('Eido Profile MCP failed.\n')
  })
})

function executeRelay(userArguments, spawn, streams = {}) {
  const stdout = streams.stdout ?? collectWrites()
  const stderr = collectWrites()
  const executable = path.join(path.sep, 'package', 'eido-profile-mcp.exe')
  const process = Object.assign(new EventEmitter(), {
    argv: [executable, executable, ...userArguments],
    env: { APPDATA: path.join(path.sep, 'synthetic-app-data') },
    execPath: executable,
    exitCode: undefined,
    stdin: new PassThrough(),
    stdout: stdout.stream,
    stderr: stderr.stream,
  })
  const require = (specifier) => (
    specifier === 'node:child_process' ? { spawn } : nativeRequire(specifier)
  )
  const source = createWindowsProfileMcpRelaySource('Eido Shell Proof.exe')
  new vm.Script(source, { filename: 'profile-mcp-relay.cjs' }).runInNewContext({ process, require })
  return { process, stdout, stderr }
}

function failingWrites() {
  return {
    stream: new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('synthetic relay output failure'))
      },
    }),
    text: () => '',
  }
}

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    stdio: [null, null, null, new PassThrough(), new PassThrough(), new PassThrough()],
    kill: vi.fn(),
  })
  return child
}

function collectWrites() {
  const chunks = []
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    }),
    text: () => Buffer.concat(chunks).toString('utf8'),
  }
}
