import { spawnSync } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'

const WINDOWS_AUTHENTICODE_INSPECTORS = ['pwsh.exe', 'powershell.exe']

export function capturePathIdentity(
  value,
  {
    platform = process.platform,
    realpath = realpathSync.native,
    stat = statSync,
  } = {},
) {
  const canonicalPath = realpath(resolveForPlatform(value, platform))
  const metadata = stat(canonicalPath, { bigint: true })
  assert(
    typeof metadata.dev === 'bigint' && metadata.dev > 0n,
    'Path identity requires a positive filesystem device identifier',
  )
  assert(
    typeof metadata.ino === 'bigint' && metadata.ino > 0n,
    'Path identity requires a positive filesystem entry identifier',
  )
  return {
    canonicalPath,
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
  }
}

export function samePathIdentity(left, right) {
  return isPathIdentity(left)
    && isPathIdentity(right)
    && left.device === right.device
    && left.inode === right.inode
}

export function parseProfileCliResponse(
  stdoutBytes,
  { platform = process.platform, envelope = 'native-shell' } = {},
) {
  assert(Buffer.isBuffer(stdoutBytes), 'Profile CLI stdout must be captured as bytes')
  assert(platform === 'win32' || platform === 'darwin', `Unsupported Profile CLI proof host: ${platform}`)
  assert(
    envelope === 'native-shell' || envelope === 'standalone',
    `Unsupported Profile CLI envelope: ${envelope}`,
  )
  const nativePreamble = platform === 'win32' && envelope === 'native-shell'
    ? Buffer.from('\r\n', 'ascii')
    : Buffer.alloc(0)
  assert(
    stdoutBytes.subarray(0, nativePreamble.byteLength).equals(nativePreamble),
    'Profile CLI stdout did not use the exact platform envelope',
  )
  const responseBytes = stdoutBytes.subarray(nativePreamble.byteLength)

  let responseText
  try {
    responseText = new TextDecoder('utf-8', { fatal: true }).decode(responseBytes)
  } catch {
    throw new Error('Profile CLI stdout was not valid UTF-8')
  }

  let response
  try {
    response = JSON.parse(responseText)
  } catch {
    throw new Error('Profile CLI stdout was not contract JSON')
  }
  const canonicalBytes = Buffer.from(`${JSON.stringify(response)}\n`, 'utf8')
  assert(
    responseBytes.equals(canonicalBytes),
    'Profile CLI stdout was not exactly one canonical JSON line',
  )
  return response
}

export function inspectUnsignedWindowsExecutable(
  executable,
  {
    cwd = process.cwd(),
    inspectors = WINDOWS_AUTHENTICODE_INSPECTORS,
    spawn = spawnSync,
  } = {},
) {
  const escapedExecutable = executable.replaceAll("'", "''")
  const arguments_ = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedExecutable}'; `
      + '[pscustomobject]@{ '
      + 'status = $signature.Status.ToString(); '
      + 'signerCertificate = $signature.SignerCertificate.Thumbprint; '
      + 'timeStamperCertificate = $signature.TimeStamperCertificate.Thumbprint '
      + '} | ConvertTo-Json -Compress',
  ]
  const failures = []

  for (const inspector of inspectors) {
    const result = spawn(inspector, arguments_, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result.error || result.status !== 0) {
      failures.push(formatInspectorFailure(inspector, result))
      continue
    }

    let signature
    try {
      signature = JSON.parse(result.stdout.trim())
    } catch (error) {
      failures.push(`${inspector}: invalid JSON (${error.message})`)
      continue
    }
    if (!isAuthenticodePayload(signature)) {
      failures.push(`${inspector}: incomplete Authenticode payload`)
      continue
    }

    assert(
      signature.status === 'NotSigned',
      `Main proof executable must be NotSigned; Authenticode status was ${signature.status}`,
    )
    assert(
      signature.signerCertificate === null,
      `Main proof executable SignerCertificate must be null; received ${signature.signerCertificate}`,
    )
    assert(
      signature.timeStamperCertificate === null,
      `Main proof executable TimeStamperCertificate must be null; received ${signature.timeStamperCertificate}`,
    )
    return { inspector, ...signature }
  }

  throw new Error(`Authenticode inspection failed:\n${failures.join('\n')}`)
}

function resolveForPlatform(value, platform) {
  return (platform === 'win32' ? path.win32 : path.posix).resolve(value)
}

function isAuthenticodePayload(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.status === 'string'
    && Object.hasOwn(value, 'signerCertificate')
    && (value.signerCertificate === null || typeof value.signerCertificate === 'string')
    && Object.hasOwn(value, 'timeStamperCertificate')
    && (value.timeStamperCertificate === null || typeof value.timeStamperCertificate === 'string')
}

function isPathIdentity(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.canonicalPath === 'string'
    && value.canonicalPath.length > 0
    && typeof value.device === 'string'
    && /^[1-9]\d*$/.test(value.device)
    && typeof value.inode === 'string'
    && /^[1-9]\d*$/.test(value.inode)
}

function formatInspectorFailure(inspector, result) {
  const detail = result.error?.message
    || result.stderr?.trim()
    || result.stdout?.trim()
    || `exit ${result.status}`
  return `${inspector}: ${detail}`
}

function assert(value, message) {
  if (!value) throw new Error(message)
}
