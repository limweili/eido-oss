// Live proof-reuse revalidation.
//
// Reusing #527's installed Gateway/CLI/MCP certification is only honest while
// the packaged Profile runtime tree it proved is still the tree being shipped.
// That used to be asserted by a hand-appended entry in
// CERTIFICATION_PROOF_REVALIDATIONS: a human wrote down a run URL and a hash,
// and CI compared the hash. The record was prose an author could get wrong, it
// forked between branches, and it blocked pull requests on bookkeeping.
//
// This module resolves the same claim from the thing that actually proves it.
// It lists recent `Native desktop proof` runs on `main`, finds a successful run
// whose tree fingerprint matches the tree under certification, confirms both
// native gate jobs concluded success, and returns a machine-written record. The
// record is sealed into every platform evidence packet, so the audit question
// "what evidence justified reusing #527 for this build?" is answered by the
// build's own immutable evidence rather than by a file in the repository.
//
// Selection is deterministic. The bounded push and workflow_dispatch pages are
// merged by run ID, sorted newest-first, and the newest run that proves this
// exact tree is chosen. The prepare job resolves it once and carries the sealed
// record into both native legs and final pairing; finalize-certification.mjs
// still fails closed if those packets ever disagree.

import { spawnSync } from 'node:child_process'

import {
  CERTIFICATION_PROOF_PATH_SET,
  NATIVE_DESKTOP_PROOF_ALLOWED_EVENTS,
  NATIVE_DESKTOP_PROOF_GATE_JOBS,
  NATIVE_DESKTOP_PROOF_WORKFLOW,
  NATIVE_DESKTOP_PROOF_WORKFLOW_FILE,
  assertResolvedProofRevalidation,
  computeProfileRuntimeFingerprint,
} from './certification-manifest.mjs'

// One page of the runs API. `Native desktop proof` runs on `main` a handful of
// times a day, so this window reaches back weeks. A tree older than the window
// is a tree nobody should be certifying without a fresh proof run anyway.
export const PROOF_RUN_WINDOW = 100

export function githubApi({ repository = process.env.GITHUB_REPOSITORY, cwd } = {}) {
  return (route) => {
    if (!repository) throw new Error('Proof revalidation needs GITHUB_REPOSITORY to reach the workflow API')
    const result = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', route.replace('{repo}', repository)], {
      encoding: 'utf8',
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    })
    if (result.error) throw new Error(`Proof revalidation could not run gh: ${result.error.message}`)
    if (result.status !== 0) throw new Error(`Proof revalidation API call failed (${route}): ${result.stderr.trim()}`)
    return JSON.parse(result.stdout)
  }
}

// A commit must be present locally before its tree can be fingerprinted. On a
// full checkout of `main` every candidate already is; this only reports the
// shallow case, and reports it as a setup failure rather than silently
// treating an unreadable tree as a mismatch.
export function assertCommitPresent(sha, cwd) {
  const present = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, encoding: 'utf8', windowsHide: true })
  if (present.status !== 0) {
    throw new Error(
      `Proof revalidation cannot read commit ${sha}. Check out with fetch-depth: 0 so main history is available.`,
    )
  }
}

export function resolveProofRevalidation({
  sourceSha,
  cwd,
  repository = process.env.GITHUB_REPOSITORY,
  api = githubApi({ repository, cwd }),
  computeFingerprint = computeProfileRuntimeFingerprint,
  ensureCommit = assertCommitPresent,
  window = PROOF_RUN_WINDOW,
} = {}) {
  const treeSha256 = computeFingerprint(sourceSha, { cwd })
  const runsById = new Map()
  for (const event of NATIVE_DESKTOP_PROOF_ALLOWED_EVENTS) {
    // GitHub's status filter can omit a completed run visible in its event list.
    const listed = api(
      `repos/{repo}/actions/workflows/${NATIVE_DESKTOP_PROOF_WORKFLOW_FILE}/runs`
        + `?event=${event}&branch=main&per_page=${window}`,
    )
    for (const run of listed.workflow_runs ?? []) {
      if (
        run.conclusion === 'success'
        && run.name === NATIVE_DESKTOP_PROOF_WORKFLOW
        && run.head_branch === 'main'
        && NATIVE_DESKTOP_PROOF_ALLOWED_EVENTS.includes(run.event)
      ) {
        runsById.set(run.id, run)
      }
    }
  }
  const runs = [...runsById.values()]
    .toSorted((left, right) => right.id - left.id)
    .slice(0, window)

  for (const run of runs) {
    ensureCommit(run.head_sha, cwd)
    if (computeFingerprint(run.head_sha, { cwd }) !== treeSha256) continue
    return describeProofRun({ run, repository, api, treeSha256 })
  }

  throw new Error(
    `No successful ${NATIVE_DESKTOP_PROOF_WORKFLOW} run on main covers the runtime tree of ${sourceSha} `
      + `(fingerprint ${treeSha256}) in the search of up to ${window} recent runs per allowed event. `
      + 'Land the change on main, or dispatch Native desktop proof on this SHA, before certifying '
      + '(see docs/agents/packaged-certification.md).',
  )
}

function describeProofRun({ run, repository, api, treeSha256 }) {
  const listed = api(`repos/{repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)
  const jobs = NATIVE_DESKTOP_PROOF_GATE_JOBS.map((name) => {
    const job = (listed.jobs ?? []).find((candidate) => candidate.name === name)
    if (job === undefined) throw new Error(`Run ${run.id} has no job named ${name}`)
    return { id: job.id, name: job.name, conclusion: job.conclusion }
  })
  const revalidation = {
    schemaVersion: 2,
    pathSet: CERTIFICATION_PROOF_PATH_SET,
    revalidatedSourceSha: run.head_sha,
    treeSha256,
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: NATIVE_DESKTOP_PROOF_WORKFLOW,
      repository: repository ?? run.repository?.full_name,
      runId: run.id,
      runAttempt: run.run_attempt,
      runUrl: `https://github.com/${repository ?? run.repository?.full_name}/actions/runs/${run.id}`,
      event: run.event,
      branch: run.head_branch,
      conclusion: run.conclusion,
      headSha: run.head_sha,
      jobs,
    },
  }
  assertResolvedProofRevalidation(revalidation)
  return revalidation
}
