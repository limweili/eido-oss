import assert from 'node:assert/strict'
import test from 'node:test'

import {
  capturePathIdentity,
  inspectUnsignedWindowsExecutable,
  parseProfileCliResponse,
  samePathIdentity,
} from '../electron/proof-host.mjs'

const unsignedAuthenticodeInspection = {
  status: 0,
  stdout: JSON.stringify({
    status: 'NotSigned',
    signerCertificate: null,
    timeStamperCertificate: null,
  }),
  stderr: '',
}

test('Profile CLI proof parser admits only the exact platform bytes and fatal UTF-8', () => {
  const response = {
    version: 1,
    requestId: 'request-unicode',
    ok: true,
    result: { name: '思考 🧠' },
  }
  const jsonLine = Buffer.from(`${JSON.stringify(response)}\n`, 'utf8')

  assert.deepEqual(parseProfileCliResponse(jsonLine, { platform: 'darwin' }), response)
  assert.deepEqual(parseProfileCliResponse(
    Buffer.concat([Buffer.from('\r\n', 'ascii'), jsonLine]),
    { platform: 'win32' },
  ), response)
  assert.deepEqual(parseProfileCliResponse(
    jsonLine,
    { platform: 'win32', envelope: 'standalone' },
  ), response)

  for (const bytes of [
    Buffer.concat([Buffer.from('\r\n ', 'ascii'), jsonLine]),
    Buffer.concat([Buffer.from('\r\n\t', 'ascii'), jsonLine]),
    Buffer.concat([Buffer.from('\r\n\r\n', 'ascii'), jsonLine]),
    Buffer.concat([Buffer.from('\r\n', 'ascii'), jsonLine, Buffer.from('\n')]),
    Buffer.concat([
      Buffer.from('\r\n{"version":1,"name":"', 'ascii'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}\n', 'ascii'),
    ]),
  ]) {
    assert.throws(() => parseProfileCliResponse(bytes, { platform: 'win32' }))
  }
  assert.throws(() => parseProfileCliResponse(jsonLine, { platform: 'win32' }), /platform envelope/)
  assert.throws(() => parseProfileCliResponse(
    Buffer.concat([Buffer.from('\r\n', 'ascii'), jsonLine]),
    { platform: 'win32', envelope: 'standalone' },
  ))
})

test('scratch path identity survives a macOS alias after the directory is removed', () => {
  const stat = () => ({ dev: 17n, ino: 42n })
  const expected = capturePathIdentity('/var/folders/eido-shell-smoke-proof', {
    platform: 'darwin',
    realpath: () => '/private/var/folders/eido-shell-smoke-proof',
    stat,
  })
  const reported = capturePathIdentity('/private/var/folders/eido-shell-smoke-proof', {
    platform: 'darwin',
    realpath: (value) => value,
    stat,
  })

  assert.equal(samePathIdentity(reported, expected), true)
})

test('scratch path identity accepts Windows long and 8.3 aliases only for the same filesystem entry', () => {
  const longPath = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\eido-shell-smoke-Th7QMx'
  const shortPath = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\eido-shell-smoke-Th7QMx'
  const capture = (value, ino) => capturePathIdentity(value, {
    platform: 'win32',
    realpath: (resolved) => resolved,
    stat: () => ({ dev: 23n, ino }),
  })

  const expected = capture(longPath, 99n)
  const reportedAlias = capture(shortPath, 99n)
  const differentDirectory = capture(shortPath, 100n)

  assert.equal(samePathIdentity(reportedAlias, expected), true)
  assert.equal(samePathIdentity(differentDirectory, expected), false)
})

test('Authenticode inspection stops after the preferred pwsh inspector succeeds', () => {
  const calls = []
  const evidence = inspectUnsignedWindowsExecutable('C:\\proof\\Eido Shell Proof.exe', {
    cwd: 'C:\\proof',
    spawn: (command, arguments_, options) => {
      calls.push({ command, arguments_, options })
      return unsignedAuthenticodeInspection
    },
  })

  assert.deepEqual(calls.map(({ command }) => command), ['pwsh.exe'])
  assert.deepEqual(evidence, {
    inspector: 'pwsh.exe',
    status: 'NotSigned',
    signerCertificate: null,
    timeStamperCertificate: null,
  })
})

test('Authenticode inspection falls back after a preferred inspector process or module failure', () => {
  const calls = []
  const evidence = inspectUnsignedWindowsExecutable('C:\\proof\\Eido Shell Proof.exe', {
    spawn: (command) => {
      calls.push(command)
      return command === 'pwsh.exe'
        ? { status: 1, stdout: '', stderr: 'Microsoft.PowerShell.Security could not be loaded' }
        : unsignedAuthenticodeInspection
    },
  })

  assert.deepEqual(calls, ['pwsh.exe', 'powershell.exe'])
  assert.equal(evidence.inspector, 'powershell.exe')
})

test('Authenticode inspection fails closed when neither PowerShell runtime can inspect the executable', () => {
  const missingRuntime = (command) => ({
    error: Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' }),
    status: null,
    stdout: '',
    stderr: '',
  })

  assert.throws(
    () => inspectUnsignedWindowsExecutable('C:\\proof\\Eido Shell Proof.exe', { spawn: missingRuntime }),
    /Authenticode inspection failed:[\s\S]*pwsh\.exe: spawn pwsh\.exe ENOENT[\s\S]*powershell\.exe: spawn powershell\.exe ENOENT/,
  )
})

test('a successful inspector cannot fall back around a signed executable', () => {
  const calls = []
  const signedInspection = {
    status: 0,
    stdout: JSON.stringify({
      status: 'Valid',
      signerCertificate: '0123456789ABCDEF',
      timeStamperCertificate: null,
    }),
    stderr: '',
  }

  assert.throws(
    () => inspectUnsignedWindowsExecutable('C:\\proof\\Eido Shell Proof.exe', {
      spawn: (command) => {
        calls.push(command)
        return signedInspection
      },
    }),
    /must be NotSigned; Authenticode status was Valid/,
  )
  assert.deepEqual(calls, ['pwsh.exe'])
})

test('an unsigned status still rejects a signer certificate', () => {
  const signerInspection = {
    status: 0,
    stdout: JSON.stringify({
      status: 'NotSigned',
      signerCertificate: '0123456789ABCDEF',
      timeStamperCertificate: null,
    }),
    stderr: '',
  }

  assert.throws(
    () => inspectUnsignedWindowsExecutable('C:\\proof\\Eido Shell Proof.exe', {
      spawn: () => signerInspection,
    }),
    /SignerCertificate must be null/,
  )
})

test('an unsigned status still rejects a timestamp certificate', () => {
  const timestampInspection = {
    status: 0,
    stdout: JSON.stringify({
      status: 'NotSigned',
      signerCertificate: null,
      timeStamperCertificate: 'FEDCBA9876543210',
    }),
    stderr: '',
  }

  assert.throws(
    () => inspectUnsignedWindowsExecutable('C:\\proof\\Eido Shell Proof.exe', {
      spawn: () => timestampInspection,
    }),
    /TimeStamperCertificate must be null/,
  )
})
