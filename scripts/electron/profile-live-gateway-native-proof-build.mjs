import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildProfileLiveGatewayHelper,
  profileLiveGatewayHelperBuildPlan,
  resolveProfileLiveGatewayWindowsMsvcEnvironment,
} from './profile-live-gateway-helper.mjs'

const windowsPipeSecurityProbeSource = resolve(
  'native/profile-live-gateway/windows_pipe_security_probe.c',
)
const windowsPipeSecurityProbeCompileTimeoutMs = 120_000

export async function buildProfileLiveGatewayNativeProof({
  helperPath,
  securityProbePath,
  platform = process.platform,
} = {}) {
  if (typeof helperPath !== 'string' || helperPath.length === 0) {
    throw new Error('Native Live Gateway proof helper path is required')
  }
  if (platform === 'win32'
    && (typeof securityProbePath !== 'string' || securityProbePath.length === 0)) {
    throw new Error('Native Live Gateway proof security-probe path is required on Windows')
  }
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error(`Native Live Gateway proof does not support ${platform}`)
  }

  await mkdir(dirname(helperPath), { recursive: true })
  phase('helper-start')
  buildProfileLiveGatewayHelper({ outputPath: helperPath, platform })
  phase('helper-complete')

  if (platform === 'win32') {
    await mkdir(dirname(securityProbePath), { recursive: true })
    phase('security-probe-start')
    buildWindowsPipeSecurityProbe(securityProbePath, dirname(securityProbePath))
    phase('security-probe-complete')
  }
}

function buildWindowsPipeSecurityProbe(outputPath, cwd) {
  const plan = profileLiveGatewayHelperBuildPlan({
    platform: 'win32',
    outputPath,
  })
  const environment = resolveProfileLiveGatewayWindowsMsvcEnvironment(plan.toolchain)
  const built = spawnSync('cl.exe', [
    '/nologo',
    '/std:c11',
    '/D_WIN32_WINNT=0x0600',
    '/W4',
    '/WX',
    '/O2',
    windowsPipeSecurityProbeSource,
    '/link',
    'advapi32.lib',
    `/out:${outputPath}`,
  ], {
    cwd,
    encoding: 'utf8',
    env: environment,
    timeout: windowsPipeSecurityProbeCompileTimeoutMs,
    windowsHide: true,
  })
  if (built.error || built.status !== 0) {
    if (built.error?.code === 'ETIMEDOUT' || built.error?.message?.includes('ETIMEDOUT')) {
      throw new Error(
        'Windows pipe security probe compile (cl.exe) timed out after '
        + `${windowsPipeSecurityProbeCompileTimeoutMs}ms`,
      )
    }
    throw new Error(built.error?.message || built.stderr || built.stdout)
  }
}

function phase(name) {
  process.stderr.write(`[native-live-gateway-build] ${name}\n`)
}

const isCli = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  await buildProfileLiveGatewayNativeProof({
    helperPath: process.argv[2],
    securityProbePath: process.argv[3],
  })
}
