import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  MAC_EIDO_COMMAND,
  MAC_EIDO_COMMAND_INSTALL_SCRIPT,
  renderMacEidoCommandLauncher,
} from './eidoCommandLauncher'

const execFileAsync = promisify(execFile)

export type EidoCommandInstallerRunner = (
  executable: string,
  args: string[],
  options: Readonly<{ timeout: number; maxBuffer: number; windowsHide: boolean }>,
) => Promise<unknown>

const INSTALL_SCRIPT = `on run argv
  set installer to quoted form of item 1 of argv
  set targetPath to quoted form of item 2 of argv
  set sourcePath to quoted form of item 3 of argv
  set launcher to quoted form of item 4 of argv
  set commandText to "/bin/sh -c " & installer & " eido-install " & targetPath & " " & sourcePath & " " & launcher
  do shell script commandText with administrator privileges
end run`

export function resolveMacosEidoCommandSource(resourcesPath: string): string {
  try {
    const resourcesRoot = realpathSync.native(resourcesPath)
    const source = realpathSync.native(path.join(resourcesRoot, 'bin', 'eido'))
    const relative = path.relative(resourcesRoot, source)
    const sourceStat = statSync(source)
    if (relative === ''
      || path.isAbsolute(relative)
      || relative === '..'
      || relative.startsWith(`..${path.sep}`)
      || !sourceStat.isFile()
      || (sourceStat.mode & 0o111) === 0) {
      throw new Error('invalid source')
    }
    return source
  } catch {
    throw new Error('Packaged eido command source is invalid')
  }
}

export async function installMacosEidoCommand(
  resourcesPath: string,
  run: EidoCommandInstallerRunner = execFileAsync,
): Promise<void> {
  const source = resolveMacosEidoCommandSource(resourcesPath)
  await run('/usr/bin/osascript', [
    '-e', INSTALL_SCRIPT, MAC_EIDO_COMMAND_INSTALL_SCRIPT, MAC_EIDO_COMMAND, source,
    renderMacEidoCommandLauncher(source),
  ], {
    timeout: 60_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  })
}
