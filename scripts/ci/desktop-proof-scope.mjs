// Decides whether `Native desktop proof` has real work to do on this event.
//
// The gate has to report a conclusion on every pull request, or it can never be
// a required check: a workflow held back by a path filter leaves the check
// permanently pending and the pull request permanently unmergeable. So the
// workflow always runs, and this decides in a few seconds whether the native
// matrix does anything.
//
// The decision is the fingerprint itself, not a second copy of the path rules.
// If the tree named by CERTIFICATION_PROFILE_RUNTIME_PATHS is byte-identical
// between the merge base and the head, nothing that could invalidate the
// packaged proof changed, and the two matrix jobs pass on a Linux runner
// without checking anything out.

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeProfileRuntimeFingerprint } from '../certification/certification-manifest.mjs'

const FULL_SHA = /^[0-9a-f]{40}$/

// The native matrix, and the runner each leg lands on in each state. `runner`
// and `arch` render the two GitHub check names and never change, which is what
// lets the gate report the same two names whether or not it does real work.
// `host` is the machine that actually boots: the real one in scope, and the
// cheapest Linux runner out of scope, where every step is skipped.
export const NATIVE_DESKTOP_PROOF_MATRIX = Object.freeze([
  Object.freeze({ runner: 'macos-15', platform: 'darwin', arch: 'arm64' }),
  Object.freeze({ runner: 'windows-2025', platform: 'win32', arch: 'x64' }),
])
export const OUT_OF_SCOPE_HOST = 'ubuntu-24.04'

export function desktopProofMatrix(inScope) {
  return {
    include: NATIVE_DESKTOP_PROOF_MATRIX.map((leg) => ({
      ...leg,
      host: inScope ? leg.runner : OUT_OF_SCOPE_HOST,
    })),
  }
}

function git(arguments_, cwd) {
  const result = spawnSync('git', arguments_, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`Desktop proof scope could not run git ${arguments_.join(' ')}: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

export function decideDesktopProofScope({
  eventName,
  baseSha,
  headSha,
  cwd,
  computeFingerprint = computeProfileRuntimeFingerprint,
  mergeBase = (base, head) => git(['merge-base', base, head], cwd),
} = {}) {
  // Only a pull request can be narrowed. A push to main and a manual dispatch
  // are already path-filtered or deliberate, and both must do the real work.
  if (eventName !== 'pull_request') {
    return { inScope: true, reason: `${eventName} always runs the native proof` }
  }
  if (!FULL_SHA.test(baseSha ?? '') || !FULL_SHA.test(headSha ?? '')) {
    return { inScope: true, reason: 'the compared revisions are not both full SHAs' }
  }
  const base = mergeBase(baseSha, headSha)
  if (!FULL_SHA.test(base)) return { inScope: true, reason: 'no merge base could be read' }
  const baseFingerprint = computeFingerprint(base, { cwd })
  const headFingerprint = computeFingerprint(headSha, { cwd })
  if (baseFingerprint === headFingerprint) {
    return {
      inScope: false,
      reason: `the packaged runtime tree is unchanged from ${base.slice(0, 8)} (${headFingerprint})`,
      fingerprint: headFingerprint,
    }
  }
  return {
    inScope: true,
    reason: `the packaged runtime tree moved from ${baseFingerprint} to ${headFingerprint}`,
    fingerprint: headFingerprint,
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  const decision = decideDesktopProofScope({
    eventName: process.env.EIDO_DESKTOP_PROOF_EVENT_NAME,
    baseSha: process.env.EIDO_DESKTOP_PROOF_BASE_SHA,
    headSha: process.env.EIDO_DESKTOP_PROOF_HEAD_SHA,
  })
  process.stderr.write(
    `Native desktop proof ${decision.inScope ? 'runs' : 'passes without native work'}: ${decision.reason}\n`,
  )
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `in_scope=${decision.inScope}`,
      `reason=${decision.reason}`,
      `matrix=${JSON.stringify(desktopProofMatrix(decision.inScope))}`,
      '',
    ].join('\n'))
  }
}
