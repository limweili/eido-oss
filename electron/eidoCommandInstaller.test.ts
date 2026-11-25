import { spawn } from 'node:child_process'
import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installMacosEidoCommand,
  resolveMacosEidoCommandSource,
  type EidoCommandInstallerRunner,
} from './eidoCommandInstaller'
import {
  MAC_EIDO_COMMAND,
  MAC_EIDO_COMMAND_INSTALL_SCRIPT,
  renderMacEidoCommandLauncher,
} from './eidoCommandLauncher'

const ownedRoots: string[] = []

afterEach(async () => {
  await Promise.all(ownedRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('macOS eido PATH command offer (#712)', () => {
  it('installs only the executable app-bundle shim through the fixed privileged target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eido-command-installer-'))
    ownedRoots.push(root)
    const resourcesPath = path.join(root, 'Eido.app', 'Contents', 'Resources')
    const source = path.join(resourcesPath, 'bin', 'eido')
    await mkdir(path.dirname(source), { recursive: true })
    await writeFile(source, '#!/bin/sh\nexit 0\n')
    await chmod(source, 0o755)
    const run = vi.fn(async () => undefined)

    const canonicalSource = await realpath(source)
    expect(resolveMacosEidoCommandSource(resourcesPath)).toBe(canonicalSource)
    await installMacosEidoCommand(resourcesPath, run)

    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      ['-e', expect.stringContaining('with administrator privileges'), MAC_EIDO_COMMAND_INSTALL_SCRIPT,
        MAC_EIDO_COMMAND, canonicalSource, renderMacEidoCommandLauncher(canonicalSource)],
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('refuses a packaged shim symlink that escapes the signed Resources directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eido-command-installer-'))
    ownedRoots.push(root)
    const resourcesPath = path.join(root, 'Eido.app', 'Contents', 'Resources')
    const outside = path.join(root, 'outside-eido')
    await mkdir(path.join(resourcesPath, 'bin'), { recursive: true })
    await writeFile(outside, '#!/bin/sh\nexit 0\n')
    await chmod(outside, 0o755)
    await symlink(outside, path.join(resourcesPath, 'bin', 'eido'))

    expect(() => resolveMacosEidoCommandSource(resourcesPath)).toThrow(
      'Packaged eido command source is invalid',
    )
  })

  it.runIf(process.platform === 'darwin')('emits AppleScript accepted by the platform compiler', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eido-command-installer-'))
    ownedRoots.push(root)
    const resourcesPath = path.join(root, 'Eido.app', 'Contents', 'Resources')
    const source = path.join(resourcesPath, 'bin', 'eido')
    const compiled = path.join(root, 'install-eido.scpt')
    await mkdir(path.dirname(source), { recursive: true })
    await writeFile(source, '#!/bin/sh\nexit 0\n')
    await chmod(source, 0o755)
    let script: string | undefined
    const run: EidoCommandInstallerRunner = async (_executable, args) => {
      script = args[1]
    }

    await installMacosEidoCommand(resourcesPath, run)
    expect(typeof script).toBe('string')
    const result = await runCommand(
      '/usr/bin/osacompile',
      ['-o', compiled, '-e', script as string],
      root,
      '',
    )

    expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
  })

  it.runIf(process.platform === 'darwin')('installs a regular launcher that preserves arguments and stdin', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eido-command-installer-'))
    ownedRoots.push(root)
    const packagedExecutable = path.join(root, "Eido's App", 'Contents', 'Resources', 'bin', 'eido')
    const workingDirectory = path.join(root, 'unrelated-cwd')
    await Promise.all([
      mkdir(path.dirname(packagedExecutable), { recursive: true }),
      mkdir(workingDirectory, { recursive: true }),
    ])
    await writeFile(packagedExecutable, '#!/bin/sh\nprintf "<%s>\\n" "$@"\ncat\n')
    await chmod(packagedExecutable, 0o755)
    const pathCommand = path.join(root, 'path-bin', 'eido')
    const launcher = renderMacEidoCommandLauncher(packagedExecutable)
    const install = () => runCommand('/bin/sh', [
      '-c', MAC_EIDO_COMMAND_INSTALL_SCRIPT, 'eido-install', pathCommand, packagedExecutable, launcher,
    ], root, '')

    expect((await install()).code).toBe(0)
    expect((await lstat(pathCommand)).isFile()).toBe(true)
    expect(await readFile(pathCommand, 'utf8')).toBe(launcher)
    expect((await install()).code).toBe(0)

    await rm(pathCommand)
    await symlink(packagedExecutable, pathCommand)
    expect((await install()).code).toBe(0)
    expect((await lstat(pathCommand)).isFile()).toBe(true)

    const result = await runCommand(pathCommand, ['batch', 'two words'], workingDirectory, '{"raw":true}\n')
    expect(result).toEqual({
      code: 0,
      stdout: '<batch>\n<two words>\n{"raw":true}\n',
      stderr: '',
    })

    await writeFile(pathCommand, 'unrelated')
    expect((await install()).code).toBe(73)
    expect(await readFile(pathCommand, 'utf8')).toBe('unrelated')
  })
})

function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  input: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.once('error', reject)
    child.once('close', code => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
    child.stdin.end(input)
  })
}
