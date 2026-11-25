import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { runStandaloneEidoCli } from './eidoCliStandalone'

void runStandaloneEidoCli({
  argv: process.argv.slice(2),
  environment: process.env,
  platform: process.platform as 'darwin' | 'win32',
  executablePath: process.execPath,
  homeDirectory: os.homedir(),
  stdin: process.stdin,
  stdout: { write: (value) => new Promise<void>((resolve, reject) => {
    process.stdout.write(value, 'utf8', (error) => error ? reject(error) : resolve())
  }) },
  stderr: { write: (value) => new Promise<void>((resolve, reject) => {
    process.stderr.write(value, 'utf8', (error) => error ? reject(error) : resolve())
  }) },
  ...(import.meta.env.VITE_EIDO_RELEASE_VERSION
    ? { appVersion: import.meta.env.VITE_EIDO_RELEASE_VERSION as string }
    : {}),
  createRequestId: randomUUID,
  createSessionId: randomUUID,
}).then((exitCode) => {
  process.exitCode = exitCode
}).catch(() => {
  process.stderr.write('Eido command failed.\n')
  process.exitCode = 1
})
