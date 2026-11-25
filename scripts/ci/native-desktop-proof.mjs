import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FULL_SHA = /^[0-9a-f]{40}$/

function assert(value, message) {
  if (!value) throw new Error(message)
}

function readGitRevision(cwd) {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert(!revision.error && revision.status === 0, `Git evidence identity failed: ${revision.stderr}`)
  return revision.stdout.trim()
}

export function readNativeProofIdentity({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  cwd = process.cwd(),
  revision = readGitRevision(cwd),
  requireDeclared = false,
} = {}) {
  const declaredTestedSha = env.EIDO_DESKTOP_PROOF_TESTED_SHA?.trim()
  const declaredHeadSha = env.EIDO_DESKTOP_PROOF_HEAD_SHA?.trim()
  const declaredBaseSha = env.EIDO_DESKTOP_PROOF_BASE_SHA?.trim()
  const expectedPlatform = env.EIDO_DESKTOP_PROOF_EXPECTED_PLATFORM?.trim()
  const expectedArch = env.EIDO_DESKTOP_PROOF_EXPECTED_ARCH?.trim()

  if (requireDeclared) {
    assert(declaredTestedSha, 'Native proof must declare its tested SHA')
    assert(declaredHeadSha, 'Native proof must declare its exact head SHA')
    assert(expectedPlatform, 'Native proof must declare its expected platform')
    assert(expectedArch, 'Native proof must declare its expected architecture')
  }

  assert(FULL_SHA.test(revision), `Git evidence identity was not a full SHA: ${revision}`)
  if (declaredTestedSha) {
    assert(FULL_SHA.test(declaredTestedSha), `Tested evidence identity was not a full SHA: ${declaredTestedSha}`)
    assert(declaredTestedSha === revision, `Tested SHA ${revision} did not match ${declaredTestedSha}`)
  }
  if (declaredHeadSha) {
    assert(FULL_SHA.test(declaredHeadSha), `Head evidence identity was not a full SHA: ${declaredHeadSha}`)
    assert(declaredHeadSha === revision, `Checked-out SHA ${revision} was not exact head ${declaredHeadSha}`)
  }
  if (declaredBaseSha) {
    assert(FULL_SHA.test(declaredBaseSha), `Base evidence identity was not a full SHA: ${declaredBaseSha}`)
  }
  assert((expectedPlatform || platform) === platform, `Native proof platform ${platform} did not match ${expectedPlatform}`)
  assert((expectedArch || arch) === arch, `Native proof architecture ${arch} did not match ${expectedArch}`)

  return {
    testedSha: revision,
    headSha: declaredHeadSha || revision,
    baseSha: declaredBaseSha || null,
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  console.log(JSON.stringify(readNativeProofIdentity({ requireDeclared: true })))
}
