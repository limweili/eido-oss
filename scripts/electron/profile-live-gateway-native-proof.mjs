import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runBoundedNativeBuild } from './bounded-native-build.mjs'

const NATIVE_BUILD_DEADLINE_MS = 60_000
const NATIVE_TEST_DEADLINE_MS = 105_000
const NATIVE_VITEST_PROOFS = Object.freeze([
  Object.freeze({
    file: 'electron/profileLiveGatewayServer.test.ts',
    timeoutMs: 35_000,
  }),
  Object.freeze({
    file: 'scripts/electron/profile-live-gateway-helper.test.mjs',
    timeoutMs: 50_000,
  }),
  Object.freeze({
    file: 'scripts/electron/profile-live-gateway-helper-deployment.test.mjs',
    timeoutMs: 10_000,
  }),
])
const supported = process.platform === 'darwin' || process.platform === 'win32'

if (!supported) {
  throw new Error(`Native Live Gateway proof does not support ${process.platform}`)
}

const proofRoot = await mkdtemp(join(tmpdir(), 'eido-native-live-gateway-proof-'))
const helperPath = join(
  proofRoot,
  process.platform === 'win32'
    ? 'eido-profile-live-gateway-helper.exe'
    : 'eido-profile-live-gateway-helper',
)
const securityProbePath = process.platform === 'win32'
  ? join(proofRoot, 'eido-pipe-security-probe.exe')
  : undefined

try {
  const buildArguments = [
    resolve('scripts/electron/profile-live-gateway-native-proof-build.mjs'),
    helperPath,
  ]
  if (securityProbePath !== undefined) buildArguments.push(securityProbePath)
  await runBoundedNativeBuild({
    command: process.execPath,
    args: buildArguments,
    label: 'Native Live Gateway proof build',
    timeoutMs: NATIVE_BUILD_DEADLINE_MS,
    cwd: resolve('.'),
    forwardOutput: true,
  })

  const testDeadline = Date.now() + NATIVE_TEST_DEADLINE_MS
  for (const proof of NATIVE_VITEST_PROOFS) {
    const remainingMs = testDeadline - Date.now()
    if (remainingMs <= 0) {
      throw new Error(`Native Live Gateway Vitest proof exhausted its deadline before ${proof.file}`)
    }
    await runBoundedNativeBuild({
      command: process.execPath,
      args: [
        resolve('node_modules/vitest/vitest.mjs'),
        'run',
        '--no-file-parallelism',
        '--reporter=verbose',
        proof.file,
      ],
      label: `Native Live Gateway Vitest proof: ${proof.file}`,
      timeoutMs: Math.min(proof.timeoutMs, remainingMs),
      cwd: resolve('.'),
      environment: {
        ...process.env,
        EIDO_PROFILE_LIVE_GATEWAY_TEST_HELPER: helperPath,
        ...(securityProbePath === undefined
          ? {}
          : { EIDO_PROFILE_LIVE_GATEWAY_TEST_SECURITY_PROBE: securityProbePath }),
      },
      forwardOutput: true,
    })
  }
} finally {
  await rm(proofRoot, { recursive: true, force: true })
}
